# Afinador: migración del detector a AudioWorklet — Mini-Spec (mejora opcional)

> Refinado vía `/last30days` el 2026-06-09. Rama: `beta-stems`. **No bloqueante.**
> Este spec es una mejora de arquitectura sobre el afinador ya existente; los planes
> de afinador del wave (`2026-06-09-afinador-entrenamiento.md`, `-validacion-calibracion.md`)
> NO dependen de esto y funcionan con el detector actual.

## Motivación (estado de la industria 2026)

El detector actual (`src/lib/pitch.js`) corre el algoritmo **YIN** en el **hilo principal**, leyendo de un `AnalyserNode` por intervalo (~30 Hz). Funciona, pero:

- El cómputo de pitch compite con el render de la UI → jank bajo carga (animación de aguja, gauge, runner de entrenamiento).
- El consenso 2026 para pitch-detection en browser es correr el DSP en un **AudioWorklet** (hilo de audio dedicado), separado del hilo de UI. YIN sigue siendo el algoritmo recomendado por balance precisión/velocidad; su debilidad (saltos ocasionales de octava) ya la mitiga nuestro `pitchStabilizer` (mediana + EMA).

**Objetivo:** mover el cálculo de YIN a un `AudioWorkletProcessor`, dejando que `pitch.js` solo orqueste y reciba `{hz, rms}` por mensaje, **sin cambiar** la interfaz pública `createPitchDetector` ni `pitchStabilizer`/`Tuner.js`.

## Alcance

- **Dentro:** nuevo `src/lib/pitchWorklet.js` (processor), refactor interno de `createPitchDetector` para usar `AudioWorkletNode` cuando esté disponible, fallback al camino `AnalyserNode` actual.
- **Fuera:** WASM/Rust (over-engineering para este caso), cambiar de YIN a MPM/pitchy, tocar la UI o el estabilizador.

## Arquitectura

```
getUserMedia → MediaStreamSource ─┐
                                  ├─ AudioWorkletNode('yin-processor')
                                  │     (hilo de audio: acumula frames de 128,
                                  │      cada ~fftSize corre detectPitch/YIN,
                                  │      postMessage({hz, rms}) ~30 Hz)
                                  │            │ port.onmessage
                                  └────────────┴──→ onPitch({hz, rms})  (igual que hoy)
```

- El **algoritmo YIN se comparte**: extraer la función pura `detectPitch(buffer, sampleRate, opts)` de `pitch.js` a un módulo importable por el worklet (los AudioWorklets no comparten scope; se importa vía `import` dentro del módulo del processor, que Vite empaqueta).
- El worklet emite el mismo shape `{hz, rms}` que hoy consume `stabilizer.push(payload)` → **cero cambios aguas abajo** (calibración de la Task 3 del Grupo B sigue aplicándose igual en `onPitch`).

## Módulo nuevo: `src/lib/pitchWorklet.js`

```js
/**
 * pitchWorklet.js — AudioWorkletProcessor que corre YIN en el hilo de audio.
 * Se registra con registerProcessor('yin-processor'). Importa la misma
 * función pura detectPitch usada por el camino AnalyserNode (fallback).
 */
import { detectPitch } from './pitchCore.js'; // detectPitch extraído de pitch.js

class YinProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.fftSize = opts.fftSize ?? 2048;
    this.minIntervalSec = (opts.intervalMs ?? 33) / 1000;
    this.buf = new Float32Array(this.fftSize);
    this.filled = 0;
    this.lastEmit = 0;
    this.detectOpts = opts.detectOpts ?? {};
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true; // sin audio: mantener vivo el processor
    const channel = input[0]; // 128 samples
    for (let i = 0; i < channel.length; i++) {
      this.buf[this.filled++] = channel[i];
      if (this.filled >= this.fftSize) {
        const now = currentTime; // global del scope del worklet
        if (now - this.lastEmit >= this.minIntervalSec) {
          let sum = 0;
          for (let k = 0; k < this.fftSize; k++) sum += this.buf[k] * this.buf[k];
          const rms = Math.sqrt(sum / this.fftSize);
          const hz = detectPitch(this.buf, sampleRate, this.detectOpts); // sampleRate: global
          this.port.postMessage({ hz: hz ?? null, rms });
          this.lastEmit = now;
        }
        this.filled = 0; // ventana no solapada (igual que el camino actual)
      }
    }
    return true;
  }
}

registerProcessor('yin-processor', YinProcessor);
```

## Refactor de `src/lib/pitch.js`

1. **Extraer** `detectPitch` (y constantes YIN) a `src/lib/pitchCore.js` (puro, sin DOM ni Web Audio). `pitch.js` y `pitchWorklet.js` lo importan. Los tests existentes (`tests/pitch.test.js`) pasan a importar de `pitchCore.js` (re-exportar desde `pitch.js` para no romper imports externos).
2. En `createPitchDetector(...)`, dentro de `start()`:
   - Cargar el módulo del worklet: `await audioCtx.audioWorklet.addModule(new URL('./pitchWorklet.js', import.meta.url))`.
   - Crear `const node = new AudioWorkletNode(audioCtx, 'yin-processor', { processorOptions: { fftSize, intervalMs, detectOpts } })`.
   - `source.connect(node)` (no hace falta `node.connect(destination)`; el processor no produce salida audible).
   - `node.port.onmessage = (e) => onPitch(e.data)`.
   - **Fallback:** si `audioCtx.audioWorklet` es undefined o `addModule` lanza (Safari viejo, contexto no seguro), caer al camino `AnalyserNode + intervalo` actual. Conservar ese código como `startWithAnalyser()`.
3. `stop()` desconecta el node y cierra el stream igual que hoy.

`shouldAutoStartMic` y la interfaz pública (`onPitch/onError/onState`) **no cambian**.

## Fallback y compatibilidad

- AudioWorklet requiere contexto seguro (HTTPS/localhost) — ya garantizado en prod (Vercel) y dev.
- iOS Safari soporta AudioWorklet desde hace años; aun así, el fallback `AnalyserNode` cubre cualquier entorno donde `addModule` falle. El gate de permiso de mic existente sigue como está.

## Testing

- `pitchCore.js` se testea con los tests actuales de `detectPitch` (mover/duplicar `tests/pitch.test.js`).
- El processor NO es testeable en jsdom (no hay `AudioWorkletGlobalScope`). Cobertura:
  - Test unitario del **wiring** de `createPitchDetector` con un mock de `audioCtx.audioWorklet.addModule` + `AudioWorkletNode` (verifica que se usa el worklet cuando existe y el fallback cuando no).
  - Verificación manual en browser: la aguja se mueve fluida sin jank durante el modo Entrenar.

## Criterios de aceptación

- `createPitchDetector` usa AudioWorklet cuando está disponible; cae a AnalyserNode si no.
- Misma salida `{hz, rms}` → `pitchStabilizer`, calibración y los 5 modos del afinador funcionan sin cambios.
- `pnpm vitest run` y `pnpm lint` verdes.
- Mejora perceptible de fluidez de la aguja bajo carga (verificación manual).

## Esfuerzo estimado

Pequeño: 1 módulo nuevo + extraer 1 función + ~30 líneas de refactor con fallback. Candidato a su propio writing-plan corto (4-5 tasks TDD) si se decide ejecutar; por ahora queda como mejora opcional documentada en la rama.
