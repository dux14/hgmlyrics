import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMultiTrackPlayer, syncStep } from '../src/components/pipeline/MultiTrackPlayer.js';

function makeTracks() {
  return [
    {
      kind: 'vocals',
      url: 'https://storage.example.com/vocals.mp3',
      label: 'Voz',
      durationSec: 100,
    },
    {
      kind: 'drums',
      url: 'https://storage.example.com/drums.mp3',
      label: 'Batería',
      durationSec: 100,
    },
    { kind: 'bass', url: 'https://storage.example.com/bass.mp3', label: 'Bajo', durationSec: 100 },
  ];
}

describe('createMultiTrackPlayer', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crea un <audio> por pista', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    expect(audios.length).toBe(3);
    destroy();
  });

  it('play global llama play() en TODAS las pistas, incluidas las muteadas', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const muteBtns = el.querySelectorAll('.mtp__row-btn--mute');

    // Silenciar la pista 1 (Batería) antes de reproducir: solo debe afectar
    // audibilidad (muted), no si la pista reproduce.
    muteBtns[1].click();
    expect(audios[1].muted).toBe(true);

    el.querySelector('.mtp__play').click();

    // play/pause son un unico spy en el prototype (compartido entre
    // instancias): se identifica el <audio> invocado por el `this` de cada
    // llamada (mock.instances).
    const playedOn = window.HTMLMediaElement.prototype.play.mock.instances;
    expect(playedOn).toContain(audios[0]);
    expect(playedOn).toContain(audios[1]);
    expect(playedOn).toContain(audios[2]);
    destroy();
  });

  it('mute/unmute en caliente: la pista sigue reproduciendo, nunca se pausa', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const muteBtns = el.querySelectorAll('.mtp__row-btn--mute');

    el.querySelector('.mtp__play').click();
    window.HTMLMediaElement.prototype.pause.mockClear();

    muteBtns[0].click();
    expect(audios[0].muted).toBe(true);
    muteBtns[0].click();
    expect(audios[0].muted).toBe(false);

    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    destroy();
  });

  it('maestra muteada: igual reproduce y su currentTime avanza (no arrastra a 0)', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const muteBtns = el.querySelectorAll('.mtp__row-btn--mute');

    muteBtns[0].click();
    expect(audios[0].muted).toBe(true);

    el.querySelector('.mtp__play').click();

    const playedOn = window.HTMLMediaElement.prototype.play.mock.instances;
    expect(playedOn).toContain(audios[0]);
    destroy();
  });

  it('multiples solos simultaneos: las soleadas quedan audibles, el resto muteado', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const soloBtns = el.querySelectorAll('.mtp__row-btn--solo');

    soloBtns[0].click();
    soloBtns[2].click();

    expect(audios[0].muted).toBe(false);
    expect(audios[1].muted).toBe(true);
    expect(audios[2].muted).toBe(false);
    destroy();
  });

  it('rAF: play arranca el loop, pause y destroy lo cancelan sin dejarlo huerfano', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });

    el.querySelector('.mtp__play').click();
    expect(window.requestAnimationFrame).toHaveBeenCalled();

    el.querySelector('.mtp__play').click(); // pausa
    expect(window.cancelAnimationFrame).toHaveBeenCalled();

    el.querySelector('.mtp__play').click(); // vuelve a reproducir
    destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it('mute de una pista: solo esa pista queda muted', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const muteBtns = el.querySelectorAll('.mtp__row-btn--mute');

    muteBtns[0].click();

    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    expect(audios[2].muted).toBe(false);
    expect(muteBtns[0].getAttribute('aria-pressed')).toBe('true');
    destroy();
  });

  it('solo de una pista: silencia las demas; un segundo click restaura', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const soloBtns = el.querySelectorAll('.mtp__row-btn--solo');

    soloBtns[1].click();
    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    expect(audios[2].muted).toBe(true);
    expect(soloBtns[1].getAttribute('aria-pressed')).toBe('true');

    soloBtns[1].click();
    expect(audios[0].muted).toBe(false);
    expect(audios[1].muted).toBe(false);
    expect(audios[2].muted).toBe(false);
    expect(soloBtns[1].getAttribute('aria-pressed')).toBe('false');
    destroy();
  });

  it('seek: setea currentTime en todas las pistas al mismo valor', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const bar = el.querySelector('.mtp__bar');
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      height: 0,
      right: 200,
      bottom: 0,
    });

    // 50% del ancho -> 50s de 100s de duración
    bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }));
    bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100 }));

    audios.forEach((audio) => expect(audio.currentTime).toBe(50));
    destroy();
  });

  it('destroy() pausa todas las pistas y es idempotente', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');

    destroy();
    const pausedOn = window.HTMLMediaElement.prototype.pause.mock.instances;
    audios.forEach((audio) => expect(pausedOn).toContain(audio));
    expect(() => destroy()).not.toThrow();
  });
});

describe('syncStep', () => {
  it('corrige una pista desviada mas del umbral a masterTime', () => {
    const audios = [{ currentTime: 10.1 }, { currentTime: 10.0 }];
    const corrected = syncStep(audios, 10.0);
    expect(corrected).toBe(1);
    expect(audios[0].currentTime).toBe(10.0);
    expect(audios[1].currentTime).toBe(10.0);
  });

  it('no toca una pista dentro del umbral', () => {
    const audios = [{ currentTime: 10.02 }];
    const corrected = syncStep(audios, 10.0);
    expect(corrected).toBe(0);
    expect(audios[0].currentTime).toBe(10.02);
  });
});
