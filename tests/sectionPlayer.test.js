import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSectionAudioManager } from '../src/components/SectionPlayer.js';

function track(overrides = {}) {
  return {
    id: 'id-0',
    sectionIndex: 0,
    voiceScope: null,
    label: null,
    durationSec: 10,
    url: 'https://storage.example.com/song/section-0.mp3',
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

describe('createSectionAudioManager — tracksFor', () => {
  it('devuelve solo los tracks de esa sección', () => {
    const tracks = [
      track({ id: 'a', sectionIndex: 0 }),
      track({ id: 'b', sectionIndex: 1 }),
      track({ id: 'c', sectionIndex: 0, voiceScope: 'tenor' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    const result = manager.tracksFor(0);
    expect(result.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('ordena mezcla primero, luego el orden de VOICE_SCOPE_LABELS, desconocidos al final', () => {
    const tracks = [
      track({ id: 'backing', sectionIndex: 0, voiceScope: 'backing' }),
      track({ id: 'unknown', sectionIndex: 0, voiceScope: 'weird' }),
      track({ id: 'tenor', sectionIndex: 0, voiceScope: 'tenor' }),
      track({ id: 'mix', sectionIndex: 0, voiceScope: null }),
      track({ id: 'soprano', sectionIndex: 0, voiceScope: 'soprano' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    const result = manager.tracksFor(0);
    expect(result.map((t) => t.id)).toEqual(['mix', 'soprano', 'tenor', 'backing', 'unknown']);
  });
});

describe('createSectionAudioManager — load', () => {
  it('asigna src la primera vez', () => {
    const t = track({ url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.load(t);
    expect(manager.audio.src).toBe('https://x/0.mp3');
    expect(manager.audio.preload).toBe('metadata');
  });

  it('no reasigna src si el track ya está cargado', () => {
    const t = track({ url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.load(t);
    manager.audio.src = 'https://x/mutated.mp3'; // simula que algo más tocó el src
    manager.load(t);
    expect(manager.audio.src).toBe('https://x/mutated.mp3');
  });

  it('preload por defecto es metadata; puede pasarse explicito', () => {
    const t = track();
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.load(t, { preload: 'auto' });
    expect(manager.audio.preload).toBe('auto');
  });

  it('el audio interno arranca con preload none', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    expect(manager.audio.preload).toBe('none');
  });
});

describe('createSectionAudioManager — play/pause/seek', () => {
  it('play() carga si hace falta y reproduce', () => {
    const t = track({ url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.play(t);
    expect(manager.audio.src).toBe('https://x/0.mp3');
    expect(manager.audio.play).toHaveBeenCalled();
  });

  it('play() del mismo track pausado reanuda sin resetear currentTime', () => {
    const t = track({ url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.play(t);
    manager.audio.currentTime = 5;
    manager.audio.play.mockClear();
    manager.play(t);
    expect(manager.audio.currentTime).toBe(5);
    expect(manager.audio.play).toHaveBeenCalled();
  });

  it('play() de un track distinto carga el nuevo src', () => {
    const a = track({ id: 'a', url: 'https://x/0.mp3' });
    const b = track({ id: 'b', url: 'https://x/1.mp3' });
    const manager = createSectionAudioManager({ tracks: [a, b] });
    manager.play(a);
    manager.play(b);
    expect(manager.audio.src).toBe('https://x/1.mp3');
  });

  it('pause() pausa el audio', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    manager.pause();
    expect(manager.audio.pause).toHaveBeenCalled();
  });

  it('seek() asigna currentTime', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    manager.seek(12);
    expect(manager.audio.currentTime).toBe(12);
  });
});

describe('createSectionAudioManager — onTime/onEnded', () => {
  it('onTime se dispara en timeupdate y loadedmetadata', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    const cb = vi.fn();
    manager.onTime(cb);
    manager.audio.dispatchEvent(new Event('timeupdate'));
    manager.audio.dispatchEvent(new Event('loadedmetadata'));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('soporta varios callbacks de onTime', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    manager.onTime(cb1);
    manager.onTime(cb2);
    manager.audio.dispatchEvent(new Event('timeupdate'));
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('onTime devuelve función de desuscripción', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    const cb = vi.fn();
    const off = manager.onTime(cb);
    off();
    manager.audio.dispatchEvent(new Event('timeupdate'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('onEnded se dispara en ended', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    const cb = vi.fn();
    manager.onEnded(cb);
    manager.audio.dispatchEvent(new Event('ended'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onEnded devuelve función de desuscripción', () => {
    const manager = createSectionAudioManager({ tracks: [] });
    const cb = vi.fn();
    const off = manager.onEnded(cb);
    off();
    manager.audio.dispatchEvent(new Event('ended'));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('createSectionAudioManager — reintento de audio con error (re-firma)', () => {
  it('re-fetch y reintenta una vez ante un error de audio (URL vencida)', async () => {
    const staleTrack = track({ id: 'a', url: 'https://x/stale.mp3' });
    const freshTrack = { ...staleTrack, url: 'https://x/fresh.mp3' };
    const refetch = vi.fn().mockResolvedValue([freshTrack]);
    const manager = createSectionAudioManager({ tracks: [staleTrack], refetch });
    manager.play(staleTrack);
    manager.audio.play.mockClear();

    manager.audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(manager.audio.src).toBe('https://x/fresh.mp3');
    expect(manager.audio.play).toHaveBeenCalled();

    const toast = document.querySelector('.toast');
    expect(toast?.classList.contains('visible')).not.toBe(true);

    // Un segundo error del mismo id ya reintentado no vuelve a re-fetch.
    manager.audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('avisa con un toast cuando el re-fetch también falla', async () => {
    const staleTrack = track({ id: 'a', url: 'https://x/stale.mp3' });
    const refetch = vi.fn().mockRejectedValue(new Error('offline'));
    const manager = createSectionAudioManager({ tracks: [staleTrack], refetch });
    manager.play(staleTrack);

    manager.audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('visible')).toBe(true);
    });
    const toast = document.querySelector('.toast');
    expect(toast.textContent).toBe('No se pudo reproducir el audio de esta sección');
  });

  it('avisa con un toast en vez de fallar mudo si no hay refetch disponible', async () => {
    const t = track({ id: 'a', url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.play(t);

    manager.audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('visible')).toBe(true);
    });
    const toast = document.querySelector('.toast');
    expect(toast.textContent).toBe('No se pudo reproducir el audio de esta sección');
  });
});

describe('createSectionAudioManager — destroy', () => {
  it('pausa, quita el src y limpia callbacks', () => {
    const t = track();
    const manager = createSectionAudioManager({ tracks: [t] });
    const timeCb = vi.fn();
    const endedCb = vi.fn();
    manager.play(t);
    manager.onTime(timeCb);
    manager.onEnded(endedCb);
    const { audio } = manager;

    manager.destroy();

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.getAttribute('src')).toBeNull();

    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('ended'));
    expect(timeCb).not.toHaveBeenCalled();
    expect(endedCb).not.toHaveBeenCalled();
  });
});
