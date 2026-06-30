import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildIndex } from '../lib/search.js';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/icons.js', () => ({
  icon: vi.fn(() => '<svg></svg>'),
  COVER_PLACEHOLDER: 'placeholder.svg',
}));

import { icon } from '../lib/icons.js';
import { openSearchFocus } from './SearchFocus.js';

const SONGS = [{ id: '1', title: 'Eres Mi Refugio', album: 'Adoración I', albumSlug: 'a1', artist: 'Hakuna', coverImage: 'misa.webp' }];
const VOCES = [{ id: 'v1', title: 'Voz litúrgica', gospel_ref: 'Juan 1:1' }];

describe('openSearchFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    buildIndex(SONGS, []);
    vi.clearAllMocks();
  });

  it('monta scrim + barra y enfoca el input', () => {
    openSearchFocus();
    expect(document.querySelector('.search-focus__scrim')).toBeTruthy();
    expect(document.querySelector('.search-focus__bar input')).toBeTruthy();
  });

  it('al escribir muestra la sección Canciones con resultados', async () => {
    openSearchFocus();
    const input = document.querySelector('.search-focus__bar input');
    input.value = 'refug';
    input.dispatchEvent(new Event('input'));
    const groups = document.querySelectorAll('.search-focus__group');
    expect([...groups].some((g) => /canciones/i.test(g.textContent))).toBe(true);
  });

  it('Escape cierra el overlay', () => {
    openSearchFocus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.search-focus__scrim')).toBeNull();
  });

  it('muestra un control Cancelar que cierra el focus', () => {
    openSearchFocus();
    const cancel = document.querySelector('.search-focus__cancel');
    expect(cancel).toBeTruthy();
    cancel.click();
    expect(document.querySelector('.search-focus__bar')).toBeNull();
  });

  it('la sección Voz en off usa icono gospel, no music', () => {
    buildIndex(SONGS, VOCES);
    openSearchFocus('litúr');
    const iconCalls = icon.mock.calls.map((c) => c[0]);
    expect(iconCalls).toContain('gospel');
    expect(iconCalls).not.toContain('music');
  });
});
