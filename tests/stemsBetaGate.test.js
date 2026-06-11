import { describe, it, expect } from 'vitest';
import { checkStudioAccess } from '../api/_lib/stems.js';

describe('beta gate', () => {
  it('niega si no está en beta', () => {
    expect(checkStudioAccess({ studio_beta: false, is_admin: false })).toEqual({
      ok: false,
      reason: 'beta',
    });
  });

  it('permite admin y beta', () => {
    expect(checkStudioAccess({ studio_beta: true }).ok).toBe(true);
    expect(checkStudioAccess({ is_admin: true }).ok).toBe(true);
  });
});
