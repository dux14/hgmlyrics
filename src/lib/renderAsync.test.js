import { describe, it, expect, vi } from 'vitest';
import { renderAsyncRegion } from './renderAsync.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('renderAsyncRegion', () => {
  it('con cache pinta al instante sin bloquear en fetcher (SWR)', async () => {
    const el = document.createElement('div');
    const fetcher = vi.fn().mockResolvedValue(['fresh']);
    renderAsyncRegion(el, {
      cached: ['cache'],
      skeleton: () => '<span class="sk">s</span>',
      fetcher,
      render: (d) => {
        el.innerHTML = `<p>${d[0]}</p>`;
      },
    });
    expect(el.innerHTML).toContain('cache'); // pinta cache ya
    await flush();
    expect(el.innerHTML).toContain('fresh'); // revalidó
  });

  it('sin cache monta skeleton y luego el contenido', async () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    let resolveFetch;
    const fetcher = () =>
      new Promise((res) => {
        resolveFetch = res;
      });
    renderAsyncRegion(el, {
      skeleton: () => '<span class="sk">s</span>',
      fetcher,
      render: (d) => {
        el.innerHTML = `<p>${d}</p>`;
      },
    });
    vi.advanceTimersByTime(200);
    expect(el.innerHTML).toContain('sk'); // skeleton montado
    resolveFetch('ok');
    await vi.runAllTimersAsync();
    expect(el.innerHTML).toContain('ok');
    vi.useRealTimers();
  });

  it('anti-flash: si resuelve <150ms nunca monta skeleton', async () => {
    const el = document.createElement('div');
    renderAsyncRegion(el, {
      skeleton: () => '<span class="sk">s</span>',
      fetcher: () => Promise.resolve('ok'),
      render: (d) => {
        el.innerHTML = `<p>${d}</p>`;
      },
    });
    await flush();
    expect(el.innerHTML).not.toContain('sk');
    expect(el.innerHTML).toContain('ok');
  });

  it('error monta onError y Reintentar re-dispara fetcher', async () => {
    const el = document.createElement('div');
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce('ok');
    renderAsyncRegion(el, {
      skeleton: () => '<span class="sk">s</span>',
      fetcher,
      render: (d) => {
        el.innerHTML = `<p>${d}</p>`;
      },
      onError: () => '<button data-retry>Reintentar</button>',
    });
    await flush();
    expect(el.querySelector('[data-retry]')).toBeTruthy();
    el.querySelector('[data-retry]').click();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(el.innerHTML).toContain('ok');
  });

  it('data vacía usa empty()', async () => {
    const el = document.createElement('div');
    renderAsyncRegion(el, {
      skeleton: () => 's',
      fetcher: () => Promise.resolve([]),
      render: () => {},
      empty: () => '<p>vacío</p>',
    });
    await flush();
    expect(el.innerHTML).toContain('vacío');
  });
});
