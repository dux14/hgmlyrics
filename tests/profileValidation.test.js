import { describe, it, expect, vi } from 'vitest';

// Mock the heavy imports api/profile/me.js pulls in (postgres + supabase client).
// We only need validateAndNormalize, which is pure.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock('postgres', () => ({
  default: () => Object.assign(() => Promise.resolve([]), { json: (v) => v }),
}));

process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
process.env.DATABASE_URL = 'postgresql://test';

const { validateAndNormalize } = await import('../api/profile/me.js');

describe('validateAndNormalize', () => {
  it('accepts a fully valid profile', () => {
    const { out, errs } = validateAndNormalize({
      username: 'JuanP_88',
      displayName: 'Juan Pablo',
      bio: 'Cantante en Hakuna desde 2020',
      voiceType: 'tenor',
      voiceSubtype: 'alta',
      vocalRangeLow: 'C3',
      vocalRangeHigh: 'A4',
      instrumentRoles: ['guitarra nylon', 'cajón'],
      isPublic: false,
    });
    expect(errs).toEqual([]);
    expect(out.username).toBe('juanp_88');
    expect(out.display_name).toBe('Juan Pablo');
    expect(out.voice_type).toBe('tenor');
    expect(out.is_public).toBe(false);
  });

  it('rejects invalid username format', () => {
    const { errs } = validateAndNormalize({ username: 'has spaces' });
    expect(errs.some((e) => e.startsWith('username'))).toBe(true);
  });

  it('rejects reserved username', () => {
    const { errs } = validateAndNormalize({ username: 'admin' });
    expect(errs).toContain('username: reserved');
  });

  it('rejects bio over 200 chars', () => {
    const { errs } = validateAndNormalize({ bio: 'x'.repeat(201) });
    expect(errs).toContain('bio: max 200 chars');
  });

  it('rejects invalid vocal range', () => {
    const { errs } = validateAndNormalize({ vocalRangeLow: 'Z9' });
    expect(errs.some((e) => e.toLowerCase().includes('grave'))).toBe(true);
  });

  it('rejects display name over 32 chars', () => {
    const { errs } = validateAndNormalize({ displayName: 'x'.repeat(33) });
    expect(errs.some((e) => e.includes('32'))).toBe(true);
  });

  it('accepts vocal range with sharp/flat', () => {
    const { errs, out } = validateAndNormalize({ vocalRangeLow: 'F#4', vocalRangeHigh: 'Bb5' });
    expect(errs).toEqual([]);
    expect(out.vocal_range_low).toBe('F#4');
    expect(out.vocal_range_high).toBe('Bb5');
  });

  it('accepts vocalRangeNotes up to 80 chars and rejects past it', () => {
    const ok = validateAndNormalize({ vocalRangeNotes: 'falsete G4-D2, zona segura D2-D4' });
    expect(ok.errs).toEqual([]);
    expect(ok.out.vocal_range_notes).toBe('falsete G4-D2, zona segura D2-D4');

    const bad = validateAndNormalize({ vocalRangeNotes: 'x'.repeat(81) });
    expect(bad.errs.some((e) => e.includes('80'))).toBe(true);
  });

  it('rejects invalid voiceType', () => {
    const { errs } = validateAndNormalize({ voiceType: 'mezzo' });
    expect(errs).toContain('voiceType: invalid');
  });

  it('rejects instrumentRoles non-array', () => {
    const { errs } = validateAndNormalize({ instrumentRoles: 'guitarra' });
    expect(errs).toContain('instrumentRoles: must be array');
  });

  it('returns empty out when no recognized fields', () => {
    const { out } = validateAndNormalize({ unknownField: 'x' });
    expect(out).toEqual({});
  });

  // SEC-01 / SEC-05 — avatarUrl backend validation
  it('SEC-05: rejects avatarUrl with external domain', () => {
    expect(() => validateAndNormalize({ avatarUrl: 'https://evil.com/x.png' })).toThrow(
      'avatar_url_invalida',
    );
  });

  it('SEC-05: rejects avatarUrl with javascript: scheme', () => {
    expect(() => validateAndNormalize({ avatarUrl: 'javascript:alert(1)' })).toThrow(
      'avatar_url_invalida',
    );
  });

  it('SEC-05: accepts valid Supabase Storage URL', () => {
    const { out, errs } = validateAndNormalize({
      avatarUrl: 'https://abc.supabase.co/storage/v1/object/public/avatars/x.png',
    });
    expect(errs).toEqual([]);
    expect(out.avatar_url).toBe('https://abc.supabase.co/storage/v1/object/public/avatars/x.png');
  });

  it('SEC-05: accepts avatarUrl = null (clear avatar)', () => {
    const { out, errs } = validateAndNormalize({ avatarUrl: null });
    expect(errs).toEqual([]);
    expect(out.avatar_url).toBeNull();
  });

  // Hardened regex — canonical Storage path required
  it('SEC-05: accepts canonical signed path (sign/)', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/sign/avatars/x.png?token=t';
    const { out, errs } = validateAndNormalize({ avatarUrl: url });
    expect(errs).toEqual([]);
    expect(out.avatar_url).toBe(url);
  });

  it('SEC-05: rejects non-canonical storage path (/storage/otracosa)', () => {
    expect(() =>
      validateAndNormalize({ avatarUrl: 'https://x.supabase.co/storage/otracosa' }),
    ).toThrow('avatar_url_invalida');
  });

  it('SEC-05: rejects subdomain-spoofing (evil.supabase.co.attacker.com)', () => {
    expect(() =>
      validateAndNormalize({
        avatarUrl: 'https://evil.supabase.co.attacker.com/storage/v1/object/public/x',
      }),
    ).toThrow('avatar_url_invalida');
  });

  it('SEC-05: accepts public URL with cache-buster query param (uploadAvatar shape)', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/avatars/uid/avatar.webp?t=1718000000000';
    const { out, errs } = validateAndNormalize({ avatarUrl: url });
    expect(errs).toEqual([]);
    expect(out.avatar_url).toBe(url);
  });
});
