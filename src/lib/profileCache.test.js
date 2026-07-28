// src/lib/profileCache.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'token123' })),
  refreshProfile: vi.fn(async () => true),
  getProfile: vi.fn(() => ({ id: 'u1', username: 'yo' })),
}));

import { _clearCache } from './prefetch.js';
import { refreshProfile } from './authStore.js';
import {
  getMyProfile,
  getPublicProfile,
  getFriends,
  invalidateMyProfile,
  invalidatePublicProfile,
  invalidateFriends,
} from './profileCache.js';

beforeEach(() => {
  _clearCache();
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ accepted: [], pendingIncoming: [], pendingOutgoing: [] }),
  });
});

describe('getMyProfile', () => {
  it('dos llamadas seguidas hacen UN solo refresh y devuelven el mismo resultado', async () => {
    const first = await getMyProfile();
    const second = await getMyProfile();
    expect(first).toEqual({ id: 'u1', username: 'yo' });
    expect(second).toEqual({ id: 'u1', username: 'yo' });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it('tras invalidateMyProfile() vuelve a refrescar', async () => {
    await getMyProfile();
    invalidateMyProfile();
    await getMyProfile();
    expect(refreshProfile).toHaveBeenCalledTimes(2);
  });

  it('si refreshProfile falla (res.ok=false internamente) no cachea un perfil vacío', async () => {
    refreshProfile.mockResolvedValueOnce(false);
    await expect(getMyProfile()).rejects.toThrow();
    // El fallo no quedó cacheado: el siguiente intento vuelve a refrescar.
    refreshProfile.mockResolvedValueOnce(true);
    const second = await getMyProfile();
    expect(second).toEqual({ id: 'u1', username: 'yo' });
    expect(refreshProfile).toHaveBeenCalledTimes(2);
  });
});

describe('getPublicProfile', () => {
  it('dos llamadas seguidas al mismo username hacen UNA sola llamada de red', async () => {
    await getPublicProfile('ana');
    await getPublicProfile('ana');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('tras invalidatePublicProfile(username) vuelve a la red', async () => {
    await getPublicProfile('ana');
    invalidatePublicProfile('ana');
    await getPublicProfile('ana');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('getFriends', () => {
  it('dos llamadas seguidas hacen UNA sola llamada de red', async () => {
    await getFriends();
    await getFriends();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('tras invalidateFriends() vuelve a la red', async () => {
    await getFriends();
    invalidateFriends();
    await getFriends();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('un 500 transitorio sin cache previa devuelve defaults SIN cachearlos', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const first = await getFriends();
    expect(first).toEqual({ accepted: [], pendingIncoming: [], pendingOutgoing: [] });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accepted: [{ id: 'f1' }], pendingIncoming: [], pendingOutgoing: [] }),
    });
    const second = await getFriends();
    expect(second).toEqual({ accepted: [{ id: 'f1' }], pendingIncoming: [], pendingOutgoing: [] });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
