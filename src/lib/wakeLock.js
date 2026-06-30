/**
 * Gestor de Wake Lock con `navigator` inyectable (testeable).
 * Degradacion honesta: si la API no existe, `supported` es false y `acquire`
 * no hace nada (el llamador oculta el indicador "Pantalla activa").
 */
export function createWakeLock(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const supported = !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function');
  let sentinel = null;

  async function acquire() {
    if (!supported || sentinel) return sentinel;
    try {
      sentinel = await nav.wakeLock.request('screen');
      // El SO suelta el lock en background; reflejarlo en el estado.
      sentinel.addEventListener?.('release', () => { sentinel = null; });
      return sentinel;
    } catch {
      sentinel = null;
      return null;
    }
  }

  async function release() {
    if (!sentinel) return;
    try { await sentinel.release(); } catch { /* ya liberado */ }
    sentinel = null;
  }

  return {
    supported,
    acquire,
    release,
    get held() { return !!sentinel; },
  };
}
