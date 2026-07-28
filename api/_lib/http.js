/**
 * Reject with 405 if req.method is not in `allowed`.
 * Returns true if the response was sent (caller should return).
 */
export function allowMethods(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return true;
  }
  return false;
}

/**
 * Cache CDN para endpoints PÚBLICOS (sin auth). Nunca usar en endpoints que
 * lean el header Authorization: el edge cache de Vercel serviría la respuesta
 * cacheada a cualquier usuario.
 * s-maxage: frescura en el edge; stale-while-revalidate: sirve stale mientras
 * revalida en background; stale-if-error: sirve stale si la función falla.
 */
export function cachePublic(res, { sMaxage = 60, swr = 86400, sie = 86400 } = {}) {
  res.setHeader(
    'Cache-Control',
    `public, max-age=0, s-maxage=${sMaxage}, stale-while-revalidate=${swr}, stale-if-error=${sie}`,
  );
}

/**
 * Timeout de los POST de dispatch a Modal (stems/align/transcribe/clips/pitch).
 * Esos endpoints solo validan el payload y hacen `.spawn()`, así que responden
 * en milisegundos EN CALIENTE; el que manda es el cold start del contenedor del
 * endpoint, que con imágenes pesadas pasa cómodamente de 8s (el valor viejo,
 * que hacía fallar el dispatch mientras Modal ya había arrancado el job).
 * Debe quedar por debajo del maxDuration del endpoint que despacha (60s en
 * vercel.json para todos los que llaman a un dispatch) para que el catch que
 * marca la fase alcance a correr.
 */
export const MODAL_DISPATCH_TIMEOUT_MS = 30000;

/**
 * fetch con timeout que traduce fallos de red (timeout o conexión) a un error 502.
 * Unifica el patrón que estaba duplicado en modal.js y ordo/[date].js.
 * @param {string} url
 * @param {RequestInit} [opts] — opciones de fetch (sin signal; se inyecta el timeout).
 * @param {{ timeoutMs?: number, label?: string }} [cfg] — label nombra el upstream en el mensaje.
 * @returns {Promise<Response>} la Response si la red respondió (aunque sea !ok).
 */
export async function fetchWithTimeout(
  url,
  opts = {},
  { timeoutMs = 8000, label = 'El servicio externo' } = {},
) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    const e = new Error(
      isTimeout
        ? `${label} no respondió a tiempo.`
        : `No se pudo contactar a ${label}: ${err.message}`,
    );
    e.status = 502;
    // `timeout` distingue "no sabemos si el upstream recibió el request" de un
    // fallo de conexión limpio. Para los dispatch a Modal (que son .spawn()) un
    // timeout NO implica que el job no arrancó: el trabajo puede estar corriendo
    // y su webhook llegar después (ver el rescate de applyPhaseEvent).
    e.timeout = isTimeout;
    throw e;
  }
}

/**
 * Async handler wrapper: catches thrown errors and sends a JSON response.
 * Errors with .status get that code; everything else becomes 500.
 */
export function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      const status = e?.status ?? 500;
      if (status >= 500) {
        console.error(e); // log server-side, NO al cliente
        res.status(status).json({ error: 'Internal error' });
        return;
      }
      res.status(status).json({ error: e?.message ?? 'Error' });
    }
  };
}
