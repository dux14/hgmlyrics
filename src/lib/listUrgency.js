// src/lib/listUrgency.js
// Lógica de urgencia de listas efímeras: color por proximidad a vencer y orden.

const pad = (n) => String(n).padStart(2, '0');

/**
 * Día calendario (YYYY-MM-DD) de un valor en la zona horaria del usuario.
 *
 * `expires_at` es `timestamptz`: llega en UTC. Cortar el ISO a 10 caracteres lo
 * lee como día UTC y adelanta la caducidad un día para todo usuario al oeste de
 * Greenwich (un evento que vence a las 22:00 en Bogotá se guarda como 03:00Z del
 * día siguiente). Un valor sin hora ya es un día calendario: se devuelve tal cual.
 * @param {string|Date|null|undefined} value
 * @returns {string|null} YYYY-MM-DD local; null si no hay valor
 */
export function localDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) {
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) return s.slice(0, 10);
    return localDay(parsed);
  }
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * Hoy como YYYY-MM-DD en la zona del usuario. Es el `today` por defecto de las
 * vistas: `toISOString()` daría el día UTC y adelantaría la cuenta regresiva las
 * últimas horas de cada día local.
 * @returns {string} YYYY-MM-DD
 */
export function todayLocal() {
  return localDay(new Date());
}

/**
 * Días de calendario entre `today` (YYYY-MM-DD) y la fecha de `expiresAt`.
 * @param {string|null|undefined} expiresAt ISO date/timestamp
 * @param {string} today YYYY-MM-DD
 * @returns {number|null} días restantes (0/negativo posible); null si no hay fecha
 */
export function daysUntil(expiresAt, today) {
  if (!expiresAt) return null;
  const [ey, em, ed] = localDay(expiresAt).split('-').map(Number);
  const [ty, tm, td] = String(today).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/**
 * Nivel de urgencia + días restantes. Umbrales: rojo ≤2 · amarillo ≤7 · verde ≤21 · lejano (neutral) >21.
 * @param {{expires_at?: string|null}} list
 * @param {string} today YYYY-MM-DD
 * @returns {{level:'red'|'amber'|'green'|'neutral', daysLeft:number|null}}
 */
export function urgencyOf(list, today) {
  const daysLeft = daysUntil(list?.expires_at, today);
  if (daysLeft === null) return { level: 'neutral', daysLeft: null };
  if (daysLeft <= 2) return { level: 'red', daysLeft };
  if (daysLeft <= 7) return { level: 'amber', daysLeft };
  if (daysLeft <= 21) return { level: 'green', daysLeft };
  return { level: 'neutral', daysLeft };
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
