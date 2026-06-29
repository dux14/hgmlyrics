/**
 * offlineState.js — estado offline global confiable y observable.
 *
 * Logica de deteccion:
 *   1. navigator.onLine === false  => offline sin ambiguedad (SO lo sabe).
 *   2. navigator.onLine === true   => confirmar con heartbeat HEAD; un fetch
 *      exitoso (res.ok) => online; cualquier error => offline.
 *
 * Estado interno inicializado en null ("desconocido") para que la primera
 * llamada a _setState siempre notifique a los suscriptores, independientemente
 * del valor. Si arrancara en false (offline), una transicion a online (false=>false
 * en _offline) seria silenciada por el guard de igualdad.
 */

let _offline = null;
const subs = new Set();

export async function isOnline() {
  if (!globalThis.navigator?.onLine) return false;
  try {
    const res = await globalThis.fetch(`/?_=${performance.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
    });
    return !!res?.ok;
  } catch {
    return false;
  }
}

export function isOffline() {
  return _offline === true;
}

export function subscribe(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function _setState(online) {
  const offline = !online;
  if (offline === _offline) return;
  _offline = offline;
  subs.forEach((cb) => cb(online));
}

export function initOfflineState() {
  const recompute = async () => _setState(await isOnline());
  globalThis.addEventListener?.('online', recompute);
  globalThis.addEventListener?.('offline', () => _setState(false));
  recompute();
}
