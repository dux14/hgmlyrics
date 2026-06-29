import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { invalidateListCache } from './index.js';
import { isValidKey } from '../../src/lib/musicKeys.js';
import { validateSongV2, validateSongV3 } from '../../src/lib/voiceSystem.js';

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
  const result = await sql`
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
  if (result.count === 0) {
    res.status(404).json({ error: 'Song not found' });
    return;
  }
  invalidateListCache();
  res.status(200).json({ success: true });
}

async function remove(req, res, id) {
  await requireAdmin(req, sql);
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
