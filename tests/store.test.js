/**
 * store.test.js — Unit tests for store module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock idb-keyval before importing store
vi.mock('idb-keyval', () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
}));

import {
  initStore,
  getState,
  subscribe,
  filterByAlbum,
  setSortMode,
  filterByVoice,
  getSongById,
  getAlbums,
  clearCache,
  refreshData,
} from '../src/lib/store.js';

describe('store', () => {
  beforeEach(async () => {
    await initStore();
  });

  describe('initStore', () => {
    it('should load songs from bundled data', () => {
      const { songs } = getState();
      expect(songs).toBeDefined();
      expect(songs.length).toBeGreaterThan(0);
    });

    it('should populate filtered with all songs initially', () => {
      const { filtered } = getState();
      expect(filtered.length).toBe(getState().songs.length);
    });

    it('should default to a-z sort mode', () => {
      const { sortMode } = getState();
      expect(sortMode).toBe('a-z');
    });
  });

  describe('filterByAlbum', () => {
    it('should filter songs by album slug', () => {
      filterByAlbum('mi-pobre-loco');
      const { filtered, activeAlbum } = getState();
      expect(activeAlbum).toBe('mi-pobre-loco');
      filtered.forEach((song) => {
        expect(song.albumSlug).toBe('mi-pobre-loco');
      });
    });

    it('should show all songs when filter is cleared', () => {
      filterByAlbum('mi-pobre-loco');
      filterByAlbum(null);
      const { filtered, activeAlbum } = getState();
      expect(activeAlbum).toBeNull();
      expect(filtered.length).toBe(getState().songs.length);
    });
  });

  describe('setSortMode', () => {
    it('should sort A-Z by title', () => {
      setSortMode('a-z');
      const { filtered } = getState();
      for (let i = 1; i < filtered.length; i++) {
        expect(
          filtered[i - 1].title.localeCompare(filtered[i].title, 'es'),
        ).toBeLessThanOrEqual(0);
      }
    });

    it('should sort Z-A by title', () => {
      setSortMode('z-a');
      const { filtered } = getState();
      for (let i = 1; i < filtered.length; i++) {
        expect(
          filtered[i - 1].title.localeCompare(filtered[i].title, 'es'),
        ).toBeGreaterThanOrEqual(0);
      }
    });

    it('should sort by most recent year', () => {
      setSortMode('recent');
      const { filtered } = getState();
      for (let i = 1; i < filtered.length; i++) {
        expect(filtered[i - 1].year).toBeGreaterThanOrEqual(filtered[i].year);
      }
    });

    it('should sort by album name', () => {
      setSortMode('album');
      const { filtered } = getState();
      for (let i = 1; i < filtered.length; i++) {
        const cmp = filtered[i - 1].album.localeCompare(filtered[i].album, 'es');
        expect(cmp).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('filterByVoice', () => {
    it('should filter by male voice type', () => {
      filterByVoice('male');
      const { filtered } = getState();
      filtered.forEach((song) => {
        expect(song.voiceType).toBe('male');
      });
    });

    it('should filter by female voice type', () => {
      filterByVoice('female');
      const { filtered } = getState();
      filtered.forEach((song) => {
        expect(song.voiceType).toBe('female');
      });
    });

    it('should clear voice filter with null', () => {
      filterByVoice('male');
      filterByVoice(null);
      const { filtered } = getState();
      expect(filtered.length).toBe(getState().songs.length);
    });
  });

  describe('getSongById', () => {
    it('should return a song by its id', () => {
      const { songs } = getState();
      const song = getSongById(songs[0].id);
      expect(song).toBeDefined();
      expect(song.id).toBe(songs[0].id);
    });

    it('should return undefined for a non-existent id', () => {
      const song = getSongById('non-existent-song-id');
      expect(song).toBeUndefined();
    });
  });

  describe('getAlbums', () => {
    it('should return unique albums', () => {
      const albums = getAlbums();
      expect(albums.length).toBeGreaterThan(0);
      const slugs = albums.map((a) => a.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('should have slug, name, and coverImage for each album', () => {
      const albums = getAlbums();
      albums.forEach((album) => {
        expect(album.slug).toBeDefined();
        expect(album.name).toBeDefined();
        expect(album.coverImage).toBeDefined();
      });
    });
  });

  describe('subscribe', () => {
    it('should call listener on state change', () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);

      setSortMode('z-a');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
    });

    it('should not call listener after unsubscribe', () => {
      const listener = vi.fn();
      const unsub = subscribe(listener);
      unsub();

      setSortMode('a-z');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('refreshData', () => {
    it('should reload songs from bundled data', async () => {
      await refreshData();
      const { songs } = getState();
      expect(songs.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('should not throw', async () => {
      await expect(clearCache()).resolves.not.toThrow();
    });
  });
});
