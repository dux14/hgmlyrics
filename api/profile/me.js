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
    if (!v) errs.push('Falta el nombre a mostrar.');
    else if (v.length > 32) errs.push('El nombre a mostrar no puede tener más de 32 caracteres.');
    else out.display_name = v;
  }
  if ('bio' in input) {
    const v = input.bio === null || input.bio === undefined ? null : String(input.bio);
    if (v && v.length > 200) errs.push('bio: max 200 chars');
    else out.bio = v;
  }
  if ('avatarUrl' in input) {
    const v = input.avatarUrl;
    if (v === null || v === undefined) {
      out.avatar_url = null;
    } else {
      const url = String(v);
      const ok = /^https:\/\/[a-z0-9.-]*\.supabase\.co\/storage\//i.test(url);
      if (!ok) {
        const e = new Error('avatar_url_invalida');
        e.status = 400;
        throw e;
      }
      out.avatar_url = url;
    }
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
    if (invalid) {
      errs.push('Nota grave inválida. Usa notación científica: C3, F#4, Bb5 (octava 0-7).');
    } else out.vocal_range_low = v ?? null;
  }
  if ('vocalRangeHigh' in input) {
    const v = input.vocalRangeHigh;
    if (v !== null && v !== undefined && !RANGE_RE.test(v)) {
      errs.push('Nota aguda inválida. Usa notación científica: C3, F#4, Bb5 (octava 0-7).');
    } else out.vocal_range_high = v ?? null;
  }
  if ('vocalRangeNotes' in input) {
    const v =
      input.vocalRangeNotes === null || input.vocalRangeNotes === undefined
        ? null
        : String(input.vocalRangeNotes).trim();
    if (v && v.length > 80) errs.push('Notas del rango: máximo 80 caracteres.');
    else out.vocal_range_notes = v || null;
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
                vocal_range_notes AS "vocalRangeNotes",
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
