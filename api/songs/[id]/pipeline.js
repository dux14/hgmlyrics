// Run del pipeline unificado por canción (spec 2026-07-20, Task B2).
// GET: estado del run activo con URLs firmadas de las pistas ya publicadas.
// POST: crea un run nuevo + URL de subida firmada del mp3 completo.
// DELETE: "reemplazar audio" (Task A2) — purga los artefactos derivados del
// audio viejo y cierra los runs. Ver purgeRun más abajo.
import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import {
  pipelineInputKey,
  createSongAudioSignedPutUrl,
  signSongAudioDownloads,
  deleteSongAudioObjects,
} from '../../_lib/storage.js';
import { deletePitchPrefix } from '../../pitch/_lib/storage.js';
import { initialPhases } from '../../_lib/pipeline/state.js';
import { titleSimilarity, TITLE_MATCH_THRESHOLD } from '../../_lib/pipeline/titleMatch.js';

// Run "actual" para el GET del stepper: el activo (no terminal) si existe, y si
// no, el último terminal 'done'/'failed'. Sin este fallback, una canción YA
// procesada (run 'done') caía en 404 y la vista de Procesamiento la mostraba
// como "no procesada" (0/6). Se excluyen 'cancelled'/'superseded' (historial:
// reemplazados por un run más nuevo o purgados) — el ORDER BY created_at ya deja
// arriba el activo cuando coexiste con un terminal viejo. El set no-terminal es
// el mismo del índice único parcial (song_pipeline_runs_one_active_per_song).
async function findCurrentRun(songId) {
  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath",
      input_meta AS "inputMeta", lyrics_review AS "lyricsReview", created_at AS "createdAt"
    FROM song_pipeline_runs
    WHERE song_id = ${songId}
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics',
                     'running', 'done', 'failed')
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

// Las pistas ya publicadas por una fase (phases[fase].tracks) se guardan como
// storage key; para el front necesitamos la URL de descarga firmada, no la key cruda.
async function signTracks(phases) {
  const signed = structuredClone(phases);
  // Junta TODAS las keys de todas las fases y las firma en UNA sola llamada
  // batch (createSignedUrls) en vez de un createSignedUrl por pista: evita la
  // ráfaga contra Storage que contribuye al 429 de Supabase.
  const refs = [];
  for (const phase of Object.keys(signed)) {
    const tracks = signed[phase]?.tracks;
    if (!tracks) continue;
    for (const [k, v] of Object.entries(tracks)) {
      if (typeof v === 'string') refs.push({ phase, k, key: v });
    }
  }
  if (refs.length === 0) return signed;
  const urls = await signSongAudioDownloads(refs.map((r) => r.key));
  refs.forEach((r, idx) => {
    signed[r.phase].tracks[r.k] = urls[idx];
  });
  return signed;
}

async function getRun(_req, res, songId) {
  const run = await findCurrentRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución activa para esta canción' });
    return;
  }
  // structure (Task 16): song_structure.segments no vive en phases.structure
  // (solo status/error, ver applyPhaseEvent en process.js) sino en su propia
  // tabla — se adjunta aquí para que StructureDetail no necesite un fetch
  // aparte del mismo run que ya consume el stepper.
  const [phases, [structureRow]] = await Promise.all([
    signTracks(run.phases),
    sql`SELECT segments FROM song_structure WHERE song_id = ${songId}`,
  ]);
  // El orden de song_structure.segments NO está garantizado en el productor
  // (mismo hallazgo que pipelineLinesFor en lyrics.js): ordenar acá por
  // startMs ascendente deja a TODOS los consumidores (StructureDetail
  // incluido) viendo el mismo orden cronológico, en vez de que cada uno
  // ordene (o no) por su cuenta.
  const segments = structureRow
    ? [...structureRow.segments].sort((a, b) => a.startMs - b.startMs)
    : null;
  const structure = segments ? { segments } : null;
  res.status(200).json({ run: { ...run, phases, structure } });
}

async function createRun(req, res, songId) {
  const user = await requireAdmin(req, sql);

  const songRows = await sql`SELECT id, title FROM songs WHERE id = ${songId}`;
  if (songRows.length === 0) {
    res.status(404).json({ error: 'Canción no encontrada' });
    return;
  }
  const song = songRows[0];

  const { filename, size = null, mime = null } = req.body ?? {};
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename es obligatorio' });
    return;
  }

  // El score bajo NO bloquea la creación del run: solo se persiste en
  // input_meta para que el front muestre la advertencia y el admin decida
  // (spec: el override es implícito, seguir adelante ES el override).
  const titleScore = titleSimilarity(filename, song.title);

  let rows;
  try {
    // Un run previo terminal ('failed' o 'done') no debe bloquear una nueva
    // ejecución con 409: se marca 'superseded' (limpiado luego por el cron,
    // api/pipeline/cleanup.js) y se crea el nuevo run. Atómico con el INSERT
    // (misma tx) para que no quede una ventana con dos runs "activos" a la
    // vez si el INSERT falla. Un run ACTIVO (running/awaiting_lyrics/etc.) NO
    // entra en este UPDATE y sigue dando 409 vía el índice único parcial.
    rows = await sql.begin(async (tx) => {
      await tx`
        UPDATE song_pipeline_runs SET status = 'superseded', updated_at = now()
        WHERE song_id = ${songId} AND status IN ('failed', 'done')
      `;
      return tx`
        INSERT INTO song_pipeline_runs (song_id, created_by, status, phases, input_meta)
        VALUES (${songId}, ${user.id}, 'created', ${tx.json(initialPhases())},
          ${tx.json({ filename, size, mime, titleScore })})
        RETURNING id
      `;
    });
  } catch (err) {
    // Índice único parcial song_pipeline_runs_one_active_per_song: ya hay un
    // run vivo para esta canción (mismo patrón 23505 de pitch/jobs.js).
    // Se valida el constraint exacto para no tragar otras violaciones de
    // unicidad (p.ej. una PK) como si fueran este caso esperado.
    if (
      err?.code === '23505' &&
      err?.constraint_name === 'song_pipeline_runs_one_active_per_song'
    ) {
      res.status(409).json({ error: 'Ya hay una ejecución activa para esta canción' });
      return;
    }
    throw err;
  }
  const runId = rows[0].id;
  const inputPath = pipelineInputKey(songId, runId);
  await sql`UPDATE song_pipeline_runs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${runId}`;

  const uploadUrl = await createSongAudioSignedPutUrl(inputPath);
  res.status(200).json({
    runId,
    uploadUrl,
    titleScore,
    threshold: TITLE_MATCH_THRESHOLD,
    songTitle: song.title,
  });
}

/**
 * DELETE = "reemplazar audio" (Task A2): purga TODOS los artefactos
 * derivados del audio (stems, clips del pipeline, estructura, pitch,
 * timings, mp3s de entrada de los runs) y cierra los runs. NUNCA toca
 * songs.sections (letra manual, independiente del pipeline) ni los clips
 * manuales de song_section_audio (run_id NULL). Idempotente: responde 200
 * incluso si no había nada que purgar.
 */
async function purgeRun(req, res, songId) {
  await requireAdmin(req, sql);

  // Storage keys a borrar: se leen ANTES de la transacción porque una vez
  // borradas las filas ya no hay forma de recuperar las keys.
  const [stemRows, clipRows, runRows] = await Promise.all([
    sql`SELECT storage_key AS "storageKey" FROM song_stems WHERE song_id = ${songId}`,
    sql`
      SELECT storage_key AS "storageKey" FROM song_section_audio
      WHERE song_id = ${songId} AND run_id IS NOT NULL
    `,
    sql`SELECT id, status, input_path FROM song_pipeline_runs WHERE song_id = ${songId} AND input_path IS NOT NULL`,
  ]);

  // Inputs de los runs: son las keys que se van a borrar del Storage más abajo
  // y, si el approve hizo el swap de audio, también las que song_audio está
  // referenciando.
  const inputPaths = runRows.map((r) => r.input_path).filter(Boolean);

  const purged = await sql.begin(async (tx) => {
    const stems = await tx`DELETE FROM song_stems WHERE song_id = ${songId}`;
    // Solo los clips del pipeline (run_id NOT NULL): los subidos a mano por
    // un admin (run_id NULL) sobreviven al reemplazo de audio.
    const clips = await tx`
      DELETE FROM song_section_audio WHERE song_id = ${songId} AND run_id IS NOT NULL
    `;
    const structure = await tx`DELETE FROM song_structure WHERE song_id = ${songId}`;
    const pitch = await tx`DELETE FROM song_pitch_analysis WHERE song_id = ${songId}`;
    // Store propio de letra IA (Task 4): la letra manual del cancionero
    // (songs.sections) nunca se toca aquí, solo el store del pipeline.
    const pipelineLyrics = await tx`DELETE FROM song_pipeline_lyrics WHERE song_id = ${songId}`;
    // Filtrado a provider='pipeline': song_line_timings es 1:1 por canción y
    // ese mismo registro lo puede ocupar un align standalone (provider
    // 'whisperx', ver modal/align_app.py) que no es un artefacto derivado de
    // este audio de pipeline y por lo tanto sobrevive al reemplazo.
    const timings = await tx`
      DELETE FROM song_line_timings WHERE song_id = ${songId} AND provider = 'pipeline'
    `;
    // H6 (auditoría del 24-jul): el approve apunta song_audio.storage_key al
    // runs/<runId>/full.mp3 del run, y ese objeto se borra del Storage unas
    // líneas más abajo. Dejar la fila viva deja la canción con un audio 404.
    // Se borra SOLO si la key es el input de un run purgado: si el audio vino
    // del flujo manual (<songId>/full.mp3, api/songs/[id]/audio.js) sobrevive
    // al reemplazo, igual que los clips manuales de song_section_audio.
    const audio = inputPaths.length
      ? await tx`
          DELETE FROM song_audio
          WHERE song_id = ${songId} AND storage_key IN ${tx(inputPaths)}
        `
      : { count: 0 };
    const cancelled = await tx`
      UPDATE song_pipeline_runs SET status = 'cancelled', updated_at = now()
      WHERE song_id = ${songId}
        AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
    `;
    // 'failed' se trata como terminal equivalente a 'done' (mismo criterio
    // que createRun más arriba): si no, un run failed queda con status
    // intacto pero input_path apuntando a un objeto ya borrado del storage.
    const superseded = await tx`
      UPDATE song_pipeline_runs SET status = 'superseded', updated_at = now()
      WHERE song_id = ${songId} AND status IN ('done', 'failed')
    `;
    return {
      stems: stems.count,
      clips: clips.count,
      structure: structure.count,
      pitch: pitch.count,
      pipelineLyrics: pipelineLyrics.count,
      timings: timings.count,
      audio: audio.count,
      cancelled: cancelled.count,
      superseded: superseded.count,
    };
  });

  // Storage best-effort DESPUÉS del commit: si el borrado de objetos falla,
  // las filas ya no existen (fuente de verdad) y el cron de limpieza puede
  // re-barrer keys huérfanas más adelante sin bloquear la respuesta aquí.
  const keys = [
    ...stemRows.map((r) => r.storageKey),
    ...clipRows.map((r) => r.storageKey),
    ...runRows.map((r) => r.input_path),
  ].filter(Boolean);
  await deleteSongAudioObjects(keys).catch(() => {});

  // Artefactos del pitch en el bucket pitch-jobs (deletePitchPrefix.js): el
  // signer del pipeline (api/pipeline/sign-upload.js) los sube bajo
  // pipeline/${songId}/${runId}/... . deletePitchPrefix solo lista subcarpetas
  // fijas bajo un prefijo EXACTO (no hace listado recursivo por prefijo
  // parcial), así que no alcanza con pipeline/${songId}/: hay que borrar
  // run por run. runRows ya trae todos los runs con input_path (único caso en
  // que la fase pitch pudo haber llegado a correr).
  await Promise.all(
    runRows.map((r) => deletePitchPrefix(`pipeline/${songId}/${r.id}`).catch(() => {})),
  );

  res.status(200).json({ success: true, purged });
}

async function renameRun(req, res, songId) {
  await requireAdmin(req, sql);
  const { displayName } = req.body ?? {};
  if (typeof displayName !== 'string' || !displayName.trim()) {
    res.status(400).json({ error: 'displayName es obligatorio' });
    return;
  }
  const clean = displayName.trim().slice(0, 200);

  const songRows = await sql`SELECT title FROM songs WHERE id = ${songId}`;
  if (songRows.length === 0) {
    res.status(404).json({ error: 'Canción no encontrada' });
    return;
  }
  const song = songRows[0];
  // El rename revalida contra el título real (review D3b): un "Revalidar" tras
  // corregir el nombre debe reflejar la coincidencia nueva, no la del POST original.
  const titleScore = titleSimilarity(clean, song.title);

  const result = await sql`
    UPDATE song_pipeline_runs
    SET input_meta = COALESCE(input_meta, '{}'::jsonb) || ${sql.json({ displayName: clean, titleScore })}::jsonb,
        updated_at = now()
    WHERE song_id = ${songId}
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'No hay una ejecución activa para esta canción' });
    return;
  }
  res
    .status(200)
    .json({ success: true, titleScore, threshold: TITLE_MATCH_THRESHOLD, songTitle: song.title });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'DELETE', 'PATCH'])) return;
  const songId = req.query.id;
  if (!songId || typeof songId !== 'string') {
    res.status(400).json({ error: 'id es obligatorio' });
    return;
  }
  if (req.method === 'GET') {
    await requireAdmin(req, sql);
    return getRun(req, res, songId);
  }
  if (req.method === 'POST') return createRun(req, res, songId);
  if (req.method === 'PATCH') return renameRun(req, res, songId);
  return purgeRun(req, res, songId);
});
