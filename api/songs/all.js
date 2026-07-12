import sql from '../_lib/db.js';
import { allowMethods, cachePublic, withErrors } from '../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;

  const rows = await sql`
    SELECT id, title, artist, album, album_slug AS "albumSlug", year, genre,
           voice_type AS "voiceType",
           voice_percent_male AS "voicePercentMale",
           voice_percent_female AS "voicePercentFemale",
           cover_image AS "coverImage",
           sections,
           album_order AS "albumOrder",
           cejilla,
           voice_roster AS "voiceRoster",
           schema_version AS "schemaVersion",
           key,
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM songs
    ORDER BY album, album_order
  `;

  const songs = rows.map((r) => {
    const { voicePercentMale, voicePercentFemale, ...rest } = r;
    return { ...rest, voicePercent: { male: voicePercentMale, female: voicePercentFemale } };
  });

  // sections is already a JS array from JSONB — no JSON.parse needed.
  const version = rows.reduce((m, r) => {
    const t = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
    return t > m ? t : m;
  }, 0);

  cachePublic(res, { sMaxage: 60 });
  res.status(200).json({ songs, version });
});
