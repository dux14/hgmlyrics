import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { resolveEnabledFlags } from '../../src/lib/featureFlags.js';

function isAdminFromEnv(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}

function avatarFromMetadata(user) {
  const m = user?.user_metadata ?? {};
  return m.avatar_url || m.picture || null;
}

function displayNameFromMetadata(user) {
  const m = user?.user_metadata ?? {};
  return m.full_name || m.name || null;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  const user = await requireUser(req);

  // Sync is_admin from ADMIN_EMAILS env (cheap; runs each /me call).
  const expectedAdmin = isAdminFromEnv(user.email);
  await sql`
    UPDATE profiles
    SET is_admin = ${expectedAdmin}
    WHERE id = ${user.id} AND is_admin IS DISTINCT FROM ${expectedAdmin}
  `;

  // First-load hydration from OAuth provider (Google): backfill avatar_url
  // and display_name when null, so the user has a sensible default.
  const providerAvatar = avatarFromMetadata(user);
  const providerName = displayNameFromMetadata(user);
  if (providerAvatar || providerName) {
    await sql`
      UPDATE profiles
      SET avatar_url   = COALESCE(avatar_url, ${providerAvatar}),
          display_name = COALESCE(display_name, ${providerName})
      WHERE id = ${user.id}
    `;
  }

  const rows = await sql`
    SELECT id, username, display_name AS "displayName", bio, avatar_url AS "avatarUrl",
           voice_type AS "voiceType", voice_subtype AS "voiceSubtype",
           vocal_range_low AS "vocalRangeLow", vocal_range_high AS "vocalRangeHigh",
           vocal_range_notes AS "vocalRangeNotes",
           instrument_roles AS "instrumentRoles",
           is_admin AS "isAdmin", is_public AS "isPublic",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM profiles WHERE id = ${user.id}
  `;

  if (rows.length === 0) {
    // Trigger should have inserted; if missing, create now.
    await sql`INSERT INTO profiles (id) VALUES (${user.id}) ON CONFLICT DO NOTHING`;
    const retry = await sql`SELECT * FROM profiles WHERE id = ${user.id}`;
    if (retry.length === 0) {
      res.status(500).json({ error: 'Could not create or fetch profile' });
      return;
    }
  }

  // Feature flags habilitados para este usuario.
  const profile = rows[0];
  const [flagCatalog, flagAssignments] = await Promise.all([
    sql`SELECT key, enabled_global AS "enabledGlobal" FROM feature_flags`,
    sql`
      SELECT flag_key AS "flagKey", email, username
      FROM feature_flag_users
      WHERE lower(email) = lower(${user.email ?? ''})
         OR lower(username) = lower(${profile?.username ?? ''})
    `,
  ]);
  const flags = resolveEnabledFlags(flagCatalog, flagAssignments, {
    email: user.email,
    username: profile?.username,
  });

  res.status(200).json({
    user: { id: user.id, email: user.email },
    profile,
    flags,
  });
});
