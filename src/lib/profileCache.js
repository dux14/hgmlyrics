// src/lib/profileCache.js
// SWR para datos por-usuario que hoy se re-fetchean en cada navegación.
// TTL corto (5 min): son datos editables; toda mutación invalida al instante.
import { cached, invalidate } from './prefetch.js';
import { getSession, refreshProfile, getProfile } from './authStore.js';

const TTL = 5 * 60 * 1000;

async function fetchMyProfile() {
  const ok = await refreshProfile();
  if (!ok) throw new Error('fetchMyProfile: refreshProfile failed');
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

const EMPTY_FRIENDS = { accepted: [], pendingIncoming: [], pendingOutgoing: [] };

async function fetchFriends() {
  const token = getSession()?.access_token;
  const res = await fetch('/api/social/friends', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchFriends failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  return data || EMPTY_FRIENDS;
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
  // Sin stale disponible, cached() propaga: devolvemos defaults SIN cachearlos
  // (cached() solo cachea fetches exitosos), así el próximo intento reintenta la red.
  try {
    const { data } = await cached('social:friends', fetchFriends, { ttl: TTL });
    return data;
  } catch {
    return EMPTY_FRIENDS;
  }
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
