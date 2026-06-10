// src/lib/listDraft.js
/** listDraft.js — helpers puros del borrador del editor de listas. Sin DOM. */

/** Normaliza texto: minúsculas y sin diacríticos. */
export function normalize(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Filtra amigos por query (acento-insensible sobre displayName/username),
 * excluyendo ids ya invitados.
 */
export function filterFriends(friends, query, excludeIds) {
  const q = normalize(query);
  return friends.filter((f) => {
    if (excludeIds.has(f.id)) return false;
    if (!q) return true;
    return normalize(f.displayName).includes(q) || normalize(f.username).includes(q);
  });
}

/**
 * Diff de miembros entre el estado original (de getList) y el borrador actual.
 * @returns {{toInvite:string[], toRemove:string[]}} usernames a invitar, userIds a quitar
 */
export function diffMembers(original, current) {
  const origIds = new Set(original.map((m) => m.user_id ?? m.id));
  const currIds = new Set(current.map((m) => m.id));
  const toInvite = current.filter((m) => !origIds.has(m.id)).map((m) => m.username);
  const toRemove = original
    .filter((m) => !currIds.has(m.user_id ?? m.id))
    .map((m) => m.user_id ?? m.id);
  return { toInvite, toRemove };
}

/** Caducidad ISO desde días desde hoy. */
function isoFromDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/**
 * Resuelve la fecha de caducidad. Fecha exacta (si se dio) gana al preset.
 * @throws {Error} 'La fecha debe ser futura.'
 */
export function resolveExpiresAt({ days, dateValue }) {
  if (dateValue) {
    const chosen = new Date(dateValue);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (chosen <= today) throw new Error('La fecha debe ser futura.');
    chosen.setHours(23, 59, 59, 999);
    return chosen.toISOString();
  }
  return isoFromDays(days ?? 1);
}
