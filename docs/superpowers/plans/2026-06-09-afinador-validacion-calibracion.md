# Afinador — Validación y calibración de nota real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GUARD DE RAMA (obligatorio):** todo el trabajo va en la rama `beta-stems`. Antes de CUALQUIER edición ejecuta `git branch --show-current`; si no estás en `beta-stems`, haz `git checkout beta-stems`. NUNCA commitees a `master`.

**Goal:** Permitir comprobar que la nota detectada por el afinador corresponde a una nota "de la vida real" combinando (1) un **auto-test de loopback** —la app emite tonos conocidos, el micrófono los capta y se mide el offset en cents— y (2) una **calibración manual** persistida (offset en cents + control de A4), que se aplica al hz entrante antes de estabilizar.

**Architecture:** `calibration.js` (puro) persiste el offset en `localStorage` y convierte entre cents y A4; `loopbackTest.js` (puro) calcula el offset mediano de un set de mediciones y orquesta la reproducción/captura usando `tonePlayer.js` (creado en el Grupo A) y el `createPitchDetector` existente. `Tuner.js` aplica `applyCalibration(hz)` en un único punto antes de `stabilizer.push` y añade un modo `calibrar` con el auto-test y los controles manuales.

**Tech Stack:** Vanilla JS + Vite, Web Audio API, `localStorage`, Vitest + jsdom. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-09-afinador-entrenamiento-validacion-y-fix-logout-design.md`

**Dependencia:** usa `src/lib/tonePlayer.js`. Si el Grupo A aún no se implementó, ejecuta antes su **Task 6** (crea `tonePlayer.js` + `tests/tonePlayer.test.js`) — está reproducida en el Anexo A al final de este plan.

**Convenciones del repo que DEBES seguir:**
- `pnpm` siempre, nunca `npm`/`yarn`.
- Tests en `tests/*.test.js`. Módulos puros: import directo. Para `localStorage` en jsdom: disponible por defecto; limpiar con `localStorage.clear()` en `beforeEach`.
- Comentarios y copy de UI en español; código (nombres) en inglés.
- Prettier: singleQuote, printWidth 100. `pnpm lint` antes de cada commit.
- A4 = 440 Hz / MIDI 69. cents = `1200 * log2(f / ref)`.
- **Todos los commits terminan con la línea:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/calibration.js` | Create | Persistencia del offset en cents, `applyCalibration`, conversión cents↔A4 |
| `src/lib/loopbackTest.js` | Create | `medianOffsetCents` (puro) + orquestador `runLoopbackTest` |
| `src/components/Tuner.js` | Modify | Aplicar calibración al hz entrante + modo `calibrar` (UI) |
| `tests/calibration.test.js` | Create | applyCalibration, centsToA4/a4ToCents, persistencia |
| `tests/loopbackTest.test.js` | Create | medianOffsetCents con varios sets |

---

### Task 0: Verificar rama y dependencia

- [ ] **Step 1: Confirmar `beta-stems`**

```bash
cd /Users/samu/code/personal/Mark-N-Hkl/hgmlyrics
git branch --show-current   # Expected: beta-stems
```

- [ ] **Step 2: Confirmar que existe `tonePlayer.js`**

Run: `ls src/lib/tonePlayer.js`
Expected: el archivo existe. Si NO existe, ejecuta primero el **Anexo A** de este plan (crea `tonePlayer.js` + su test) y luego continúa.

---

### Task 1: `calibration.js` — persistencia y `applyCalibration`

**Files:**
- Create: `src/lib/calibration.js`
- Test: `tests/calibration.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/calibration.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CAL_KEY,
  getCalibrationCents,
  setCalibrationCents,
  applyCalibration,
  centsToA4,
  a4ToCents,
} from '../src/lib/calibration.js';

describe('calibración: persistencia', () => {
  beforeEach(() => localStorage.clear());

  it('default 0 cuando no hay nada guardado', () => {
    expect(getCalibrationCents()).toBe(0);
  });

  it('persiste y recupera el offset', () => {
    setCalibrationCents(12);
    expect(getCalibrationCents()).toBe(12);
    expect(localStorage.getItem(CAL_KEY)).toBe('12');
  });

  it('hace clamp a [-100, 100]', () => {
    setCalibrationCents(999);
    expect(getCalibrationCents()).toBe(100);
    setCalibrationCents(-999);
    expect(getCalibrationCents()).toBe(-100);
  });

  it('valores corruptos en storage vuelven a 0', () => {
    localStorage.setItem(CAL_KEY, 'basura');
    expect(getCalibrationCents()).toBe(0);
  });
});

describe('applyCalibration', () => {
  it('con 0 cents no cambia el hz', () => {
    expect(applyCalibration(440, 0)).toBeCloseTo(440, 6);
  });

  it('si el dispositivo lee sostenido (+cents), baja el hz', () => {
    // +100 cents = un semitono; 440 debería corregirse hacia ~415.3.
    expect(applyCalibration(440, 100)).toBeCloseTo(440 * Math.pow(2, -100 / 1200), 6);
    expect(applyCalibration(440, 100)).toBeLessThan(440);
  });
});

describe('cents <-> A4', () => {
  it('centsToA4(0) = 440 y a4ToCents(440) = 0', () => {
    expect(centsToA4(0)).toBeCloseTo(440, 6);
    expect(a4ToCents(440)).toBeCloseTo(0, 6);
  });

  it('son inversas', () => {
    expect(a4ToCents(centsToA4(37))).toBeCloseTo(37, 6);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/calibration.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/calibration.js"`.

- [ ] **Step 3: Implementar `calibration.js`**

```js
// src/lib/calibration.js
/**
 * calibration.js — Calibración del afinador para compensar el desfase del
 * micrófono/dispositivo respecto a la afinación "real" (A4=440).
 * El offset se mide en cents y se persiste en localStorage.
 * Puro y síncrono (salvo el acceso a localStorage, protegido con try/catch).
 */
export const CAL_KEY = 'hkn-tuner-cal-cents';
const CAL_MIN = -100;
const CAL_MAX = 100;

function clamp(c) {
  if (!Number.isFinite(c)) return 0;
  return Math.max(CAL_MIN, Math.min(CAL_MAX, Math.round(c)));
}

/** @returns {number} Offset de calibración en cents (default 0). */
export function getCalibrationCents() {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (raw === null) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? clamp(n) : 0;
  } catch (_e) {
    return 0;
  }
}

/** @param {number} cents */
export function setCalibrationCents(cents) {
  const c = clamp(cents);
  try {
    localStorage.setItem(CAL_KEY, String(c));
  } catch (_e) {
    /* ignore */
  }
  return c;
}

/**
 * Corrige un hz detectado según el offset de calibración.
 * calCents > 0 significa que el dispositivo lee sostenido → bajamos el hz.
 * @param {number} hz
 * @param {number} calCents
 * @returns {number}
 */
export function applyCalibration(hz, calCents) {
  if (!Number.isFinite(hz) || hz <= 0 || !calCents) return hz;
  return hz * Math.pow(2, -calCents / 1200);
}

/** Frecuencia de A4 equivalente a un offset en cents. */
export function centsToA4(cents) {
  return 440 * Math.pow(2, cents / 1200);
}

/** Offset en cents equivalente a una frecuencia de A4 dada. */
export function a4ToCents(hz) {
  return 1200 * Math.log2(hz / 440);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/calibration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calibration.js tests/calibration.test.js
git commit -m "feat(afinador): calibracion persistente (cents y A4)"
```

---

### Task 2: `loopbackTest.js` — offset mediano

**Files:**
- Create: `src/lib/loopbackTest.js`
- Test: `tests/loopbackTest.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/loopbackTest.test.js
import { describe, it, expect } from 'vitest';
import { medianOffsetCents } from '../src/lib/loopbackTest.js';

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
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/loopbackTest.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/loopbackTest.js"`.

- [ ] **Step 3: Implementar `loopbackTest.js`**

```js
// src/lib/loopbackTest.js
/**
 * loopbackTest.js — Auto-test de afinación: la app emite tonos conocidos y el
 * micrófono los capta; el offset (en cents) entre lo esperado y lo detectado
 * indica el desfase del dispositivo.
 *
 * `medianOffsetCents` es puro. `runLoopbackTest` orquesta tonePlayer + detector
 * y por tanto requiere audio real (verificación manual; avisar de usar altavoz).
 */
import { noteToFrequency } from './notes.js';

/**
 * Mediana de los offsets en cents de un conjunto de mediciones.
 * @param {{ expectedHz: number, detectedHz: number }[]} measurements
 * @returns {number|null} Mediana en cents, o null si no hay muestras válidas.
 */
export function medianOffsetCents(measurements) {
  const cents = (measurements || [])
    .filter((m) => m && m.expectedHz > 0 && m.detectedHz > 0)
    .map((m) => 1200 * Math.log2(m.detectedHz / m.expectedHz))
    .sort((a, b) => a - b);
  if (cents.length === 0) return null;
  const mid = Math.floor(cents.length / 2);
  return cents.length % 2 ? cents[mid] : (cents[mid - 1] + cents[mid]) / 2;
}

/**
 * Orquesta el loopback: reproduce cada nota, recoge la detección estabilizada y
 * devuelve el offset mediano. Pensado para correr en el browser (audio real).
 * @param {{
 *   tonePlayer: { play: (hz: number, ms?: number) => void, stop: () => void },
 *   sampleDetected: (hz: number) => Promise<number|null>,
 *   notes?: string[],
 *   toneMs?: number,
 * }} opts - `sampleDetected(hz)` reproduce/espera y resuelve el hz detectado
 *   para el tono pedido (lo provee Tuner.js, que tiene el detector vivo).
 * @returns {Promise<{ ok: boolean, offsetCents: number|null, detail: object[] }>}
 */
export async function runLoopbackTest({ tonePlayer, sampleDetected, notes = ['A4', 'C4', 'E4'], toneMs = 1200 }) {
  const detail = [];
  for (const label of notes) {
    const expectedHz = noteToFrequency(label);
    tonePlayer.play(expectedHz, toneMs);
    const detectedHz = await sampleDetected(expectedHz);
    tonePlayer.stop();
    detail.push({ note: label, expectedHz, detectedHz });
  }
  const offsetCents = medianOffsetCents(
    detail.map((d) => ({ expectedHz: d.expectedHz, detectedHz: d.detectedHz })),
  );
  return { ok: offsetCents !== null, offsetCents, detail };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/loopbackTest.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loopbackTest.js tests/loopbackTest.test.js
git commit -m "feat(afinador): loopback test con offset mediano en cents"
```

---

### Task 3: `Tuner.js` — aplicar calibración al hz entrante

**Files:**
- Modify: `src/components/Tuner.js`

> Punto único de integración: corregir el hz ANTES de `stabilizer.push`, sin tocar los call-sites de `notes.js`. El tono de referencia se mantiene anclado a 440 (es el "mundo real").

- [ ] **Step 1: Importar la calibración**

Tras los imports existentes en `src/components/Tuner.js`, añadir:

```js
import { getCalibrationCents, applyCalibration } from '../lib/calibration.js';
```

- [ ] **Step 2: Aplicar el offset en el callback del detector**

En `requestMic()`, el detector se crea con `onPitch: (payload) => dispatchPitch(stabilizer.push(payload))`. Reemplazar por una versión que corrige el hz:

```js
    detector = createPitchDetector({
      onPitch: (payload) => {
        const calCents = getCalibrationCents();
        const corrected =
          payload && Number.isFinite(payload.hz) && payload.hz > 0
            ? { ...payload, hz: applyCalibration(payload.hz, calCents) }
            : payload;
        dispatchPitch(stabilizer.push(corrected));
      },
      onError: (err) => {
        console.warn('[tuner] mic error:', err);
        micState = 'denied';
        paintBody();
      },
      onState: (s) => {
        micState = s;
        if (s === 'running' || s === 'denied' || s === 'stopped') paintBody();
      },
    });
```

- [ ] **Step 3: Verificar que la suite sigue verde**

Run: `pnpm vitest run`
Expected: PASS (el cambio no rompe tests; `getCalibrationCents` devuelve 0 por defecto → sin efecto).

- [ ] **Step 4: Commit**

```bash
git add src/components/Tuner.js
git commit -m "feat(afinador): aplica el offset de calibracion al hz detectado"
```

---

### Task 4: `Tuner.js` — modo `calibrar` (UI)

**Files:**
- Modify: `src/components/Tuner.js`
- Test: `tests/tuner.test.js`

- [ ] **Step 1: Añadir el test de render del cuerpo de calibración (falla)**

```js
// tests/tuner.test.js (añadir al final)
const { bodyCalibrar } = await import('../src/components/Tuner.js');

describe('bodyCalibrar', () => {
  it('muestra el offset actual, el boton de auto-test y el control de A4', () => {
    const html = bodyCalibrar({ calCents: 0 });
    expect(html).toContain('id="cal-run"'); // "Probar afinador"
    expect(html).toContain('id="cal-a4"'); // slider de A4
    expect(html).toContain('id="cal-reset"'); // restablecer
    expect(html).toContain('440'); // A4 por defecto
  });

  it('refleja un offset aplicado', () => {
    const html = bodyCalibrar({ calCents: 12 });
    expect(html).toContain('+12');
  });

  it('no usa emojis', () => {
    expect(bodyCalibrar({ calCents: 0 })).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/tuner.test.js -t bodyCalibrar`
Expected: FAIL — `bodyCalibrar is not a function`.

- [ ] **Step 3: Añadir el modo, imports y el renderer puro**

Ampliar imports en `Tuner.js`:

```js
import { setCalibrationCents, centsToA4, a4ToCents } from '../lib/calibration.js';
import { runLoopbackTest } from '../lib/loopbackTest.js';
import { createTonePlayer } from '../lib/tonePlayer.js';
```

> Si el Grupo A ya añadió `createTonePlayer` al import, no lo dupliques.

Añadir el modo a `MODES`:

```js
  { id: 'calibrar', label: `${icon('settings', { size: 15 })} Calibrar` },
```

Renderer puro (junto a los demás `body*`):

```js
/**
 * Cuerpo del modo Calibrar: auto-test de loopback + control manual de A4.
 * Render puro (string) para testear sin DOM.
 * @param {{ calCents: number }} state
 * @returns {string}
 */
export function bodyCalibrar({ calCents }) {
  const a4 = Math.round(centsToA4(calCents));
  const signed = `${calCents > 0 ? '+' : ''}${calCents}`;
  return `
    <div class="tuner-cal">
      <p class="tuner-cal__hint">
        ${icon('info', { size: 14 })} Usá un <strong>altavoz</strong> (no audífonos) para el auto-test.
      </p>
      <div class="tuner-cal__current">Ajuste actual: <strong id="cal-current">${signed}¢</strong></div>
      <button class="btn btn--primary" id="cal-run">${icon('activity', { size: 14 })} Probar afinador</button>
      <div class="tuner-cal__result" id="cal-result" aria-live="polite"></div>

      <div class="tuner-cal__manual">
        <label for="cal-a4">A4 de referencia: <strong id="cal-a4-val">${a4} Hz</strong></label>
        <input type="range" id="cal-a4" min="415" max="466" step="1" value="${a4}" />
        <button class="btn btn--secondary btn--sm" id="cal-reset">Restablecer (440 Hz)</button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: Cablear el binder y el handler en `paintBody`**

Añadir, dentro de `renderTuner`, un binder del modo calibrar. Reutiliza el detector vivo para muestrear lo detectado durante cada tono:

```js
  function bindCalibrar() {
    const player = createTonePlayer({});
    const resultEl = bodyEl.querySelector('#cal-result');
    const currentEl = bodyEl.querySelector('#cal-current');

    // Muestrea el hz mediano detectado mientras suena `expectedHz`.
    function sampleDetected() {
      return new Promise((resolve) => {
        const samples = [];
        const onPitch = (payload) => {
          if (payload && Number.isFinite(payload.hz) && payload.hz > 0) samples.push(payload.hz);
        };
        // Engancha temporalmente al detector vivo vía el stabilizer compartido:
        capturePitch = onPitch;
        setTimeout(() => {
          capturePitch = null;
          if (samples.length === 0) return resolve(null);
          const sorted = [...samples].sort((a, b) => a - b);
          resolve(sorted[Math.floor(sorted.length / 2)]);
        }, 900);
      });
    }

    bodyEl.querySelector('#cal-run')?.addEventListener('click', async () => {
      if (micState !== 'running') {
        resultEl.textContent = 'Activá el micrófono primero.';
        return;
      }
      resultEl.textContent = 'Probando…';
      const { ok, offsetCents } = await runLoopbackTest({
        tonePlayer: player,
        sampleDetected,
      });
      if (!ok) {
        resultEl.textContent = 'No detecté los tonos. Subí el volumen y reintentá.';
        return;
      }
      const rounded = Math.round(offsetCents);
      resultEl.innerHTML = `Offset medido: <strong>${rounded > 0 ? '+' : ''}${rounded}¢</strong>
        <button class="btn btn--sm btn--primary" id="cal-apply">Aplicar ajuste</button>`;
      resultEl.querySelector('#cal-apply')?.addEventListener('click', () => {
        const c = setCalibrationCents(rounded);
        currentEl.textContent = `${c > 0 ? '+' : ''}${c}¢`;
        resultEl.textContent = 'Ajuste aplicado.';
      });
    });

    const a4Input = bodyEl.querySelector('#cal-a4');
    const a4Val = bodyEl.querySelector('#cal-a4-val');
    a4Input?.addEventListener('input', () => {
      const hz = Number(a4Input.value);
      a4Val.textContent = `${hz} Hz`;
      const c = setCalibrationCents(Math.round(a4ToCents(hz)));
      currentEl.textContent = `${c > 0 ? '+' : ''}${c}¢`;
    });

    bodyEl.querySelector('#cal-reset')?.addEventListener('click', () => {
      setCalibrationCents(0);
      paintBody();
    });
  }
```

Añadir el estado `capturePitch` junto al resto del estado de `renderTuner`:

```js
  let capturePitch = null; // hook temporal para el auto-test de calibración
```

Y en el callback `onPitch` del detector (modificado en la Task 3), enrutar también al captador cuando esté activo. Dentro de `onPitch`, antes de `dispatchPitch(...)`:

```js
        if (capturePitch && payload) capturePitch(payload);
```

En `paintBody`, añadir la rama:

```js
    } else if (mode === 'calibrar') {
      bodyEl.innerHTML = bodyCalibrar({ calCents: getCalibrationCents() });
      bindCalibrar();
    }
```

- [ ] **Step 5: Verificar suite + lint**

Run: `pnpm vitest run`
Expected: PASS.

Run: `pnpm lint`
Expected: sin errores.

- [ ] **Step 6: Verificación manual (browser)**

Run: `pnpm dev`, ir a `#/afinador` → pestaña **Calibrar** con el micrófono activo y un altavoz:
- "Probar afinador" emite A4/C4/E4, mide el offset y ofrece "Aplicar ajuste".
- El slider de A4 (415–466 Hz) cambia el offset en vivo.
- "Restablecer" vuelve a 0¢ / 440 Hz.
- Tras aplicar un offset, en el modo **Voz** la lectura se desplaza coherentemente.

- [ ] **Step 7: Commit**

```bash
git add src/components/Tuner.js tests/tuner.test.js
git commit -m "feat(afinador): modo Calibrar con auto-test de loopback y control de A4"
```

---

## Anexo A — `tonePlayer.js` (si el Grupo A no se implementó aún)

Idéntico a la **Task 6** del plan `2026-06-09-afinador-entrenamiento.md`. Resumen ejecutable:

- [ ] Crear `tests/tonePlayer.test.js` y `src/lib/tonePlayer.js` con el contenido de esa Task 6 (mock de `AudioContext`, oscilador `sine`, envolvente, `play/stop/close`).
- [ ] `pnpm vitest run tests/tonePlayer.test.js` → PASS.
- [ ] Commit: `feat(afinador): tonePlayer con oscilador sine y envolvente`.

---

## Notas de estilo (opcional, recomendado)

Añadir clases `.tuner-cal`, `.tuner-cal__manual`, `.tuner-cal__result` en `src/styles/tuner.css` siguiendo el patrón de `.tuner-range`/`.tuner-free`. No bloqueante.
