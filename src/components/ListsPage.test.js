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

  it('renderListsPage pinta skeleton antes de resolver los datos', async () => {
    const el = document.createElement('div');
    const p = renderListsPage(el); // no await todavía
    expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
    await p;
  });

  it('pinta título "Listas" y una fila por lista', async () => {
    await renderListsPage(container, { today: '2026-07-01' });
    expect(container.textContent).toContain('Listas');
    expect(container.querySelector('[data-list-id="l1"]')).not.toBeNull();
    expect(container.querySelector('[data-create-list]')).not.toBeNull();
  });
});
