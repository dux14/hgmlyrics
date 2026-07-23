// Run del pipeline unificado por canción (spec 2026-07-20, Task B2).
// GET: estado del run activo con URLs firmadas de las pistas ya publicadas.
// POST: crea un run nuevo + URL de subida firmada del mp3 completo.
// DELETE: cancela el run activo.
import sql from '../../_lib/db.js';
import { requireAdmin } from '../../_lib/auth.js';
import { allowMethods, withErrors } from '../../_lib/http.js';
import { pipelineInputKey, createSongAudioSignedPutUrl, signSongAudioDownload } from '../../_lib/storage.js';
import { initialPhases } from '../../_lib/pipeline/state.js';
import { titleSimilarity, TITLE_MATCH_THRESHOLD } from '../../_lib/pipeline/titleMatch.js';

async function findActiveRun(songId) {
  const rows = await sql`
    SELECT id, song_id AS "songId", status, phases, input_path AS "inputPath",
      input_meta AS "inputMeta", lyrics_review AS "lyricsReview", created_at AS "createdAt"
    FROM song_pipeline_runs
    WHERE song_id = ${songId}
      -- Estados no terminales: mismo set que el índice único parcial de la
      -- migración (song_pipeline_runs_one_active_per_song).
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

// Las pistas ya publicadas por una fase (phases[fase].tracks) se guardan como
// storage key; para el front necesitamos la URL de descarga firmada, no la key cruda.
async function signTracks(phases) {
  const signed = structuredClone(phases);
  for (const phase of Object.keys(signed)) {
    const tracks = signed[phase]?.tracks;
    if (!tracks) continue;
    const entries = await Promise.all(
      Object.entries(tracks).map(async ([k, v]) => [
        k,
        typeof v === 'string' ? await signSongAudioDownload(v) : v,
      ]),
    );
    signed[phase] = { ...signed[phase], tracks: Object.fromEntries(entries) };
  }
  return signed;
}

async function getRun(_req, res, songId) {
  const run = await findActiveRun(songId);
  if (!run) {
    res.status(404).json({ error: 'No hay una ejecución activa para esta canción' });
    return;
  }
  // structure (Task 16): song_structure.segments no vive en phases.structure
  // (solo status/error, ver applyPhaseEvent en process.js) sino en su propia
  // tabla — se adjunta acá para que StructureDetail no necesite un fetch
  // aparte del mismo run que ya consume el stepper.
  const [phases, [structureRow]] = await Promise.all([
    signTracks(run.phases),
    sql`SELECT segments FROM song_structure WHERE song_id = ${songId}`,
  ]);
  const structure = structureRow ? { segments: structureRow.segments } : null;
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
    if (err?.code === '23505' && err?.constraint_name === 'song_pipeline_runs_one_active_per_song') {
      res.status(409).json({ error: 'Ya hay una ejecución activa para esta canción' });
      return;
    }
    throw err;
  }
  const runId = rows[0].id;
  const inputPath = pipelineInputKey(songId, runId);
  await sql`UPDATE song_pipeline_runs SET input_path = ${inputPath}, updated_at = now() WHERE id = ${runId}`;

  const uploadUrl = await createSongAudioSignedPutUrl(inputPath);
  res.status(200).json({ runId, uploadUrl, titleScore, threshold: TITLE_MATCH_THRESHOLD, songTitle: song.title });
}

async function cancelRun(req, res, songId) {
  await requireAdmin(req, sql);
  const result = await sql`
    UPDATE song_pipeline_runs SET status = 'cancelled', updated_at = now()
    WHERE song_id = ${songId}
      AND status IN ('created', 'uploading', 'processing', 'awaiting_lyrics', 'running')
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'No hay una ejecución activa para esta canción' });
    return;
  }
  res.status(200).json({ success: true });
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
  res.status(200).json({ success: true, titleScore, threshold: TITLE_MATCH_THRESHOLD, songTitle: song.title });
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
  return cancelRun(req, res, songId);
});
