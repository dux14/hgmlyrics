import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const navigate = vi.fn();
vi.mock('../router.js', () => ({ navigate: (...a) => navigate(...a) }));
let admin = true;
vi.mock('../lib/authStore.js', () => ({ isAdmin: () => admin, getSession: () => null }));

import { renderVoicesAlbumView } from './VoicesAlbumView.js';
import { _clearCache } from '../lib/prefetch.js';

// Espera hasta que fn() devuelva un valor truthy (máx `tries` ciclos de event-loop).
const waitFor = async (fn, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 0));
  }
  return fn();
};

describe('VoicesAlbumView editar por fila', () => {
  beforeEach(() => {
    navigate.mockClear();
    _clearCache(); // getWeeklyWords() cachea 'weekly-words' — evita fugas entre tests
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        weeklyWords: [
          { id: 'w1', gospel_ref: 'Jn 3,16', sunday_date: '2026-06-15', liturgical_color: 'green' },
        ],
      }),
    }));
  });
  afterEach(() => {
    admin = true;
  });

  it('admin: cada fila tiene botón editar → /admin/voz/:id', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const editBtn = await waitFor(() => container.querySelector('[data-edit-voz="w1"]'));
    expect(editBtn).not.toBeNull();
    editBtn.click();
    expect(navigate).toHaveBeenCalledWith('/admin/voz/w1');
  });

  it('no admin: sin botón editar', async () => {
    admin = false;
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    await waitFor(() => container.querySelector('.voz-album__item'));
    expect(container.querySelector('[data-edit-voz]')).toBeNull();
  });
});

describe('VoicesAlbumView jerarquía título + hero', () => {
  beforeEach(() => {
    navigate.mockClear();
    admin = true;
    _clearCache(); // getWeeklyWords() cachea 'weekly-words' — evita fugas entre tests
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        weeklyWords: [
          {
            id: 'w1',
            gospel_ref: 'Jn 3,16',
            sunday_date: '2026-06-15',
            liturgical_color: 'green',
            liturgical_title: '11. Domingo del tiempo ordinario, verde',
          },
          {
            id: 'w2',
            gospel_ref: 'Lc 10,25-37',
            sunday_date: '2026-05-01',
            liturgical_color: 'green',
          },
        ],
      }),
    }));
  });
  afterEach(() => {
    admin = true;
  });

  it('la fila muestra el título litúrgico limpio cuando hay liturgical_title', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const title = await waitFor(() =>
      container.querySelector('[data-voz-id="w1"] .voz-album__m-title'),
    );
    expect(title.textContent).toBe('Domingo del tiempo ordinario');
  });

  it('sin liturgical_title, la fila cae a gospel_ref', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const title = await waitFor(() =>
      container.querySelector('[data-voz-id="w2"] .voz-album__m-title'),
    );
    expect(title.textContent).toBe('Lc 10,25-37');
  });

  it('la fila muestra fecha corta + cita en el subtítulo', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const sub = await waitFor(() =>
      container.querySelector('[data-voz-id="w1"] .voz-album__m-sub'),
    );
    expect(sub.textContent).toContain('Jn 3,16');
  });

  it('el hero muestra el kicker "Palabra de la semana"', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const kicker = await waitFor(() => container.querySelector('.voz-album__hero-kicker'));
    expect(kicker.textContent).toBe('Palabra de la semana');
  });

  it('el badge VIGENTE aparece en la voz vigente', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    await waitFor(() => container.querySelector('.voz-album__item'));
    const badge = container.querySelector('[data-voz-id="w1"] .voz-album__badge--vigente');
    expect(badge).not.toBeNull();
  });

  it('admin: "Nueva voz en off" usa btn--primary', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const btn = await waitFor(() => container.querySelector('#voz-create-btn'));
    expect(btn.classList.contains('btn--primary')).toBe(true);
  });
});
