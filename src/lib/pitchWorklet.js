/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
/**
 * pitchWorklet.js — AudioWorkletProcessor 'yin-processor'.
 * Corre YIN en el hilo de audio: acumula frames de 128 muestras hasta fftSize,
 * y a ~intervalMs emite { hz, rms } por el port. `currentTime` y `sampleRate`
 * son globales del AudioWorkletGlobalScope.
 */
import { analyzeBuffer, createWindower } from './pitchCore.js';

class YinProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    this.minInterval = (o.intervalMs ?? 33) / 1000;
    this.detectOpts = o.detectOpts ?? {};
    this.windower = createWindower(o.fftSize ?? 2048);
    this.lastEmit = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true; // sin audio: mantener vivo el processor
    const window = this.windower.push(ch);
    if (window && currentTime - this.lastEmit >= this.minInterval) {
      this.lastEmit = currentTime;
      const { hz, rms } = analyzeBuffer(window, sampleRate, this.detectOpts);
      this.port.postMessage({ hz: hz ?? null, rms });
    }
    return true;
  }
}

registerProcessor('yin-processor', YinProcessor);
