import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGetSession = vi.fn();
vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => mockGetSession(),
}));

import { getAcceptedFriends } from '../src/lib/friends.js';

describe('getAcceptedFriends', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({ access_token: 'tok', user: { id: 'viewer1' } });
  });

  it('normaliza al "otro" usuario cuando el viewer es addressee', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accepted: [
          {
            requesterId: 'friendA',
            addresseeId: 'viewer1',
            requesterUsername: 'amiga',
            requesterDisplayName: 'Amiga A',
            requesterAvatarUrl: 'a.png',
            addresseeUsername: 'yo',
            addresseeDisplayName: 'Yo',
            addresseeAvatarUrl: 'me.png',
          },
        ],
      }),
    });

    const friends = await getAcceptedFriends();
    expect(friends).toEqual([
      { id: 'friendA', username: 'amiga', displayName: 'Amiga A', avatarUrl: 'a.png' },
    ]);
  });

  it('normaliza al "otro" usuario cuando el viewer es requester', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accepted: [
          {
            requesterId: 'viewer1',
            addresseeId: 'friendB',
            requesterUsername: 'yo',
            requesterDisplayName: 'Yo',
            requesterAvatarUrl: 'me.png',
            addresseeUsername: 'amigo',
            addresseeDisplayName: 'Amigo B',
            addresseeAvatarUrl: 'b.png',
          },
        ],
      }),
    });

    const friends = await getAcceptedFriends();
    expect(friends).toEqual([
      { id: 'friendB', username: 'amigo', displayName: 'Amigo B', avatarUrl: 'b.png' },
    ]);
  });

  it('devuelve [] si la respuesta no trae accepted', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await getAcceptedFriends()).toEqual([]);
  });

  it('devuelve [] si el fetch falla', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await getAcceptedFriends()).toEqual([]);
  });
});
