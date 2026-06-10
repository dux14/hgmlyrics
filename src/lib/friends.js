/** friends.js — lectura normalizada de amigos aceptados del usuario. */
import { getSession } from './authStore.js';

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
