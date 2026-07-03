import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub supabase (requires env vars not available in test).
vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

// Stub store: canción cacheada CON secciones → renderSongView toma la rama cacheada
// (_renderSongBody directo, sin skeleton de fetch).
vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn(() => ({ prev: null, next: null, currentIndex: 0, total: 0 })),
  filterByAlbum: vi.fn(),
}));

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));

vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn(() => false),
}));

// lists.js: getList NUNCA resuelve, para congelar _renderSongBody en el await de red
// y poder observar el DOM justo en ese límite. getAdjacentInList devuelve null para
// forzar la rama que hace await import() + getList().
vi.mock('../src/lib/lists.js', () => ({
  getAdjacentInList: vi.fn(() => null),
  getList: vi.fn(() => new Promise(() => {})),
  setActiveContext: vi.fn(),
  getActiveContext: vi.fn(() => null),
}));

const cachedSong = {
  id: 'abc',
  title: 'Canción cacheada',
  sections: [{ type: 'verse', label: 'V', lines: [{ text: 'hola mundo' }] }],
  voiceRoster: [],
};

beforeEach(() => {
  window.location.hash = '';
});

describe('SongView — navegación: no dejar la pantalla anterior bajo la URL nueva', () => {
  it('canción cacheada abierta desde una lista (?lista=) limpia la pantalla anterior ANTES de esperar la red', async () => {
    window.location.hash = '#/song/abc?lista=xyz';
    const store = await import('../src/lib/store.js');
    store.getSongById.mockReturnValue(cachedSong);

    const container = document.createElement('div');
    container.innerHTML = '<div id="prev-screen">pantalla anterior (lista)</div>';

    const { renderSongView } = await import('../src/components/SongView.js');
    // No await: getList() nunca resuelve; queremos el estado del DOM en el límite
    // del primer await, con la URL ya en /song/abc.
    renderSongView(container, 'abc');

    expect(container.querySelector('#prev-screen')).toBeNull();
  });
});
