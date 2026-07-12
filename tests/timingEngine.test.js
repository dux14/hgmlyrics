import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTimingEngine, LEAD_MS, PREROLL_MIN_MS } from '../src/lib/timingEngine.js';

/**
 * Fake <audio> minimo: EventTarget real (jsdom) + currentTime seteable.
 */
function createFakeAudio() {
  const audio = document.createElement('audio');
  Object.defineProperty(audio, 'currentTime', {
    value: 0,
    writable: true,
    configurable: true,
  });
  return audio;
}

describe('createTimingEngine — lineAt', () => {
  const lines = [
    { i: 0, startMs: 0 },
    { i: 1, startMs: 5000 },
    { i: 2, startMs: 9000 },
  ];

  it('busqueda binaria: devuelve la ultima linea con startMs <= ms', () => {
    const e = createTimingEngine({ lines });
    expect(e.lineAt(0)).toBe(0);
    expect(e.lineAt(5100)).toBe(1);
    expect(e.lineAt(8999)).toBe(1);
    expect(e.lineAt(20000)).toBe(2);
  });

  it('antes de la primera linea con intro >= PREROLL_MIN_MS devuelve -1 (pre-roll)', () => {
    const e = createTimingEngine({
      lines: [
        { i: 0, startMs: 3000 },
        { i: 1, startMs: 8000 },
      ],
    });
    expect(e.lineAt(0)).toBe(-1);
    expect(e.lineAt(1500)).toBe(-1);
  });

  it('antes de la primera linea con intro < PREROLL_MIN_MS devuelve 0 (sin pre-roll)', () => {
    const e = createTimingEngine({
      lines: [
        { i: 0, startMs: 2500 },
        { i: 1, startMs: 8000 },
      ],
    });
    expect(e.lineAt(0)).toBe(0);
    expect(e.lineAt(1500)).toBe(0);
  });

  it('lines vacio no crashea y devuelve 0', () => {
    const e = createTimingEngine({ lines: [] });
    expect(e.lineAt(1000)).toBe(0);
  });

  it('lines de un solo elemento no crashea', () => {
    const e = createTimingEngine({ lines: [{ i: 0, startMs: 2000 }] });
    expect(e.lineAt(0)).toBe(0);
    expect(e.lineAt(50000)).toBe(0);
  });
});

describe('createTimingEngine — interludios', () => {
  it('gap > 5000ms entre lineas emite onInterlude con progreso creciente', () => {
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 10000 }, // gap de 10s > 5000ms
    ];
    const onInterlude = vi.fn();
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange, onInterlude });
    const audio = createFakeAudio();
    e.attach(audio);

    // ms efectivo incluye LEAD_MS (anticipacion de 120ms sobre currentTime)
    audio.currentTime = 2; // 2000ms + 120 = 2120ms, progress = 2120/10000 = 0.212
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).toHaveBeenCalledWith({ index: 0, progress: 0.212 });

    audio.currentTime = 7; // 7000ms + 120 = 7120ms, progress = 0.712
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).toHaveBeenLastCalledWith({ index: 0, progress: 0.712 });

    // al entrar la siguiente linea, onLineChange normal (no interludio)
    audio.currentTime = 10.5;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenLastCalledWith(1);
  });

  it('sin gap > 5000ms nunca emite onInterlude', () => {
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 3000 },
    ];
    const onInterlude = vi.fn();
    const e = createTimingEngine({ lines, onInterlude });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.currentTime = 1;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).not.toHaveBeenCalled();
  });

  it('gap exactamente igual a 5000ms no emite onInterlude (regla es estrictamente >)', () => {
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 5000 },
    ];
    const onInterlude = vi.fn();
    const e = createTimingEngine({ lines, onInterlude });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).not.toHaveBeenCalled();
  });
});

describe('createTimingEngine — timeupdate y onLineChange', () => {
  let lines;
  beforeEach(() => {
    lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 5000 },
      { i: 2, startMs: 9000 },
    ];
  });

  it('dispara onLineChange solo al cambiar de linea', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.currentTime = 0;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(1);
    expect(onLineChange).toHaveBeenLastCalledWith(0);

    audio.currentTime = 1;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(1); // sigue en linea 0

    audio.currentTime = 5.2;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(2);
    expect(onLineChange).toHaveBeenLastCalledWith(1);
  });

  it('detach quita todos los listeners: timeupdate deja de disparar callbacks', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.currentTime = 0;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(1);

    e.detach();
    audio.currentTime = 5.2;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(1); // no crecio
  });

  it('attach sin detach previo hace auto-detach del audio anterior (no fuga el listener)', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio1 = createFakeAudio();
    const audio2 = createFakeAudio();

    e.attach(audio1);
    e.attach(audio2); // sin detach() explicito

    audio1.currentTime = 5.2;
    audio1.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).not.toHaveBeenCalled(); // audio1 ya no esta escuchado

    audio2.currentTime = 5.2;
    audio2.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledTimes(1);
    expect(onLineChange).toHaveBeenLastCalledWith(1);
  });

  it('re-attach con el audio nuevo en la misma linea SI dispara onLineChange de resincronizacion', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio1 = createFakeAudio();
    e.attach(audio1);

    audio1.currentTime = 9.1; // linea 2
    audio1.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenLastCalledWith(2);

    e.detach();

    const audio2 = createFakeAudio();
    audio2.currentTime = 9.1; // misma linea 2 que el audio anterior
    e.attach(audio2);

    audio2.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenLastCalledWith(2);
    expect(onLineChange).toHaveBeenCalledTimes(2); // sin el fix se quedaria en 1
  });
});

describe('createTimingEngine — pre-roll (indice -1)', () => {
  it('intro larga (startMs=8000): emite onInterlude con index -1 antes de la linea 0', () => {
    const lines = [
      { i: 0, startMs: 8000 },
      { i: 1, startMs: 12000 },
    ];
    const onInterlude = vi.fn();
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange, onInterlude });
    const audio = createFakeAudio();
    e.attach(audio);

    // 1000ms + LEAD_MS(120) = 1120ms, progress = 1120/8000 = 0.14
    audio.currentTime = 1;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).toHaveBeenCalledWith({ index: -1, progress: 0.14 });
    expect(onLineChange).not.toHaveBeenCalled();
  });

  it('al cruzar startMs - LEAD_MS pasa a la linea 0 con onLineChange', () => {
    const lines = [
      { i: 0, startMs: 8000 },
      { i: 1, startMs: 12000 },
    ];
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    // 7880ms + LEAD_MS(120) = 8000ms >= startMs de la linea 0
    audio.currentTime = 7.88;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenCalledWith(0);
  });

  it('intro corta (startMs=2500 < PREROLL_MIN_MS): sin pre-roll, arranca directo en linea 0', () => {
    const lines = [
      { i: 0, startMs: 2500 },
      { i: 1, startMs: 6000 },
    ];
    expect(2500).toBeLessThan(PREROLL_MIN_MS);
    const onInterlude = vi.fn();
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange, onInterlude });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.currentTime = 1;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).not.toHaveBeenCalled();
    expect(onLineChange).toHaveBeenCalledWith(0);
  });

  it('seekToLine(0) sigue funcionando durante el pre-roll', () => {
    const lines = [
      { i: 0, startMs: 8000 },
      { i: 1, startMs: 12000 },
    ];
    const e = createTimingEngine({ lines });
    const audio = createFakeAudio();
    e.attach(audio);

    e.seekToLine(0);
    expect(audio.currentTime).toBe(8);
  });
});

describe('createTimingEngine — seekToLine', () => {
  it('fija audio.currentTime = startMs/1000 de la linea', () => {
    const lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 5000 },
      { i: 2, startMs: 9500 },
    ];
    const e = createTimingEngine({ lines });
    const audio = createFakeAudio();
    e.attach(audio);

    e.seekToLine(2);
    expect(audio.currentTime).toBe(9.5);
  });

  it('sin audio attacheado no crashea', () => {
    const e = createTimingEngine({ lines: [{ i: 0, startMs: 0 }] });
    expect(() => e.seekToLine(0)).not.toThrow();
  });

  it('indice fuera de rango no crashea', () => {
    const lines = [{ i: 0, startMs: 0 }];
    const e = createTimingEngine({ lines });
    const audio = createFakeAudio();
    e.attach(audio);
    expect(() => e.seekToLine(5)).not.toThrow();
    expect(audio.currentTime).toBe(0);
  });
});

describe('createTimingEngine — LEAD_MS y rAF', () => {
  let lines;
  let rafQueue;
  let rafId;
  let originalRaf;
  let originalCaf;

  beforeEach(() => {
    lines = [
      { i: 0, startMs: 0 },
      { i: 1, startMs: 5000 },
      { i: 2, startMs: 9000 },
    ];
    rafQueue = [];
    rafId = 0;
    originalRaf = globalThis.requestAnimationFrame;
    originalCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb) => {
      const id = ++rafId;
      rafQueue.push({ id, cb });
      return id;
    });
    globalThis.cancelAnimationFrame = vi.fn((id) => {
      rafQueue = rafQueue.filter((entry) => entry.id !== id);
    });
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });

  /** Ejecuta un frame pendiente de la cola (simula un tick de rAF). */
  function flushOneFrame() {
    const entry = rafQueue.shift();
    if (entry) entry.cb();
  }

  it('LEAD_MS exportado vale 120', () => {
    expect(LEAD_MS).toBe(120);
  });

  it('la linea activa se decide con currentTime + LEAD_MS (anticipacion)', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    // 4900ms + 120 = 5020ms >= 5000 (startMs de la linea 1)
    audio.currentTime = 4.9;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenLastCalledWith(1);
  });

  it('con la pista reproduciendo, el rAF loop actualiza el indice sin timeupdate', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);
    onLineChange.mockClear();

    audio.dispatchEvent(new Event('play'));
    expect(rafQueue.length).toBe(1);

    audio.currentTime = 5.2; // sin dispatch de timeupdate
    flushOneFrame();

    expect(onLineChange).toHaveBeenCalledWith(1);
  });

  it('pause detiene el rAF loop: no corren mas frames', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.dispatchEvent(new Event('play'));
    expect(rafQueue.length).toBe(1);

    audio.dispatchEvent(new Event('pause'));
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(rafQueue.length).toBe(0);

    onLineChange.mockClear();
    audio.currentTime = 5.2;
    flushOneFrame(); // cola vacia: no-op
    expect(onLineChange).not.toHaveBeenCalled();
  });

  it('timeupdate sigue funcionando como respaldo mientras no hay rAF activo', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);
    onLineChange.mockClear();

    audio.currentTime = 5.2;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onLineChange).toHaveBeenLastCalledWith(1);
  });

  it('detach cancela el rAF si estaba corriendo y remueve listeners play/pause', () => {
    const onLineChange = vi.fn();
    const e = createTimingEngine({ lines, onLineChange });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.dispatchEvent(new Event('play'));
    expect(rafQueue.length).toBe(1);

    e.detach();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    expect(rafQueue.length).toBe(0);
  });

  it('no arranca dos loops de rAF si play se dispara dos veces seguidas', () => {
    const e = createTimingEngine({ lines });
    const audio = createFakeAudio();
    e.attach(audio);

    audio.dispatchEvent(new Event('play'));
    audio.dispatchEvent(new Event('play'));
    expect(rafQueue.length).toBe(1);
  });
});
