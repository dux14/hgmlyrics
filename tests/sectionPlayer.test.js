import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSectionAudioManager, createSectionAccordion } from '../src/components/SectionPlayer.js';

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

afterEach(() => {
  // El toast es un singleton en document.body con un setTimeout propio: sin
  // esto, un toast "visible" de un test se filtra a las aserciones de otro.
  document.querySelector('.toast')?.remove();
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

  it('no reasigna src ni reproduce ni muestra toast si destroy() se llamó mientras el refetch estaba pendiente', async () => {
    const staleTrack = track({ id: 'a', url: 'https://x/stale.mp3' });
    const freshTrack = { ...staleTrack, url: 'https://x/fresh.mp3' };
    let resolveRefetch;
    const refetch = vi.fn(() => new Promise((resolve) => (resolveRefetch = resolve)));
    const manager = createSectionAudioManager({ tracks: [staleTrack], refetch });
    manager.play(staleTrack);
    manager.audio.play.mockClear();

    manager.audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));

    manager.destroy();
    resolveRefetch([freshTrack]);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.audio.src).not.toBe('https://x/fresh.mp3');
    expect(manager.audio.play).not.toHaveBeenCalled();
    const toast = document.querySelector('.toast');
    expect(toast?.classList.contains('visible')).not.toBe(true);
  });
});

describe('createSectionAudioManager — url invalida', () => {
  it('load() no asigna src ni dispara toast si safeUrl saneó la url a vacio', async () => {
    const t = track({ id: 'a', url: 'javascript:alert(1)' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.load(t);
    expect(manager.audio.src).toBe('');

    // El <audio> con src vacio no debe disparar el flujo de error/toast.
    manager.audio.dispatchEvent(new Event('error'));
    await Promise.resolve();
    const toast = document.querySelector('.toast');
    expect(toast?.classList.contains('visible')).not.toBe(true);
  });

  it('el retry no reasigna src ni reproduce si la url refrescada tambien es invalida', async () => {
    const staleTrack = track({ id: 'a', url: 'https://x/stale.mp3' });
    const freshTrack = { ...staleTrack, url: 'javascript:alert(1)' };
    const refetch = vi.fn().mockResolvedValue([freshTrack]);
    const manager = createSectionAudioManager({ tracks: [staleTrack], refetch });
    manager.play(staleTrack);
    manager.audio.play.mockClear();

    manager.audio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      const toast = document.querySelector('.toast');
      expect(toast?.classList.contains('visible')).toBe(true);
    });
    expect(manager.audio.src).not.toBe('https://x/stale.mp3'.replace('stale', 'fresh'));
    expect(manager.audio.play).not.toHaveBeenCalled();
  });
});

describe('createSectionAudioManager — rechazo de play()', () => {
  it('play() deja rastro con console.warn si audio.play() rechaza, sin lanzar', async () => {
    window.HTMLMediaElement.prototype.play.mockImplementation(() =>
      Promise.reject(new Error('AbortError'))
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = track({ id: 'a', url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });

    expect(() => manager.play(t)).not.toThrow();
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
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

describe('createSectionAccordion — estructura', () => {
  it('sin chips cuando hay un solo scope (mezcla)', () => {
    const t = track({ id: 'a' });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    expect(el.className).toBe('section-audio');
    expect(el.hidden).toBe(true);
    expect(el.querySelector('.section-audio__chips')).toBeNull();
  });

  it('chips por voz cuando hay más de un scope', () => {
    const tracks = [
      track({ id: 'mix', voiceScope: null }),
      track({ id: 'tenor', voiceScope: 'tenor' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks });
    const chips = el.querySelectorAll('.section-audio__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true'); // mezcla activa por defecto
    expect(chips[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('fila del reproductor tiene play, dos tiempos y scrubber', () => {
    const t = track({ id: 'a' });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    expect(el.querySelector('.section-audio__player')).not.toBeNull();
    expect(el.querySelector('button.section-audio__play')).not.toBeNull();
    expect(el.querySelectorAll('span.section-audio__time').length).toBe(2);
    const scrubber = el.querySelector('input.section-audio__scrubber');
    expect(scrubber).not.toBeNull();
    expect(scrubber.type).toBe('range');
  });
});

describe('createSectionAccordion — controles', () => {
  it('el play togglea manager.play/pause del track activo de la sección', () => {
    const t = track({ id: 'a', url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });

    el.querySelector('.section-audio__play').click();
    expect(manager.audio.src).toBe('https://x/0.mp3');
    expect(manager.audio.play).toHaveBeenCalled();
  });

  it('mover el scrubber llama manager.seek() cuando el track de la sección está cargado', () => {
    const t = track({ id: 'a', url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    manager.play(t);

    const scrubber = el.querySelector('.section-audio__scrubber');
    scrubber.value = '3';
    scrubber.dispatchEvent(new Event('input'));
    expect(manager.audio.currentTime).toBe(3);
  });

  it('clic en un chip cambia el track activo de la sección', () => {
    const tracks = [
      track({ id: 'mix', voiceScope: null, url: 'https://x/mix.mp3' }),
      track({ id: 'tenor', voiceScope: 'tenor', url: 'https://x/tenor.mp3' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks });

    el.querySelectorAll('.section-audio__chip')[1].click();
    el.querySelector('.section-audio__play').click();
    expect(manager.audio.src).toBe('https://x/tenor.mp3');
  });

  it('onTime del manager repinta el tiempo transcurrido de la sección activa', () => {
    const t = track({ id: 'a', url: 'https://x/0.mp3', durationSec: 20 });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    manager.play(t);
    manager.audio.currentTime = 7;
    manager.audio.dispatchEvent(new Event('timeupdate'));

    const [elapsedEl] = el.querySelectorAll('.section-audio__time');
    expect(elapsedEl.textContent).toBe('0:07');
  });

  it('load() carga metadata del track activo sin reproducir', () => {
    const t = track({ id: 'a', url: 'https://x/0.mp3' });
    const manager = createSectionAudioManager({ tracks: [t] });
    manager.audio.play.mockClear();
    const { el, load } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    load();
    expect(manager.audio.src).toBe('https://x/0.mp3');
    expect(manager.audio.preload).toBe('metadata');
    expect(manager.audio.play).not.toHaveBeenCalled();
    void el;
  });

  it('destroy() quita el elemento del DOM y desuscribe del manager', () => {
    const t = track({ id: 'a' });
    const manager = createSectionAudioManager({ tracks: [t] });
    const { el, destroy } = createSectionAccordion({ manager, sectionIndex: 0, tracks: [t] });
    const parent = document.createElement('div');
    parent.appendChild(el);
    destroy();
    expect(parent.contains(el)).toBe(false);
  });
});

describe('createSectionAudioManager — getCurrentTrack (fuente de verdad para consumidores)', () => {
  it('null antes de cargar nada; el track cargado/reproducido después', () => {
    const t = track({ id: 'a' });
    const manager = createSectionAudioManager({ tracks: [t] });
    expect(manager.getCurrentTrack()).toBeNull();
    manager.play(t);
    expect(manager.getCurrentTrack()).toEqual(t);
  });
});

// Regresión (code review Task 1.2): activeTrack era un estado LOCAL del
// closure del acordeón, desincronizable del <audio> real compartido por dos
// caminos — cambiar de chip mientras algo suena, y el rebuild de
// wireSectionPlayButtons en cada reRenderLyrics. Ambos dejaban el panel
// "mintiendo" sobre qué sonaba.
describe('createSectionAccordion — regresión: no debe desincronizarse del manager', () => {
  it('cambiar de chip con la pista sonando la pausa (no queda sonando sin control visible)', () => {
    const tracks = [
      track({ id: 'mix', voiceScope: null, url: 'https://x/mix.mp3' }),
      track({ id: 'tenor', voiceScope: 'tenor', url: 'https://x/tenor.mp3' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    manager.audio.pause.mockClear();
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks });

    el.querySelector('.section-audio__play').click(); // reproduce mezcla
    expect(manager.audio.pause).not.toHaveBeenCalled();
    // jsdom no simula el estado real de reproducción tras un play() mockeado
    // (paused sigue en true); se fuerza para simular "está sonando" al tocar
    // el chip — paused es un getter sin setter en el prototipo real.
    Object.defineProperty(manager.audio, 'paused', { value: false, configurable: true });

    el.querySelectorAll('.section-audio__chip')[1].click(); // cambia a tenor mientras suena
    expect(manager.audio.pause).toHaveBeenCalled();
  });

  it('un rebuild (nueva instancia para la misma sección) detecta el track que REALMENTE suena en el manager, no el default', () => {
    const tracks = [
      track({ id: 'mix', voiceScope: null, url: 'https://x/mix.mp3' }),
      track({ id: 'tenor', voiceScope: 'tenor', url: 'https://x/tenor.mp3' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    manager.play(tracks[1]); // suena tenor (no el default "mezcla")
    Object.defineProperty(manager.audio, 'paused', { value: false, configurable: true });

    // Simula wireSectionPlayButtons: destruye el panel viejo (si lo hubiera)
    // y crea uno nuevo para la misma sección, SIN pasar initialTrackId — el
    // manager ya sabe qué suena, no debería hacer falta.
    const { el } = createSectionAccordion({ manager, sectionIndex: 0, tracks });

    const chips = el.querySelectorAll('.section-audio__chip');
    expect(chips[1].getAttribute('aria-pressed')).toBe('true'); // tenor, no mezcla
    expect(chips[0].getAttribute('aria-pressed')).toBe('false');
    // El botón play refleja "sonando" para el track real, no "Reproducir".
    expect(el.querySelector('.section-audio__play').getAttribute('aria-label')).toBe('Pausar');
  });

  it('initialTrackId preserva el scope elegido (sin sonar) a través de un rebuild', () => {
    const tracks = [
      track({ id: 'mix', voiceScope: null, url: 'https://x/mix.mp3' }),
      track({ id: 'tenor', voiceScope: 'tenor', url: 'https://x/tenor.mp3' }),
    ];
    const manager = createSectionAudioManager({ tracks });
    const first = createSectionAccordion({ manager, sectionIndex: 0, tracks });
    first.el.querySelectorAll('.section-audio__chip')[1].click(); // elige tenor, sin reproducir
    const preservedId = first.getActiveTrackId();
    expect(preservedId).toBe('tenor');
    first.destroy();

    const rebuilt = createSectionAccordion({
      manager,
      sectionIndex: 0,
      tracks,
      initialTrackId: preservedId,
    });
    const chips = rebuilt.el.querySelectorAll('.section-audio__chip');
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
  });
});
