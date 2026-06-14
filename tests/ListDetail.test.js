import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/lists.js', () => ({
  getList: vi.fn(),
  createList: vi.fn(async () => ({ id: 'L1' })),
  updateList: vi.fn(),
  deleteList: vi.fn(),
  setListSongs: vi.fn(async () => {}),
  inviteMember: vi.fn(async () => {}),
  removeMember: vi.fn(),
  setActiveContext: vi.fn(),
  searchUsers: vi.fn(async () => []),
}));
vi.mock('../src/lib/store.js', () => ({ getSongById: vi.fn(() => null) }));
vi.mock('../src/lib/search.js', () => ({ searchSongs: vi.fn(() => []) }));
vi.mock('../src/lib/friends.js', () => ({ getAcceptedFriends: vi.fn(async () => []) }));
vi.mock('../src/lib/authStore.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('./Sidebar.js', () => ({ updateSidebarContent: vi.fn() }), { virtual: true });
vi.mock('../src/components/Sidebar.js', () => ({ updateSidebarContent: vi.fn() }));

import { renderListDetail } from '../src/components/ListDetail.js';

describe('wizard de listas', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
  });

  it('arranca en el paso 1 (lo básico)', async () => {
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    expect(container.querySelector('#list-detail-name')).toBeTruthy();
    expect(container.querySelector('.list-wizard__rail')).toBeTruthy();
  });

  it('no avanza al paso 2 si el nombre está vacío', async () => {
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    container.querySelector('#list-wizard-next').click();
    expect(container.querySelector('#list-detail-error').textContent).toMatch(/nombre/i);
  });

  it('avanza al paso 2 con nombre válido', async () => {
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    const name = container.querySelector('#list-detail-name');
    name.value = 'Mi lista';
    name.dispatchEvent(new Event('input'));
    container.querySelector('#list-wizard-next').click();
    expect(container.querySelector('#list-detail-search')).toBeTruthy();
  });

  it('el paso 1 muestra selector de fecha+hora y barra de vida', async () => {
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    expect(container.querySelector('#list-detail-datetime')).toBeTruthy();
    expect(container.querySelector('.list-wizard__life')).toBeTruthy();
  });

  it('agrega una canción desde el buscador en el paso 2', async () => {
    const { searchSongs } = await import('../src/lib/search.js');
    searchSongs.mockReturnValue([{ id: 's1', title: 'Tema', album: 'A' }]);
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    const name = container.querySelector('#list-detail-name');
    name.value = 'L';
    name.dispatchEvent(new Event('input'));
    container.querySelector('#list-wizard-next').click();
    const search = container.querySelector('#list-detail-search');
    search.value = 'tema';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 250));
    container.querySelector('#list-detail-results .song-row-compact').click();
    expect(container.querySelectorAll('#list-detail-songs .song-row-compact').length).toBe(1);
  });

  it('crea la lista llamando a la API con el draft', async () => {
    const lists = await import('../src/lib/lists.js');
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    const name = container.querySelector('#list-detail-name');
    name.value = 'Mi lista';
    name.dispatchEvent(new Event('input'));
    container.querySelector('#list-wizard-next').click(); // a paso 2
    container.querySelector('#list-wizard-next').click(); // a paso 3
    container.querySelector('#list-wizard-next').click(); // crear
    await new Promise((r) => setTimeout(r, 10));
    expect(lists.createList).toHaveBeenCalledWith('Mi lista', expect.any(String));
  });
});
