/**
 * fetchWithRetry.test.js — Unit tests for retry/backoff helper
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithRetry } from '../src/lib/fetchWithRetry.js';

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the response on first success', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const res = await fetchWithRetry('/test');

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('forwards url and init options to fetch', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await fetchWithRetry('/echo', { method: 'POST', body: 'data' });

    expect(globalThis.fetch).toHaveBeenCalledWith('/echo', { method: 'POST', body: 'data' });
  });

  it('retries on 5xx then resolves with the eventual success', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response('err', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const p = fetchWithRetry('/test', {}, { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on TypeError (network failure)', async () => {
    globalThis.fetch
      .mockImplementationOnce(() => {
        throw new TypeError('fetch failed');
      })
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const p = fetchWithRetry('/test', {}, { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx responses', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

    const res = await fetchWithRetry(
      '/test',
      {},
      { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 },
    );

    expect(res.status).toBe(404);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on AbortError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch.mockImplementationOnce(() => {
      throw abortErr;
    });

    await expect(
      fetchWithRetry('/test', {}, { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 }),
    ).rejects.toThrow('aborted');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws after maxAttempts when network errors are persistent', async () => {
    const throwFetch = () => {
      throw new TypeError('fetch failed');
    };
    globalThis.fetch
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch);

    const p = fetchWithRetry('/test', {}, { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 });
    const assertion = expect(p).rejects.toThrow('fetch failed');
    await vi.runAllTimersAsync();
    await assertion;

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('returns the last 5xx response when maxAttempts exhausts on server errors', async () => {
    globalThis.fetch.mockResolvedValue(new Response('err', { status: 503 }));

    const p = fetchWithRetry('/test', {}, { maxAttempts: 3, baseMs: 100, maxMs: 200, jitter: 0 });
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.status).toBe(503);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff capped at maxMs', async () => {
    const throwFetch = () => {
      throw new TypeError('fetch failed');
    };
    globalThis.fetch
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const p = fetchWithRetry('/test', {}, { maxAttempts: 4, baseMs: 500, maxMs: 2000, jitter: 0 });
    const assertion = expect(p).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    // 3 retries between 4 attempts: 500, 1000, 2000 (capped at maxMs=2000).
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('applies jitter symmetrically within ±jitter range', async () => {
    const throwFetch = () => {
      throw new TypeError('fetch failed');
    };
    globalThis.fetch
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch)
      .mockImplementationOnce(throwFetch);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    // Math.random() → 1 yields max +jitter; → 0 yields max -jitter.
    vi.spyOn(Math, 'random').mockReturnValueOnce(1).mockReturnValueOnce(0);

    const p = fetchWithRetry(
      '/test',
      {},
      { maxAttempts: 3, baseMs: 1000, maxMs: 8000, jitter: 0.2 },
    );
    const assertion = expect(p).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;

    const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
    // Delay 1: 1000 + (1000 * 0.2 * (2*1 - 1)) = 1000 + 200 = 1200
    // Delay 2: 2000 + (2000 * 0.2 * (2*0 - 1)) = 2000 - 400 = 1600
    expect(delays[0]).toBe(1200);
    expect(delays[1]).toBe(1600);
  });
});
