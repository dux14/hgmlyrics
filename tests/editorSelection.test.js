import { describe, it, expect } from 'vitest';
import {
  normalizeRange,
  buildCharStripHTML,
  addGroupEntry,
  deleteGroupAt,
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
