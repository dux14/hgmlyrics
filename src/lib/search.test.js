import { describe, it, expect, beforeEach } from 'vitest';
import { buildIndex, searchEverything, searchSongs, searchAll } from './search.js';

const SONGS = [
  {
    id: '1',
    title: 'Eres Mi Refugio',
    album: 'Adoracion I',
    albumSlug: 'adoracion-i',
    artist: 'Hakuna',
    coverImage: 'misa.webp',
  },
  {
    id: '2',
    title: 'Aguas Vivas',
    album: 'Refugio',
    albumSlug: 'refugio',
    artist: 'Hakuna',
    coverImage: 'tu.webp',
  },
  {
    id: '3',
    title: '(Tú) El único rey - una voz',
    album: 'Tú',
    albumSlug: 'tu',
    artist: 'Hakuna',
    coverImage: 'tu.webp',
  },
];
const WW = [
  {
    id: 'w1',
    title: 'Refugio del Alma',
    gospel_ref: 'Sal 90',
    liturgical_title: '',
    voiceover_body: '',
  },
];

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

// El motor ya ignoraba tildes, pero exigía la subcadena contigua: cualquier
// paréntesis, coma o guion del título rompía la coincidencia aunque el usuario
// escribiera todas las palabras. Caso real reportado: «(Tú) El único rey».
describe('coincidencia por palabras sueltas', () => {
  beforeEach(() => buildIndex(SONGS, WW));

  it('encuentra el título aunque la puntuación separe las palabras', () => {
    expect(searchSongs('Tu el unico').map((s) => s.id)).toContain('3');
  });

  it('ignora tildes y mayúsculas escribiendo la frase completa', () => {
    expect(searchSongs('tú el único rey').map((s) => s.id)).toContain('3');
  });

  it('no exige el orden original de las palabras', () => {
    expect(searchSongs('rey unico').map((s) => s.id)).toContain('3');
  });

  it('acepta palabras a medio escribir (prefijo)', () => {
    expect(searchSongs('uni rey').map((s) => s.id)).toContain('3');
  });

  it('exige TODAS las palabras: una ajena descarta el resultado', () => {
    expect(searchSongs('unico refugio').map((s) => s.id)).not.toContain('3');
  });

  it('mantiene la coincidencia dentro de una palabra (no regresión)', () => {
    // "gua" está en medio de "Aguas": ya matcheaba y debe seguir haciéndolo.
    expect(searchSongs('gua').map((s) => s.id)).toContain('2');
  });

  it('la frase exacta sigue puntuando por encima de la coincidencia suelta', () => {
    const r = searchSongs('eres mi refugio');
    expect(r[0].id).toBe('1');
  });

  it('searchAll también encuentra por palabras sueltas', () => {
    const r = searchAll('unico tu');
    expect(r.map((x) => x.item.id)).toContain('3');
  });

  it('searchEverything encuentra álbum y voz por palabras sueltas', () => {
    expect(searchEverything('alma refugio').voces.map((v) => v.id)).toContain('w1');
    expect(searchEverything('adoracion i').albums.map((a) => a.slug)).toContain('adoracion-i');
  });
});
