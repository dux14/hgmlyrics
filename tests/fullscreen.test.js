import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestStageFullscreen, exitStageFullscreen } from '../src/lib/fullscreen.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('fullscreen helpers', () => {
  it('requestStageFullscreen llama requestFullscreen cuando existe', async () => {
    const el = { requestFullscreen: vi.fn(() => Promise.resolve()) };
    await requestStageFullscreen(el);
    expect(el.requestFullscreen).toHaveBeenCalled();
  });

  it('requestStageFullscreen no rompe si no existe la API', async () => {
    await expect(requestStageFullscreen({})).resolves.toBeUndefined();
  });

  it('requestStageFullscreen traga el rechazo (iOS bloquea)', async () => {
    const el = { requestFullscreen: vi.fn(() => Promise.reject(new Error('blocked'))) };
    await expect(requestStageFullscreen(el)).resolves.toBeUndefined();
  });

  it('exitStageFullscreen solo sale si hay fullscreenElement', async () => {
    const exit = vi.fn(() => Promise.resolve());
    vi.spyOn(document, 'exitFullscreen', 'get').mockReturnValue(exit);
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(document.body);
    await exitStageFullscreen();
    expect(exit).toHaveBeenCalled();
  });

  it('exitStageFullscreen no hace nada sin fullscreenElement', async () => {
    vi.spyOn(document, 'fullscreenElement', 'get').mockReturnValue(null);
    await expect(exitStageFullscreen()).resolves.toBeUndefined();
  });
});
