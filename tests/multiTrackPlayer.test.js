import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  });

  it('crea un <audio> por pista', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    expect(audios.length).toBe(3);
    destroy();
  });

  it('play global llama play() en todas las pistas no-muteadas', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const muteBtns = el.querySelectorAll('.mtp__row-btn--mute');

    // Silenciar la pista 1 (Batería) antes de reproducir
    muteBtns[1].click();
    expect(audios[1].muted).toBe(true);

    el.querySelector('.mtp__play').click();

    // play/pause son un unico spy en el prototype (compartido entre
    // instancias): se identifica el <audio> invocado por el `this` de cada
    // llamada (mock.instances).
    const playedOn = window.HTMLMediaElement.prototype.play.mock.instances;
    expect(playedOn).toContain(audios[0]);
    expect(playedOn).not.toContain(audios[1]);
    expect(playedOn).toContain(audios[2]);
    destroy();
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
