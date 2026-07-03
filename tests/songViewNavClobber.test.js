import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bug de navegación #3 (misma clase, caller SongView): si el usuario abre una
// canción NO cacheada y navega fuera antes de que resuelva fetchSongDetail, el
// render tardío NO debe reemplazar la pantalla nueva. _renderSongBody posee el
// container full-bleed, así que el guard es container.contains(region).

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(() => null),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn(() => ({ prev: null, next: null, currentIndex: 0, total: 0 })),
  filterByAlbum: vi.fn(),
}));

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));

vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: vi.fn().mockReturnValue(false),
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../src/lib/lists.js', () => ({
  getAdjacentInList: vi.fn(() => null),
  getList: vi.fn(() => new Promise(() => {})),
  setActiveContext: vi.fn(),
  getActiveContext: vi.fn(() => null),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  window.location.hash = '';
  document.body.innerHTML = '';
});

describe('SongView — navegación: un fetch tardío de la canción no clobberea la pantalla nueva', () => {
  it('navegar fuera antes de que resuelva fetchSongDetail deja intacta la pantalla nueva', async () => {
    const store = await import('../src/lib/store.js');
    store.getSongById.mockReturnValue(null); // sin cache → rama async con fetch

    let resolveFetch;
    const fetchP = new Promise((r) => {
      resolveFetch = r;
    });
    store.fetchSongDetail.mockImplementation(() => fetchP);

    const container = document.createElement('div');
    document.body.appendChild(container);

    const { renderSongView } = await import('../src/components/SongView.js');
    renderSongView(container, 'abc'); // arranca fetch async (fetchSongDetail pendiente)

    // El usuario navega a /admin: el router reemplaza el contenido compartido.
    container.innerHTML = '<div id="admin-page">Panel de admin</div>';

    // La canción resuelve tarde, con la URL ya en /admin.
    resolveFetch({
      id: 'abc',
      title: 'Cancion',
      sections: [{ type: 'verse', label: 'V', lines: [{ text: 'hola' }] }],
      voiceRoster: [],
    });
    await flush();

    expect(container.querySelector('#admin-page')).not.toBeNull();
  });
});
