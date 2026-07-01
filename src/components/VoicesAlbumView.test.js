import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const navigate = vi.fn();
vi.mock('../router.js', () => ({ navigate: (...a) => navigate(...a) }));
let admin = true;
vi.mock('../lib/authStore.js', () => ({ isAdmin: () => admin }));
vi.mock('../lib/supabase.js', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}));

import { renderVoicesAlbumView } from './VoicesAlbumView.js';

describe('VoicesAlbumView editar por fila', () => {
  beforeEach(() => {
    navigate.mockClear();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        weeklyWords: [
          { id: 'w1', gospel_ref: 'Jn 3,16', sunday_date: '2026-06-15', liturgical_color: 'green' },
        ],
      }),
    }));
  });
  afterEach(() => { admin = true; });

  it('admin: cada fila tiene botón editar → /admin/voz/:id', async () => {
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    const editBtn = container.querySelector('[data-edit-voz="w1"]');
    expect(editBtn).not.toBeNull();
    editBtn.click();
    expect(navigate).toHaveBeenCalledWith('/admin/voz/w1');
  });

  it('no admin: sin botón editar', async () => {
    admin = false;
    const container = document.createElement('div');
    await renderVoicesAlbumView(container);
    expect(container.querySelector('[data-edit-voz]')).toBeNull();
  });
});
