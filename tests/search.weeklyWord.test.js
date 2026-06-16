// tests/search.weeklyWord.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { buildIndex, searchAll, clearIndex } from '../src/lib/search.js';

describe('búsqueda de weekly_words', () => {
  beforeEach(() => {
    clearIndex();
    buildIndex(
      [
        {
          id: 's1',
          title: 'Canción',
          album: 'Album',
          artist: 'Artista',
          voiceType: 'mixed',
          coverImage: '',
        },
      ],
      [
        {
          id: 'ww1',
          sunday_date: '2026-06-15',
          gospel_ref: 'Jn 14,6',
          liturgical_title: 'XI Domingo',
          voiceover_body: 'El camino y la verdad',
          liturgical_color: 'green',
        },
      ],
    );
  });

  it('searchAll sin query devuelve []', () => {
    expect(searchAll('')).toEqual([]);
  });

  it('busca canciones y devuelve type song', () => {
    const results = searchAll('canción');
    expect(results.some((r) => r.type === 'song')).toBe(true);
  });

  it('busca weekly_words por gospel_ref', () => {
    const results = searchAll('Jn 14');
    expect(results.some((r) => r.type === 'weekly_word' && r.item.id === 'ww1')).toBe(true);
  });

  it('busca weekly_words por texto del voiceover_body', () => {
    const results = searchAll('camino');
    expect(results.some((r) => r.type === 'weekly_word')).toBe(true);
  });

  it('resultado weekly_word tiene item.id para rutar a #/voz/:id', () => {
    const results = searchAll('XI Domingo');
    const hit = results.find((r) => r.type === 'weekly_word');
    expect(hit).toBeTruthy();
    expect(hit.item.id).toBe('ww1');
  });
});
