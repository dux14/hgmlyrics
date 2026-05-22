import sql from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';

const VOICE_TYPES = ['soprano', 'contralto', 'tenor', 'bass'];
const VOICE_SUBTYPES = ['alta', 'baja'];
const RANGE_RE = /^[A-G][#b]?[0-7]$/;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED_USERNAMES = new Set([
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

export function validateAndNormalize(input) {
  const out = {};
  const errs = [];

  if ('username' in input) {
    const v = String(input.username || '')
      .trim()
      .toLowerCase();
    if (!USERNAME_RE.test(v)) errs.push('username: invalid format');
    else if (RESERVED_USERNAMES.has(v)) errs.push('username: reserved');
    else out.username = v;
  }
  if ('displayName' in input) {
    const v = String(input.displayName || '').trim();
    if (!v) errs.push('displayName: required');
    else if (v.length > 80) errs.push('displayName: max 80 chars');
    else out.display_name = v;
  }
  if ('bio' in input) {
    const v = input.bio === null || input.bio === undefined ? null : String(input.bio);
    if (v && v.length > 200) errs.push('bio: max 200 chars');
    else out.bio = v;
  }
  if ('avatarUrl' in input) {
    out.avatar_url =
      input.avatarUrl === null || input.avatarUrl === undefined ? null : String(input.avatarUrl);
  }
  if ('voiceType' in input) {
    const v = input.voiceType;
    if (v !== null && v !== undefined && !VOICE_TYPES.includes(v)) errs.push('voiceType: invalid');
    else out.voice_type = v ?? null;
  }
  if ('voiceSubtype' in input) {
    const v = input.voiceSubtype;
    const invalid = v !== null && v !== undefined && !VOICE_SUBTYPES.includes(v);
    if (invalid) errs.push('voiceSubtype: invalid');
    else out.voice_subtype = v ?? null;
  }
  if ('vocalRangeLow' in input) {
    const v = input.vocalRangeLow;
    const invalid = v !== null && v !== undefined && !RANGE_RE.test(v);
    if (invalid) errs.push('vocalRangeLow: invalid (use scientific notation A2/F#4)');
    else out.vocal_range_low = v ?? null;
  }
  if ('vocalRangeHigh' in input) {
    const v = input.vocalRangeHigh;
    if (v !== null && v !== undefined && !RANGE_RE.test(v)) errs.push('vocalRangeHigh: invalid');
    else out.vocal_range_high = v ?? null;
  }
  if ('instrumentRoles' in input) {
    if (!Array.isArray(input.instrumentRoles)) errs.push('instrumentRoles: must be array');
    else out.instrument_roles = input.instrumentRoles.map((s) => String(s).trim()).filter(Boolean);
  }
  if ('isPublic' in input) {
    out.is_public = !!input.isPublic;
  }

  return { out, errs };
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['PATCH'])) return;
  const user = await requireUser(req);

  const { out, errs } = validateAndNormalize(req.body ?? {});
  if (errs.length > 0) {
    res.status(400).json({ error: 'validation_failed', details: errs });
    return;
  }
  if (Object.keys(out).length === 0) {
    res.status(400).json({ error: 'no fields to update' });
    return;
  }

  try {
    const result = await sql`
      UPDATE profiles SET ${sql(out)} WHERE id = ${user.id}
      RETURNING id, username, display_name AS "displayName", bio, avatar_url AS "avatarUrl",
                voice_type AS "voiceType", voice_subtype AS "voiceSubtype",
                vocal_range_low AS "vocalRangeLow", vocal_range_high AS "vocalRangeHigh",
                instrument_roles AS "instrumentRoles",
                is_admin AS "isAdmin", is_public AS "isPublic",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    if (result.length === 0) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.status(200).json({ profile: result[0] });
  } catch (e) {
    if (e?.code === '23505') {
      // unique violation (username taken)
      res.status(409).json({ error: 'username_taken' });
      return;
    }
    throw e;
  }
});
