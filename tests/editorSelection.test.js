import { describe, it, expect } from 'vitest';
import {
  normalizeRange,
  buildCharStripHTML,
  addGroupEntry,
  deleteGroupAt,
  applyGroupsForRange,
} from '../src/lib/editorSelection.js';

describe('normalizeRange', () => {
  it('un solo carácter → end exclusivo (i, i+1)', () => {
    expect(normalizeRange(3, 3)).toEqual({ start: 3, end: 4 });
  });
  it('ordena anchor/focus y hace end exclusivo', () => {
    expect(normalizeRange(2, 5)).toEqual({ start: 2, end: 6 });
    expect(normalizeRange(5, 2)).toEqual({ start: 2, end: 6 });
  });
});

describe('buildCharStripHTML', () => {
  it('una celda por carácter con su índice', () => {
    const html = buildCharStripHTML('ab', null);
    expect(html).toContain('data-char="0"');
    expect(html).toContain('data-char="1"');
    expect(html).toContain('>a<');
    expect(html).toContain('>b<');
  });
  it('marca como seleccionadas las celdas dentro de [start,end)', () => {
    const html = buildCharStripHTML('abc', { start: 0, end: 2 });
    const cells = html.match(/<button class="char-cell[^"]*"/g);
    expect(cells[0]).toContain('char-cell--sel');
    expect(cells[1]).toContain('char-cell--sel');
    expect(cells[2]).not.toContain('char-cell--sel');
  });
  it('escapa HTML y muestra espacios como nbsp', () => {
    expect(buildCharStripHTML('a<b', null)).toContain('&lt;');
    expect(buildCharStripHTML('a b', null)).toContain('&nbsp;');
  });
  it('texto vacío → placeholder', () => {
    expect(buildCharStripHTML('', null)).toContain('char-strip__empty');
  });
});

describe('addGroupEntry', () => {
  it('añade y ordena por start, luego voiceId', () => {
    let g = [];
    g = addGroupEntry(g, { start: 5, end: 9, voiceId: 'ten1', note: 'D3' });
    g = addGroupEntry(g, { start: 0, end: 5, voiceId: 'sop1', note: 'B3' });
    expect(g.map((x) => x.start)).toEqual([0, 5]);
    expect(g[0]).toEqual({ start: 0, end: 5, voiceId: 'sop1', note: 'B3' });
  });
  it('mismo rango, distinta voz → entradas separadas', () => {
    let g = [];
    g = addGroupEntry(g, { start: 0, end: 5, voiceId: 'sop1', note: 'B3' });
    g = addGroupEntry(g, { start: 0, end: 5, voiceId: 'ten1', note: 'D3' });
    expect(g).toHaveLength(2);
  });
  it('mismo rango y misma voz → reemplaza la nota (no duplica)', () => {
    let g = [{ start: 0, end: 5, voiceId: 'sop1', note: 'B3' }];
    g = addGroupEntry(g, { start: 0, end: 5, voiceId: 'sop1', note: 'C4' });
    expect(g).toHaveLength(1);
    expect(g[0].note).toBe('C4');
  });
  it('nota ausente → null', () => {
    const g = addGroupEntry([], { start: 0, end: 2, voiceId: 'sop1' });
    expect(g[0].note).toBe(null);
  });
  it('no muta el array de entrada', () => {
    const orig = [];
    addGroupEntry(orig, { start: 0, end: 2, voiceId: 'sop1', note: null });
    expect(orig).toHaveLength(0);
  });
});

describe('deleteGroupAt', () => {
  it('elimina por índice y devuelve nuevo array', () => {
    const orig = [
      { start: 0, end: 2, voiceId: 'sop1', note: null },
      { start: 2, end: 4, voiceId: 'ten1', note: 'D3' },
    ];
    const out = deleteGroupAt(orig, 0);
    expect(out).toHaveLength(1);
    expect(out[0].voiceId).toBe('ten1');
    expect(orig).toHaveLength(2);
  });
  it('índice fuera de rango → array igual (copia)', () => {
    const out = deleteGroupAt([{ start: 0, end: 1, voiceId: 'a', note: null }], 9);
    expect(out).toHaveLength(1);
  });
});

describe('applyGroupsForRange', () => {
  const range = { start: 4, end: 7 }; // "del" en "Dio del…" (ejemplo)

  it('agrega varias voces con notas distintas en un rango', () => {
    const out = applyGroupsForRange([], range, [
      { voiceId: 'v1', included: true, note: 'F#4' },
      { voiceId: 'v2', included: true, note: 'D4' },
      { voiceId: 'v3', included: false, note: null },
      { voiceId: 'v4', included: true, note: 'F#4' },
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((g) => g.voiceId === 'v1')).toMatchObject({ start: 4, end: 7, note: 'F#4' });
    expect(out.find((g) => g.voiceId === 'v2').note).toBe('D4');
    expect(out.find((g) => g.voiceId === 'v3')).toBeUndefined();
  });

  it('actualiza la nota de una voz ya existente en ese rango (no duplica)', () => {
    const groups = [{ start: 4, end: 7, voiceId: 'v1', note: 'D4' }];
    const out = applyGroupsForRange(groups, range, [
      { voiceId: 'v1', included: true, note: 'F#4' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('F#4');
  });

  it('voz incluida sin nota → grupo con note null', () => {
    const out = applyGroupsForRange([], range, [{ voiceId: 'v1', included: true, note: null }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 4, end: 7, voiceId: 'v1', note: null });
  });

  it('excluir una voz que tenía grupo en ese rango → lo quita', () => {
    const groups = [{ start: 4, end: 7, voiceId: 'v1', note: 'F#4' }];
    const out = applyGroupsForRange(groups, range, [
      { voiceId: 'v1', included: false, note: null },
    ]);
    expect(out).toHaveLength(0);
  });

  it('no toca grupos de OTROS rangos de la misma línea', () => {
    const groups = [{ start: 0, end: 3, voiceId: 'v1', note: 'A3' }];
    const out = applyGroupsForRange(groups, range, [{ voiceId: 'v2', included: true, note: 'D4' }]);
    expect(out.find((g) => g.start === 0 && g.voiceId === 'v1')).toMatchObject({ note: 'A3' });
    expect(out).toHaveLength(2);
  });

  it('devuelve un array nuevo (no muta la entrada)', () => {
    const groups = [];
    const out = applyGroupsForRange(groups, range, [{ voiceId: 'v1', included: true, note: 'B3' }]);
    expect(out).not.toBe(groups);
    expect(groups).toHaveLength(0);
  });
});
