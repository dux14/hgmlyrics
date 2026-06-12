import { describe, it, expect } from 'vitest';
import { mergeSegments, segmentToPct, voiceColorVar, labelColor } from './studioSegments.js';

describe('mergeSegments', () => {
  it('fusiona tramos contiguos del mismo cantante bajo el umbral de hueco', () => {
    const segs = [
      { voice: 'Voz 1', start: 0.2, end: 0.27 },
      { voice: 'Voz 1', start: 0.28, end: 0.29 }, // hueco 0.01 < 0.4
    ];
    expect(mergeSegments(segs)).toEqual([{ voice: 'Voz 1', start: 0.2, end: 0.29 }]);
  });

  it('NO fusiona cantantes distintos aunque sean contiguos', () => {
    const segs = [
      { voice: 'Voz 1', start: 0.0, end: 0.5 },
      { voice: 'Voz 2', start: 0.5, end: 1.0 },
    ];
    expect(mergeSegments(segs)).toEqual(segs);
  });

  it('NO fusiona si el hueco supera el umbral', () => {
    const segs = [
      { voice: 'Voz 1', start: 0, end: 1 },
      { voice: 'Voz 1', start: 2, end: 3 }, // hueco 1.0 > 0.4
    ];
    expect(mergeSegments(segs)).toEqual(segs);
  });

  it('ordena por start antes de fusionar', () => {
    const segs = [
      { voice: 'Voz 1', start: 1.0, end: 1.2 },
      { voice: 'Voz 1', start: 0.0, end: 0.9 }, // hueco a 1.0 = 0.1 < 0.4
    ];
    expect(mergeSegments(segs)).toEqual([{ voice: 'Voz 1', start: 0.0, end: 1.2 }]);
  });

  it('lista vacía -> []', () => {
    expect(mergeSegments([])).toEqual([]);
  });

  it('un solo segmento -> igual', () => {
    expect(mergeSegments([{ voice: 'Voz 1', start: 1, end: 2 }])).toEqual([
      { voice: 'Voz 1', start: 1, end: 2 },
    ]);
  });
});

describe('segmentToPct', () => {
  it('convierte start/end a porcentajes left/width sobre la duración', () => {
    expect(segmentToPct({ start: 30, end: 60 }, 120)).toEqual({ left: 25, width: 25 });
  });
  it('clampa al rango 0..100 y evita ancho negativo', () => {
    expect(segmentToPct({ start: 110, end: 130 }, 120)).toEqual({
      left: 91.66666666666666,
      width: 8.333333333333343,
    });
  });
  it('duración 0 o inválida -> left 0 width 0', () => {
    expect(segmentToPct({ start: 1, end: 2 }, 0)).toEqual({ left: 0, width: 0 });
  });
});

describe('voiceColorVar', () => {
  it('asigna una var CSS estable por nombre de voz, ciclando la paleta', () => {
    const order = ['Voz 1', 'Voz 2'];
    expect(voiceColorVar('Voz 1', order)).toBe('var(--color-voice-soprano)');
    expect(voiceColorVar('Voz 2', order)).toBe('var(--color-voice-contralto)');
  });
  it('cicla cuando hay más voces que colores', () => {
    const order = ['A', 'B', 'C', 'D', 'E'];
    expect(voiceColorVar('E', order)).toBe('var(--color-voice-soprano)'); // índice 4 % 4 = 0
  });
  it('voz desconocida -> primer color', () => {
    expect(voiceColorVar('X', ['A', 'B'])).toBe('var(--color-voice-soprano)');
  });
});

describe('labelColor', () => {
  it('verso → --color-primary', () => {
    expect(labelColor('verso')).toBe('var(--color-primary)');
  });
  it('coro → --color-accent', () => {
    expect(labelColor('coro')).toBe('var(--color-accent)');
  });
  it('puente → --color-voice-contralto', () => {
    expect(labelColor('puente')).toBe('var(--color-voice-contralto)');
  });
  it('intro → --color-text-secondary', () => {
    expect(labelColor('intro')).toBe('var(--color-text-secondary)');
  });
  it('outro → --color-text-secondary', () => {
    expect(labelColor('outro')).toBe('var(--color-text-secondary)');
  });
  it('silencio → --color-text-secondary', () => {
    expect(labelColor('silencio')).toBe('var(--color-text-secondary)');
  });
  it('instrumental → --color-voice-bass', () => {
    expect(labelColor('instrumental')).toBe('var(--color-voice-bass)');
  });
  it('pre-coro → --color-primary-light', () => {
    expect(labelColor('pre-coro')).toBe('var(--color-primary-light)');
  });
  it('label desconocido → --color-text-secondary (fallback)', () => {
    expect(labelColor('unknown')).toBe('var(--color-text-secondary)');
    expect(labelColor('')).toBe('var(--color-text-secondary)');
    expect(labelColor('CORO')).toBe('var(--color-text-secondary)'); // case-sensitive
  });
});
