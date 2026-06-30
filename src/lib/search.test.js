import { describe, it, expect, beforeEach } from 'vitest';
import { buildIndex, searchEverything } from './search.js';

const SONGS = [
  { id: '1', title: 'Eres Mi Refugio', album: 'Adoracion I', albumSlug: 'adoracion-i', artist: 'Hakuna', coverImage: 'misa.webp' },
  { id: '2', title: 'Aguas Vivas', album: 'Refugio', albumSlug: 'refugio', artist: 'Hakuna', coverImage: 'tu.webp' },
];
const WW = [{ id: 'w1', title: 'Refugio del Alma', gospel_ref: 'Sal 90', liturgical_title: '', voiceover_body: '' }];

describe('searchEverything', () => {
  beforeEach(() => buildIndex(SONGS, WW));

  it('agrupa resultados por canciones, albumes y voces', () => {
    const r = searchEverything('refug');
    expect(r.songs.map((s) => s.id)).toContain('1');
    expect(r.albums.map((a) => a.slug)).toContain('refugio');
    expect(r.voces.map((v) => v.id)).toContain('w1');
  });

  it('deduplica albumes por slug', () => {
    const r = searchEverything('adoracion');
    const slugs = r.albums.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('query vacia devuelve secciones vacias', () => {
    const r = searchEverything('');
    expect(r).toEqual({ songs: [], albums: [], voces: [] });
  });
});
