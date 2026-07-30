import { describe, expect, it } from 'vitest';
import { buildTimeline, activeAt } from '../src/components/pipeline/lyrics/sheetTiming.js';

const SECTIONS = [
  { type: 'verse', startMs: 0, endMs: 20000, lines: [{ text: 'a' }, { text: 'b' }] },
  { type: 'instrumental', startMs: 20000, endMs: 30000, lines: [] },
  { type: 'chorus', startMs: 30000, endMs: 40000, lines: [{ text: 'c' }] },
];
const TIMINGS = [
  { i: 0, startMs: 1000, interpolated: false },
  { i: 1, startMs: 9000, interpolated: true },
  { i: 2, startMs: 31000, interpolated: false },
];

describe('sheetTiming', () => {
  it('la sección instrumental no corre el índice plano', () => {
    const { entries } = buildTimeline(SECTIONS, TIMINGS);
    expect(entries[2]).toMatchObject({ i: 2, sIdx: 2, lIdx: 0 });
  });

  it('la ventana del renglón llega hasta el inicio del siguiente', () => {
    const { entries } = buildTimeline(SECTIONS, TIMINGS);
    expect(entries[0].endMs).toBe(9000);
  });

  it('la ventana del último renglón llega hasta la duración', () => {
    const { entries } = buildTimeline(SECTIONS, TIMINGS, 40000);
    expect(entries[2].endMs).toBe(40000);
  });

  it('sin duración conocida el último renglón no se apaga', () => {
    const { entries } = buildTimeline(SECTIONS, TIMINGS);
    expect(entries[2].endMs).toBe(Infinity);
  });

  it('la banda instrumental gana sobre la ventana del renglón anterior', () => {
    const t = buildTimeline(SECTIONS, TIMINGS, 40000);
    expect(activeAt(t, 25000)).toEqual({ sIdx: 1, lIdx: null });
    expect(activeAt(t, 15000)).toMatchObject({ sIdx: 0, lIdx: 1, interpolated: true });
  });

  it('sin timings no rompe y no activa ningún renglón', () => {
    const t = buildTimeline(SECTIONS, [], 40000);
    expect(t.entries).toEqual([]);
    expect(activeAt(t, 25000)).toEqual({ sIdx: 1, lIdx: null });
    expect(activeAt(buildTimeline([], [], null), 1000)).toBeNull();
  });
});
