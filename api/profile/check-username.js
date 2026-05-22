import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

const RESERVED = new Set([
  'me',
  'admin',
  'api',
  'login',
  'register',
  'auth',
  'u',
  'amigos',
  'perfil',
  'home',
  'song',
  'songs',
]);

const VALID_RE = /^[a-z0-9_]{3,24}$/;

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  await requireUser(req); // any signed-in user can check

  const raw = (req.body?.username ?? '').toString().trim().toLowerCase();
  if (!raw) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  if (!VALID_RE.test(raw)) {
    res.status(200).json({ available: false, reason: 'invalid_format' });
    return;
  }
  if (RESERVED.has(raw)) {
    res.status(200).json({ available: false, reason: 'reserved' });
    return;
  }
  const rows = await sql`SELECT 1 FROM profiles WHERE lower(username) = ${raw} LIMIT 1`;
  if (rows.length > 0) {
    res.status(200).json({ available: false, reason: 'taken' });
    return;
  }
  res.status(200).json({ available: true });
});
