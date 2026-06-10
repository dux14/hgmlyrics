/** lists.js — cliente de listas efímeras: API + contexto de reproducción. */
import { supabase } from './supabase.js';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeaders()),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

export const listMyLists = () => req('/api/lists');
export const createList = (name, expiresAt) =>
  req('/api/lists', { method: 'POST', body: JSON.stringify({ name, expires_at: expiresAt }) });
export const getList = (id) => req(`/api/lists/${id}`);
export const updateList = (id, fields) =>
  req(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteList = (id) => req(`/api/lists/${id}`, { method: 'DELETE' });
export const setListSongs = (id, songIds) =>
  req(`/api/lists/${id}/songs`, { method: 'PUT', body: JSON.stringify({ songIds }) });
export const inviteMember = (id, username) =>
  req(`/api/lists/${id}/members`, { method: 'POST', body: JSON.stringify({ username }) });
export const removeMember = (id, userId) =>
  req(`/api/lists/${id}/members/${userId}`, { method: 'DELETE' });

// ---- Contexto de reproducción activo (en memoria) ----
let activeContext = null; // { listId, name, orderedSongIds }
export function setActiveContext(ctx) {
  activeContext = ctx;
}
export function getActiveContext() {
  return activeContext;
}

/**
 * Adyacentes circulares dentro de una lista. Devuelve {prev,next,currentIndex,total}
 * con prev/next como {id}, o null si el contexto no corresponde a listId.
 */
export function getAdjacentInList(listId, songId) {
  if (!activeContext || activeContext.listId !== listId) return null;
  const ids = activeContext.orderedSongIds;
  const idx = ids.indexOf(songId);
  if (idx === -1 || ids.length === 0) return null;
  if (ids.length === 1) return { prev: null, next: null, currentIndex: 0, total: 1 };
  const prevIdx = (idx - 1 + ids.length) % ids.length;
  const nextIdx = (idx + 1) % ids.length;
  return {
    prev: { id: ids[prevIdx] },
    next: { id: ids[nextIdx] },
    currentIndex: idx,
    total: ids.length,
  };
}
