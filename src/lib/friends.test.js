import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok', user: { id: 'me' } })),
}));

import { getPendingIncomingCount } from './friends.js';

function mockFetchOnce(payload, ok = true) {
  global.fetch = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(payload) }));
}

describe('getPendingIncomingCount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve la cantidad de pendingIncoming', async () => {
    mockFetchOnce({ accepted: [], pendingIncoming: [{}, {}, {}], pendingOutgoing: [] });
    expect(await getPendingIncomingCount()).toBe(3);
  });

  it('devuelve 0 cuando no hay pendientes', async () => {
    mockFetchOnce({ accepted: [], pendingIncoming: [], pendingOutgoing: [] });
    expect(await getPendingIncomingCount()).toBe(0);
  });

  it('devuelve 0 si la respuesta no es ok', async () => {
    mockFetchOnce({}, false);
    expect(await getPendingIncomingCount()).toBe(0);
  });

  it('devuelve 0 si fetch lanza', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('net')));
    expect(await getPendingIncomingCount()).toBe(0);
  });
});

import { emitPendingChanged, onPendingChanged } from './friends.js';

describe('pub/sub de pendientes', () => {
  it('notifica el nuevo conteo a los suscriptores', () => {
    const seen = [];
    const off = onPendingChanged((n) => seen.push(n));
    emitPendingChanged(2);
    emitPendingChanged(0);
    off();
    emitPendingChanged(5); // ya desuscrito, no debe registrarse
    expect(seen).toEqual([2, 0]);
  });
});
