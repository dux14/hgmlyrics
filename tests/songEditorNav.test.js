import { describe, it, expect, vi } from 'vitest';

// Stub supabase (requires env vars not available in test).
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

// Stub store to avoid idb-keyval and auth side-effects.
vi.mock('../src/lib/store.js', () => ({
  fetchSongDetail: vi.fn(),
  refreshData: vi.fn(),
}));

// Stub router to avoid hash-router DOM side-effects.
vi.mock('../src/router.js', () => ({
  navigate: vi.fn(),
}));

// Stub SongView to avoid its transitive DOM/store deps.
vi.mock('../src/components/SongView.js', () => ({
  renderSongView: vi.fn(),
}));

const { postSaveTarget } = await import('../src/components/SongEditor.js');

describe('postSaveTarget', () => {
  it('con from → vuelve a la canción de origen', () => {
    expect(postSaveTarget({ from: 'abc', isNew: false })).toBe('/song/abc');
    expect(postSaveTarget({ from: 'abc', isNew: true })).toBe('/song/abc');
  });
  it('sin from + edición existente → lista de edición', () => {
    expect(postSaveTarget({ from: null, isNew: false })).toBe('/admin/edit');
  });
  it('sin from + canción nueva → admin', () => {
    expect(postSaveTarget({ from: null, isNew: true })).toBe('/admin');
  });
});
