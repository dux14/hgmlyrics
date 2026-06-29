import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('offlineState', () => {
  beforeEach(() => { vi.resetModules(); });

  it('confia solo en navigator.onLine === false', async () => {
    globalThis.navigator = { onLine: false };
    const { isOnline } = await import('./offlineState.js');
    expect(await isOnline()).toBe(false);
  });

  it('si onLine es true, confirma con heartbeat HEAD', async () => {
    globalThis.navigator = { onLine: true };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { isOnline } = await import('./offlineState.js');
    expect(await isOnline()).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('heartbeat que falla => offline', async () => {
    globalThis.navigator = { onLine: true };
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('net'));
    const { isOnline } = await import('./offlineState.js');
    expect(await isOnline()).toBe(false);
  });

  it('notifica a suscriptores en cambio de estado', async () => {
    globalThis.navigator = { onLine: true };
    const { subscribe, _setState } = await import('./offlineState.js');
    const cb = vi.fn();
    subscribe(cb);
    _setState(true);
    expect(cb).toHaveBeenCalledWith(true);
  });
});
