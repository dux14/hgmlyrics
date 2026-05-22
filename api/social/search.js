import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const viewer = await requireUser(req);

  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase();
  if (q.length < 2) {
    res.status(200).json({ results: [] });
    return;
  }
  const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  // Friend search must surface other people only — never the viewer's own profile.
  // Visibility: is_public OR an already-accepted friend.
  const rows = await sql`
    SELECT p.id, p.username, p.display_name AS "displayName", p.avatar_url AS "avatarUrl"
    FROM profiles p
    WHERE p.username IS NOT NULL
      AND p.id <> ${viewer.id}
      AND (lower(p.username) LIKE ${pattern} OR lower(p.display_name) LIKE ${pattern})
      AND (
        p.is_public = true
        OR EXISTS (
          SELECT 1 FROM friendships
          WHERE status = 'accepted'
            AND ((requester_id = ${viewer.id} AND addressee_id = p.id)
             OR  (requester_id = p.id AND addressee_id = ${viewer.id}))
        )
      )
    ORDER BY
      CASE WHEN lower(p.username) = ${q} THEN 0
           WHEN lower(p.username) LIKE ${q + '%'} THEN 1
           WHEN lower(p.display_name) LIKE ${q + '%'} THEN 2
           ELSE 3 END,
      p.username
    LIMIT 20
  `;

  res.status(200).json({ results: rows });
});
