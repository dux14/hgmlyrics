import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

// GET → { users: [{ id, username, displayName, email, isAdmin }] }
//
// El email NO se copia a `profiles`: vive solo en auth.users, que Supabase Auth
// mantiene al día. Se lee por JOIN con el cliente service-role (omite RLS) y se
// devuelve únicamente detrás de requireAdmin, así que no queda expuesto por
// PostgREST (la policy profiles_select deja leer los perfiles públicos a
// cualquier usuario autenticado).
//
// Sin filtro por username: los perfiles que no completaron el onboarding son
// justamente los que hace falta identificar por email.
async function listProfiles(_req, res) {
  const users = await sql`
    SELECT p.id, p.username, p.display_name AS "displayName",
           u.email, p.is_admin AS "isAdmin"
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    ORDER BY lower(coalesce(p.display_name, p.username, u.email))
  `;
  res.status(200).json({ users });
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  await requireAdmin(req, sql);
  return listProfiles(req, res);
});
