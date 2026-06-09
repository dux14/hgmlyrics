# Afinador: detector en AudioWorklet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GUARD DE RAMA (obligatorio):** todo el trabajo va en la rama `beta-stems`. Antes de CUALQUIER edición ejecuta `git branch --show-current`; si no estás en `beta-stems`, haz `git checkout beta-stems`. NUNCA commitees a `master`.

**Goal:** Mover el cálculo de pitch (YIN) del hilo principal a un **AudioWorklet** (hilo de audio dedicado), eliminando el jank de UI bajo carga, sin cambiar la interfaz pública `createPitchDetector` ni nada aguas abajo (`pitchStabilizer`, calibración, `Tuner.js`).

**Architecture:** Se extrae toda la lógica pura de `pitch.js` a un nuevo `src/lib/pitchCore.js` (YIN + análisis de buffer + ventaneo de frames), que importan tanto el worklet como el camino de fallback. `src/lib/pitchWorklet.js` es un `AudioWorkletProcessor` que acumula frames de 128 muestras, corre YIN en el hilo de audio y emite `{hz, rms}` por `port`. `createPitchDetector` intenta el camino worklet y cae al `AnalyserNode` actual si el worklet no está disponible.

**Tech Stack:** Vanilla JS + Vite (soporta `new URL('./worklet.js', import.meta.url)` para AudioWorklets), Web Audio API (`AudioWorkletNode`/`AudioWorkletProcessor`), Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-09-afinador-audioworklet-migracion-spec.md`

**Convenciones del repo que DEBES seguir:**
- `pnpm` siempre, nunca `npm`/`yarn`.
- Tests en `tests/*.test.js`; módulos puros con import directo (patrón de `tests/pitch.test.js`).
- Comentarios y copy de UI en español; código (nombres) en inglés.
- Prettier: singleQuote, printWidth 100. `pnpm lint` antes de cada commit.
- **Todos los commits terminan con la línea:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/pitchCore.js` | Create | Lógica pura: `detectPitch` (YIN) + constantes + `analyzeBuffer` + `createWindower` |
| `src/lib/pitch.js` | Modify | Re-exporta `detectPitch` desde core; `createPitchDetector` usa AudioWorklet con fallback |
| `src/lib/pitchWorklet.js` | Create | `AudioWorkletProcessor` `yin-processor` que corre YIN en el hilo de audio |
| `tests/pitchCore.test.js` | Create | `analyzeBuffer` y `createWindower` |
| `tests/pitchDetector.test.js` | Create | Wiring: usa worklet si existe, fallback a AnalyserNode si no |
| `tests/pitch.test.js` | Modify | Importa `detectPitch` desde `pitchCore.js` (sigue pasando vía re-export de `pitch.js`) |

---

### Task 0: Verificar rama

- [ ] **Step 1: Confirmar `beta-stems`**

```bash
cd /Users/samu/code/personal/Mark-N-Hkl/hgmlyrics
git branch --show-current   # Expected: beta-stems
```

---

### Task 1: Extraer `detectPitch` + constantes a `pitchCore.js`

**Files:**
- Create: `src/lib/pitchCore.js`
- Modify: `src/lib/pitch.js`
- Test: `tests/pitchCore.test.js`

- [ ] **Step 1: Escribir el test que falla (import directo desde core)**

```js
// tests/pitchCore.test.js
import { describe, it, expect } from 'vitest';
import { detectPitch } from '../src/lib/pitchCore.js';

const SAMPLE_RATE = 44100;
const SAMPLES = 2048;
function sine(freq, n = SAMPLES, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
  return out;
}

describe('pitchCore.detectPitch', () => {
  it('detecta A4 (440Hz) con < 5 cents de error', () => {
    const hz = detectPitch(sine(440), SAMPLE_RATE);
    expect(hz).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);
  });
  it('rechaza el silencio', () => {
    expect(detectPitch(new Float32Array(SAMPLES), SAMPLE_RATE)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/pitchCore.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/pitchCore.js"`.

- [ ] **Step 3: Crear `pitchCore.js` moviendo `detectPitch` y constantes**

Mover desde `src/lib/pitch.js` el bloque de constantes (`DEFAULT_THRESHOLD`, `DEFAULT_MIN_HZ`, `DEFAULT_MAX_HZ`, `DEFAULT_RMS_GATE`) y la función `detectPitch` COMPLETA tal cual está (sin cambios de lógica) a un nuevo archivo:

```js
// src/lib/pitchCore.js
/**
 * pitchCore.js — DSP puro del afinador (sin DOM ni Web Audio).
 * Importado por pitch.js (camino AnalyserNode) y por pitchWorklet.js (hilo de audio).
 *
 * Referencia: de Cheveigné & Kawahara (2002), "YIN, a fundamental frequency
 * estimator for speech and music." J. Acoust. Soc. Am. 111(4).
 */

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_MIN_HZ = 60;
const DEFAULT_MAX_HZ = 1500;
const DEFAULT_RMS_GATE = 0.005;

/**
 * Detecta la frecuencia fundamental en un buffer. null si no hay pitch confiable.
 * @param {Float32Array|number[]} buffer Muestras mono en [-1, 1].
 * @param {number} sampleRate
 * @param {{ threshold?: number, minHz?: number, maxHz?: number, rmsGate?: number }} [opts]
 * @returns {number | null} Frecuencia en Hz, o null.
 */
export function detectPitch(buffer, sampleRate, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const minHz = opts.minHz ?? DEFAULT_MIN_HZ;
  const maxHz = opts.maxHz ?? DEFAULT_MAX_HZ;
  const rmsGate = opts.rmsGate ?? DEFAULT_RMS_GATE;
  const N = buffer.length;
  if (N < 64 || !Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  let rms = 0;
  for (let i = 0; i < N; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / N);
  if (rms < rmsGate) return null;

  const halfN = Math.floor(N / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(halfN - 1, Math.floor(sampleRate / minHz));
  if (tauMax <= tauMin) return null;

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < halfN; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += d[tau];
    cmnd[tau] = (d[tau] * tau) / (runningSum || 1);
  }

  let tauEstimate = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return null;

  let betterTau = tauEstimate;
  const x0 = tauEstimate > 0 ? cmnd[tauEstimate - 1] : cmnd[tauEstimate];
  const x1 = cmnd[tauEstimate];
  const x2 = tauEstimate < tauMax ? cmnd[tauEstimate + 1] : cmnd[tauEstimate];
  const denom = x0 + x2 - 2 * x1;
  if (Math.abs(denom) > 1e-9) {
    const shift = (x0 - x2) / (2 * denom);
    if (Math.abs(shift) < 1) betterTau = tauEstimate + shift;
  }

  return sampleRate / betterTau;
}
```

En `src/lib/pitch.js`: borrar las constantes y la función `detectPitch` movidas, y al inicio (tras el comentario de cabecera) importar + re-exportar para no romper imports externos (`Tuner.js`, `tests/pitch.test.js`):

```js
import { detectPitch } from './pitchCore.js';
export { detectPitch } from './pitchCore.js';
```

> `createPitchDetector` y `shouldAutoStartMic` permanecen en `pitch.js`. La llamada interna `detectPitch(buffer, ctx.sampleRate)` ahora resuelve al import de core.

- [ ] **Step 4: Correr y verificar que pasa (core + suite existente)**

Run: `pnpm vitest run tests/pitchCore.test.js tests/pitch.test.js`
Expected: PASS — `tests/pitch.test.js` sigue verde porque `pitch.js` re-exporta `detectPitch`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchCore.js src/lib/pitch.js tests/pitchCore.test.js
git commit -m "refactor(afinador): extrae detectPitch puro a pitchCore.js"
```

---

### Task 2: `analyzeBuffer` en `pitchCore.js`

**Files:**
- Modify: `src/lib/pitchCore.js`
- Test: `tests/pitchCore.test.js`

> DRY: hoy el tick del detector calcula RMS y llama a `detectPitch` por separado. `analyzeBuffer` unifica eso y lo comparten el worklet y el fallback.

- [ ] **Step 1: Añadir el test que falla**

```js
// tests/pitchCore.test.js (añadir)
import { analyzeBuffer } from '../src/lib/pitchCore.js';

describe('analyzeBuffer', () => {
  it('devuelve { hz, rms } para un seno A4', () => {
    const { hz, rms } = analyzeBuffer(sine(440), SAMPLE_RATE);
    expect(Math.abs(1200 * Math.log2(hz / 440))).toBeLessThan(5);
    expect(rms).toBeGreaterThan(0.3); // amp 0.5 → rms ≈ 0.354
  });
  it('hz null pero rms reportado en silencio', () => {
    const { hz, rms } = analyzeBuffer(new Float32Array(SAMPLES), SAMPLE_RATE);
    expect(hz).toBeNull();
    expect(rms).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/pitchCore.test.js -t analyzeBuffer`
Expected: FAIL — `analyzeBuffer is not a function`.

- [ ] **Step 3: Implementar `analyzeBuffer`**

```js
// src/lib/pitchCore.js (añadir al final)
/**
 * Calcula RMS y pitch de un buffer en una sola pasada de conveniencia.
 * Reporta rms SIEMPRE (incluso si hz es null), igual que el tick actual.
 * @param {Float32Array|number[]} buffer
 * @param {number} sampleRate
 * @param {object} [opts] - mismas opciones que detectPitch
 * @returns {{ hz: number|null, rms: number }}
 */
export function analyzeBuffer(buffer, sampleRate, opts = {}) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = buffer.length ? Math.sqrt(sum / buffer.length) : 0;
  const hz = detectPitch(buffer, sampleRate, opts);
  return { hz, rms };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/pitchCore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchCore.js tests/pitchCore.test.js
git commit -m "feat(afinador): analyzeBuffer (rms + pitch) compartido"
```

---

### Task 3: `createWindower` en `pitchCore.js`

**Files:**
- Modify: `src/lib/pitchCore.js`
- Test: `tests/pitchCore.test.js`

> El worklet recibe frames de 128 muestras; necesita acumularlos hasta `fftSize`. Esa lógica se factoriza pura y testeable (el `AudioWorkletGlobalScope` no existe en jsdom).

- [ ] **Step 1: Añadir el test que falla**

```js
// tests/pitchCore.test.js (añadir)
import { createWindower } from '../src/lib/pitchCore.js';

describe('createWindower', () => {
  it('devuelve null hasta completar fftSize y luego una ventana llena', () => {
    const w = createWindower(256);
    const frame = new Float32Array(128).fill(0.2);
    expect(w.push(frame)).toBeNull(); // 128/256
    const out = w.push(frame); // 256/256 → ventana
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(256);
    expect(out[0]).toBeCloseTo(0.2, 6);
  });
  it('reinicia el llenado tras emitir una ventana', () => {
    const w = createWindower(256);
    const frame = new Float32Array(128).fill(0.1);
    w.push(frame);
    w.push(frame); // emite
    expect(w.push(frame)).toBeNull(); // vuelve a acumular desde 0
  });
  it('reset() limpia el acumulador', () => {
    const w = createWindower(256);
    w.push(new Float32Array(128).fill(0.5));
    w.reset();
    expect(w.push(new Float32Array(128).fill(0.5))).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/pitchCore.test.js -t createWindower`
Expected: FAIL — `createWindower is not a function`.

- [ ] **Step 3: Implementar `createWindower`**

```js
// src/lib/pitchCore.js (añadir al final)
/**
 * Acumula frames de tamaño arbitrario (el worklet entrega 128 muestras) en
 * ventanas no solapadas de `fftSize`. Devuelve una COPIA de la ventana cuando
 * se llena, o null mientras acumula.
 * @param {number} fftSize
 * @returns {{ push: (frame: Float32Array|number[]) => Float32Array|null, reset: () => void }}
 */
export function createWindower(fftSize) {
  const buf = new Float32Array(fftSize);
  let filled = 0;
  return {
    push(frame) {
      let out = null;
      for (let i = 0; i < frame.length; i++) {
        buf[filled++] = frame[i];
        if (filled >= fftSize) {
          out = buf.slice(0);
          filled = 0;
        }
      }
      return out;
    },
    reset() {
      filled = 0;
    },
  };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/pitchCore.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitchCore.js tests/pitchCore.test.js
git commit -m "feat(afinador): createWindower para acumular frames del worklet"
```

---

### Task 4: `pitchWorklet.js` — el processor

**Files:**
- Create: `src/lib/pitchWorklet.js`

> El processor corre en `AudioWorkletGlobalScope` (no testeable en jsdom). Su lógica pura (ventaneo + análisis) ya está cubierta por las Tasks 2-3. Aquí solo se ensambla. Verificación: lint + check manual en browser (Task 6).

- [ ] **Step 1: Implementar el processor**

```js
// src/lib/pitchWorklet.js
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
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: sin errores. (ESLint puede no conocer `AudioWorkletProcessor`/`registerProcessor`/`currentTime`/`sampleRate`; si marca `no-undef`, añadir un comentario `/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */` al inicio del archivo.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pitchWorklet.js
git commit -m "feat(afinador): AudioWorkletProcessor yin-processor"
```

---

### Task 5: `createPitchDetector` usa AudioWorklet con fallback

**Files:**
- Modify: `src/lib/pitch.js`
- Test: `tests/pitchDetector.test.js`

- [ ] **Step 1: Escribir el test de wiring que falla**

```js
// tests/pitchDetector.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPitchDetector } from '../src/lib/pitch.js';

function fakeAudio({ withWorklet }) {
  const node = { port: { onmessage: null, postMessage: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
  };
  const ctx = {
    state: 'running',
    sampleRate: 44100,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  };
  if (withWorklet) {
    ctx.audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    globalThis.AudioWorkletNode = vi.fn(() => node);
  } else {
    globalThis.AudioWorkletNode = undefined;
  }
  window.AudioContext = vi.fn(() => ctx);
  navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  };
  return { ctx, node, analyser };
}

beforeEach(() => {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
});
afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.AudioWorkletNode;
});

describe('createPitchDetector — camino AudioWorklet', () => {
  it('carga el módulo, crea el AudioWorkletNode y enruta port.onmessage a onPitch', async () => {
    const { ctx, node, analyser } = fakeAudio({ withWorklet: true });
    const onPitch = vi.fn();
    const det = createPitchDetector({ onPitch });
    await det.start();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalled();
    expect(globalThis.AudioWorkletNode).toHaveBeenCalledWith(ctx, 'yin-processor', expect.any(Object));
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled(); // no usó el fallback
    // Simula un mensaje del worklet:
    node.port.onmessage({ data: { hz: 440, rms: 0.2 } });
    expect(onPitch).toHaveBeenCalledWith({ hz: 440, rms: 0.2 });
    det.stop();
  });
});

describe('createPitchDetector — fallback AnalyserNode', () => {
  it('si no hay AudioWorklet, usa createAnalyser', async () => {
    const { ctx } = fakeAudio({ withWorklet: false });
    const det = createPitchDetector({ onPitch: vi.fn() });
    await det.start();
    expect(ctx.createAnalyser).toHaveBeenCalled();
    det.stop();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/pitchDetector.test.js`
Expected: FAIL — hoy `createPitchDetector` siempre usa `createAnalyser`; el primer test falla en `addModule`/`AudioWorkletNode`.

- [ ] **Step 3: Refactor de `createPitchDetector`**

En `src/lib/pitch.js`, reemplazar el cuerpo de `start()` para intentar el worklet y caer al analyser. Extraer el bucle actual del AnalyserNode a `startWithAnalyser()` (es el código que ya existe, sin cambios de lógica) y añadir `startWithWorklet()`:

```js
  async function start() {
    if (running) return;
    onState('requesting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false },
      });
    } catch (e) {
      onState('denied');
      onError(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);

    // Camino moderno: YIN en el hilo de audio. Si falla, fallback a AnalyserNode.
    if (ctx.audioWorklet && typeof globalThis.AudioWorkletNode === 'function') {
      try {
        await ctx.audioWorklet.addModule(new URL('./pitchWorklet.js', import.meta.url));
        workletNode = new globalThis.AudioWorkletNode(ctx, 'yin-processor', {
          processorOptions: { fftSize, intervalMs },
        });
        workletNode.port.onmessage = (e) => onPitch(e.data);
        // Mantener vivo el grafo (quirk iOS) con una ganancia silenciosa.
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(silentGain);
        silentGain.connect(ctx.destination);
        if (ctx.state === 'suspended') await ctx.resume();
        running = true;
        onState('running');
        return;
      } catch (e) {
        console.warn('[tuner] AudioWorklet no disponible, usando AnalyserNode:', e);
        if (workletNode) {
          workletNode.disconnect();
          workletNode = null;
        }
      }
    }

    startWithAnalyser(source);
  }

  function startWithAnalyser(source) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(ctx.destination);
    buffer = new Float32Array(analyser.fftSize);

    running = true;
    onState('running');
    const tick = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        const hz = detectPitch(buffer, ctx.sampleRate);
        onPitch({ hz: hz !== null ? hz : null, rms });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
```

Declarar `workletNode` junto al resto del estado del closure (con `let ctx = null; ...`):

```js
  let workletNode = null;
```

Y en `stop()`, desconectar el worklet además de lo actual:

```js
  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (workletNode) {
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      workletNode = null;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    analyser = null;
    buffer = null;
    onState('stopped');
  }
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/pitchDetector.test.js`
Expected: PASS (ambos describe).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pitch.js tests/pitchDetector.test.js
git commit -m "feat(afinador): createPitchDetector usa AudioWorklet con fallback a AnalyserNode"
```

---

### Task 6: Verificación final (suite + browser)

**Files:**
- (verificación; sin cambios salvo ajustes de lint)

- [ ] **Step 1: Suite completa + lint**

Run: `pnpm vitest run`
Expected: PASS (incluye `pitch.test.js`, `pitchCore.test.js`, `pitchDetector.test.js`, `tuner.test.js` y el resto).

Run: `pnpm lint`
Expected: sin errores.

- [ ] **Step 2: Verificación manual en browser**

Run: `pnpm dev`, navegar a `#/afinador`:
- Conceder micrófono. La aguja y la lectura responden igual que antes (mismo `{hz, rms}` → `pitchStabilizer`).
- En DevTools → Performance/Console: no aparece el warning de fallback en navegadores modernos (Chrome/Safari recientes) → confirma que corre el worklet.
- Forzar el fallback (DevTools console: `delete AudioWorklet`) y recargar → el afinador sigue funcionando vía AnalyserNode (warning esperado en consola).
- Modo Voz y modo Entrenar: la aguja fluye sin jank durante animaciones.

- [ ] **Step 3: Commit (si hubo ajustes de lint)**

```bash
git add -A
git commit -m "chore(afinador): ajustes de lint del camino AudioWorklet"
```

---

## Notas

- **Sin cambios aguas abajo:** `pitchStabilizer.push({hz, rms})`, la calibración del Grupo B (que envuelve `onPitch` en `Tuner.js`) y los 5 modos del afinador siguen recibiendo el mismo payload. Esta migración es puramente de dónde corre el DSP.
- **Vite + worklet:** `new URL('./pitchWorklet.js', import.meta.url)` es el patrón soportado por Vite para empaquetar el módulo del worklet (lo emite como asset y resuelve la URL en build). No requiere config extra.
- **Compatibilidad:** AudioWorklet exige contexto seguro (HTTPS/localhost), ya garantizado. El fallback cubre cualquier entorno donde `addModule` falle.
