import { describe, it, expect } from 'vitest';
import { collapseSegments, collapseBySeed } from '../api/_lib/pipeline/structureShape.js';

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

describe('collapseBySeed', () => {
  const seed = [
    { dbIndex: 0, sectionIdx: 0, lineIdx: 0, text: 'canto uno' },
    { dbIndex: 1, sectionIdx: 0, lineIdx: 1, text: 'canto dos' },
  ];

  it('fusiona secciones adyacentes cuyos renglones son de la misma sección semilla', () => {
    const doc = { version: 2, sections: [
      { type: 'chorus', label: null, startMs: 0, endMs: 5000,
        lines: [{ text: 'canto uno', seedSectionIdx: 0 }] },
      { type: 'chorus', label: null, startMs: 5000, endMs: 9000,
        lines: [{ text: 'canto dos', seedSectionIdx: 0 }] },
    ] };
    const out = collapseBySeed(doc, seed);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].lines.map((l) => l.text)).toEqual(['canto uno', 'canto dos']);
    expect(out.sections[0].endMs).toBe(9000);
  });

  it('no fusiona si los renglones vienen de secciones semilla distintas', () => {
    const doc = { version: 2, sections: [
      { type: 'chorus', label: null, startMs: 0, endMs: 5000,
        lines: [{ text: 'canto uno', seedSectionIdx: 0 }] },
      { type: 'chorus', label: null, startMs: 5000, endMs: 9000,
        lines: [{ text: 'otro', seedSectionIdx: 1 }] },
    ] };
    expect(collapseBySeed(doc, seed).sections).toHaveLength(2);
  });

  it('sin semilla no toca nada', () => {
    const doc = { version: 2, sections: [
      { type: 'chorus', label: null, startMs: 0, endMs: 5000, lines: [{ text: 'a' }] },
      { type: 'chorus', label: null, startMs: 5000, endMs: 9000, lines: [{ text: 'b' }] },
    ] };
    expect(collapseBySeed(doc, []).sections).toHaveLength(2);
  });
});
