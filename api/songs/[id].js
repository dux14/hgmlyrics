import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { invalidateListCache } from './index.js';

async function getOne(req, res, id) {
  const rows = await sql`
    SELECT id, title, artist, album, album_slug AS "albumSlug", year, genre,
           voice_type AS "voiceType",
           voice_percent_male AS "voicePercentMale",
           voice_percent_female AS "voicePercentFemale",
           cover_image AS "coverImage",
           sections,
           album_order AS "albumOrder",
           cejilla,
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
  res
    .status(200)
    .json({ ...rest, voicePercent: { male: voicePercentMale, female: voicePercentFemale } });
}

async function update(req, res, id) {
  requireAdmin(req);
  const s = req.body ?? {};
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
      album_order = ${s.albumOrder ?? 0},
      cejilla = ${s.cejilla ?? null}
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
  requireAdmin(req);
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
