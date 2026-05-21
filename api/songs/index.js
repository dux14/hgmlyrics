import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

// Module-scope cache. Fluid Compute reuses the instance across requests.
// Per-instance, not cross-instance — fine for a low-write wiki.
let listCache = null;
let listCacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

export function invalidateListCache() {
  listCache = null;
  listCacheAt = 0;
}

async function listSongs(_req, res) {
  if (listCache && Date.now() - listCacheAt < TTL_MS) {
    res.status(200).json(listCache);
    return;
  }

  const rows = await sql`
    SELECT id, title, artist, album, album_slug AS "albumSlug", year, genre,
           voice_type AS "voiceType",
           voice_percent_male AS "voicePercentMale",
           voice_percent_female AS "voicePercentFemale",
           cover_image AS "coverImage",
           album_order AS "albumOrder",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM songs
    ORDER BY album, album_order
  `;

  const songs = rows.map((r) => {
    const { voicePercentMale, voicePercentFemale, ...rest } = r;
    return { ...rest, voicePercent: { male: voicePercentMale, female: voicePercentFemale } };
  });

  listCache = { songs, total: songs.length };
  listCacheAt = Date.now();
  res.status(200).json(listCache);
}

async function createSong(req, res) {
  requireAdmin(req);
  const s = req.body ?? {};
  if (!s.id || !s.title) {
    res.status(400).json({ error: 'id and title are required' });
    return;
  }
  await sql`
    INSERT INTO songs (
      id, title, artist, album, album_slug, year, genre,
      voice_type, voice_percent_male, voice_percent_female,
      cover_image, sections, album_order, cejilla
    ) VALUES (
      ${s.id}, ${s.title}, ${s.artist ?? null}, ${s.album ?? null},
      ${s.albumSlug ?? null}, ${s.year ?? null}, ${s.genre ?? null},
      ${s.voiceType ?? null},
      ${s.voicePercent?.male ?? 50}, ${s.voicePercent?.female ?? 50},
      ${s.coverImage ?? null}, ${sql.json(s.sections ?? [])},
      ${s.albumOrder ?? 0}, ${s.cejilla ?? null}
    )
  `;
  invalidateListCache();
  res.status(201).json({ success: true, id: s.id });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST'])) return;
  if (req.method === 'GET') return listSongs(req, res);
  return createSong(req, res);
});
