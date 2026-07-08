import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { invalidateFlags } from '../_lib/flagsCache.js';

// GET    → { flags: [{key, description, enabledGlobal, users:[{email,username}]}] }
// POST   → body { flagKey, email?, username? } agrega asignación (contrato actual)
//        → body { action:'create', key, description } crea flag en el catálogo
//        → body { action:'toggle-global', key, enabled } activa/desactiva global
//        → body { action:'assign', flagKey, users:[{email?,username?}] } asigna en lote
// DELETE → body { flagKey, email?, username? } quita asignación (contrato actual)
//        → body { action:'flag', key } borra la flag del catálogo (cascade en asignaciones)

const KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

function badRequest(res, message) {
  res.status(400).json({ error: message });
}
async function list(_req, res) {
  const flags = await sql`
    SELECT key, description, enabled_global AS "enabledGlobal"
    FROM feature_flags ORDER BY key
  `;
  const users = await sql`
    SELECT flag_key AS "flagKey", email, username FROM feature_flag_users
  `;
  const byFlag = new Map(flags.map((f) => [f.key, { ...f, users: [] }]));
  for (const u of users)
    {byFlag.get(u.flagKey)?.users.push({ email: u.email, username: u.username });}
  res.status(200).json({ flags: [...byFlag.values()] });
}

async function addAssignment(req, res) {
  const { flagKey, email, username } = req.body ?? {};
  if (!flagKey || (!email && !username)) {
    res.status(400).json({ error: 'flagKey y (email o username) son requeridos' });
    return;
  }
  await sql`
    INSERT INTO feature_flag_users (flag_key, email, username)
    VALUES (${flagKey}, ${email ?? null}, ${username ?? null})
    ON CONFLICT DO NOTHING
  `;
  invalidateFlags();
  res.status(200).json({ success: true });
}

async function removeAssignment(req, res) {
  const { flagKey, email, username } = req.body ?? {};
  if (!flagKey || (!email && !username)) {
    res.status(400).json({ error: 'flagKey y (email o username) son requeridos' });
    return;
  }
  await sql`
    DELETE FROM feature_flag_users
    WHERE flag_key = ${flagKey}
      AND email IS NOT DISTINCT FROM ${email ?? null}
      AND username IS NOT DISTINCT FROM ${username ?? null}
  `;
  invalidateFlags();
  res.status(200).json({ success: true });
}

async function createFlag(req, res) {
  const { key, description } = req.body ?? {};
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    badRequest(
      res,
      'Key inválida: usa minúsculas, números o "_", debe empezar por letra y tener máximo 50 caracteres',
    );
    return;
  }
  try {
    await sql`
      INSERT INTO feature_flags (key, description)
      VALUES (${key}, ${description ?? null})
    `;
  } catch (err) {
    if (err?.code === '23505') {
      res.status(409).json({ error: 'La flag ya existe' });
      return;
    }
    throw err;
  }
  invalidateFlags();
  res.status(200).json({ success: true });
}

async function toggleGlobal(req, res) {
  const { key, enabled } = req.body ?? {};
  if (typeof key !== 'string' || !key) {
    badRequest(res, 'key es requerida');
    return;
  }
  const result = await sql`
    UPDATE feature_flags SET enabled_global = ${!!enabled} WHERE key = ${key}
  `;
  if (result.count === 0) {
    res.status(404).json({ error: 'La flag no existe' });
    return;
  }
  invalidateFlags();
  res.status(200).json({ success: true });
}

async function assignBatch(req, res) {
  const { flagKey, users } = req.body ?? {};
  if (typeof flagKey !== 'string' || !flagKey) {
    badRequest(res, 'flagKey es requerida');
    return;
  }
  if (!Array.isArray(users) || users.length < 1 || users.length > 100) {
    badRequest(res, 'users debe ser un array de 1 a 100 elementos');
    return;
  }
  const exists = await sql`SELECT 1 FROM feature_flags WHERE key = ${flagKey} LIMIT 1`;
  if (exists.length === 0) {
    res.status(404).json({ error: 'La flag no existe' });
    return;
  }
  const rows = [];
  for (const u of users) {
    const email = u?.email ?? null;
    const username = u?.username ?? null;
    if (!email && !username) {
      badRequest(res, 'cada usuario requiere email o username');
      return;
    }
    rows.push({ flag_key: flagKey, email, username });
  }
  await sql`
    INSERT INTO feature_flag_users ${sql(rows)}
    ON CONFLICT DO NOTHING
  `;
  invalidateFlags();
  res.status(200).json({ success: true });
}

async function deleteFlag(req, res) {
  const { key } = req.body ?? {};
  if (typeof key !== 'string' || !key) {
    badRequest(res, 'key es requerida');
    return;
  }
  const result = await sql`DELETE FROM feature_flags WHERE key = ${key}`;
  if (result.count === 0) {
    res.status(404).json({ error: 'La flag no existe' });
    return;
  }
  invalidateFlags();
  res.status(200).json({ success: true });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST', 'DELETE'])) return;
  await requireAdmin(req, sql);
  if (req.method === 'GET') return list(req, res);

  const action = req.body?.action;
  if (req.method === 'POST') {
    if (action === 'create') return createFlag(req, res);
    if (action === 'toggle-global') return toggleGlobal(req, res);
    if (action === 'assign') return assignBatch(req, res);
    return addAssignment(req, res);
  }

  if (action === 'flag') return deleteFlag(req, res);
  return removeAssignment(req, res);
});
