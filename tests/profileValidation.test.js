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
});
