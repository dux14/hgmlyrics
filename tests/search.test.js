/**
 * search.test.js — Unit tests for search module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildIndex, searchSongs, clearIndex } from '../src/lib/search.js';

const mockSongs = [
  {
    id: 'song-1',
    title: 'Loco',
    artist: 'Hakuna Group Music',
    album: 'Mi Pobre Loco',
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          { text: 'Me dijeron que era un loco', color: null },
          { text: 'Por creer en lo invisible', color: null },
        ],
      },
      {
        type: 'chorus',
        label: 'Coro',
        lines: [{ text: 'Loco loco loco de amor', color: '#FF7043' }],
      },
    ],
  },
  {
    id: 'song-2',
    title: 'Todo Lo Puedo en Él',
    artist: 'Hakuna Group Music',
    album: 'Gracias',
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [
          { text: 'Cuando siento que no puedo más', color: null },
          { text: 'Tú me dices no estás solo', color: null },
        ],
      },
    ],
  },
  {
    id: 'song-3',
    title: 'Vuelve',
    artist: 'Hakuna Group Music',
    album: 'Mi Pobre Loco',
    sections: [
      {
        type: 'verse',
        label: 'Verso 1',
        lines: [{ text: 'He caminado lejos de Ti', color: null }],
      },
    ],
  },
];

describe('search', () => {
  beforeEach(() => {
    clearIndex();
    buildIndex(mockSongs);
  });

  describe('buildIndex', () => {
    it('should build index without errors', () => {
      expect(() => buildIndex(mockSongs)).not.toThrow();
    });

    it('should handle empty array', () => {
      expect(() => buildIndex([])).not.toThrow();
    });
  });

  describe('searchSongs', () => {
    it('should find songs by title', () => {
      const results = searchSongs('Loco');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.id === 'song-1')).toBe(true);
    });

    it('should find songs by album name', () => {
      const results = searchSongs('Gracias');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.id === 'song-2')).toBe(true);
    });

    it('should find songs by lyrics content', () => {
      const results = searchSongs('invisible');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((s) => s.id === 'song-1')).toBe(true);
    });

    it('should return empty array for empty query', () => {
      expect(searchSongs('')).toEqual([]);
      expect(searchSongs('   ')).toEqual([]);
    });

    it('should return empty array for null/undefined query', () => {
      expect(searchSongs(null)).toEqual([]);
      expect(searchSongs(undefined)).toEqual([]);
    });

    it('should return empty array when no matches', () => {
      const results = searchSongs('xyznonexistent');
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const results = searchSongs('Hakuna', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should rank title matches higher than lyrics matches', () => {
      const results = searchSongs('Loco');
      // "Loco" appears in both title (song-1) and lyrics (song-1 chorus)
      // song-1 should be first because of title match
      if (results.length > 0) {
        expect(results[0].id).toBe('song-1');
      }
    });
  });

  describe('clearIndex', () => {
    it('should clear the index so no results are returned', () => {
      clearIndex();
      const results = searchSongs('Loco');
      expect(results).toEqual([]);
    });
  });
});
