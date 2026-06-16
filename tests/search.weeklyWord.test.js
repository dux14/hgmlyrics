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
          title: 'La vid y los sarmientos',
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

  it('busca weekly_words por el campo title', () => {
    const results = searchAll('vid');
    const hit = results.find((r) => r.type === 'weekly_word');
    expect(hit).toBeTruthy();
    expect(hit.item.id).toBe('ww1');
  });

  it('el campo title tiene score más alto que gospel_ref para el mismo match', () => {
    clearIndex();
    buildIndex(
      [],
      [
        {
          id: 'ww2',
          gospel_ref: 'Jn 1,1',
          title: 'Inicio',
          liturgical_title: '',
          voiceover_body: '',
        },
        {
          id: 'ww3',
          gospel_ref: 'Inicio del evangelio',
          title: null,
          liturgical_title: '',
          voiceover_body: '',
        },
      ],
    );
    const results = searchAll('inicio');
    const byTitle = results.find((r) => r.item.id === 'ww2');
    const byRef = results.find((r) => r.item.id === 'ww3');
    expect(byTitle).toBeTruthy();
    expect(byRef).toBeTruthy();
    expect(byTitle.score).toBeGreaterThan(byRef.score);
  });

  it('weekly_word sin title no impacta si title es null', () => {
    clearIndex();
    buildIndex(
      [],
      [
        {
          id: 'ww4',
          gospel_ref: 'Lc 1,1',
          liturgical_title: 'Adviento',
          voiceover_body: 'texto',
          title: null,
        },
      ],
    );
    const results = searchAll('adviento');
    expect(results.some((r) => r.item.id === 'ww4')).toBe(true);
  });
});
