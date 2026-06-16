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
export const createList = (name, expiresAt, parentId = null) =>
  req('/api/lists', {
    method: 'POST',
    body: JSON.stringify({ name, expires_at: expiresAt, parent_id: parentId }),
  });
export const getList = (id) => req(`/api/lists/${id}`);
export const updateList = (id, fields) =>
  req(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const deleteList = (id) => req(`/api/lists/${id}`, { method: 'DELETE' });
export const setListSongs = (id, songIds) =>
  req(`/api/lists/${id}/songs`, { method: 'PUT', body: JSON.stringify({ songIds }) });

/**
 * Reemplaza los items tipados de una lista.
 * @param {string} id - list id
 * @param {Array<{ item_type: 'song'|'weekly_word', item_id: string }>} items
 */
export const setListItems = (id, items) =>
  req(`/api/lists/${id}/songs`, { method: 'PUT', body: JSON.stringify({ items }) });
export const inviteMember = (id, username) =>
  req(`/api/lists/${id}/members`, { method: 'POST', body: JSON.stringify({ username }) });
export const removeMember = (id, userId) =>
  req(`/api/lists/${id}/members/${userId}`, { method: 'DELETE' });

/**
 * Busca usuarios para invitar. scope='all' (solo admin en backend) devuelve a
 * cualquier usuario, no solo públicos/amigos. Devuelve [] ante error o query corta.
 * @param {string} q
 * @returns {Promise<Array<{id:string,username:string,displayName:string,avatarUrl:string}>>}
 */
export async function searchUsers(q) {
  const term = (q || '').trim();
  if (term.length < 2) return [];
  try {
    const body = await req(`/api/social/search?scope=all&q=${encodeURIComponent(term)}`);
    return body?.results || [];
  } catch {
    return [];
  }
}

// ---- Contexto de reproducción activo (en memoria) ----
// Shape: { listId, name, orderedItems: [{ item_type, item_id }] }
// Legacy shape: { listId, name, orderedSongIds: string[] }
let activeContext = null;
export function setActiveContext(ctx) {
  activeContext = ctx;
}
export function getActiveContext() {
  return activeContext;
}

/**
 * Adyacentes circulares dentro de una lista. Devuelve {prev,next,currentIndex,total}
 * o null si el contexto no corresponde a listId.
 *
 * Soporta dos formas:
 *  - getAdjacentInList(listId, itemType, itemId) — forma tipada; prev/next son
 *    { item_type, item_id }.
 *  - getAdjacentInList(listId, songId) — forma legacy (2 args); prev/next son
 *    { id }, usa orderedSongIds del contexto.
 */
export function getAdjacentInList(listId, itemTypeOrSongId, itemId) {
  if (!activeContext || activeContext.listId !== listId) return null;

  // Detectar forma legacy (2 args): no hay itemId
  if (itemId === undefined) {
    // Legacy: usa orderedSongIds
    const ids = activeContext.orderedSongIds ?? [];
    const songId = itemTypeOrSongId;
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

  // Forma tipada (3 args): itemTypeOrSongId es itemType
  const itemType = itemTypeOrSongId;
  let items;
  if (activeContext.orderedItems) {
    items = activeContext.orderedItems;
  } else if (activeContext.orderedSongIds) {
    // legacy context used with typed call
    items = activeContext.orderedSongIds.map((id) => ({ item_type: 'song', item_id: id }));
  } else {
    return null;
  }

  const idx = items.findIndex((it) => it.item_type === itemType && it.item_id === itemId);
  if (idx === -1 || items.length === 0) return null;
  if (items.length === 1) return { prev: null, next: null, currentIndex: 0, total: 1 };
  const prevIdx = (idx - 1 + items.length) % items.length;
  const nextIdx = (idx + 1) % items.length;
  return {
    prev: items[prevIdx],
    next: items[nextIdx],
    currentIndex: idx,
    total: items.length,
  };
}
