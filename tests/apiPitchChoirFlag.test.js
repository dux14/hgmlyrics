import { describe, it, expect } from 'vitest';
import { choirEnabled } from '../api/pitch/_lib/state.js';
import { OPTIONAL_PHASES } from '../api/pitch/_lib/process.js';

describe('flag PITCH_CHOIR', () => {
  it('OFF por default, ON solo con "on" exacto', () => {
    delete process.env.PITCH_CHOIR; expect(choirEnabled()).toBe(false);
    process.env.PITCH_CHOIR = 'on'; expect(choirEnabled()).toBe(true);
    process.env.PITCH_CHOIR = 'true'; expect(choirEnabled()).toBe(false);
    delete process.env.PITCH_CHOIR;
  });

  it('OPTIONAL_PHASES incluye gender y choir', () => {
    expect(OPTIONAL_PHASES).toContain('gender');
    expect(OPTIONAL_PHASES).toContain('choir');
  });
});
