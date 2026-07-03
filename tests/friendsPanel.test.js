import { describe, it, expect } from 'vitest';
import { normalizeOther } from '../src/components/FriendsPanel.js';

describe('normalizeOther', () => {
  const item = {
    requesterId: 'A',
    requesterUsername: 'ana',
    requesterDisplayName: 'Ana',
    requesterAvatarUrl: 'a.png',
    addresseeId: 'B',
    addresseeUsername: 'beto',
    addresseeDisplayName: 'Beto',
    addresseeAvatarUrl: 'b.png',
  };
  it('devuelve al addressee cuando el viewer es requester', () => {
    expect(normalizeOther(item, 'A')).toMatchObject({ id: 'B', username: 'beto' });
  });
  it('devuelve al requester cuando el viewer es addressee', () => {
    expect(normalizeOther(item, 'B')).toMatchObject({ id: 'A', username: 'ana' });
  });
});
