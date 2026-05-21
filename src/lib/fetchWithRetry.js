/**
 * fetchWithRetry.js — Resilient fetch with exponential backoff and jitter
 *
 * Retries on transient failures (network errors, 5xx) but NOT on
 * 4xx responses or user-initiated aborts. Mirrors the native fetch API:
 * resolves with a Response (even non-2xx) so the caller can inspect status;
 * rejects only when a network/abort error survives all retries.
 */

/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [init]
 * @param {{ maxAttempts?: number, baseMs?: number, maxMs?: number, jitter?: number }} [retry]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init = {}, retry = {}) {
  const { maxAttempts = 3, baseMs = 500, maxMs = 4000, jitter = 0.2 } = retry;

  let lastError;
  let lastResponse;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      lastResponse = res;
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500) return res;
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      lastError = err;
    }

    if (attempt < maxAttempts - 1) {
      const exp = Math.min(baseMs * 2 ** attempt, maxMs);
      const jitterMs = exp * jitter * (Math.random() * 2 - 1);
      const delay = Math.max(0, exp + jitterMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}
