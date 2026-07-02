import { describe, it, expect } from 'vitest';
import { skelLine, skelBlock, skelCircle, skelRow, skelCard, skelGrid } from './skeleton.js';
import { skelTracklist, skelSongDetail, skelRowList, skelProfile, skelLongText } from './skeleton.js';

describe('skeleton primitivas', () => {
  it('skelLine devuelve un div .skeleton con ancho/alto y aria-hidden', () => {
    const html = skelLine({ w: '70%', h: 14 });
    expect(html).toContain('class="skeleton sk-line"');
    expect(html).toContain('width:70%');
    expect(html).toContain('height:14px');
    expect(html).toContain('aria-hidden="true"');
  });
  it('skelCircle es redondo', () => {
    expect(skelCircle({ size: 48 })).toContain('border-radius:50%');
  });
  it('skelBlock respeta radius', () => {
    expect(skelBlock({ h: 120, radius: 16 })).toContain('border-radius:16px');
  });
  it('skelRow trae thumb + 2 líneas', () => {
    const html = skelRow();
    expect(html).toContain('sk-row');
    expect((html.match(/sk-line/g) || []).length).toBe(2);
  });
  it('skelGrid(6) devuelve 6 tiles', () => {
    const html = skelGrid(6);
    expect((html.match(/sk-tile/g) || []).length).toBe(6);
  });
  it('skelCard trae cover + título', () => {
    expect(skelCard()).toContain('sk-card');
  });
});

describe('skeleton arquetipos', () => {
  it('skelTracklist({rows:4}) tiene hero + 4 filas', () => {
    const html = skelTracklist({ rows: 4 });
    expect(html).toContain('sk-block');
    expect((html.match(/sk-row/g) || []).length).toBe(4);
  });
  it('skelSongDetail trae acciones + párrafos', () => {
    expect(skelSongDetail()).toContain('sk-actions');
  });
  it('skelRowList({rows:3}) tiene 3 filas', () => {
    expect((skelRowList({ rows: 3 }).match(/sk-row/g) || []).length).toBe(3);
  });
  it('skelProfile trae avatar redondo + grid', () => {
    const html = skelProfile();
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('sk-grid');
  });
  it('skelLongText trae hero + párrafos', () => {
    expect(skelLongText()).toContain('sk-para');
  });
});
