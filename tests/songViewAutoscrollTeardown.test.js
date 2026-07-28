import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// B1 (perf): el teardown del autoscroll estaba colgado de 'hashchange', pero
// navigate(path, {replace:true}) usa history.replaceState y NO dispara ese
// evento (logout / expiracion de sesion via guardedRoute). Este test usa el
// router REAL (no mockeado) para probar el camino real: navegar con replace
// debe disparar onRouteChange y limpiar el FAB + sus listeners.

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}));

vi.mock('../src/lib/store.js', () => ({
  getSongById: vi.fn(),
  filterByAlbum: vi.fn(),
  fetchSongDetail: vi.fn(),
  getAdjacentSongs: vi.fn().mockReturnValue({ prev: null, next: null }),
}));

vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => null,
  subscribe: () => () => {},
  isAdmin: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/components/ImmersiveView.js', () => ({
  enterImmersive: vi.fn(),
}));

const { renderSongView } = await import('../src/components/SongView.js');
const { getSongById } = await import('../src/lib/store.js');
const { navigate } = await import('../src/router.js');

window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

function buildSong(id) {
  return {
    id,
    title: 'Santo',
    schemaVersion: 3,
    voiceRoster: [],
    sections: [{ type: 'verse', label: 'V', lines: [{ text: 'Santo es el Señor', groups: [] }] }],
  };
}

describe('setupAutoscroll — teardown por onRouteChange (no solo hashchange)', () => {
  beforeEach(() => {
    window.location.hash = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('navigate(path, {replace:true}) desmonta el FAB y desengancha wheel/touchmove', async () => {
    const song = buildSong('song-1');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderSongView(container, 'song-1');

    expect(document.querySelectorAll('.autoscroll-fab').length).toBe(1);

    const removeSpy = vi.spyOn(window, 'removeEventListener');

    // replaceState no dispara 'hashchange' — camino real de guardedRoute/logout.
    navigate('/otra-pantalla', { replace: true });

    expect(document.querySelectorAll('.autoscroll-fab').length).toBe(0);
    expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));

    removeSpy.mockRestore();
  });

  it('navegar dos veces con replace no deja FABs huerfanos acumulados', async () => {
    const song = buildSong('song-2');
    getSongById.mockReturnValue(song);
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderSongView(container, 'song-2');
    expect(document.querySelectorAll('.autoscroll-fab').length).toBe(1);

    navigate('/pantalla-a', { replace: true });
    navigate('/pantalla-b', { replace: true });

    expect(document.querySelectorAll('.autoscroll-fab').length).toBe(0);
  });
});
