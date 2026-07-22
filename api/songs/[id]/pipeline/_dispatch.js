// _dispatch.js — helper compartido por confirm.js y retry.js para armar los
// argumentos de cada dispatch* de api/_lib/pipeline/dispatch.js a partir del
// run persistido. Prefijo `_`: no es una ruta, mismo criterio que api/pitch/_lib.
import {
  dispatchStems,
  dispatchTranscribe,
  dispatchAlign,
  dispatchPitch,
  dispatchClips,
} from '../../../_lib/pipeline/dispatch.js';
import {
  pipelineStemKey,
  createSongAudioSignedPutUrl,
  signSongAudioDownload,
} from '../../../_lib/storage.js';
import { projectCanonicalLines, projectLineSections } from '../../../_lib/align.js';
import sql from '../../../_lib/db.js';
import { STEM_KINDS, SECTION_KEYS } from '../../../stems/_sections.js';

// Pistas que produce la fase 'stems' agrupadas por sección Modal (mismo shape
// {seccion: {pista: url}} que arma api/stems/jobs/[id]/start.js). STEM_KINDS
// (kinds que cada sección PUBLICA en song_stems) vive en api/stems/_sections.js
// — único hogar compartido con api/_lib/pipeline/stemsAdapter.js, que filtra
// por ese mapa antes de publicar (fix review Task 6: la vocals de S1 llegaba
// a publicarse igual, protegida solo por el orden temporal S1→S3 del DAG).

// UPLOAD_SLOTS = archivos que SUBE cada sección Modal (distinto de STEM_KINDS
// solo en voiceInstrumental: S1/extract siempre sube las 7 pistas, incl.
// `vocals` — stemsAdapter la descarta al publicar, ver STEM_KINDS).
// TODO(Task 9 paralelizacion): S1 y S3 suben su `vocals` a la MISMA storage
// key fisica (pipelineStemKey(songId,'vocals')). Hoy no hay colision real
// porque S1 termina antes de que S3 arranque (run_pipeline espera s1_call.get()
// antes de spawnear S3); al paralelizar S1-S5 esa garantia desaparece y el
// archivo final en esa key queda no-determinista entre S1/S3 (impacto bajo:
// contenido casi identico, mismo checkpoint de extraccion vocal) — evaluar
// subir el `vocals` de S1 a una key aparte si se necesita determinismo estricto.
export const UPLOAD_SLOTS = {
  ...STEM_KINDS,
  voiceInstrumental: ['vocals', ...STEM_KINDS.voiceInstrumental],
};

// Las 5 secciones del DAG Modal (modal/stems_app.py run_pipeline), mismo orden
// que SECTION_KEYS. S1 (voiceInstrumental) corre siempre sin importar
// enabledSections; S2 (structure) / S3 (leadBacking) / S4 (gender) / S5 (duet)
// sí se gatean acá.
export const ENABLED_SECTIONS = SECTION_KEYS;

function webhookUrl() {
  return `${process.env.PUBLIC_BASE_URL}/api/pipeline/webhook`;
}

/**
 * Líneas de texto de la letra actual en DB (`songs.sections`), en el mismo
 * orden/regla que `projectCanonicalLines` (align.js) — mismo criterio que
 * usa `dispatchAlign` para armar `lines`.
 * @param {string} songId
 * @returns {Promise<string[]>}
 */
async function dbLinesFor(songId) {
  const [song] = await sql`SELECT sections FROM songs WHERE id = ${songId}`;
  return projectCanonicalLines(song?.sections).map((l) => l.text);
}

/**
 * Líneas de texto de la letra canónica ingerida (fuente externa, tabla
 * `song_lyrics_canonical`), si existe. Shape del ingest:
 * `{ secciones: [ { lineas: [ { texto } ] } ] }` — se aplana a un solo array.
 * @param {string} songId
 * @returns {Promise<string[]|undefined>}
 */
async function canonicalLinesFor(songId) {
  const [row] = await sql`SELECT content FROM song_lyrics_canonical WHERE song_id = ${songId}`;
  if (!row?.content) return undefined;
  const secciones = row.content.secciones || [];
  const lines = secciones.flatMap((s) => (s.lineas || []).map((l) => l.texto));
  return lines.length ? lines : undefined;
}

async function stemsUploads(songId) {
  const entries = await Promise.all(
    Object.entries(UPLOAD_SLOTS).map(async ([section, kinds]) => {
      const signed = await Promise.all(
        kinds.map(async (k) => [k, await createSongAudioSignedPutUrl(pipelineStemKey(songId, k))]),
      );
      // gender usa estructura anidada por modelo (ver modal/sections/gender.py,
      // solo queda vigente chorus_bs_roformer): uploads.gender.chorus.{male,female}.
      if (section === 'gender') return [section, { chorus: Object.fromEntries(signed) }];
      return [section, Object.fromEntries(signed)];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Despacha la fase `phase` de un run ya persistido (el llamador hizo el CAS
 * de estado antes de invocar, igual criterio que dispatch.js). `transcription`
 * y `clips` dependen de apps Modal que aún no existen (Task B5/B6, ver
 * comentarios en dispatch.js) — fallan igual con un 500 claro, sin guard especial.
 * @param {'stems'|'transcription'|'sync'|'pitch'|'clips'} phase
 * @param {{id:string, songId:string, inputPath:string, phases:object}} run
 * @returns {Promise<{id:string}>}
 */
export async function dispatchPhase(phase, run) {
  const webhook = webhookUrl();
  if (phase === 'stems') {
    const inputGetUrl = await signSongAudioDownload(run.inputPath);
    const uploads = await stemsUploads(run.songId);
    return dispatchStems({
      run: { id: run.id, songId: run.songId, inputGetUrl },
      uploads,
      enabledSections: ENABLED_SECTIONS,
      webhookUrl: webhook,
    });
  }
  if (phase === 'transcription') {
    const vocalsKey = run.phases.stems?.tracks?.vocals;
    if (!vocalsKey) {
      const e = new Error("Fase 'stems' sin pista vocals: no se puede transcribir");
      e.status = 409;
      throw e;
    }
    const [vocalsGetUrl, dbLines, canonicalLines] = await Promise.all([
      signSongAudioDownload(vocalsKey),
      dbLinesFor(run.songId),
      canonicalLinesFor(run.songId),
    ]);
    // `run.lyricsReview` NO viaja hoy en el objeto `run` que reciben
    // confirm.js/retry.js (su SELECT no trae `lyrics_review`) — en la fase
    // transcription normalmente no hay snapshot aprobado todavía, así que
    // queda undefined salvo que el llamador ya lo incluya.
    return dispatchTranscribe({
      run: { id: run.id, songId: run.songId },
      vocalsGetUrl,
      dbLines,
      canonicalLines,
      snapshotHash: run.lyricsReview?.approvedHash,
      webhookUrl: webhook,
    });
  }
  if (phase === 'sync') {
    // ver nota de transcription/pitch arriba: run.lyricsReview aún no viaja
    // desde confirm.js/retry.js, undefined por ahora si no hay aprobación.
    return dispatchAlign(run.songId, run.lyricsReview?.approvedHash);
  }
  if (phase === 'pitch') {
    const leadKey = run.phases.stems?.tracks?.lead;
    const backingKey = run.phases.stems?.tracks?.backing;
    if (!leadKey || !backingKey) {
      const e = new Error("Fase 'stems' sin lead/backing: no se puede analizar el pitch");
      e.status = 409;
      throw e;
    }
    const [leadGetUrl, backingGetUrl] = await Promise.all([
      signSongAudioDownload(leadKey),
      signSongAudioDownload(backingKey),
    ]);
    return dispatchPitch({
      run: { id: run.id, songId: run.songId },
      leadGetUrl,
      backingGetUrl,
      // ver nota de transcription arriba: run.lyricsReview aún no viaja desde
      // confirm.js/retry.js, undefined por ahora si no hay aprobación.
      snapshotHash: run.lyricsReview?.approvedHash,
      webhookUrl: webhook,
    });
  }
  // clips (Task B6+plan C, Task 8 song_structure): stems/lines vienen de
  // song_stems (vía run.phases.stems.tracks) y song_line_timings.
  // lineSections/totalMs se derivan de los segmentos reales detectados por
  // SongFormer (song_structure, fase `structure`) cuando existen; si no hay
  // fila song_structure, caen al fallback anterior: snapshot de letra ya
  // aprobado (plan C publica songs.sections + line timings vía sync antes de
  // que ADVANCE_AFTER dispare clips).
  const tracks = run.phases.stems?.tracks || {};
  const [song, stems, lineTimingsRow, audioRow, structureRow] = await Promise.all([
    sql`SELECT sections FROM songs WHERE id = ${run.songId}`,
    Promise.all(
      Object.entries(tracks).map(async ([kind, key]) => ({ kind, getUrl: await signSongAudioDownload(key) })),
    ),
    sql`SELECT lines FROM song_line_timings WHERE song_id = ${run.songId}`,
    sql`SELECT duration_sec AS "durationSec" FROM song_audio WHERE song_id = ${run.songId}`,
    sql`SELECT segments FROM song_structure WHERE song_id = ${run.songId}`,
  ]);
  const lines = lineTimingsRow[0]?.lines || [];
  // Segmentos detectados (ya en ms, ver supabase/migrations/20260722010000_song_structure.sql):
  // [{label, startMs, endMs}]. Nada garantiza en el productor (stemsAdapter/
  // process.js no ordenan) que lleguen ordenados/contiguos, así que acá se
  // ordenan defensivamente por startMs ascendente y se descartan filas con
  // startMs/endMs no finitos antes de derivar nada (review Task 8, Important).
  const rawSegments = structureRow[0]?.segments;
  const detectedSegments = Array.isArray(rawSegments)
    ? rawSegments
        .filter((s) => Number.isFinite(s?.startMs) && Number.isFinite(s?.endMs))
        .sort((a, b) => a.startMs - b.startMs)
    : [];
  const hasDetectedSegments = detectedSegments.length > 0;

  // canonicalSections[i] = índice de sección de la línea canónica i (mismo
  // orden que usa song_line_timings.lines[].i, ver projectCanonicalLines).
  // lineSections queda paralelo a `lines` (mismo largo, mismo orden), como
  // espera modal/clips_app.py: lineSections[k] = sección de lines[k].
  const canonicalSections = projectLineSections(song[0]?.sections);
  // Con segmentos detectados: sección de una línea = índice del último
  // segmento (ya ordenado) cuyo startMs no supera el startMs de la línea.
  const lineSections = hasDetectedSegments
    ? lines.map((l) => {
        let idx = 0;
        for (let s = 0; s < detectedSegments.length; s += 1) {
          if (detectedSegments[s].startMs <= (l.startMs || 0)) idx = s;
          else break;
        }
        return idx;
      })
    : lines.map((l) => canonicalSections[l.i] ?? 0);
  // duration_sec es NUMERIC en Postgres → llega como string vía postgres.js.
  // Puede ser null (caso real observado); ahí se cae a la última línea
  // conocida (máximo startMs) en vez de dispatchear con 0. Con segmentos
  // detectados, totalMs es el máximo endMs (no el del último elemento
  // posicional — ya se ordenó arriba, pero calcularlo así es robusto igual
  // si algún día conviven segmentos solapados).
  const durationSec = audioRow[0]?.durationSec;
  const totalMs = hasDetectedSegments
    ? Math.max(...detectedSegments.map((s) => s.endMs))
    : durationSec !== null && durationSec !== undefined
      ? Math.round(Number(durationSec) * 1000)
      : lines.reduce((max, l) => Math.max(max, l.startMs || 0), 0);
  // sectionCount/uploads/uploadKeys quedan SIEMPRE atados a `song.sections`
  // (letra actual en DB), nunca al conteo de segmentos detectados: son la
  // misma columna section_index que usan api/songs/[id]/section-audio.js
  // (valida contra song.sections.length) y SongView.js (renderiza audio por
  // .lyrics__section indexado por song.sections). La reconciliación
  // estructura↔letra está diferida a Task 15 (review Task 8, Critical) — acá
  // los segmentos detectados solo alimentan lineSections/totalMs arriba.
  const sectionCount = song[0]?.sections?.length || 0;
  const uploads = {};
  const uploadKeys = {};
  for (const kind of Object.keys(tracks)) {
    uploads[kind] = {};
    uploadKeys[kind] = {};
    for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
      const key = `${run.songId}/clips/${kind}/section-${sectionIndex}.mp3`;
      // Volumen bajo (secciones de una canción): claridad > paralelismo aquí.
      uploads[kind][String(sectionIndex)] = await createSongAudioSignedPutUrl(key);
      uploadKeys[kind][String(sectionIndex)] = key;
    }
  }
  return dispatchClips({
    run: { id: run.id, songId: run.songId },
    stems,
    lines,
    lineSections,
    totalMs,
    uploads,
    uploadKeys,
    snapshotHash: run.lyricsReview?.approvedHash,
    webhookUrl: webhook,
  });
}
