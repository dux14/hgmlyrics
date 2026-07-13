// FriendsPanel.test.js — T4.1: no debe atascarse offline (botón + toast).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../styles/friends.css', () => ({}));
vi.mock('../lib/authStore.js', () => ({
  getSession: () => ({ user: { id: 'viewer1' }, access_token: 'tok' }),
}));
vi.mock('../lib/friends.js', () => ({ emitPendingChanged: vi.fn() }));

const showToastMock = vi.fn();
vi.mock('../lib/toast.js', () => ({ showToast: (...args) => showToastMock(...args) }));

import { renderFriendsPanel } from './FriendsPanel.js';

const jsonRes = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

const FRIENDS_PAYLOAD = {
  accepted: [],
  pendingIncoming: [
    {
      requesterId: 'u3',
      requesterUsername: 'bob',
      requesterDisplayName: 'Bob',
      requesterAvatarUrl: null,
      addresseeId: 'viewer1',
    },
  ],
  pendingOutgoing: [],
};

const SEARCH_PAYLOAD = {
  results: [{ id: 'u2', username: 'ana', displayName: 'Ana', avatarUrl: null, relation: 'none' }],
};

/** Reads GET (búsqueda/lista) resuelven ok; cualquier mutación (POST/PATCH/DELETE) simula offline. */
function makeOfflineMutationsFetch() {
  return vi.fn((url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method !== 'GET') return Promise.reject(new TypeError('Failed to fetch'));
    if (url.includes('/api/social/search')) return Promise.resolve(jsonRes(SEARCH_PAYLOAD));
    if (url.includes('/api/social/friends')) return Promise.resolve(jsonRes(FRIENDS_PAYLOAD));
    return Promise.reject(new TypeError('Failed to fetch'));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mount() {
  const container = document.createElement('div');
  renderFriendsPanel(container);
  return container;
}

beforeEach(() => {
  showToastMock.mockClear();
  vi.stubGlobal('fetch', makeOfflineMutationsFetch());
});

describe('FriendsPanel offline', () => {
  it('(a)+(b) sendAdd restaura el botón y avisa con toast si la red falla', async () => {
    const container = mount();
    await wait(10); // deja resolver la carga inicial (GET friends)

    const searchInput = container.querySelector('#friends-search');
    searchInput.value = 'an';
    searchInput.dispatchEvent(new Event('input'));
    await wait(350); // debounce interno de 300ms + runSearch

    const btn = container.querySelector('button[data-act="add"]');
    expect(btn).toBeTruthy();
    const prevLabel = btn.textContent;

    btn.click();
    await wait(10);

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe(prevLabel);
    expect(showToastMock).toHaveBeenCalledWith('Sin conexión. Intenta de nuevo.', {
      type: 'error',
    });
  });

  it('(c) doAction no deja el estado colgado y avisa con el mismo toast si la red falla', async () => {
    const container = mount();
    await wait(10);

    const btn = container.querySelector('button[data-act="accept"]');
    expect(btn).toBeTruthy();

    btn.click();
    await wait(10);

    expect(showToastMock).toHaveBeenCalledWith('Sin conexión. Intenta de nuevo.', {
      type: 'error',
    });
  });
});
