import { describe, it, expect } from 'vitest';
import { isSpeaking, makeSpeakingSmoother, computeRms } from '../../src/world/voiceLevel.js';

// ---------------------------------------------------------------------------
// isSpeaking — función pura
// ---------------------------------------------------------------------------
describe('isSpeaking', () => {
  it('retorna false cuando el rms esta por debajo del umbral', () => {
    expect(isSpeaking(0.05, 0.1)).toBe(false);
  });

  it('retorna false cuando el rms es exactamente el umbral (no estricto)', () => {
    expect(isSpeaking(0.1, 0.1)).toBe(false);
  });

  it('retorna true cuando el rms supera el umbral', () => {
    expect(isSpeaking(0.11, 0.1)).toBe(true);
  });

  it('retorna true para rms = 1 con cualquier umbral < 1', () => {
    expect(isSpeaking(1, 0.9)).toBe(true);
  });

  it('retorna false para rms = 0', () => {
    expect(isSpeaking(0, 0.01)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeSpeakingSmoother — histeresis + attack/release
// ---------------------------------------------------------------------------
describe('makeSpeakingSmoother', () => {
  it('inicia en silencio', () => {
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 3, release: 3 });
    expect(smooth(0)).toBe(false);
  });

  it('activa despues de N muestras consecutivas sobre el umbral (attack)', () => {
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 3, release: 3 });
    expect(smooth(0.2)).toBe(false); // 1 muestra activa → aun no activa
    expect(smooth(0.2)).toBe(false); // 2 muestras activas → aun no activa
    expect(smooth(0.2)).toBe(true); // 3 muestras activas → activa
  });

  it('no activa si la secuencia activa se interrumpe antes de completar attack', () => {
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 3, release: 3 });
    smooth(0.2); // 1
    smooth(0.2); // 2
    smooth(0.0); // resetea el contador
    smooth(0.2); // 1 de nuevo
    smooth(0.2); // 2 — aun no activa
    expect(smooth(0.0)).toBe(false); // nunca llego a 3 consecutivas
  });

  it('permanece activo con una muestra baja aislada (evita parpadeo)', () => {
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 1, release: 3 });
    smooth(0.2); // activa en muestra 1 (attack=1)
    expect(smooth(0.0)).toBe(true); // 1 muestra baja — aun activa
    expect(smooth(0.0)).toBe(true); // 2 muestras bajas — aun activa
    expect(smooth(0.0)).toBe(false); // 3 muestras bajas → desactiva (release=3)
  });

  it('desactiva usando el umbral de histeresis (60% del umbral de activacion)', () => {
    // Con threshold=0.1, releaseThreshold=0.06
    // rms=0.07 esta entre releaseThreshold y threshold → no activa NI desactiva
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 1, release: 2 });
    smooth(0.2); // activa
    expect(smooth(0.07)).toBe(true); // 0.07 > 0.06 → no empieza release
    expect(smooth(0.07)).toBe(true); // sigue activo
    expect(smooth(0.05)).toBe(true); // 0.05 <= 0.06 → empieza release (1/2)
    expect(smooth(0.05)).toBe(false); // release completo (2/2)
  });

  it('multiples instancias son independientes', () => {
    const s1 = makeSpeakingSmoother({ threshold: 0.1, attack: 1, release: 1 });
    const s2 = makeSpeakingSmoother({ threshold: 0.1, attack: 1, release: 1 });
    s1(0.2); // activa s1
    expect(s1(0.0)).toBe(false); // desactiva s1
    expect(s2(0.0)).toBe(false); // s2 nunca se activo
  });

  it('con attack=1 y release=1 se comporta como isSpeaking simple con histeresis', () => {
    const smooth = makeSpeakingSmoother({ threshold: 0.1, attack: 1, release: 1 });
    // Activar
    expect(smooth(0.2)).toBe(true);
    // Muestra entre releaseThreshold(0.06) y threshold(0.1) → se mantiene activo
    expect(smooth(0.08)).toBe(true);
    // Muestra bajo releaseThreshold → desactiva
    expect(smooth(0.05)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeRms — normalizacion de datos del AnalyserNode
// ---------------------------------------------------------------------------
describe('computeRms', () => {
  it('retorna 0 para un array vacio', () => {
    expect(computeRms(new Uint8Array(0))).toBe(0);
  });

  it('retorna 0 para silencio puro (todos los valores = 128)', () => {
    const data = new Uint8Array(256).fill(128);
    expect(computeRms(data)).toBe(0);
  });

  it('retorna 1 para amplitud maxima positiva (255)', () => {
    // (255 - 128) / 128 ≈ 0.992; RMS de una muestra = ese valor
    const data = new Uint8Array(1).fill(255);
    const rms = computeRms(data);
    expect(rms).toBeGreaterThan(0.99);
    expect(rms).toBeLessThanOrEqual(1);
  });

  it('retorna el mismo valor para amplitud maxima negativa (0)', () => {
    // (0 - 128) / 128 = -1
    const data = new Uint8Array(1).fill(0);
    const rms = computeRms(data);
    expect(rms).toBeCloseTo(1, 2);
  });

  it('calcula correctamente para una señal cuadrada de amplitud 0.5', () => {
    // Valores alternando 192 (= 128 + 64 → 0.5) y 64 (= 128 - 64 → -0.5)
    const data = new Uint8Array(4);
    data[0] = 192;
    data[1] = 64;
    data[2] = 192;
    data[3] = 64;
    const rms = computeRms(data);
    expect(rms).toBeCloseTo(0.5, 2);
  });
});
