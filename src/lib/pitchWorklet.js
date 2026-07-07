/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pitchWorklet.js — AudioWorkletProcessor 'yin-processor'.
 * Corre YIN en el hilo de audio con ventana solapada (fftSize 2048, hop 512
 * por defecto): analiza una ventana por cada hop (~86-94 Hz) y agrega los
 * resultados del intervalo (mediana de hz/confidence, último rms) para emitir
 * un único mensaje cada ~intervalMs por el port, sin subir la tasa de
 * mensajes hacia la UI. `currentTime` y `sampleRate` son globales del
 * AudioWorkletGlobalScope.
 */
import { analyzeBuffer, createOverlapWindower } from './pitchCore.js';

// Tope de análisis agregados por intervalo (holgado: a 44.1kHz/hop 512 caben
// ~2-3 por intervalo de 33ms). Arrays de tamaño fijo: sin allocaciones por frame.
const MAX_AGG = 8;

/**
 * Mediana in-place de los primeros `count` elementos de `arr` (los reordena).
 * Insertion sort: sin allocaciones, apropiado para los arrays pequeños (≤8)
 * que agrega este processor entre emisiones.
 * @param {Float32Array} arr
 * @param {number} count
 * @returns {number}
 */
function medianInPlace(arr, count) {
  for (let i = 1; i < count; i++) {
    const v = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > v) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = v;
  }
  const mid = count >> 1;
  return count % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

class YinProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.minInterval = (o.intervalMs ?? 33) / 1000;
    this.detectOpts = o.detectOpts ?? {};
    this.windower = createOverlapWindower(o.fftSize ?? 2048, o.hop ?? 512);
    this.lastEmit = 0;
    // acumuladores del intervalo en curso (reseteados tras cada emisión).
    this.hzAgg = new Float32Array(MAX_AGG);
    this.confAgg = new Float32Array(MAX_AGG);
    this.aggCount = 0;
    this.lastRms = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true; // sin audio: mantener vivo el processor
    const window = this.windower.push(ch);
    if (window) {
      const { hz, rms, confidence } = analyzeBuffer(window, sampleRate, this.detectOpts);
      this.lastRms = rms;
      if (hz !== null && this.aggCount < MAX_AGG) {
        this.hzAgg[this.aggCount] = hz;
        this.confAgg[this.aggCount] = confidence;
        this.aggCount++;
      }
    }
    if (currentTime - this.lastEmit >= this.minInterval) {
      this.lastEmit = currentTime;
      const hz = this.aggCount > 0 ? medianInPlace(this.hzAgg, this.aggCount) : null;
      const confidence = this.aggCount > 0 ? medianInPlace(this.confAgg, this.aggCount) : 0;
      this.port.postMessage({ hz, rms: this.lastRms, confidence });
      this.aggCount = 0;
    }
    return true;
  }
}

registerProcessor('yin-processor', YinProcessor);
