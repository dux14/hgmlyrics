import { describe, it, expect } from 'vitest';
import { normalizeOther, buildFriendRow, buildSearchRow } from '../src/components/FriendsPanel.js';

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

const person = { id: 'X', username: 'carla', displayName: 'Carla', avatarUrl: 'c.png' };

describe('buildFriendRow', () => {
  it('friend: enlaza al perfil y ofrece quitar', () => {
    const html = buildFriendRow(person, { kind: 'friend' });
    expect(html).toContain('href="#/u/carla"');
    expect(html).toContain('data-act="unfriend"');
    expect(html).toContain('data-id="X"');
  });
  it('incoming: aceptar + rechazar', () => {
    const html = buildFriendRow(person, { kind: 'incoming' });
    expect(html).toContain('data-act="accept"');
    expect(html).toContain('data-act="reject"');
  });
  it('outgoing: cancelar y marca enviada', () => {
    const html = buildFriendRow(person, { kind: 'outgoing' });
    expect(html).toContain('data-act="cancel"');
  });
});

describe('buildSearchRow', () => {
  it('none: pill Agregar', () => {
    expect(buildSearchRow({ ...person, relation: 'none' })).toContain('data-act="add"');
  });
  it('pending_out: cancelar (Enviada)', () => {
    expect(buildSearchRow({ ...person, relation: 'pending_out' })).toContain('data-act="cancel"');
  });
  it('pending_in: aceptar', () => {
    expect(buildSearchRow({ ...person, relation: 'pending_in' })).toContain('data-act="accept"');
  });
  it('friends: sin botón de acción', () => {
    const html = buildSearchRow({ ...person, relation: 'friends' });
    expect(html).not.toContain('data-act=');
  });
});
