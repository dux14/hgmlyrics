import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTimingEngine } from '../src/lib/timingEngine.js';

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

  it('antes de la primera linea (startMs > 0) devuelve 0', () => {
    const e = createTimingEngine({
      lines: [
        { i: 0, startMs: 3000 },
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

    audio.currentTime = 2; // 2000ms, progress = 2000/10000 = 0.2
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).toHaveBeenCalledWith({ index: 0, progress: 0.2 });

    audio.currentTime = 7; // 7000ms, progress = 0.7
    audio.dispatchEvent(new Event('timeupdate'));
    expect(onInterlude).toHaveBeenLastCalledWith({ index: 0, progress: 0.7 });

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
