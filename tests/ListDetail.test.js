import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/lib/lists.js', () => ({
  getList: vi.fn(),
  createList: vi.fn(async () => ({ id: 'L1' })),
  updateList: vi.fn(),
  deleteList: vi.fn(),
  setListSongs: vi.fn(async () => {}),
  setListItems: vi.fn(async () => {}),
  inviteMember: vi.fn(async () => {}),
  removeMember: vi.fn(),
  setActiveContext: vi.fn(),
  searchUsers: vi.fn(async () => []),
}));
vi.mock('../src/lib/store.js', () => ({ getSongById: vi.fn(() => null) }));
vi.mock('../src/lib/search.js', () => ({ searchAll: vi.fn(() => []) }));
vi.mock('../src/lib/friends.js', () => ({ getAcceptedFriends: vi.fn(async () => []) }));
vi.mock('../src/lib/authStore.js', () => ({ isAdmin: vi.fn(() => false) }));
vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('./Sidebar.js', () => ({ updateSidebarContent: vi.fn() }), { virtual: true });
vi.mock('../src/components/Sidebar.js', () => ({ updateSidebarContent: vi.fn() }));

import { renderListDetail, __renderEditorForTest } from '../src/components/ListDetail.js';

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
    const { searchAll } = await import('../src/lib/search.js');
    searchAll.mockReturnValue([
      { type: 'song', item: { id: 's1', title: 'Tema', album: 'A' }, score: 100 },
    ]);
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

  it('agrega una voz en off desde el buscador en el paso 2', async () => {
    const { searchAll } = await import('../src/lib/search.js');
    searchAll.mockReturnValue([
      {
        type: 'weekly_word',
        item: { id: 'ww1', gospel_ref: 'Jn 14,6', liturgical_title: 'XI Domingo', title: null },
        score: 100,
      },
    ]);
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    const name = container.querySelector('#list-detail-name');
    name.value = 'L';
    name.dispatchEvent(new Event('input'));
    container.querySelector('#list-wizard-next').click();
    const search = container.querySelector('#list-detail-search');
    search.value = 'jn';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 250));
    // El resultado muestra el badge "Voz en off"
    expect(container.querySelector('#list-detail-results [data-voz-id]')).toBeTruthy();
    container.querySelector('#list-detail-results [data-voz-id]').click();
    // La voz en off aparece en el borrador
    const rows = container.querySelectorAll('#list-detail-songs .song-row-compact');
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.songId).toBe('ww1');
    expect(container.querySelector('#list-detail-songs .voice-badge--voz')).toBeTruthy();
  });

  it('al crear lista con voz en off, setListItems recibe item_type weekly_word', async () => {
    const { searchAll } = await import('../src/lib/search.js');
    const lists = await import('../src/lib/lists.js');
    searchAll.mockReturnValue([
      {
        type: 'weekly_word',
        item: { id: 'ww1', gospel_ref: 'Jn 14,6', liturgical_title: 'XI Domingo', title: null },
        score: 100,
      },
    ]);
    await renderListDetail(container, 'nueva', { mode: 'edit' });
    container.querySelector('#list-detail-name').value = 'Lista';
    container.querySelector('#list-detail-name').dispatchEvent(new Event('input'));
    container.querySelector('#list-wizard-next').click(); // paso 2
    const search = container.querySelector('#list-detail-search');
    search.value = 'jn';
    search.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 250));
    container.querySelector('#list-detail-results [data-voz-id]').click();
    container.querySelector('#list-wizard-next').click(); // paso 3
    container.querySelector('#list-wizard-next').click(); // commit
    await new Promise((r) => setTimeout(r, 10));
    expect(lists.setListItems).toHaveBeenCalledWith('L1', [
      { item_type: 'weekly_word', item_id: 'ww1' },
    ]);
  });

  it('quita is-entering al terminar la animación (no bloquea el transform del drag)', async () => {
    const { searchAll } = await import('../src/lib/search.js');
    searchAll.mockReturnValue([
      { type: 'song', item: { id: 's1', title: 'Tema', album: 'A' }, score: 100 },
    ]);
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
    const row = container.querySelector('#list-detail-songs .song-row-compact');
    // recién agregada: tiene la clase de entrada
    expect(row.classList.contains('is-entering')).toBe(true);
    // al terminar la animación, la clase debe removerse para liberar el transform inline (FLIP)
    row.dispatchEvent(new Event('animationend'));
    expect(row.classList.contains('is-entering')).toBe(false);
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
    expect(lists.createList).toHaveBeenCalledWith('Mi lista', expect.any(String), null);
  });

  it('renderiza segmented control y filas de ensayos para un evento', async () => {
    const { getList } = await import('../src/lib/lists.js');
    getList.mockResolvedValue({
      id: 'evt1',
      name: 'Concierto',
      expires_at: '2026-06-20T00:00:00Z',
      role: 'owner',
      parent_id: null,
      parent: null,
      songs: [],
      members: [],
      children: [
        { id: 'sub1', name: 'Ensayo general', expires_at: '2026-06-18T00:00:00Z', song_count: 3 },
      ],
    });
    const el = document.createElement('div');
    await renderListDetail(el, 'evt1', { mode: 'view' });
    expect(el.querySelector('.list-detail__seg')).toBeTruthy();
    expect(el.textContent).toContain('Ensayos');
    expect(el.textContent).toContain('Ensayo general');
  });

  it('en la vista, una voz en off del setlist muestra su título y navega a /voz', async () => {
    const { getList } = await import('../src/lib/lists.js');
    const { navigate } = await import('../src/router.js');
    getList.mockResolvedValue({
      id: 'l1',
      name: 'HS 16 de junio',
      expires_at: '2099-01-01T00:00:00Z',
      role: 'owner',
      parent_id: null,
      parent: null,
      children: [],
      members: [],
      // items tipados como los devuelve la API (voz en off con metadata `word`)
      items: [
        { item_type: 'song', item_id: 's1', position: 0 },
        {
          item_type: 'weekly_word',
          item_id: 'ww1',
          position: 1,
          word: { id: 'ww1', gospel_ref: 'Mt 9,36', title: '¡Mírame!', liturgical_title: 'XI TO' },
        },
      ],
      songs: ['s1'],
    });
    const el = document.createElement('div');
    await renderListDetail(el, 'l1', { mode: 'view' });
    const vozRow = el.querySelector('.list-detail__voz-row');
    expect(vozRow).toBeTruthy();
    // muestra el título, no el UUID
    expect(vozRow.textContent).toContain('¡Mírame!');
    expect(vozRow.textContent).not.toContain('ww1');
    // el setlist cuenta canciones + voces
    expect(el.textContent).toContain('Setlist · 2');
    vozRow.click();
    expect(navigate).toHaveBeenCalledWith('/voz/ww1');
  });

  it('muestra migaja al ver una sub-lista', async () => {
    const { getList } = await import('../src/lib/lists.js');
    getList.mockResolvedValue({
      id: 'sub1',
      name: 'Ensayo general',
      expires_at: '2026-06-18T00:00:00Z',
      role: 'member',
      parent_id: 'evt1',
      parent: { id: 'evt1', name: 'Concierto' },
      songs: [],
      members: [],
      children: [],
    });
    const el = document.createElement('div');
    await renderListDetail(el, 'sub1', { mode: 'view' });
    expect(el.querySelector('.list-detail__crumb')).toBeTruthy();
    expect(el.textContent).toContain('Concierto');
  });

  it('al editar una sub-lista, el input de fecha lleva el tope del evento', () => {
    const el = document.createElement('div');
    __renderEditorForTest(
      el,
      {
        id: 'sub1',
        name: 'Ensayo',
        expires_at: '2026-06-18T00:00:00Z',
        role: 'owner',
        parent_id: 'evt1',
        parent: { id: 'evt1', name: 'Concierto', expires_at: '2026-06-20T00:00:00Z' },
        songs: [],
        members: [],
      },
      { parent: { id: 'evt1', name: 'Concierto', expires_at: '2026-06-20T00:00:00Z' } },
    );
    const dt = el.querySelector('#list-detail-datetime');
    expect(dt.getAttribute('max')).toBeTruthy();
  });

  it('crea un ensayo pasando parentId y miembros heredados', async () => {
    const { createList, setListSongs, inviteMember } = await import('../src/lib/lists.js');
    createList.mockResolvedValue({ id: 'sub1' });
    setListSongs.mockResolvedValue(null);
    inviteMember.mockResolvedValue(null);
    const el = document.createElement('div');
    __renderEditorForTest(
      el,
      {
        id: null,
        name: '',
        expires_at: null,
        songs: [],
        members: [{ user_id: 'u2', username: 'bob' }],
        role: 'owner',
      },
      {
        parent: {
          id: 'evt1',
          name: 'Concierto',
          expires_at: '2026-06-20T00:00:00Z',
          songs: ['s1', 's2'],
        },
      },
    );
    el.querySelector('#list-detail-name').value = 'Ensayo general';
    el.querySelector('#list-detail-name').dispatchEvent(new Event('input'));
    el.querySelector('#list-detail-datetime').value = '2026-06-18T20:00';
    el.querySelector('#list-detail-datetime').dispatchEvent(new Event('input'));
    const nextBtn = el.querySelector('#list-wizard-next');
    nextBtn.click(); // paso 2
    nextBtn.click(); // paso 3
    nextBtn.click(); // commit
    await new Promise((r) => setTimeout(r, 0));
    expect(createList).toHaveBeenCalledWith('Ensayo general', expect.any(String), 'evt1');
    expect(inviteMember).toHaveBeenCalledWith('sub1', 'bob');
  });
});

// Candado de especificidad CSS: jsdom no computa estilos de hojas externas,
// así que no podemos probar el comportamiento visual directamente. En su lugar
// verificamos que la regla override exista en el CSS fuente. Sin ella,
// `.list-detail__songs { display:flex }` gana sobre el `[hidden]` del user-agent
// y el tracklist aparece aunque el tab activo sea "Ensayos".
describe('CSS especificidad: .list-detail__songs[hidden]', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/lists.css'), 'utf8');

  it('contiene override [hidden] para .list-detail__songs', () => {
    expect(css).toMatch(/\.list-detail__songs\[hidden\]\s*\{[^}]*display\s*:\s*none/);
  });
});
