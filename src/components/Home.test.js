// Home.test.js — TDD Fase 4: Home estilo Spotify (6 secciones dinámicas)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted antes de los imports) ─────────────────────────────
vi.mock('../styles/home.css', () => ({}));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../lib/store.js', () => ({ getState: vi.fn(), getAlbums: vi.fn() }));
vi.mock('../lib/authStore.js', () => ({ isAuthenticated: vi.fn(), getSession: vi.fn() }));
vi.mock('../lib/lists.js', () => ({ listMyLists: vi.fn() }));
vi.mock('../lib/favorites.js', () => ({ getFavoriteIds: vi.fn() }));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn((name) => `[${name}]`) }));
vi.mock('../lib/escape.js', () => ({ escapeHtml: (s) => String(s ?? '') }));
vi.mock('./SongList.js', () => ({
  createSongCard: vi.fn((song) => {
    const d = document.createElement('div');
    d.className = 'song-card';
    d.dataset.songId = song.id;
    return d;
  }),
}));
vi.mock('./songRow.js', () => ({
  resolveCoverUrl: vi.fn((a) => `/covers/${a.slug}.jpg`),
}));
vi.mock('../lib/voiceoverCover.js', () => ({
  voiceoverCoverHtml: vi.fn(() => '<div class="voz-cover"></div>'),
}));
vi.mock('./VoicesAlbumView.js', () => ({
  isVigente: vi.fn((date, today) => String(date).slice(0, 10) <= today),
}));

import { selectRecent, renderHome } from './Home.js';
import { getState, getAlbums } from '../lib/store.js';
import { isAuthenticated } from '../lib/authStore.js';
import { listMyLists } from '../lib/lists.js';
import { getFavoriteIds } from '../lib/favorites.js';
import { navigate } from '../router.js';

// ── Fixtures ─────────────────────────────────────────────────────────
const SONGS = [
  { id: 's1', title: 'Cancion A', year: 2024, albumOrder: 1 },
  { id: 's2', title: 'Cancion B', year: 2023, albumOrder: 2 },
  { id: 's3', title: 'Cancion C', year: 2022, albumOrder: 1 },
];

const ALBUMS = [
  { slug: 'album-1', name: 'Album Uno', coverImage: '', artist: 'Artista A' },
  { slug: 'album-2', name: 'Album Dos', coverImage: '', artist: 'Artista B' },
  { slug: 'album-3', name: 'Album Tres', coverImage: '', artist: 'Artista C' },
  { slug: 'album-4', name: 'Album Cuatro', coverImage: '', artist: 'Artista D' },
  { slug: 'album-5', name: 'Album Cinco', coverImage: '', artist: 'Artista E' },
];

/** fetch que falla (no hay voces) */
const FETCH_FAIL = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });

/** Crea un contenedor limpio y lo adjunta al body. */
function mkContainer() {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  getState.mockReturnValue({ songs: SONGS });
  getAlbums.mockReturnValue(ALBUMS);
  isAuthenticated.mockReturnValue(false);
  getFavoriteIds.mockReturnValue([]);
  vi.stubGlobal('fetch', FETCH_FAIL);
});

// ── selectRecent ──────────────────────────────────────────────────────
describe('selectRecent', () => {
  it('ordena por año desc y acota al límite', () => {
    const result = selectRecent(SONGS, 2);
    expect(result.length).toBe(2);
    expect(result[0].year).toBe(2024);
    expect(result[1].year).toBe(2023);
  });

  it('devuelve array vacío si songs es null', () => {
    expect(selectRecent(null, 6)).toEqual([]);
  });

  it('devuelve array vacío si songs es undefined', () => {
    expect(selectRecent(undefined, 6)).toEqual([]);
  });
});

// ── Estructura y orden de secciones ──────────────────────────────────
describe('renderHome — estructura y orden', () => {
  it('renderiza secciones en el orden: Reciente, Listas, Álbumes', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const titles = [...c.querySelectorAll('.home__hd-title')].map((h) => h.textContent.trim());
    expect(titles[0]).toBe('Reciente');
    expect(titles[1]).toBe('Listas');
    expect(titles[2]).toBe('Álbumes');
  });

  it('cabecera Reciente tiene enlace Ver todos → /buscar', async () => {
    isAuthenticated.mockReturnValue(false);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const btn = [...c.querySelectorAll('.home__all')].find((b) =>
      b.closest('[aria-labelledby="home-recent-hd"]'),
    );
    expect(btn).not.toBeNull();
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/buscar');
  });

  it('cabecera Álbumes tiene enlace Ver todos → /albumes', async () => {
    isAuthenticated.mockReturnValue(false);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const btn = [...c.querySelectorAll('.home__all')].find((b) =>
      b.closest('[aria-labelledby="home-albums-hd"]'),
    );
    expect(btn).not.toBeNull();
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/albumes');
  });

  it('cabecera Voz en off tiene enlace Ver todas → /voces cuando hay vigente', async () => {
    isAuthenticated.mockReturnValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weeklyWords: [
            {
              id: 'w1',
              sunday_date: '2026-06-29',
              gospel_ref: 'Jn 1:1',
              liturgical_color: 'green',
            },
          ],
        }),
      }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const btn = [...c.querySelectorAll('.home__all')].find((b) => b.closest('#section-voz'));
    expect(btn).not.toBeNull();
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/voces');
  });

  it('cabecera Favoritos tiene enlace Ver todos → /favoritos cuando hay favoritos', async () => {
    isAuthenticated.mockReturnValue(false);
    getFavoriteIds.mockReturnValue(['s1']);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const btn = [...c.querySelectorAll('.home__all')].find((b) =>
      b.closest('[aria-labelledby="home-fav-hd"]'),
    );
    expect(btn).not.toBeNull();
    btn.click();
    expect(navigate).toHaveBeenCalledWith('/favoritos');
  });

  it('el teaser Oración navega a /oracion', async () => {
    isAuthenticated.mockReturnValue(false);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    c.querySelector('[data-nav="/oracion"]')?.click();
    expect(navigate).toHaveBeenCalledWith('/oracion');
  });
});

// ── Reciente ──────────────────────────────────────────────────────────
describe('renderHome — Reciente', () => {
  it('renderiza cards para cada canción reciente', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const strip = c.querySelector('#home-recent-strip');
    expect(strip).not.toBeNull();
    expect(strip.querySelectorAll('.song-card').length).toBe(SONGS.length);
  });

  it('el strip existe aunque songs sea vacío', async () => {
    getState.mockReturnValue({ songs: [] });
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#home-recent-strip')).not.toBeNull();
  });
});

// ── Listas ────────────────────────────────────────────────────────────
describe('renderHome — Listas', () => {
  it('oculta la sección si el usuario no está autenticado', async () => {
    isAuthenticated.mockReturnValue(false);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#section-listas')).toBeNull();
  });

  it('oculta la sección si listMyLists lanza un error', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockRejectedValue(new Error('red caída'));
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#section-listas')).toBeNull();
  });

  it('muestra N filas + botón crear cuando hay N listas', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([
      { id: 'l1', name: 'Lista Alpha', expires_at: null, songs_count: 3 },
      { id: 'l2', name: 'Lista Beta', expires_at: '2026-08-01', songs_count: 5 },
    ]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelectorAll('[data-list-id]').length).toBe(2);
    const createBtn = c.querySelector('[data-create-list]');
    expect(createBtn).not.toBeNull();
    expect(createBtn.textContent).toContain('Crear nueva lista');
  });

  it('muestra estado vacío con mensaje y botón cuando listas es []', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const createBtn = c.querySelector('[data-create-list]');
    expect(createBtn).not.toBeNull();
    expect(createBtn.textContent).toContain('Crear tu primera lista');
  });

  it('navega a /lista/:id al hacer clic en una fila', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([
      { id: 'l1', name: 'Lista Alpha', expires_at: null, songs_count: 2 },
    ]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    c.querySelector('[data-list-id]').click();
    expect(navigate).toHaveBeenCalledWith('/lista/l1');
  });

  it('navega a /lista/nueva al hacer clic en crear', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    c.querySelector('[data-create-list]').click();
    expect(navigate).toHaveBeenCalledWith('/lista/nueva');
  });

  it('muestra el conteo real desde song_count (plural)', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([
      { id: 'l1', name: 'Concierto', song_count: 12, expires_at: null },
    ]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const meta = c.querySelector('.home__list-meta');
    expect(meta).not.toBeNull();
    expect(meta.textContent).toContain('12 canciones');
  });

  it('muestra singular cuando song_count es 1', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([
      { id: 'l2', name: 'Sola', song_count: 1, expires_at: null },
    ]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const meta = c.querySelector('.home__list-meta');
    expect(meta).not.toBeNull();
    expect(meta.textContent).toContain('1 canción');
    expect(meta.textContent).not.toContain('1 canciones');
  });

  it('ordena las listas por proximidad a vencer y aplica clase de urgencia', async () => {
    isAuthenticated.mockReturnValue(true);
    listMyLists.mockResolvedValue([
      { id: 'lejana', name: 'Lejana', song_count: 2, expires_at: '2026-09-06' }, // verde
      { id: 'roja', name: 'Inminente', song_count: 2, expires_at: '2026-07-02' }, // rojo (1 día)
      { id: 'amarilla', name: 'Media', song_count: 2, expires_at: '2026-07-06' }, // amarillo (5 días)
    ]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-07-01' });

    const ids = [...c.querySelectorAll('[data-list-id]')].map((b) => b.dataset.listId);
    expect(ids).toEqual(['roja', 'amarilla', 'lejana']);

    const first = c.querySelector('[data-list-id="roja"]');
    expect(first.classList.contains('-red')).toBe(true);
    expect(first.querySelector('.home__list-dot.-red')).not.toBeNull();
    expect(first.querySelector('.home__list-pill').textContent.trim()).toBe('mañana');
  });
});

// ── Álbumes ───────────────────────────────────────────────────────────
describe('renderHome — Álbumes', () => {
  it('muestra exactamente 5 cards de álbum + 1 card "+"', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelectorAll('[data-album-slug]').length).toBe(5);
    expect(c.querySelector('[data-album-plus]')).not.toBeNull();
  });

  it('la card "+" navega a /albumes', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    c.querySelector('[data-album-plus]').click();
    expect(navigate).toHaveBeenCalledWith('/albumes');
  });

  it('las cards de álbum navegan a /album/:slug', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const first = c.querySelector('[data-album-slug="album-1"]');
    expect(first).not.toBeNull();
    first.click();
    expect(navigate).toHaveBeenCalledWith('/album/album-1');
  });

  it('muestra el nombre del álbum en cada card', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const names = [...c.querySelectorAll('.home__album-name')].map((el) => el.textContent.trim());
    expect(names).toContain('Album Uno');
    expect(names).toContain('Album Cinco');
  });

  it('renderiza los álbumes del home como rail horizontal', async () => {
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });
    const rail = c.querySelector('.home__albums-rail');
    expect(rail).toBeTruthy();
    expect(rail.querySelector('.home__album-plus')).toBeTruthy(); // el "+" vive dentro del rail
  });
});

// ── Voz en off ────────────────────────────────────────────────────────
describe('renderHome — Voz en off', () => {
  it('oculta la sección si no hay palabras vigentes (futura)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weeklyWords: [
            {
              id: 'w-future',
              sunday_date: '2026-07-06',
              gospel_ref: 'Jn 1:1',
              liturgical_color: 'green',
            },
          ],
        }),
      }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#section-voz')).toBeNull();
  });

  it('oculta la sección si fetch lanza error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#section-voz')).toBeNull();
  });

  it('oculta la sección si weekly-words devuelve lista vacía', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ weeklyWords: [] }) }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#section-voz')).toBeNull();
  });

  it('muestra la card con badge VIGENTE cuando hay palabra vigente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weeklyWords: [
            {
              id: 'w1',
              sunday_date: '2026-06-29',
              gospel_ref: 'Jn 1:1',
              liturgical_color: 'green',
            },
          ],
        }),
      }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('.home__voz-badge')?.textContent.trim()).toBe('VIGENTE');
    expect(c.querySelector('[data-voz-id]')).not.toBeNull();
  });

  it('navega a /voz/:id al hacer clic en la card', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weeklyWords: [
            {
              id: 'w42',
              sunday_date: '2026-06-22',
              gospel_ref: 'Mt 5:3',
              liturgical_color: 'green',
            },
          ],
        }),
      }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    c.querySelector('[data-voz-id]').click();
    expect(navigate).toHaveBeenCalledWith('/voz/w42');
  });

  it('usa el parámetro today para filtrar vigentes (futura excluida)', async () => {
    // w-future (2026-07-06) está en futuro → no vigente con today=2026-06-30
    // w-past   (2026-06-22) está en pasado → vigente
    const words = [
      { id: 'w-future', sunday_date: '2026-07-06', gospel_ref: 'A', liturgical_color: 'green' },
      { id: 'w-past', sunday_date: '2026-06-22', gospel_ref: 'B', liturgical_color: 'purple' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ weeklyWords: words }) }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('[data-voz-id]')?.dataset.vozId).toBe('w-past');
  });

  it('elige la más reciente (max sunday_date) entre varias vigentes, sin depender del orden del array', async () => {
    // Array en orden ASCENDENTE (más antigua primero) para probar que no usamos find().
    // Con find() devolvería w-old (primera); con reduce(max) devuelve w-recent.
    const words = [
      { id: 'w-old', sunday_date: '2026-06-01', gospel_ref: 'A', liturgical_color: 'green' },
      { id: 'w-mid', sunday_date: '2026-06-15', gospel_ref: 'B', liturgical_color: 'purple' },
      { id: 'w-recent', sunday_date: '2026-06-29', gospel_ref: 'C', liturgical_color: 'white' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ weeklyWords: words }) }),
    );
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    // Debe mostrar la más reciente, no la primera del array
    expect(c.querySelector('[data-voz-id]')?.dataset.vozId).toBe('w-recent');
  });
});

// ── Favoritos ─────────────────────────────────────────────────────────
describe('renderHome — Favoritos', () => {
  it('oculta la sección si no hay favoritos', async () => {
    getFavoriteIds.mockReturnValue([]);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    expect(c.querySelector('#home-fav-strip')).toBeNull();
    expect(c.querySelector('[aria-labelledby="home-fav-hd"]')).toBeNull();
  });

  it('muestra el strip de favoritos con las cards cuando hay favoritos', async () => {
    getFavoriteIds.mockReturnValue(['s1', 's2']);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const strip = c.querySelector('#home-fav-strip');
    expect(strip).not.toBeNull();
    expect(strip.querySelectorAll('.song-card').length).toBe(2);
  });

  it('ignora IDs de favoritos que no están en songs', async () => {
    getFavoriteIds.mockReturnValue(['s1', 'no-existe']);
    const c = mkContainer();
    await renderHome(c, { today: '2026-06-30' });

    const strip = c.querySelector('#home-fav-strip');
    expect(strip?.querySelectorAll('.song-card').length).toBe(1);
  });
});
