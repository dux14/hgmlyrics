import sql from '../_lib/db.js';
import { allowMethods, withErrors } from '../_lib/http.js';

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const q = (req.query?.q ?? '').toString().trim();
  if (!q) {
    res.status(200).json({ results: [] });
    return;
  }
  const needle = stripAccents(q).toLowerCase();

  const rows = await sql`
    SELECT id, title, artist, album, album_slug AS "albumSlug", year, genre,
           voice_type AS "voiceType",
           voice_percent_male AS "voicePercentMale",
           voice_percent_female AS "voicePercentFemale",
           cover_image AS "coverImage",
           album_order AS "albumOrder"
    FROM songs
  `;

  const results = rows
    .filter((r) =>
      stripAccents(`${r.title} ${r.album ?? ''} ${r.artist ?? ''}`)
        .toLowerCase()
        .includes(needle),
    )
    .slice(0, 15)
    .map((r) => {
      const { voicePercentMale, voicePercentFemale, ...rest } = r;
      return { ...rest, voicePercent: { male: voicePercentMale, female: voicePercentFemale } };
    });

  res.status(200).json({ results });
});
