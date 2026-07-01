import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prefetch.js', () => ({
  cached: vi.fn(async (_k, fn) => ({ data: await fn() })),
}));
vi.mock('../lib/lists.js', () => ({
  listMyLists: vi.fn(async () => [{ id: 'l1', name: 'Domingo', song_count: 2 }]),
  warmList: vi.fn(),
}));

import { renderListsPage } from './ListsPage.js';

describe('renderListsPage', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
  });

  it('pinta título "Listas" y una fila por lista', async () => {
    await renderListsPage(container, { today: '2026-07-01' });
    expect(container.textContent).toContain('Listas');
    expect(container.querySelector('[data-list-id="l1"]')).not.toBeNull();
    expect(container.querySelector('[data-create-list]')).not.toBeNull();
  });
});
