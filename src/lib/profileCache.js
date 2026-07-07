// src/lib/profileCache.js
// SWR para datos por-usuario que hoy se re-fetchean en cada navegación.
// TTL corto (5 min): son datos editables; toda mutación invalida al instante.
import { cached, invalidate } from './prefetch.js';
import { getSession, refreshProfile, getProfile } from './authStore.js';

const TTL = 5 * 60 * 1000;

async function fetchMyProfile() {
  await refreshProfile();
  return getProfile();
}

async function fetchPublicProfile(username) {
  const token = getSession()?.access_token;
  const res = await fetch(`/api/profile/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchFriends() {
  const empty = { accepted: [], pendingIncoming: [], pendingOutgoing: [] };
  const token = getSession()?.access_token;
  const res = await fetch('/api/social/friends', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return empty;
  const data = await res.json().catch(() => null);
  return data || empty;
}

export async function getMyProfile() {
  const { data } = await cached('profile:me', fetchMyProfile, { ttl: TTL });
  return data;
}
export async function getPublicProfile(username) {
  const { data } = await cached(`profile:${username}`, () => fetchPublicProfile(username), {
    ttl: TTL,
  });
  return data;
}
export async function getFriends() {
  const { data } = await cached('social:friends', fetchFriends, { ttl: TTL });
  return data;
}
export function invalidateMyProfile() {
  invalidate('profile:me');
}
export function invalidatePublicProfile(username) {
  invalidate(`profile:${username}`);
}
export function invalidateFriends() {
  invalidate('social:friends');
}
