import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMultiTrackPlayer, syncStep } from '../src/components/pipeline/MultiTrackPlayer.js';
import { createMetronomeClick } from '../src/lib/metronomeClick.js';

// Mockeado para verificar destroy()->stop() sin construir un AudioContext real
// (jsdom no lo implementa). El resto de tests del archivo no pasan `beats`,
// así que nunca invocan este mock — no afecta ninguna otra suite.
vi.mock('../src/lib/metronomeClick.js', () => ({
  createMetronomeClick: vi.fn(() => ({
    setMuted: vi.fn(),
    isMuted: vi.fn(() => true),
    stop: vi.fn(),
  })),
}));

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
      vi.fn(() => 1),
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

  it('play global llama play() en TODAS las pistas, incluidas las apagadas', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const toggleBtns = el.querySelectorAll('.mtp__row-toggle');

    // Apagar la pista 1 (Batería) antes de reproducir: solo debe afectar
    // audibilidad (muted), no si la pista reproduce.
    toggleBtns[1].click();
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

  it('apagar/prender en caliente: la pista sigue reproduciendo, nunca se pausa', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const toggleBtns = el.querySelectorAll('.mtp__row-toggle');

    el.querySelector('.mtp__play').click();
    window.HTMLMediaElement.prototype.pause.mockClear();

    toggleBtns[0].click();
    expect(audios[0].muted).toBe(true);
    toggleBtns[0].click();
    expect(audios[0].muted).toBe(false);

    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    destroy();
  });

  it('maestra apagada: igual reproduce y su currentTime avanza (no arrastra a 0)', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const toggleBtns = el.querySelectorAll('.mtp__row-toggle');

    toggleBtns[0].click();
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

  it('apagar una pista: solo esa pista queda muted', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    const toggleBtns = el.querySelectorAll('.mtp__row-toggle');

    toggleBtns[0].click();

    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    expect(audios[2].muted).toBe(false);
    expect(toggleBtns[0].getAttribute('aria-pressed')).toBe('false');
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

  it('onTime: el callback se llama con el tiempo maestro en segundos en cada tick', () => {
    const { el, onTime, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');
    audios[0].currentTime = 12.5;
    const cb = vi.fn();
    onTime(cb);

    el.querySelector('.mtp__play').click(); // arranca el loop (rAF mockeado ejecuta tick 0 veces automaticamente)
    // requestAnimationFrame esta mockeado sin ejecutar el callback; disparamos
    // el primer tick manualmente via el mock para simular un frame.
    const tickFn = window.requestAnimationFrame.mock.calls[0][0];
    tickFn();

    expect(cb).toHaveBeenCalledWith(12.5);
    destroy();
  });

  it('onTime: la funcion de unsubscribe deja de invocar el callback', () => {
    const { el, onTime, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const cb = vi.fn();
    const off = onTime(cb);
    off();

    el.querySelector('.mtp__play').click();
    const tickFn = window.requestAnimationFrame.mock.calls[0][0];
    tickFn();

    expect(cb).not.toHaveBeenCalled();
    destroy();
  });

  it('seek: mueve el transporte a un tiempo dado (equivalente a un scrub programatico)', () => {
    const { el, seek, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const audios = el.querySelectorAll('audio');

    seek(30);

    audios.forEach((audio) => expect(audio.currentTime).toBe(30));
    destroy();
  });

  it('seek: notifica a los listeners de onTime con el tiempo buscado (highlight en vivo con player en pausa)', () => {
    const { onTime, seek, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const cb = vi.fn();
    onTime(cb);

    seek(30);

    expect(cb).toHaveBeenCalledWith(30);
    destroy();
  });

  it('destroy() limpia los callbacks de onTime (no quedan huerfanos)', () => {
    const { onTime, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    const cb = vi.fn();
    onTime(cb);
    expect(() => destroy()).not.toThrow();
  });

  it('expone sub-elementos para el layout B', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    for (const key of ['transport', 'practice', 'sections', 'nowSound', 'mixer', 'audios']) {
      expect(player.els[key]).toBeInstanceOf(HTMLElement);
    }
    player.destroy();
  });

  it('aditivo: todas encendidas al inicio; togglear una fila la apaga (muted)', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    const audios = player.el.querySelectorAll('audio');
    expect([...audios].map((a) => a.muted)).toEqual([false, false, false]);
    player.el.querySelector('.mtp__row[data-idx="0"] .mtp__row-toggle').click();
    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    player.destroy();
  });

  it('solo: aísla la pista aunque el resto esté encendido', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    const audios = player.el.querySelectorAll('audio');
    player.el.querySelector('.mtp__row[data-idx="1"] .mtp__row-btn--solo').click();
    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    player.destroy();
  });

  it('chip Todo restaura la mezcla completa', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    player.el.querySelector('.mtp__row[data-idx="0"] .mtp__row-toggle').click();
    player.el.querySelector('.mtp__row[data-idx="1"] .mtp__row-btn--solo').click();
    player.el.querySelector('.mtp__all').click();
    const audios = player.el.querySelectorAll('audio');
    expect([...audios].map((a) => a.muted)).toEqual([false, false, false]);
    player.destroy();
  });

  it('nowsound refleja el estado del mixer', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    expect(player.els.nowSound.textContent).toBe('Sonando: Voz + Batería + Bajo');
    player.el.querySelector('.mtp__row[data-idx="1"] .mtp__row-toggle').click();
    expect(player.els.nowSound.textContent).toBe('Sonando: Voz + Bajo');
    player.destroy();
  });
});

describe('createMultiTrackPlayer — long-press vs click nativo (guard anti-carrera)', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('long-press real (>=500ms) aisla la pista; el click sintetico posterior no la des-aisla', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    const row = player.el.querySelector('.mtp__row[data-idx="1"]');
    const soloBtn = row.querySelector('.mtp__row-btn--solo');
    const audios = player.el.querySelectorAll('audio');

    row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(500); // dispara el long-press: soloed.add(1)
    row.dispatchEvent(new Event('pointerup', { bubbles: true }));
    // El navegador SIEMPRE dispara un click sobre el target del
    // pointerdown/pointerup, sin importar cuanto se sostuvo — lo simulamos.
    soloBtn.click();

    expect(audios[0].muted).toBe(true);
    expect(audios[1].muted).toBe(false);
    expect(audios[2].muted).toBe(true);
    player.destroy();
  });

  it('long-press sobre el row-toggle no deja la pista en disabled Y soloed a la vez', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    const row = player.el.querySelector('.mtp__row[data-idx="1"]');
    const toggleBtn = row.querySelector('.mtp__row-toggle');
    const soloBtn = row.querySelector('.mtp__row-btn--solo');
    const audios = player.el.querySelectorAll('audio');

    row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(500); // el timer aisla la pista (soloed.add(1))
    row.dispatchEvent(new Event('pointerup', { bubbles: true }));
    toggleBtn.click(); // click sintetico sobre el toggle, no sobre el solo

    // Saco el solo con un click genuino (ya no hay longPressFired pendiente):
    // si el click sintetico anterior hubiera togglado `disabled` de mas
    // (bug pre-fix), la pista seguiria muted aca.
    soloBtn.click();
    expect(audios[1].muted).toBe(false);
    player.destroy();
  });

  it('cleanup: destroy() antes de que venza el timer no dispara el long-press', () => {
    const player = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    const row = player.el.querySelector('.mtp__row[data-idx="0"]');

    row.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    player.destroy();

    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
  });
});

describe('createMultiTrackPlayer — agrupacion de pistas', () => {
  it('sin group en los tracks, no aparece ningun encabezado (lista plana)', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    expect(el.querySelectorAll('.mtp__group').length).toBe(0);
    destroy();
  });

  it('con group, inserta un encabezado por grupo solo cuando cambia', () => {
    const tracks = [
      { kind: 'vocals', url: 'https://x/v.mp3', label: 'Voz', group: 'voces' },
      { kind: 'backing', url: 'https://x/b.mp3', label: 'Coros', group: 'voces' },
      { kind: 'drums', url: 'https://x/d.mp3', label: 'Bateria', group: 'instrumentos' },
    ];
    const { el, destroy } = createMultiTrackPlayer({ tracks });
    const groups = el.querySelectorAll('.mtp__group');
    expect(groups.length).toBe(2);
    expect(groups[0].textContent).toBe('VOCES');
    expect(groups[1].textContent).toBe('INSTRUMENTOS');
    destroy();
  });
});

describe('createMultiTrackPlayer — chips de sección (structure.segments, Task 19)', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeStructure() {
    return {
      segments: [
        { label: 'Intro', startMs: 0, endMs: 5000 },
        { label: 'Verso', startMs: 5000, endMs: 20000 },
      ],
    };
  }

  it('sin structure (o sin segments) no pinta fila de chips', () => {
    const { el, destroy } = createMultiTrackPlayer({ tracks: makeTracks() });
    expect(el.querySelectorAll('.mtp__section-chip').length).toBe(0);
    destroy();

    const { el: el2, destroy: destroy2 } = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: { segments: [] },
    });
    expect(el2.querySelectorAll('.mtp__section-chip').length).toBe(0);
    destroy2();
  });

  it('con structure.segments pinta un chip clickeable por segmento con su label', () => {
    const { el, destroy } = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: makeStructure(),
    });
    const chips = el.querySelectorAll('.mtp__section-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('Intro');
    expect(chips[1].textContent).toBe('Verso');
    destroy();
  });

  it('click en un chip hace seek en SEGUNDOS (startMs/1000), nunca en milisegundos', () => {
    const { el, destroy } = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: makeStructure(),
    });
    const audios = el.querySelectorAll('audio');
    const chips = el.querySelectorAll('.mtp__section-chip');

    chips[1].click();

    // 5000ms / 1000 = 5s. Si se pasara startMs sin convertir, currentTime
    // quedaría clampeado a masterDuration() (100s) muy por encima de 5.
    audios.forEach((audio) => expect(audio.currentTime).toBe(5));
    destroy();
  });

  it('resalta el chip activo segun el tiempo actual del player (seek)', () => {
    const { el, seek, destroy } = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: makeStructure(),
    });
    const chips = el.querySelectorAll('.mtp__section-chip');

    // 2s cae dentro de "Intro" [0, 5000ms) -> solo ese chip queda activo.
    seek(2);
    expect(chips[0].classList.contains('is-active')).toBe(true);
    expect(chips[1].classList.contains('is-active')).toBe(false);

    // 10s cae dentro de "Verso" [5000, 20000ms) -> cambia el chip activo.
    seek(10);
    expect(chips[0].classList.contains('is-active')).toBe(false);
    expect(chips[1].classList.contains('is-active')).toBe(true);

    // Caso de borde: tiempo == endMs de "Intro" (5s) es el límite EXCLUSIVO
    // de "Intro" e INCLUSIVO de "Verso" -> activo el siguiente, nunca ambos.
    seek(5);
    expect(chips[0].classList.contains('is-active')).toBe(false);
    expect(chips[1].classList.contains('is-active')).toBe(true);

    destroy();
  });
});

describe('createMultiTrackPlayer — tira de práctica (Task 4)', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('velocidad: aplica playbackRate y preservesPitch a TODAS las pistas', () => {
    const p = createMultiTrackPlayer({ tracks: makeTracks(), structure: null });
    document.body.appendChild(p.el);
    p.els.practice.querySelector('[data-rate="0.75"]').click();
    p.els.audios.querySelectorAll('audio').forEach((a) => {
      expect(a.playbackRate).toBe(0.75);
      expect(a.preservesPitch).toBe(true);
    });
    p.destroy();
  });

  it('loop: togglear en la tira marca el chip de la sección activa con estado de loop', () => {
    const structure = { segments: [{ label: 'verso', startMs: 0, endMs: 30000 }] };
    const p = createMultiTrackPlayer({ tracks: makeTracks(), structure });
    document.body.appendChild(p.el);
    p.els.practice.querySelector('.mtp__loop').click();
    expect(p.els.sections.querySelector('.mtp__section-chip').classList.contains('is-loop')).toBe(
      true,
    );
    p.destroy();
  });

  it('metrónomo: sin beats no se pinta el toggle', () => {
    const p = createMultiTrackPlayer({ tracks: makeTracks(), structure: null, beats: null });
    expect(p.els.practice.querySelector('.mtp__metro')).toBeNull();
    p.destroy();
  });

  it('metrónomo: con beats se pinta el toggle con BPM y compás', () => {
    const p = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: null,
      beats: [0, 500, 1000],
      bpm: 96,
      timeSignature: '3/4',
    });
    const metro = p.els.practice.querySelector('.mtp__metro');
    expect(metro).not.toBeNull();
    expect(metro.textContent).toContain('96');
    expect(metro.textContent).toContain('3/4');
    p.destroy();
  });

  it('loop: dentro de tick(), al pasar endMs vuelve TODAS las pistas a startMs; dentro del rango no hace seek', () => {
    const structure = { segments: [{ label: 'verso', startMs: 0, endMs: 30000 }] };
    const p = createMultiTrackPlayer({ tracks: makeTracks(), structure });
    document.body.appendChild(p.el);
    const audios = p.el.querySelectorAll('audio');

    // Chip del segmento 0 ya activo por el updateActiveChip(0) de init.
    p.els.practice.querySelector('.mtp__loop').click();
    p.el.querySelector('.mtp__play').click();
    const tickFn = window.requestAnimationFrame.mock.calls[0][0];

    // Control: dentro del segmento, el tick no reescribe currentTime.
    audios.forEach((a) => {
      a.currentTime = 15;
    });
    tickFn();
    audios.forEach((a) => expect(a.currentTime).toBe(15));

    // Pasó endMs (30s): loopSeekTarget dispara seekAll a startMs/1000 (0).
    audios[0].currentTime = 30.5;
    tickFn();
    audios.forEach((a) => expect(a.currentTime).toBe(0));

    p.destroy();
  });

  it('destroy() detiene el metrónomo (metronome.stop())', () => {
    const p = createMultiTrackPlayer({
      tracks: makeTracks(),
      structure: null,
      beats: [0, 500, 1000],
    });
    const instance = createMetronomeClick.mock.results.at(-1).value;

    p.destroy();

    expect(instance.stop).toHaveBeenCalled();
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
