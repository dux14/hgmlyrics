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
 * Resuelve la fecha de caducidad. Prioridad: fecha exacta > preset de días >
 * caducidad existente (al editar sin re-elegir) > default de 1 día.
 *
 * El fallback a `current` es clave: al editar una lista existente sin tocar los
 * controles de caducidad, `days` es null y `dateValue` vacío; sin este fallback
 * se reescribía `expires_at` a "ahora + 1 día" en cada guardado.
 * @throws {Error} 'La fecha debe ser futura.'
 */
export function resolveExpiresAt({ days, dateValue, current }) {
  if (dateValue) {
    const chosen = new Date(dateValue);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (chosen <= today) throw new Error('La fecha debe ser futura.');
    chosen.setHours(23, 59, 59, 999);
    return chosen.toISOString();
  }
  if (Number.isFinite(days)) return isoFromDays(days);
  if (current) return current;
  return isoFromDays(1);
}

/** Días calendario (zona local) entre hoy y la fecha de caducidad. */
function calendarDaysUntil(expiresAt) {
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startExp = new Date(expiresAt);
  startExp.setHours(0, 0, 0, 0);
  return Math.round((startExp - startToday) / 86400000);
}

/**
 * Texto legible de caducidad por día calendario, no por ventana de 24h:
 * "caduca hoy" solo si vence el mismo día, "caduca mañana" para el siguiente.
 */
export function formatExpiry(expiresAt) {
  if (!expiresAt) return '';
  if (new Date(expiresAt) <= new Date()) return 'caducada';
  const dias = calendarDaysUntil(expiresAt);
  if (dias <= 0) return 'caduca hoy';
  if (dias === 1) return 'caduca mañana';
  return `caduca en ${dias}d`;
}

/** Urgente si caduca hoy o mañana (o ya caducó). */
export function isUrgent(expiresAt) {
  if (!expiresAt) return false;
  if (new Date(expiresAt) <= new Date()) return true;
  return calendarDaysUntil(expiresAt) <= 1;
}
