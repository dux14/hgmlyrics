import { describe, it, expect, vi } from 'vitest';
import { createWakeLock } from '../src/lib/wakeLock.js';

function fakeNav() {
  const sentinel = { released: false, release: vi.fn(async () => { sentinel.released = true; }), addEventListener: vi.fn() };
  const nav = { wakeLock: { request: vi.fn(async () => sentinel) } };
  return { nav, sentinel };
}

describe('createWakeLock', () => {
  it('soporta cuando navigator.wakeLock.request existe', () => {
    const { nav } = fakeNav();
    expect(createWakeLock(nav).supported).toBe(true);
  });

  it('acquire pide el lock y queda held', async () => {
    const { nav } = fakeNav();
    const wl = createWakeLock(nav);
    await wl.acquire();
    expect(nav.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(wl.held).toBe(true);
  });

  it('release suelta el lock y deja held=false', async () => {
    const { nav, sentinel } = fakeNav();
    const wl = createWakeLock(nav);
    await wl.acquire();
    await wl.release();
    expect(sentinel.release).toHaveBeenCalled();
    expect(wl.held).toBe(false);
  });

  it('no soportado: supported=false, acquire no rompe y devuelve null', async () => {
    const wl = createWakeLock({});
    expect(wl.supported).toBe(false);
    await expect(wl.acquire()).resolves.toBeNull();
    expect(wl.held).toBe(false);
  });

  it('acquire es idempotente (no pide doble)', async () => {
    const { nav } = fakeNav();
    const wl = createWakeLock(nav);
    await wl.acquire();
    await wl.acquire();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
  });
});
