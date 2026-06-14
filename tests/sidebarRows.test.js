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
}));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { listItemHtml } from '../src/components/Sidebar.js';

describe('listItemHtml', () => {
  it('muestra badge cuando child_count > 0', () => {
    const html = listItemHtml({ id: 'e1', name: 'Concierto', expires_at: null, child_count: 2 });
    expect(html).toContain('sidebar__list-badge');
    expect(html).toContain('>2<');
  });

  it('sin badge cuando no hay hijos', () => {
    const html = listItemHtml({ id: 'l1', name: 'Lista', expires_at: null, child_count: 0 });
    expect(html).not.toContain('sidebar__list-badge');
  });
});
