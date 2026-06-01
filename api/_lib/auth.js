import { createClient } from '@supabase/supabase-js';
import { resolveEnabledFlags } from '../../src/lib/featureFlags.js';

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

// Service-role client. Fluid Compute reuses instances → cache at module scope.
const supabaseAdmin = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function extractToken(req) {
  const header = req.headers?.authorization;
  if (!header) return null;
  return header.startsWith('Bearer ') ? header.slice(7) : (header.split(' ')[1] ?? null);
}

/**
 * Validate the Supabase access token from `Authorization: Bearer <jwt>`.
 * Returns the auth.users row (id, email, ...). Throws { status: 401 } otherwise.
 * @param {object} req
 * @returns {Promise<{id: string, email: string, [k: string]: any}>}
 */
export async function requireUser(req) {
  const token = extractToken(req);
  if (!token) {
    const e = new Error('No token provided');
    e.status = 401;
    throw e;
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    const e = new Error('Invalid or expired token');
    e.status = 401;
    throw e;
  }
  return data.user;
}

/**
 * Require admin: validates user, then checks ADMIN_EMAILS env (re-evaluated each call)
 * and falls back to profiles.is_admin. Throws { status: 403 } if not admin.
 * @param {object} req
 * @param {import('postgres').Sql} sql
 * @returns {Promise<{id: string, email: string, [k: string]: any}>}
 */
export async function requireAdmin(req, sql) {
  const user = await requireUser(req);
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (user.email && adminEmails.includes(user.email.toLowerCase())) return user;

  const rows = await sql`SELECT is_admin FROM profiles WHERE id = ${user.id}`;
  if (!rows[0]?.is_admin) {
    const e = new Error('Forbidden');
    e.status = 403;
    throw e;
  }
  return user;
}

/**
 * Require que el usuario tenga habilitado el feature flag `key`.
 * Defensa en profundidad: no confiar solo en el gating de UI.
 * @param {object} req
 * @param {import('postgres').Sql} sql
 * @param {string} key
 * @returns {Promise<{id:string, email:string, [k:string]:any}>}
 */
export async function requireFlag(req, sql, key) {
  const user = await requireUser(req);
  const profileRows = await sql`SELECT username FROM profiles WHERE id = ${user.id}`;
  const username = profileRows[0]?.username ?? null;
  const catalog = await sql`SELECT key, enabled_global AS "enabledGlobal" FROM feature_flags`;
  const assignments = await sql`
    SELECT flag_key AS "flagKey", email, username
    FROM feature_flag_users
    WHERE lower(email) = lower(${user.email ?? ''})
       OR lower(username) = lower(${username ?? ''})
  `;
  const enabled = resolveEnabledFlags(catalog, assignments, { email: user.email, username });
  if (!enabled.includes(key)) {
    const e = new Error('Feature not enabled');
    e.status = 403;
    throw e;
  }
  return user;
}

// Export service-role client for endpoints that need it (e.g. updating is_admin)
export { supabaseAdmin };
