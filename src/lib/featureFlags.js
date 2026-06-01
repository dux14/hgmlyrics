/**
 * featureFlags.js — resolución pura de feature flags por usuario.
 *
 * `resolveEnabledFlags` se usa tanto en el backend (api/auth/me.js,
 * requireFlag) como en tests. El front solo consume el array resultante.
 */

/** Keys conocidas de la iniciativa (para autocompletado/uso en componentes). */
export const FLAG_KEYS = Object.freeze(['voz_tono', 'afinador_shortcut']);

/**
 * @param {Array<{key:string, enabledGlobal:boolean}>} catalog
 * @param {Array<{flagKey:string, email:string|null, username:string|null}>} assignments
 * @param {{ email?: string|null, username?: string|null }} identity
 * @returns {string[]} keys habilitadas (sin duplicados)
 */
export function resolveEnabledFlags(catalog, assignments, identity = {}) {
  const email = identity.email ? identity.email.toLowerCase() : null;
  const username = identity.username ? identity.username.toLowerCase() : null;
  const enabled = new Set();

  for (const f of catalog || []) {
    if (f.enabledGlobal) enabled.add(f.key);
  }
  for (const a of assignments || []) {
    const matchEmail = a.email && email && a.email.toLowerCase() === email;
    const matchUser = a.username && username && a.username.toLowerCase() === username;
    if (matchEmail || matchUser) enabled.add(a.flagKey);
  }
  return [...enabled];
}
