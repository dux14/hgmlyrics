/** friends.js — lectura normalizada de amigos aceptados del usuario. */
import { getSession } from './authStore.js';

const PENDING_EVT = 'hkn:pending-friends-changed';

/** Emite el nuevo conteo de pendientes a quien escuche (header). */
export function emitPendingChanged(count) {
  window.dispatchEvent(new CustomEvent(PENDING_EVT, { detail: { count } }));
}

/** Suscribe un callback(count). Devuelve función para desuscribir. */
export function onPendingChanged(cb) {
  const handler = (e) => cb(e.detail?.count ?? 0);
  window.addEventListener(PENDING_EVT, handler);
  return () => window.removeEventListener(PENDING_EVT, handler);
}

/**
 * Trae los amigos aceptados y los normaliza al "otro" usuario respecto al viewer.
 * @returns {Promise<Array<{id:string,username:string,displayName:string,avatarUrl:string}>>}
 */
export async function getAcceptedFriends() {
  const session = getSession();
  const viewerId = session?.user?.id;
  try {
    const res = await fetch('/api/social/friends', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const accepted = data?.accepted || [];
    return accepted.map((item) => {
      const otherIsRequester = item.requesterId !== viewerId;
      return otherIsRequester
        ? {
            id: item.requesterId,
            username: item.requesterUsername,
            displayName: item.requesterDisplayName,
            avatarUrl: item.requesterAvatarUrl,
          }
        : {
            id: item.addresseeId,
            username: item.addresseeUsername,
            displayName: item.addresseeDisplayName,
            avatarUrl: item.addresseeAvatarUrl,
          };
    });
  } catch {
    return [];
  }
}

/**
 * Cuenta las solicitudes de amistad recibidas (pendientes) del viewer.
 * Reusa `/api/social/friends` (campo `pendingIncoming`). Nunca lanza: 0 en error.
 * @returns {Promise<number>}
 */
export async function getPendingIncomingCount() {
  const session = getSession();
  try {
    const res = await fetch('/api/social/friends', {
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.pendingIncoming) ? data.pendingIncoming.length : 0;
  } catch {
    return 0;
  }
}
