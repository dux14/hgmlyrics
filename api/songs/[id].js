import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { invalidateListCache } from './index.js';
import { isValidKey } from '../../src/lib/musicKeys.js';
import { validateSongV2, validateSongV3 } from '../../src/lib/voiceSystem.js';
import { persistLinksInTx } from '../_lib/songLinks.js';
import { projectCanonicalLines } from '../_lib/align.js';
import { validateSectionAudioMoves, applySectionAudioMoves } from '../_lib/sectionAudioMoves.js';
import { deleteSongAudioObjects } from '../_lib/storage.js';

function normalizeKey(v) {
  if (v === null || v === undefined || v === '') return null;
  if (!isValidKey(v)) {
    const err = new Error('Invalid key');
    err.status = 400;
    throw err;
  }
  return v;
}

async function getOne(req, res, id) {
  const rows = await sql`
    SELECT id, title, artist, album, album_slug AS "albumSlug", year, genre,
           voice_type AS "voiceType",
           voice_percent_male AS "voicePercentMale",
           voice_percent_female AS "voicePercentFemale",
           cover_image AS "coverImage",
           sections,
           voice_roster   AS "voiceRoster",
           schema_version AS "schemaVersion",
           album_order AS "albumOrder",
           cejilla,
           key,
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM songs WHERE id = ${id}
  `;
  if (rows.length === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }
  const r = rows[0];
  const { voicePercentMale, voicePercentFemale, ...rest } = r;
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=86400');
  res
    .status(200)
    .json({ ...rest, voicePercent: { male: voicePercentMale, female: voicePercentFemale } });
}

async function update(req, res, id) {
  await requireAdmin(req, sql);
  const s = req.body ?? {};
  const key = normalizeKey(s.key);
  // Validación server-side: v3 primero, luego v2; v1 conserva comportamiento.
  if (s.schemaVersion === 3) {
    try {
      validateSongV3(s);
    } catch (e) {
      res.status(400).json({ error: e.message });
      return;
    }
  } else if (s.schemaVersion === 2) {
    try {
      validateSongV2(s);
    } catch (e) {
      res.status(400).json({ error: e.message });
      return;
    }
  }
  // platformLinks/voiceLinks son opcionales: si no vienen, el comportamiento
  // es el de siempre (el editor viejo/SongLinks.js siguen usando el PUT
  // separado de links.js). Si vienen, se guardan en la MISMA transacción que
  // la canción — un link inválido revierte también el UPDATE de songs.
  const hasLinks = s.platformLinks !== undefined || s.voiceLinks !== undefined;
  // sectionAudioMoves: mapping viejo->nuevo índice de secciones que trae el
  // editor cuando el usuario movió/borró bloques con audio (Task 11). Se
  // valida ANTES de la tx para responder 400 sin tocar nada si viene corrupto.
  const hasMoves = s.sectionAudioMoves !== undefined;
  if (hasMoves) {
    const moveError = validateSectionAudioMoves(s.sectionAudioMoves, (s.sections ?? []).length);
    if (moveError) {
      res.status(400).json({ error: moveError });
      return;
    }
  }
  // Se lee ANTES de la tx para comparar sections tras el UPDATE y decidir si
  // los timings de alignment (song_line_timings) quedan obsoletos.
  const [prevRow] = await sql`SELECT sections FROM songs WHERE id = ${id}`;
  await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE songs SET
        title = ${s.title},
        artist = ${s.artist ?? null},
        album = ${s.album ?? null},
        album_slug = ${s.albumSlug ?? null},
        year = ${s.year ?? null},
        genre = ${s.genre ?? null},
        voice_type = ${s.voiceType ?? null},
        voice_percent_male = ${s.voicePercent?.male ?? 50},
        voice_percent_female = ${s.voicePercent?.female ?? 50},
        cover_image = ${s.coverImage ?? null},
        sections = ${sql.json(s.sections ?? [])},
        voice_roster = ${sql.json(s.voiceRoster ?? [])},
        schema_version = ${s.schemaVersion ?? 1},
        album_order = ${s.albumOrder ?? 0},
        cejilla = ${s.cejilla ?? null},
        key = ${key}
      WHERE id = ${id}
    `;
    // La canción pudo borrarse concurrentemente: si el UPDATE no afecto filas,
    // abortamos ANTES de tocar links (si no, el INSERT viola la FK song_id y
    // el error de Postgres sin .status tapa el 404 con un 500).
    if (result.count === 0) {
      const err = new Error('Song not found');
      err.status = 404;
      throw err;
    }
    if (hasLinks) {
      await persistLinksInTx(tx, id, s.platformLinks ?? [], s.voiceLinks ?? []);
    }
    if (hasMoves && s.sectionAudioMoves.length > 0) {
      await applySectionAudioMoves(tx, id, s.sectionAudioMoves);
    }
  });

  // La letra (sections) cambio -> los timings de alignment ya no corresponden
  // a las lineas canonicas indexadas. No re-dispara Modal aca: solo marca
  // stale; el re-alineado ocurre en la proxima subida de audio (dispatchAlign).
  // Se compara la proyeccion canonica (unico dato que importa a los timings),
  // no el JSON crudo: sections leido de Postgres (JSONB) reordena las claves
  // de los objetos internamente, asi que comparar strings crudos da falsos
  // positivos aunque el contenido relevante sea identico.
  const sectionsChanged =
    JSON.stringify(projectCanonicalLines(prevRow?.sections)) !==
    JSON.stringify(projectCanonicalLines(s.sections));
  if (sectionsChanged) {
    await sql`UPDATE song_line_timings SET status = 'stale' WHERE song_id = ${id}`;
  }

  invalidateListCache();
  res.status(200).json({ success: true });
}

async function remove(req, res, id) {
  await requireAdmin(req, sql);

  // Storage primero, mismo criterio que deleteAudio en audio.js: si el
  // remove falla, se corta antes de borrar la fila (withErrors la vuelve
  // 500 y el admin puede reintentar) en vez de dejar objetos huerfanos en
  // el bucket sin ninguna fila que los referencie. Una sola llamada batch
  // (no un loop por-key): una canción con muchas secciones x scopes podía
  // acercarse al maxDuration de la función con round-trips seriados.
  const sectionKeys =
    await sql`SELECT storage_key AS "storageKey" FROM song_section_audio WHERE song_id = ${id}`;
  const audioKeys =
    await sql`SELECT storage_key AS "storageKey" FROM song_audio WHERE song_id = ${id}`;
  const allKeys = [...sectionKeys, ...audioKeys].map((r) => r.storageKey);
  await deleteSongAudioObjects(allKeys);

  const result = await sql`DELETE FROM songs WHERE id = ${id}`;
  if (result.count === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }
  invalidateListCache();
  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'PUT', 'DELETE'])) return;
  const id = req.query.id;
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  if (req.method === 'GET') return getOne(req, res, id);
  if (req.method === 'PUT') return update(req, res, id);
  return remove(req, res, id);
});
