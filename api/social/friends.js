import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

async function listFriends(viewer, res) {
  const rows = await sql`
    SELECT f.requester_id AS "requesterId", f.addressee_id AS "addresseeId",
           f.status, f.created_at AS "createdAt", f.updated_at AS "updatedAt",
           p_req.username AS "requesterUsername", p_req.display_name AS "requesterDisplayName",
           p_req.avatar_url AS "requesterAvatarUrl",
           p_addr.username AS "addresseeUsername", p_addr.display_name AS "addresseeDisplayName",
           p_addr.avatar_url AS "addresseeAvatarUrl"
    FROM friendships f
    JOIN profiles p_req  ON p_req.id  = f.requester_id
    JOIN profiles p_addr ON p_addr.id = f.addressee_id
    WHERE f.requester_id = ${viewer.id} OR f.addressee_id = ${viewer.id}
    ORDER BY f.updated_at DESC
  `;

  const accepted = [];
  const pendingIncoming = [];
  const pendingOutgoing = [];
  for (const r of rows) {
    if (r.status === 'accepted') accepted.push(r);
    else if (r.status === 'pending' && r.addresseeId === viewer.id) pendingIncoming.push(r);
    else if (r.status === 'pending' && r.requesterId === viewer.id) pendingOutgoing.push(r);
  }
  res.status(200).json({ accepted, pendingIncoming, pendingOutgoing });
}

async function createRequest(viewer, body, res) {
  const targetUsername = String(body?.username ?? '')
    .trim()
    .toLowerCase();
  if (!targetUsername) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  const target =
    await sql`SELECT id FROM profiles WHERE lower(username) = ${targetUsername} LIMIT 1`;
  if (target.length === 0) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const addresseeId = target[0].id;
  if (addresseeId === viewer.id) {
    res.status(400).json({ error: 'cannot_friend_self' });
    return;
  }
  try {
    await sql`
      INSERT INTO friendships (requester_id, addressee_id, status)
      VALUES (${viewer.id}, ${addresseeId}, 'pending')
    `;
    res.status(201).json({ success: true });
  } catch (e) {
    if (e?.code === '23505') {
      res.status(409).json({ error: 'already_exists' });
      return;
    }
    throw e;
  }
}

async function updateStatus(viewer, body, res) {
  const { requesterId, action } = body ?? {};
  if (!requesterId || !['accept', 'block'].includes(action)) {
    res.status(400).json({ error: 'requesterId + action (accept|block) required' });
    return;
  }
  const newStatus = action === 'accept' ? 'accepted' : 'blocked';
  const result = await sql`
    UPDATE friendships SET status = ${newStatus}
    WHERE requester_id = ${requesterId}
      AND addressee_id = ${viewer.id}
      AND status = 'pending'
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'pending_request_not_found' });
    return;
  }
  res.status(200).json({ success: true, status: newStatus });
}

async function deleteFriendship(viewer, body, res) {
  const { otherUserId } = body ?? {};
  if (!otherUserId) {
    res.status(400).json({ error: 'otherUserId is required' });
    return;
  }
  const result = await sql`
    DELETE FROM friendships
    WHERE (requester_id = ${viewer.id} AND addressee_id = ${otherUserId})
       OR (requester_id = ${otherUserId} AND addressee_id = ${viewer.id})
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'friendship_not_found' });
    return;
  }
  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  const viewer = await requireUser(req);

  if (req.method === 'GET') return listFriends(viewer, res);
  if (req.method === 'POST') return createRequest(viewer, req.body, res);
  if (req.method === 'PATCH') return updateStatus(viewer, req.body, res);
  return deleteFriendship(viewer, req.body, res);
});
