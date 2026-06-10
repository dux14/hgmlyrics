// tests/songRow.test.js
import { describe, it, expect } from 'vitest';
import { resolveCoverUrl, voiceBadge, songRowCompact } from '../src/components/songRow.js';

describe('resolveCoverUrl', () => {
  it('respeta rutas absolutas y http', () => {
    expect(resolveCoverUrl({ coverImage: '/x.jpg' })).toBe('/x.jpg');
    expect(resolveCoverUrl({ coverImage: 'http://a/b.jpg' })).toBe('http://a/b.jpg');
  });
  it('prefija /covers/ a nombres sueltos', () => {
    expect(resolveCoverUrl({ coverImage: 'a.jpg' })).toBe('/covers/a.jpg');
  });
});

describe('voiceBadge', () => {
  it('mapea tipos de voz a clase y label', () => {
    expect(voiceBadge({ voiceType: 'male' })).toEqual({
      class: 'voice-badge--male',
      label: 'Masculina',
    });
    expect(voiceBadge({ voiceType: 'female' }).label).toBe('Femenina');
    expect(voiceBadge({ voiceType: 'x' }).label).toBe('Mixta');
  });
});

describe('songRowCompact', () => {
  const song = {
    id: 's1',
    title: 'Mi Canción',
    album: 'Álbum',
    year: 2024,
    voiceType: 'male',
    coverImage: 'c.jpg',
  };
  it('incluye índice, portada, título y badge', () => {
    const html = songRowCompact(song, { index: 3 });
    expect(html).toContain('song-row-compact__index');
    expect(html).toContain('>3<');
    expect(html).toContain('/covers/c.jpg');
    expect(html).toContain('Mi Canción');
    expect(html).toContain('Masculina');
    expect(html).toContain('data-song-id="s1"');
  });
  it('inyecta el HTML de acciones', () => {
    const html = songRowCompact(song, { actions: '<button id="x"></button>' });
    expect(html).toContain('<button id="x"></button>');
    expect(html).toContain('song-row-compact__actions');
  });
  it('sin índice no renderiza la columna de índice', () => {
    expect(songRowCompact(song, {})).not.toContain('song-row-compact__index');
  });
});
