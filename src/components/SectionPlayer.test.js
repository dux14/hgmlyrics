import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSectionPlayer } from './SectionPlayer.js';

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

describe('createSectionPlayer — segmentos', () => {
  it('un segmento por sección, ancho proporcional a la duración', () => {
    const tracks = [
      track({ id: 'a', sectionIndex: 0, durationSec: 10 }),
      track({ id: 'b', sectionIndex: 1, durationSec: 20 }),
      track({ id: 'c', sectionIndex: 2, durationSec: 30 }),
    ];
    const { el } = createSectionPlayer({ song: { title: 'X' }, tracks });
    const segments = el.querySelectorAll('.section-player__segment');
    expect(segments.length).toBe(3);
    expect(segments[0].style.width).toBe('16.666666666666664%');
    expect(segments[1].style.width).toBe('33.33333333333333%');
    expect(segments[2].style.width).toBe('50%');
  });
});

describe('createSectionPlayer — tap en segmento', () => {
  it('cambia el src al de esa sección y reproduce', () => {
    const tracks = [
      track({ id: 'a', sectionIndex: 0, durationSec: 10, url: 'https://x/0.mp3' }),
      track({ id: 'b', sectionIndex: 1, durationSec: 10, url: 'https://x/1.mp3' }),
    ];
    const { el } = createSectionPlayer({ song: {}, tracks });
    const audio = el.querySelector('audio');
    const segments = el.querySelectorAll('.section-player__segment');
    segments[1].click();
    expect(audio.src).toBe('https://x/1.mp3');
    expect(audio.play).toHaveBeenCalled();
  });
});

describe('createSectionPlayer — loop', () => {
  it('al terminar repite la misma sección si loop está activo', () => {
    const tracks = [track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' })];
    const { el } = createSectionPlayer({ song: {}, tracks });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__loop').click(); // activa loop
    el.querySelector('.section-player__segment').click(); // carga y reproduce sección 0
    audio.currentTime = 9.9;
    audio.play.mockClear();
    audio.dispatchEvent(new Event('ended'));
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe('https://x/0.mp3'); // no avanzó de sección
  });
});

describe('createSectionPlayer — avance automático', () => {
  it('al terminar una sección sin loop avanza a la siguiente', () => {
    const tracks = [
      track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' }),
      track({ id: 'b', sectionIndex: 1, url: 'https://x/1.mp3' }),
    ];
    const onSectionFocus = vi.fn();
    const { el } = createSectionPlayer({ song: {}, tracks, onSectionFocus });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__segment').click(); // sección 0
    onSectionFocus.mockClear();
    audio.dispatchEvent(new Event('ended'));
    expect(audio.src).toBe('https://x/1.mp3');
    expect(onSectionFocus).toHaveBeenCalledWith(1);
  });

  it('al terminar la última sección sin loop no reinicia y limpia el foco', () => {
    const tracks = [track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' })];
    const onSectionFocus = vi.fn();
    const { el } = createSectionPlayer({ song: {}, tracks, onSectionFocus });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__segment').click();
    onSectionFocus.mockClear();
    audio.dispatchEvent(new Event('ended'));
    expect(onSectionFocus).toHaveBeenCalledWith(null);
  });
});

describe('createSectionPlayer — re-firma en 403', () => {
  it('re-fetch y reintenta una vez ante un error de audio (URL vencida)', async () => {
    const staleTrack = track({ id: 'a', sectionIndex: 0, url: 'https://x/stale.mp3' });
    const freshTrack = { ...staleTrack, url: 'https://x/fresh.mp3' };
    const refetch = vi.fn().mockResolvedValue([freshTrack]);
    const { el } = createSectionPlayer({ song: {}, tracks: [staleTrack], refetch });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__segment').click();
    audio.play.mockClear();

    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(audio.src).toBe('https://x/fresh.mp3');
    expect(audio.play).toHaveBeenCalled();

    // Un segundo error en la misma sección ya reintentada no vuelve a re-fetch.
    audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('avisa con un toast cuando el re-fetch también falla', async () => {
    const staleTrack = track({ id: 'a', sectionIndex: 0, url: 'https://x/stale.mp3' });
    const refetch = vi.fn().mockRejectedValue(new Error('offline'));
    const { el } = createSectionPlayer({ song: {}, tracks: [staleTrack], refetch });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__segment').click();

    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('visible')).toBe(true);
    });
    const toast = document.querySelector('.toast');
    expect(toast.textContent).toBe('No se pudo reproducir el audio de esta sección');
  });
});

describe('createSectionPlayer — sin refetch', () => {
  it('avisa con un toast en vez de fallar mudo si no hay refetch disponible', async () => {
    const tracks = [track({ id: 'a', sectionIndex: 0, url: 'https://x/0.mp3' })];
    const { el } = createSectionPlayer({ song: {}, tracks });
    const audio = el.querySelector('audio');
    el.querySelector('.section-player__segment').click();

    audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => {
      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('visible')).toBe(true);
    });
    const toast = document.querySelector('.toast');
    expect(toast.textContent).toBe('No se pudo reproducir el audio de esta sección');
  });
});

describe('createSectionPlayer — destroy', () => {
  it('pausa el audio, limpia el src y quita el elemento del DOM', () => {
    const tracks = [track()];
    const parent = document.createElement('div');
    const { el, destroy } = createSectionPlayer({ song: {}, tracks });
    parent.appendChild(el);
    const audio = el.querySelector('audio');
    destroy();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.getAttribute('src')).toBeNull();
    expect(parent.contains(el)).toBe(false);
  });
});
