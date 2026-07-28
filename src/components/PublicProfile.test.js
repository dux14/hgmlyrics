/**
 * PublicProfile.test.js
 * SEC-X1: escape XSS en avatarUrl
 * Task 4 F2a: UI Ambient Kinetic — botón amigo, secciones, favoritas
 * Task 7: estado de amistad por friendStatus + onda de rango vocal
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok' })),
}));

vi.mock('../styles/profile.css', () => ({}));

vi.mock('./vocal-range/waveRange.js', () => ({
  createWaveRange: vi.fn(({ low, high }) => {
    if (!low && !high) return null;
    return { el: document.createElement('canvas') };
  }),
}));

import { renderPublicProfile } from './PublicProfile.js';
import { _clearCache } from '../lib/prefetch.js';

// Perfil base reutilizable en los tests
function makeProfileData(overrides = {}) {
  return {
    profile: {
      id: 'user-uuid-123',
      avatarUrl: null,
      displayName: 'Mateo Ríos',
      username: 'mateor',
      bio: null,
      voiceType: null,
      voiceSubtype: null,
      vocalRangeLow: null,
      vocalRangeHigh: null,
      vocalRangeNotes: null,
      instrumentRoles: [],
      isPublic: true,
    },
    favorites: [],
    friendCount: 24,
    isOwn: false,
    friendStatus: 'none',
    ...overrides,
  };
}

// Helper: promesa que vacía la cola de microtareas
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('renderPublicProfile — SEC-X1: avatarUrl escapado en img src', () => {
  beforeEach(() => {
    _clearCache(); // getPublicProfile() cachea por username — evita fugas entre tests
    globalThis.fetch = vi.fn();
  });

  it('avatarUrl con payload XSS no crea atributo onerror ejecutable', async () => {
    const maliciousAvatar = '" onerror="alert(1)" x="';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            makeProfileData({
              profile: {
                avatarUrl: maliciousAvatar,
                displayName: 'Ana',
                username: 'ana',
                bio: null,
                voiceType: null,
                voiceSubtype: null,
                vocalRangeLow: null,
                vocalRangeHigh: null,
                vocalRangeNotes: null,
                instrumentRoles: [],
              },
            }),
          ),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'ana');
    await flush(); // la región se pinta async tras el fetch
    // No debe existir <img> con atributo onerror ejecutable
    expect(container.querySelector('img[onerror]')).toBeNull();

    const img = container.querySelector('img.pf-av');
    expect(img).not.toBeNull();
    expect(img.hasAttribute('onerror')).toBe(false);
  });

  it('avatarUrl legítima (https) se sirve como miniatura del mismo objeto', async () => {
    const legitUrl = 'https://example.supabase.co/storage/v1/object/public/avatars/ana.webp';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            makeProfileData({
              profile: {
                avatarUrl: legitUrl,
                displayName: 'Ana',
                username: 'ana',
                bio: null,
                voiceType: null,
                voiceSubtype: null,
                vocalRangeLow: null,
                vocalRangeHigh: null,
                vocalRangeNotes: null,
                instrumentRoles: [],
              },
            }),
          ),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'ana');
    await flush(); // la región se pinta async tras el fetch
    const img = container.querySelector('img.pf-av');
    expect(img).not.toBeNull();
    // La URL pasa por avatarThumb: mismo origen y mismo objeto, servido por el
    // transformador de Storage. escapeHtml no altera una URL sin &<>"'.
    const src = new URL(img.getAttribute('src'));
    expect(src.origin).toBe('https://example.supabase.co');
    expect(src.pathname).toBe('/storage/v1/render/image/public/avatars/ana.webp');
    expect(src.searchParams.get('width')).toBe('104');
  });
});

describe('renderPublicProfile — UI Ambient Kinetic (Task 4 F2a)', () => {
  beforeEach(() => {
    _clearCache(); // getPublicProfile() cachea por username — evita fugas entre tests
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData()),
      }),
    );
  });

  it('muestra el botón #add-friend-btn cuando !isOwn', async () => {
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    const btn = container.querySelector('#add-friend-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Agregar amigo');
  });

  it('no muestra #add-friend-btn cuando isOwn; muestra enlace a #/perfil/editar', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ isOwn: true })),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    expect(container.querySelector('#add-friend-btn')).toBeNull();

    const editLink = container.querySelector('a[href="#/perfil/editar"]');
    expect(editLink).not.toBeNull();
    expect(editLink.textContent).toContain('Editar mi perfil');
  });

  it('al hacer click llama POST /api/social/friends y cambia texto a "Solicitud enviada"', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeProfileData()),
      })
      .mockResolvedValueOnce({ ok: true });

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    const btn = container.querySelector('#add-friend-btn');
    expect(btn).not.toBeNull();

    btn.click();
    await flush();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/social/friends',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(btn.textContent).toBe('Solicitud enviada');
    expect(btn.classList.contains('pf-btn-action--sent')).toBe(true);
  });

  it('al hacer click con {ok:false} muestra "No se pudo enviar" y re-habilita el botón', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeProfileData()),
      })
      .mockResolvedValueOnce({ ok: false });

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    const btn = container.querySelector('#add-friend-btn');
    btn.click();
    await flush();

    expect(btn.textContent).toBe('No se pudo enviar');
    expect(btn.classList.contains('pf-btn-action--sent')).toBe(false);
    expect(btn.disabled).toBe(false); // permite reintentar
  });

  it('al rechazar fetch (error de red) muestra "No se pudo enviar" y re-habilita el botón', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeProfileData()),
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    const btn = container.querySelector('#add-friend-btn');
    btn.click();
    await flush();

    expect(btn.textContent).toBe('No se pudo enviar');
    expect(btn.classList.contains('pf-btn-action--sent')).toBe(false);
    expect(btn.disabled).toBe(false); // permite reintentar
  });

  it('renderiza favoritas en elementos .pf-srow con título y álbum', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            makeProfileData({
              favorites: [
                {
                  id: '1',
                  title: 'Aguas Vivas',
                  album: 'Manantial',
                  albumSlug: 'manantial',
                  coverImage: null,
                  favoritedAt: '2024-01-01',
                },
                {
                  id: '2',
                  title: 'Fuego Eterno',
                  album: 'Pentecostés',
                  albumSlug: 'pentecostes',
                  coverImage: 'https://example.com/cover.jpg',
                  favoritedAt: '2024-01-02',
                },
              ],
            }),
          ),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch

    const rows = container.querySelectorAll('.pf-srow');
    expect(rows).toHaveLength(2);

    expect(rows[0].querySelector('.pf-st').textContent).toBe('Aguas Vivas');
    expect(rows[0].querySelector('.pf-sa').textContent).toBe('Manantial');

    expect(rows[1].querySelector('.pf-st').textContent).toBe('Fuego Eterno');
    expect(rows[1].querySelector('.pf-sa').textContent).toBe('Pentecostés');
  });

  it('cuando no hay favoritas muestra "—" en lugar de filas', async () => {
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    expect(container.querySelectorAll('.pf-srow')).toHaveLength(0);
    expect(container.querySelector('.pf-list').textContent).toContain('—');
  });

  it('muestra identidad: nombre, @usuario y conteo de amigos', async () => {
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    const name = container.querySelector('.pf-name');
    expect(name.textContent).toContain('Mateo Ríos');

    const user = container.querySelector('.pf-user');
    expect(user.textContent).toContain('@mateor');
    expect(user.textContent).toContain('24 amigos');
  });

  it('pluraliza "amigo" cuando friendCount es 1', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendCount: 1 })),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush(); // la región se pinta async tras el fetch
    expect(container.querySelector('.pf-user').textContent).toContain('1 amigo');
    expect(container.querySelector('.pf-user').textContent).not.toContain('1 amigos');
  });
});

describe('renderPublicProfile — Task 7: estado de amistad + rango vocal', () => {
  beforeEach(() => {
    _clearCache(); // getPublicProfile() cachea por username — evita fugas entre tests
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData()),
      }),
    );
    globalThis.confirm = vi.fn(() => true);
  });

  it('friendStatus "accepted" → botón #rm-friend-btn con clase .pf-btn-action--rm y texto "Eliminar amigo"', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'accepted' })),
      }),
    );
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();
    const btn = container.querySelector('#rm-friend-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('pf-btn-action--rm')).toBe(true);
    expect(btn.textContent).toContain('Eliminar amigo');
    // No debe mostrar el botón de agregar amigo
    expect(container.querySelector('#add-friend-btn')).toBeNull();
  });

  it('friendStatus "accepted" → click confirma, llama DELETE con otherUserId y actualiza estado', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'accepted' })),
      })
      .mockResolvedValueOnce({ ok: true });

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();

    const btn = container.querySelector('#rm-friend-btn');
    expect(btn).not.toBeNull();
    btn.click();
    await flush();

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/social/friends',
      expect.objectContaining({ method: 'DELETE' }),
    );
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(body).toHaveProperty('otherUserId', 'user-uuid-123');
  });

  it('friendStatus "accepted" → click con confirm=false NO llama DELETE', async () => {
    globalThis.confirm = vi.fn(() => false);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'accepted' })),
      }),
    );

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();

    const btn = container.querySelector('#rm-friend-btn');
    btn.click();
    await flush();

    // Solo la llamada inicial del perfil; no debe haber llamada DELETE
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('friendStatus "pending_out" → botón "Solicitud enviada" deshabilitado', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'pending_out' })),
      }),
    );
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();
    const btn = container.querySelector('#add-friend-btn');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Solicitud enviada');
  });

  it('friendStatus "pending_in" → muestra botón #accept-friend-btn con texto "Aceptar"', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'pending_in' })),
      }),
    );
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();
    const btn = container.querySelector('#accept-friend-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Aceptar');
    // No debe mostrar el botón de agregar
    expect(container.querySelector('#add-friend-btn')).toBeNull();
  });

  it('friendStatus "pending_in" → click llama PATCH con requesterId y action accept', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeProfileData({ friendStatus: 'pending_in' })),
      })
      .mockResolvedValueOnce({ ok: true });

    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();

    const btn = container.querySelector('#accept-friend-btn');
    btn.click();
    await flush();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/social/friends',
      expect.objectContaining({ method: 'PATCH' }),
    );
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(body).toHaveProperty('requesterId', 'user-uuid-123');
    expect(body).toHaveProperty('action', 'accept');
  });

  it('muestra .pf-wave-host cuando el perfil trae vocalRangeLow', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            makeProfileData({
              profile: { ...makeProfileData().profile, vocalRangeLow: 'C3', vocalRangeHigh: 'A5' },
            }),
          ),
      }),
    );
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();
    expect(container.querySelector('.pf-wave-host')).not.toBeNull();
  });

  it('no muestra .pf-wave-host cuando el perfil no trae rango vocal', async () => {
    const container = document.createElement('div');
    await renderPublicProfile(container, 'mateor');
    await flush();
    expect(container.querySelector('.pf-wave-host')).toBeNull();
  });
});
