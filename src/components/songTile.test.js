import { describe, it, expect, vi } from 'vitest';
import { songTile } from './songTile.js';

vi.mock('../router.js', () => ({ navigate: vi.fn() }));
import { navigate } from '../router.js';

const SONG = { id: '42', title: 'El Arte de Vivir', album: 'Manantial', artist: 'Hakuna', coverImage: 'elartedevivir.webp' };
const COLORS = { 'elartedevivir.webp': { base: '#564733', light: '#897252' } };

describe('songTile', () => {
  it('renderiza título, grupo y portada sin label de voz', () => {
    const el = songTile(SONG, COLORS);
    expect(el.querySelector('.song-tile__title').textContent).toBe('El Arte de Vivir');
    expect(el.querySelector('.song-tile__group')).toBeTruthy();
    expect(el.querySelector('img.song-tile__art').getAttribute('src')).toContain('elartedevivir.webp');
    expect(el.querySelector('.voice-badge')).toBeNull(); // sin label de voz
  });

  it('aplica el color dominante como variables CSS', () => {
    const el = songTile(SONG, COLORS);
    expect(el.style.getPropertyValue('--tile-c1')).toBe('#564733');
    expect(el.style.getPropertyValue('--tile-c2')).toBe('#897252');
  });

  it('navega al detalle al hacer click', () => {
    const el = songTile(SONG, COLORS);
    el.click();
    expect(navigate).toHaveBeenCalledWith('/song/42');
  });

  it('incluye la placa (degradado) para legibilidad del texto', () => {
    const el = songTile(SONG, COLORS);
    const plate = el.querySelector('.song-tile__plate');
    expect(plate).not.toBeNull();
    expect(plate.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('songTile color/cover por álbum', () => {
  const colorMap = { 'elartedevivir.webp': { base: '#6a817a', light: '#8fa39d' } };
  const coverBySlug = { 'el-arte-de-vivir': 'elartedevivir.webp' };

  it('usa el color del cover del álbum vía coverBySlug', () => {
    const song = { id: 's1', title: 'Ojalá', album: 'El Arte de vivir', albumSlug: 'el-arte-de-vivir', coverImage: null };
    const el = songTile(song, colorMap, coverBySlug);
    expect(el.style.getPropertyValue('--tile-c1')).toBe('#6a817a');
    expect(el.querySelector('.song-tile__art').getAttribute('src')).toContain('elartedevivir.webp');
  });

  it('cae al fallback gris si el álbum no resuelve', () => {
    const song = { id: 's2', title: 'X', album: 'Z', albumSlug: 'no-existe', coverImage: null };
    const el = songTile(song, colorMap, coverBySlug);
    expect(el.style.getPropertyValue('--tile-c1')).toBe('#3a3a3a');
  });
});
