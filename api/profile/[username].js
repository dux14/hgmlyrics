import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const viewer = await requireUser(req);

  const usernameParam = String(req.query.username ?? '')
    .trim()
    .toLowerCase();
  if (!usernameParam) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  // Visibility: own profile, OR is_public, OR friendship accepted
  const profileRows = await sql`
    SELECT p.id, p.username, p.display_name AS "displayName", p.bio, p.avatar_url AS "avatarUrl",
           p.voice_type AS "voiceType", p.voice_subtype AS "voiceSubtype",
           p.vocal_range_low AS "vocalRangeLow", p.vocal_range_high AS "vocalRangeHigh",
           p.instrument_roles AS "instrumentRoles",
           p.is_public AS "isPublic",
           p.created_at AS "createdAt",
           (
             p.id = ${viewer.id}
             OR p.is_public = true
             OR EXISTS (
               SELECT 1 FROM friendships
               WHERE status = 'accepted'
                 AND ((requester_id = ${viewer.id} AND addressee_id = p.id)
                  OR  (requester_id = p.id AND addressee_id = ${viewer.id}))
             )
           ) AS visible
    FROM profiles p
    WHERE lower(p.username) = ${usernameParam}
    LIMIT 1
  `;

  if (profileRows.length === 0 || !profileRows[0].visible) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const { visible: _v, ...profile } = profileRows[0];

  const favoritesRows = await sql`
    SELECT s.id, s.title, s.album, s.album_slug AS "albumSlug", s.cover_image AS "coverImage",
           f.created_at AS "favoritedAt"
    FROM favorites f
    JOIN songs s ON s.id = f.song_id
    WHERE f.user_id = ${profile.id}
    ORDER BY f.created_at DESC
  `;

  const friendCountRow = await sql`
    SELECT COUNT(*)::int AS count
    FROM friendships
    WHERE status = 'accepted'
      AND (requester_id = ${profile.id} OR addressee_id = ${profile.id})
  `;

  res.status(200).json({
    profile,
    favorites: favoritesRows,
    friendCount: friendCountRow[0]?.count ?? 0,
    isOwn: profile.id === viewer.id,
  });
});
