import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildIndex } from '../lib/search.js';
import { openSearchFocus } from './SearchFocus.js';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));

const SONGS = [{ id: '1', title: 'Eres Mi Refugio', album: 'Adoración I', albumSlug: 'a1', artist: 'Hakuna', coverImage: 'misa.webp' }];

describe('openSearchFocus', () => {
  beforeEach(() => { document.body.innerHTML = ''; buildIndex(SONGS, []); });

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
});
