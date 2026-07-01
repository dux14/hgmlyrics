// src/lib/listUrgency.js
// Lógica de urgencia de listas efímeras: color por proximidad a vencer y orden.

/**
 * Días de calendario entre `today` (YYYY-MM-DD) y la fecha de `expiresAt`.
 * @param {string|null|undefined} expiresAt ISO date/timestamp
 * @param {string} today YYYY-MM-DD
 * @returns {number|null} días restantes (0/negativo posible); null si no hay fecha
 */
export function daysUntil(expiresAt, today) {
  if (!expiresAt) return null;
  const [ey, em, ed] = String(expiresAt).slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(today).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/**
 * Nivel de urgencia + días restantes. Umbrales: rojo ≤2 · amarillo ≤7 · verde >7.
 * @param {{expires_at?: string|null}} list
 * @param {string} today YYYY-MM-DD
 * @returns {{level:'red'|'amber'|'green'|'neutral', daysLeft:number|null}}
 */
export function urgencyOf(list, today) {
  const daysLeft = daysUntil(list?.expires_at, today);
  if (daysLeft === null) return { level: 'neutral', daysLeft: null };
  if (daysLeft <= 2) return { level: 'red', daysLeft };
  if (daysLeft <= 7) return { level: 'amber', daysLeft };
  return { level: 'green', daysLeft };
}

/**
 * Copia ordenada por proximidad a vencer (asc). Sin fecha al final. No muta.
 * @param {Array} lists
 * @returns {Array}
 */
export function sortByUrgency(lists) {
  return [...(lists || [])].sort((a, b) => {
    const ea = a?.expires_at ? String(a.expires_at) : null;
    const eb = b?.expires_at ? String(b.expires_at) : null;
    if (ea === null && eb === null) return 0;
    if (ea === null) return 1;
    if (eb === null) return -1;
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
}

/**
 * Texto de la píldora de cuenta regresiva.
 * @param {number|null} daysLeft
 * @returns {string}
 */
export function countdownLabel(daysLeft) {
  if (daysLeft === null) return 'fija';
  if (daysLeft <= 0) return 'hoy';
  if (daysLeft === 1) return 'mañana';
  return `en ${daysLeft} días`;
}
