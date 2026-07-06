import { describe, it, expect } from 'vitest';
import { PHASE_ORDER, phaseLabel, phaseProgress, isTerminalStatus } from './pitchProgress.js';

describe('pitchProgress', () => {
  it('define el orden fijo de fases', () => {
    expect(PHASE_ORDER).toEqual(['separation', 'f0', 'notes', 'lyrics', 'fusion', 'render']);
  });

  it('phaseLabel devuelve texto legible por fase', () => {
    expect(phaseLabel('separation')).toMatch(/voces/i);
    expect(phaseLabel('render')).toMatch(/partitura/i);
  });

  it('phaseProgress cuenta done/failed sobre el total fijo', () => {
    expect(phaseProgress({ separation: { status: 'done' }, f0: { status: 'failed' } })).toEqual({
      done: 1,
      failed: 1,
      total: 6,
      pct: 17,
    });
  });

  it('phaseProgress con phases null no revienta', () => {
    expect(phaseProgress(null)).toEqual({ done: 0, failed: 0, total: 6, pct: 0 });
  });

  it('isTerminalStatus distingue estados finales de en-progreso', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('partial')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('awaiting_approval')).toBe(false);
  });
});
