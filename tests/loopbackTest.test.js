// tests/loopbackTest.test.js
import { describe, it, expect } from 'vitest';
import { medianOffsetCents, runLoopbackTest } from '../src/lib/loopbackTest.js';

describe('medianOffsetCents', () => {
  it('detección igual a lo esperado → 0 cents', () => {
    const m = [
      { expectedHz: 440, detectedHz: 440 },
      { expectedHz: 261.63, detectedHz: 261.63 },
    ];
    expect(medianOffsetCents(m)).toBeCloseTo(0, 3);
  });

  it('calcula la mediana de los offsets por muestra', () => {
    // Tres muestras: +0, +~3.9 (442/440), +~7.8 cents. Mediana ≈ 3.9.
    const m = [
      { expectedHz: 440, detectedHz: 440 },
      { expectedHz: 440, detectedHz: 441 },
      { expectedHz: 440, detectedHz: 442 },
    ];
    expect(medianOffsetCents(m)).toBeCloseTo(1200 * Math.log2(441 / 440), 3);
  });

  it('ignora muestras inválidas (hz no positivo)', () => {
    const m = [
      { expectedHz: 440, detectedHz: 0 },
      { expectedHz: 440, detectedHz: 442 },
    ];
    expect(medianOffsetCents(m)).toBeCloseTo(1200 * Math.log2(442 / 440), 3);
  });

  it('sin muestras válidas → null', () => {
    expect(medianOffsetCents([])).toBeNull();
    expect(medianOffsetCents([{ expectedHz: 0, detectedHz: 0 }])).toBeNull();
  });
});

describe('runLoopbackTest – isCancelled', () => {
  it('aborta en la segunda nota si isCancelled devuelve true a partir de la segunda llamada', async () => {
    // Mock mínimo de tonePlayer: play/stop no hacen nada real.
    const tonePlayer = { play: () => {}, stop: () => {} };

    // sampleDetected devuelve siempre el hz esperado (offset 0 perfecto).
    const sampleDetected = (hz) => Promise.resolve(hz);

    // isCancelled: false la primera vez, true a partir de la segunda.
    let calls = 0;
    const isCancelled = () => {
      calls += 1;
      return calls > 1;
    };

    const { detail } = await runLoopbackTest({
      tonePlayer,
      sampleDetected,
      notes: ['A4', 'C4', 'E4'],
      isCancelled,
    });

    // Solo la primera nota debería haberse procesado.
    expect(detail).toHaveLength(1);
    expect(detail[0].note).toBe('A4');
  });
});
