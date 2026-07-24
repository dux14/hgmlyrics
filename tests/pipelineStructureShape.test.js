import { describe, it, expect } from 'vitest';
import { collapseSegments } from '../api/_lib/pipeline/structureShape.js';

describe('collapseSegments', () => {
  it('fusiona adyacentes del mismo tipo lírico y conserva los bordes', () => {
    const out = collapseSegments([
      { label: 'verso', startMs: 0, endMs: 10000 },
      { label: 'coro', startMs: 10000, endMs: 24000 },
      { label: 'coro', startMs: 24000, endMs: 38000 },
      { label: 'puente', startMs: 38000, endMs: 45000 },
      { label: 'puente', startMs: 45000, endMs: 52000 },
    ]);
    expect(out).toEqual([
      { label: 'verso', startMs: 0, endMs: 10000 },
      { label: 'coro', startMs: 10000, endMs: 38000 },
      { label: 'puente', startMs: 38000, endMs: 52000 },
    ]);
  });

  it('no fusiona tipos distintos ni segmentos no mapeables entre medio', () => {
    const out = collapseSegments([
      { label: 'coro', startMs: 0, endMs: 5000 },
      { label: 'instrumental', startMs: 5000, endMs: 8000 },
      { label: 'coro', startMs: 8000, endMs: 12000 },
    ]);
    expect(out).toHaveLength(3);
  });

  it('lista vacía o ausente devuelve []', () => {
    expect(collapseSegments([])).toEqual([]);
    expect(collapseSegments(undefined)).toEqual([]);
  });
});
