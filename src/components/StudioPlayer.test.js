import { describe, it, expect } from 'vitest';
import {
  fmtTimeCs,
  fmtTime,
  clamp,
  posToTime,
  timeToPos,
  magnifyRange,
  magnifyPosToTime,
  commitPreview,
  createStudioPlayer,
} from './StudioPlayer.js';

describe('fmtTimeCs', () => {
  it('formatea m:ss.cs', () => {
    expect(fmtTimeCs(72.34)).toBe('1:12.34');
    expect(fmtTimeCs(0)).toBe('0:00.00');
    expect(fmtTimeCs(5.7)).toBe('0:05.70');
  });
  it('no-finito o negativo → 0:00.00', () => {
    expect(fmtTimeCs(NaN)).toBe('0:00.00');
    expect(fmtTimeCs(-3)).toBe('0:00.00');
  });
});

describe('fmtTime', () => {
  it('formatea m:ss', () => {
    expect(fmtTime(72)).toBe('1:12');
    expect(fmtTime(5)).toBe('0:05');
    expect(fmtTime(0)).toBe('0:00');
  });
  it('no-finito o negativo → 0:00', () => {
    expect(fmtTime(NaN)).toBe('0:00');
    expect(fmtTime(-3)).toBe('0:00');
  });
});

describe('clamp', () => {
  it('acota a [lo,hi]', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
});

describe('posToTime / timeToPos', () => {
  it('posToTime mapea ratio→segundos acotado', () => {
    expect(posToTime(0.5, 100)).toBe(50);
    expect(posToTime(2, 100)).toBe(100);
    expect(posToTime(0.5, 0)).toBe(0);
  });
  it('timeToPos mapea segundos→ratio acotado', () => {
    expect(timeToPos(50, 100)).toBe(0.5);
    expect(timeToPos(200, 100)).toBe(1);
    expect(timeToPos(10, 0)).toBe(0);
  });
});

describe('magnifyRange', () => {
  it('ventana ±3s acotada a [0,duración]', () => {
    expect(magnifyRange(50, 100)).toEqual({ start: 47, end: 53 });
    expect(magnifyRange(1, 100)).toEqual({ start: 0, end: 4 });
    expect(magnifyRange(99, 100)).toEqual({ start: 96, end: 100 });
  });
  it('duración 0 → rango nulo', () => {
    expect(magnifyRange(5, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('magnifyPosToTime', () => {
  it('mapea ratio dentro del rango de la lupa', () => {
    expect(magnifyPosToTime(0.5, { start: 47, end: 53 })).toBe(50);
    expect(magnifyPosToTime(0, { start: 47, end: 53 })).toBe(47);
    expect(magnifyPosToTime(1, { start: 47, end: 53 })).toBe(53);
  });
});

describe('commitPreview', () => {
  it('retorna previewTime cuando es un tiempo válido', () => {
    expect(commitPreview({ previewTime: 42.5 })).toBe(42.5);
    expect(commitPreview({ previewTime: 0 })).toBe(0);
  });
  it('retorna 0 cuando previewTime no es finito', () => {
    expect(commitPreview({ previewTime: NaN })).toBe(0);
    expect(commitPreview({ previewTime: Infinity })).toBe(0);
  });
  it('retorna 0 cuando previewTime es negativo', () => {
    expect(commitPreview({ previewTime: -1 })).toBe(0);
  });
});

describe('createStudioPlayer — SEC-X1: safeUrl bloquea javascript: en href y src', () => {
  it('url javascript: produce href y src vacíos', () => {
    const { el } = createStudioPlayer({ label: 'Voz', url: 'javascript:alert(1)' });
    const dlLink = el.querySelector('.studio-player__dl');
    expect(dlLink).not.toBeNull();
    expect(dlLink.getAttribute('href')).toBe('');

    const audio = el.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio.getAttribute('src')).toBe('');
  });

  it('url https: legítima se preserva en href y src', () => {
    const url = 'https://storage.example.com/stems/vocals.mp3';
    const { el } = createStudioPlayer({ label: 'Voz', url });
    const dlLink = el.querySelector('.studio-player__dl');
    expect(dlLink.getAttribute('href')).toBe(url);

    const audio = el.querySelector('audio');
    expect(audio.getAttribute('src')).toBe(url);
  });
});
