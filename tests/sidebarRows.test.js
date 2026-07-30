import { describe, it, expect, vi } from 'vitest';

// Mock modules that pull in Supabase at import time
vi.mock('../src/lib/store.js', () => ({
  getAlbums: vi.fn(() => []),
  filterByAlbum: vi.fn(),
  getState: vi.fn(() => ({ activeAlbum: null })),
}));
vi.mock('../src/lib/lists.js', () => ({ listMyLists: vi.fn(async () => []) }));
vi.mock('../src/lib/listDraft.js', () => ({
  formatExpiry: vi.fn((s) => s),
  expiryBand: vi.fn(),
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { listItemHtml, sortListsByExpiry, renderSidebar } from '../src/components/Sidebar.js';
import { getAlbums } from '../src/lib/store.js';
import { expiryBand } from '../src/lib/listDraft.js';

describe('listItemHtml', () => {
  it('muestra badge cuando child_count > 0', () => {
    expiryBand.mockReturnValue(null);
    const html = listItemHtml({ id: 'e1', name: 'Concierto', expires_at: null, child_count: 2 });
    expect(html).toContain('sidebar__list-badge');
    expect(html).toContain('>2<');
  });

  it('sin badge cuando no hay hijos', () => {
    expiryBand.mockReturnValue(null);
    const html = listItemHtml({ id: 'l1', name: 'Lista', expires_at: null, child_count: 0 });
    expect(html).not.toContain('sidebar__list-badge');
  });

  it('no incluye chip de texto de caducidad en el sidebar', () => {
    expiryBand.mockReturnValue('urgent');
    const html = listItemHtml({
      id: 'l2',
      name: 'Lista',
      expires_at: '2025-01-01T00:00:00Z',
      child_count: 1,
    });
    expect(html).not.toContain('lists__expiry-chip');
  });

  it('badge con banda urgente cuando child_count > 0 y band = urgent', () => {
    expiryBand.mockReturnValue('urgent');
    const html = listItemHtml({
      id: 'l3',
      name: 'Lista',
      expires_at: '2025-01-01T00:00:00Z',
      child_count: 3,
    });
    expect(html).toContain('sidebar__list-badge--urgent');
    expect(html).toContain('>3<');
  });

  it('dot cuando child_count = 0 pero band = soon', () => {
    expiryBand.mockReturnValue('soon');
    const html = listItemHtml({
      id: 'l4',
      name: 'Lista',
      expires_at: '2025-03-01T00:00:00Z',
      child_count: 0,
    });
    expect(html).toContain('sidebar__list-dot--soon');
    expect(html).not.toContain('sidebar__list-badge');
  });

  it('sin fecha y sin ensayos: ni badge ni dot', () => {
    expiryBand.mockReturnValue(null);
    const html = listItemHtml({ id: 'l5', name: 'Lista', expires_at: null, child_count: 0 });
    expect(html).not.toContain('sidebar__list-badge');
    expect(html).not.toContain('sidebar__list-dot');
  });
});

describe('sortListsByExpiry', () => {
  it('ordena ascendente por expires_at, sin-fecha al final', () => {
    const lists = [
      { id: 'c', name: 'C', expires_at: '2026-12-01T00:00:00Z' },
      { id: 'a', name: 'A', expires_at: '2026-06-01T00:00:00Z' },
      { id: 'n', name: 'N', expires_at: null },
      { id: 'b', name: 'B', expires_at: '2026-09-01T00:00:00Z' },
    ];
    const sorted = sortListsByExpiry(lists);
    expect(sorted.map((l) => l.id)).toEqual(['a', 'b', 'c', 'n']);
  });

  it('no muta el array original', () => {
    const lists = [
      { id: 'b', name: 'B', expires_at: '2026-09-01T00:00:00Z' },
      { id: 'a', name: 'A', expires_at: '2026-06-01T00:00:00Z' },
    ];
    const original = [...lists];
    sortListsByExpiry(lists);
    expect(lists.map((l) => l.id)).toEqual(original.map((l) => l.id));
  });

  it('multiples sin fecha quedan todas al final', () => {
    const lists = [
      { id: 'x', name: 'X', expires_at: null },
      { id: 'a', name: 'A', expires_at: '2026-06-01T00:00:00Z' },
      { id: 'y', name: 'Y', expires_at: null },
    ];
    const sorted = sortListsByExpiry(lists);
    expect(sorted[0].id).toBe('a');
    expect(
      sorted
        .slice(1)
        .map((l) => l.id)
        .sort(),
    ).toEqual(['x', 'y']);
  });

  it('fecha inválida queda al final junto a las sin fecha', () => {
    const lists = [
      { id: 'inv', name: 'Inv', expires_at: 'not-a-date' },
      { id: 'a', name: 'A', expires_at: '2026-06-01T00:00:00Z' },
      { id: 'n', name: 'N', expires_at: null },
    ];
    const sorted = sortListsByExpiry(lists);
    expect(sorted[0].id).toBe('a');
    expect(
      sorted
        .slice(1)
        .map((l) => l.id)
        .sort(),
    ).toEqual(['inv', 'n']);
  });
});

describe('renderSidebar — álbum sin portada', () => {
  it('no rompe el render cuando el álbum tiene coverImage en null', () => {
    // Regresión: getAlbums toma la portada de la primera canción del grupo, así
    // que una canción sin portada deja el álbum con coverImage en null. El
    // .startsWith sin guarda explotaba dentro del .map que arma el HTML y se
    // llevaba puesto el render entero de la app, no solo la miniatura.
    getAlbums.mockReturnValue([{ slug: 'sin-portada', name: 'Sin portada', coverImage: null }]);
    const container = document.createElement('div');

    expect(() => renderSidebar(container)).not.toThrow();

    const thumb = container.querySelector('.sidebar__album-thumb');
    expect(thumb).toBeTruthy();
    // safeUrl absolutiza el src, así que el vacío queda como la base del
    // documento; lo que importa es que no se cuele el literal "null" ni el
    // prefijo /covers/ sobre una portada inexistente.
    expect(thumb.getAttribute('src')).not.toContain('null');
    expect(thumb.getAttribute('src')).not.toContain('/covers/');
    expect(container.textContent).toContain('Sin portada');
  });

  it('conserva la portada cuando el álbum sí la tiene', () => {
    getAlbums.mockReturnValue([{ slug: 'con-portada', name: 'Con portada', coverImage: 'x.jpg' }]);
    const container = document.createElement('div');

    renderSidebar(container);

    expect(container.querySelector('.sidebar__album-thumb').getAttribute('src')).toContain(
      '/covers/x.jpg',
    );
  });
});
