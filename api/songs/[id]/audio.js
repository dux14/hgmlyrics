import sql from '../../_lib/db.js';
import { requireUser, requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import {
  createSongAudioSignedPutUrl,
  signSongAudioDownload,
  deleteSongAudioObject,
} from '../../_lib/storage.js';
import { dispatchAlign } from '../../_lib/align.js';
import { validatePatchBody, validateLineTimingShape } from '../../_lib/beats.js';
import { getPipelineLyrics } from '../../_lib/pipeline/lyricsStore.js';
import { timingLinesFromSections } from './pipeline/lyrics.js';

// GET: audio completo + estado de timings para la vista inmersiva.
async function getAudio(_req, res, songId) {
  // Lecturas independientes por songId: en paralelo (una ida a la DB menos en
  // el camino que decide la promocion al player sincronizado).
  const [[audio], [timings]] = await Promise.all([
    sql`
      SELECT storage_key AS "storageKey", duration_sec AS "durationSec",
        bpm_manual AS "bpmManual", time_signature AS "timeSignature",
        beat_anchor AS "beatAnchor"
      FROM song_audio WHERE song_id = ${songId}
    `,
    sql`
      SELECT status, lines, bpm_detected AS "bpmDetected", beats
      FROM song_line_timings WHERE song_id = ${songId}
    `,
  ]);
  if (!audio) {
    res.status(200).json({ audio: null, timings: null });
    return;
  }
  const audioOut = {
    url: await signSongAudioDownload(audio.storageKey),
    // NUMERIC llega como string del driver pg; el contrato del GET es number
    // (Number.isFinite en el editor no coacciona strings, p. ej. el clamp de
    // la ultima linea en la correccion manual usa durationSec * 1000).
    durationSec: audio.durationSec == null ? null : Number(audio.durationSec),
    bpmManual: audio.bpmManual == null ? null : Number(audio.bpmManual),
    timeSignature: audio.timeSignature,
    beatAnchor: audio.beatAnchor,
  };
  const bpmDetected = timings?.bpmDetected == null ? null : Number(timings.bpmDetected);
  const beats = Array.isArray(timings?.beats?.beatsMs) ? timings.beats.beatsMs : null;

  // F4: la letra aprobada del pipeline (song_pipeline_lyrics) es la fuente
  // canonica del karaoke cuando existe — texto y timing salen del store, no
  // de songs.sections. bpmDetected/beats siguen viniendo de
  // song_line_timings: el metronomo no cambia de fuente (F3).
  const pipelineLyrics = await getPipelineLyrics(sql, songId);
  if (pipelineLyrics) {
    const flat = pipelineLyrics.sections.flatMap((s) => s.lines);
    const baseLines = timingLinesFromSections(pipelineLyrics.sections);
    const lines = baseLines.map((l, k) => ({
      ...l,
      text: flat[k]?.text ?? null,
      manual: flat[k]?.manualStartMs != null,
    }));
    res.status(200).json({
      audio: audioOut,
      timings: { status: 'ready', lines, bpmDetected, beats },
    });
    return;
  }

  res.status(200).json({
    audio: audioOut,
    // beats se guarda como JSONB { bpm, beatsMs } (shape explícito del webhook);
    // el contrato del GET es la rejilla plana en ms — lo que consume el front
    // (setupMetronome exige Array). bpm ya viaja aparte como bpmDetected.
    timings: timings
      ? {
          ...timings,
          bpmDetected,
          beats,
          // score/interpolated: filas persistidas antes de la Task 5.2 no los
          // traen en el JSONB — se rellenan con defaults (patrón defensivo
          // igual a bpmDetected arriba).
          lines: Array.isArray(timings.lines)
            ? timings.lines.map((l) => ({
                ...l,
                score: typeof l.score === 'number' ? l.score : null,
                interpolated: l.interpolated === true,
                manual: l.manual === true,
              }))
            : timings.lines,
        }
      : null,
  });
}

async function postAudio(req, res, songId) {
  await requireAdmin(req, sql);
  const { confirm = false, durationSec = null } = req.body ?? {};

  const songRows = await sql`SELECT id FROM songs WHERE id = ${songId}`;
  if (songRows.length === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }

  if (confirm) {
    // La subida directa a Storage ya ocurrió (PUT firmado del paso anterior);
    // esto solo confirma duracion y resetea/dispara el alignment (decision 5
    // del spec: automatico, sin paso manual extra del admin).
    const result = await sql`
      UPDATE song_audio SET duration_sec = ${durationSec} WHERE song_id = ${songId}
    `;
    // Si no hubo fila song_audio (confirm fuera de orden o DELETE concurrente),
    // cortamos ANTES de tocar song_line_timings/dispatchAlign (mismo patrón que
    // api/songs/[id].js:97/114 y api/social/friends.js:78/96).
    if (result.count === 0) {
      res.status(404).json({ error: 'Audio no encontrado' });
      return;
    }
    // El reset a 'pending' NO pisa un job en vuelo ('processing' fresco): eso
    // anularia el guard de idempotencia de dispatchAlign y despacharia un
    // SEGUNDO job a Modal (el webhook correlaciona solo por songId — el ultimo
    // en llegar ganaria, aunque sea el viejo). El umbral de 20 min deja escape
    // para un 'processing' colgado (webhook caido persistente).
    await sql`
      INSERT INTO song_line_timings (song_id, status, lines, error)
      VALUES (${songId}, 'pending', NULL, NULL)
      ON CONFLICT (song_id)
      DO UPDATE SET status = 'pending', lines = NULL, error = NULL, bpm_detected = NULL, beats = NULL
      WHERE song_line_timings.status <> 'processing'
         OR song_line_timings.updated_at < now() - interval '20 minutes'
    `;
    await dispatchAlign(songId);
    res.status(200).json({ success: true });
    return;
  }

  // La key SIEMPRE se construye server-side (nunca se acepta la del cliente).
  const key = `${songId}/full.mp3`;

  await sql`
    INSERT INTO song_audio (song_id, storage_key)
    VALUES (${songId}, ${key})
    ON CONFLICT (song_id)
    DO UPDATE SET storage_key = excluded.storage_key
  `;

  const uploadUrl = await createSongAudioSignedPutUrl(key);
  res.status(200).json({ uploadUrl, key });
}

// PATCH: overrides de admin (bpm manual, compas, ancla del metronomo). Solo
// toca los campos presentes en el body — undefined = no tocar, null = limpiar
// el override (ver validatePatchBody). No calcula valores efectivos: eso lo
// compone el front combinando este override con bpmDetected/beats del GET.
async function patchAudio(req, res, songId) {
  await requireAdmin(req, sql);

  // Rama excluyente: el front nunca mezcla ajuste de metronomo y de linea en
  // el mismo request (ver patchLineTiming). requireAdmin ya corrio arriba.
  if (req.body && req.body.lineTiming !== undefined) {
    return patchLineTiming(res, songId, req.body.lineTiming);
  }

  const err = validatePatchBody(req.body ?? null);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }

  const { bpmManual, timeSignature, beatAnchor } = req.body;
  const updates = {};
  if (bpmManual !== undefined) updates.bpm_manual = bpmManual;
  if (timeSignature !== undefined) updates.time_signature = timeSignature;
  if (beatAnchor !== undefined) updates.beat_anchor = beatAnchor;

  const result = await sql`
    UPDATE song_audio SET ${sql(updates)} WHERE song_id = ${songId}
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'Audio no encontrado' });
    return;
  }
  res.status(200).json({ success: true });
}

// Correccion manual del startMs de UNA linea del alignment (spec
// 2026-07-12-offset-manual-linea-design). Edicion in-place del JSONB lines
// con flag manual:true; un re-align posterior la pisa (el webhook no emite
// manual — semantica elegida: el ajuste manual es la ultima milla DESPUES
// del align definitivo).
async function patchLineTiming(res, songId, lineTiming) {
  const shapeErr = validateLineTimingShape(lineTiming);
  if (shapeErr) {
    res.status(400).json({ error: shapeErr });
    return;
  }
  const [row] = await sql`
    SELECT status, lines FROM song_line_timings WHERE song_id = ${songId}
  `;
  if (!row) {
    res.status(404).json({ error: 'Sincronía no encontrada' });
    return;
  }
  // 'ready' como precondicion cierra tambien la carrera con un job en vuelo:
  // el ciclo de alignment vive en pending/processing, asi que el PATCH queda
  // bloqueado hasta que el webhook resuelva.
  if (row.status !== 'ready' || !Array.isArray(row.lines)) {
    res.status(409).json({ error: 'La sincronía no está lista' });
    return;
  }
  const idx = row.lines.findIndex((l) => l?.i === lineTiming.i);
  if (idx === -1) {
    res.status(400).json({ error: `Línea ${lineTiming.i} inexistente` });
    return;
  }
  // Mismo invariante estrictamente creciente que validateLines del webhook
  // (seekSyncToLine lo asume): el nuevo startMs debe caber entre vecinas.
  const prev = row.lines[idx - 1];
  const next = row.lines[idx + 1];
  if (prev && lineTiming.startMs <= prev.startMs) {
    res.status(400).json({ error: 'startMs rompe la monotonía con la línea anterior' });
    return;
  }
  if (next && lineTiming.startMs >= next.startMs) {
    res.status(400).json({ error: 'startMs rompe la monotonía con la línea siguiente' });
    return;
  }
  // Shape explicito linea a linea (mismo patron que linesRow del webhook):
  // claves extra del JSONB viejo no se propagan.
  const newLines = row.lines.map((l, k) => {
    const base = {
      i: l.i,
      startMs: l.startMs,
      score: typeof l.score === 'number' ? l.score : null,
      interpolated: l.interpolated === true,
    };
    if (l.manual === true) base.manual = true;
    if (k !== idx) return base;
    return { ...base, startMs: lineTiming.startMs, manual: true };
  });
  const result = await sql`
    UPDATE song_line_timings SET lines = ${sql.json(newLines)}
    WHERE song_id = ${songId} AND status = 'ready'
  `;
  if (result.count === 0) {
    res.status(409).json({ error: 'La sincronía cambió, recarga el editor' });
    return;
  }
  res.status(200).json({ success: true });
}

async function deleteAudio(req, res, songId) {
  await requireAdmin(req, sql);

  const rows =
    await sql`SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${songId}`;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Audio no encontrado' });
    return;
  }

  // Storage primero: si el remove falla, se corta antes de borrar filas y no
  // queda huerfano silencioso (el DELETE lanza 500 vía withErrors y el admin
  // puede reintentar; si borráramos las filas primero y el remove fallara, el
  // mp3 quedaría huérfano en el bucket sin ninguna fila que lo referencie).
  await deleteSongAudioObject(rows[0].storageKey);
  await sql`DELETE FROM song_audio WHERE song_id = ${songId}`;
  await sql`DELETE FROM song_line_timings WHERE song_id = ${songId}`;

  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'DELETE', 'PATCH'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  if (req.method === 'GET') {
    await requireUser(req);
    return getAudio(req, res, songId);
  }
  if (req.method === 'POST') return postAudio(req, res, songId);
  if (req.method === 'PATCH') return patchAudio(req, res, songId);
  return deleteAudio(req, res, songId);
});
