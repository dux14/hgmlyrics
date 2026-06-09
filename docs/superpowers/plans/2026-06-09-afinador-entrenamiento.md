# Afinador — Entrenamiento (calentamiento + escalas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GUARD DE RAMA (obligatorio):** todo el trabajo va en la rama `beta-stems`. Antes de CUALQUIER edición ejecuta `git branch --show-current`; si no estás en `beta-stems`, haz `git checkout beta-stems`. NUNCA commitees a `master`.

**Goal:** Añadir un modo **Entrenar** al afinador con dos sub-flujos guiados — *Calentamiento por mi rango* (runs ascendentes transpuestos al rango vocal del perfil) y *Ejercicio de escala* (4 presets: Do Mayor pentatónica/natural, Mi menor pentatónica/natural) — con tono de referencia (oscilador Web Audio) y avance automático al sostener cada nota afinada.

**Architecture:** Tres módulos puros y testeables (`scales.js`, `warmup.js`, `exerciseEngine.js`) generan secuencias de notas y gestionan el progreso; `tonePlayer.js` reproduce el tono de referencia con un `OscillatorNode` envuelto en attack/release. `Tuner.js` añade un modo `entrenar` que reutiliza el gauge existente (`renderGauge`/`setNeedle`/`renderReadout`) y alimenta el motor con la salida ya estabilizada del detector YIN.

**Tech Stack:** Vanilla JS + Vite (frontend), Web Audio API (`OscillatorNode`/`GainNode`), Vitest + jsdom. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-09-afinador-entrenamiento-validacion-y-fix-logout-design.md`

**Convenciones del repo que DEBES seguir:**
- `pnpm` siempre, nunca `npm`/`yarn`.
- Tests en `tests/*.test.js`. Módulos puros: import directo. Componentes: `vi.mock` de `../src/styles/*.css`, `../src/lib/supabase.js`, `../src/lib/store.js`, `../src/lib/pitch.js` ANTES del import dinámico (patrón de `tests/tuner.test.js`).
- Comentarios y copy de UI en español; código (nombres) en inglés.
- Prettier: singleQuote, printWidth 100. Corre `pnpm lint` antes de cada commit.
- Notación de notas: sostenidos canónicos (`A#`, no `Bb`); A4 = 440 Hz / MIDI 69.
- **Todos los commits terminan con la línea:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/scales.js` | Create | Intervalos de escala, presets de ejercicio, generación de secuencias de notas y elección de octava inicial |
| `src/lib/warmup.js` | Create | Rangos por defecto por voz + generación de runs de calentamiento (1-2-3-2-1) a lo largo del rango |
| `src/lib/exerciseEngine.js` | Create | Motor de progreso: target actual, avance por hold, skip, resumen |
| `src/lib/tonePlayer.js` | Create | Reproductor de tono de referencia (oscilador `sine` + envolvente) |
| `src/components/Tuner.js` | Modify | + modo `entrenar`: picker, runner, resumen, handler de pitch |
| `tests/scales.test.js` | Create | Secuencias correctas, notas por preset, `pickStartOctave` |
| `tests/warmup.test.js` | Create | Runs y fallback por voz |
| `tests/exerciseEngine.test.js` | Create | Avance por hold, skip, summary, reset |
| `tests/tonePlayer.test.js` | Create | Wiring con `AudioContext` mock (frecuencia, tipo, conexiones) |
| `tests/tuner.test.js` | Modify | Render del picker de entrenamiento |

---

### Task 0: Verificar rama

- [ ] **Step 1: Confirmar `beta-stems`**

```bash
cd /Users/samu/code/personal/Mark-N-Hkl/hgmlyrics
git branch --show-current   # Expected: beta-stems
```

Si no estás en `beta-stems`: `git checkout beta-stems`.

---

### Task 1: `scales.js` — intervalos y presets

**Files:**
- Create: `src/lib/scales.js`
- Test: `tests/scales.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/scales.test.js
import { describe, it, expect } from 'vitest';
import { SCALE_INTERVALS, EXERCISE_PRESETS } from '../src/lib/scales.js';

describe('SCALE_INTERVALS', () => {
  it('define las 4 escalas con los intervalos correctos', () => {
    expect(SCALE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(SCALE_INTERVALS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(SCALE_INTERVALS.majorPentatonic).toEqual([0, 2, 4, 7, 9]);
    expect(SCALE_INTERVALS.minorPentatonic).toEqual([0, 3, 5, 7, 10]);
  });
});

describe('EXERCISE_PRESETS', () => {
  it('tiene los 4 presets pedidos con id/tonic/type', () => {
    const ids = EXERCISE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['c-major-pentatonic', 'c-major', 'e-minor-pentatonic', 'e-minor']);
    const byId = Object.fromEntries(EXERCISE_PRESETS.map((p) => [p.id, p]));
    expect(byId['c-major-pentatonic']).toMatchObject({ tonic: 'C', type: 'majorPentatonic' });
    expect(byId['e-minor']).toMatchObject({ tonic: 'E', type: 'minor' });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run tests/scales.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/scales.js"`.

- [ ] **Step 3: Implementar las constantes**

```js
// src/lib/scales.js
/**
 * scales.js — Generación de secuencias de escala para el modo Entrenar del afinador.
 * Puro y síncrono. Notación científica con sostenidos canónicos (igual que notes.js).
 */
import { noteToMidi } from './notes.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Intervalos (semitonos desde la tónica) de cada tipo de escala soportado. */
export const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
};

/** Los 4 ejercicios de escala ofrecidos en la UI. */
export const EXERCISE_PRESETS = [
  { id: 'c-major-pentatonic', label: 'Do Mayor · pentatónica', tonic: 'C', type: 'majorPentatonic' },
  { id: 'c-major', label: 'Do Mayor · natural', tonic: 'C', type: 'major' },
  { id: 'e-minor-pentatonic', label: 'Mi menor · pentatónica', tonic: 'E', type: 'minorPentatonic' },
  { id: 'e-minor', label: 'Mi menor · natural', tonic: 'E', type: 'minor' },
];

/** Convierte un número MIDI a etiqueta científica con sostenidos. */
function midiToLabel(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run tests/scales.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scales.js tests/scales.test.js
git commit -m "feat(afinador): intervalos y presets de escala para entrenamiento"
```

---

### Task 2: `scales.js` — `buildScaleSequence`

**Files:**
- Modify: `src/lib/scales.js`
- Test: `tests/scales.test.js`

- [ ] **Step 1: Añadir el test que falla**

```js
// tests/scales.test.js (añadir)
import { buildScaleSequence } from '../src/lib/scales.js';

describe('buildScaleSequence', () => {
  it('Do Mayor pentatónica ascendente = C D E G A + tónica superior', () => {
    const seq = buildScaleSequence({ tonic: 'C', type: 'majorPentatonic', startOctave: 4, direction: 'up' });
    expect(seq).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5']);
  });

  it('Mi menor pentatónica = E G A B D (clases de altura)', () => {
    const seq = buildScaleSequence({ tonic: 'E', type: 'minorPentatonic', startOctave: 3, direction: 'up' });
    expect(seq).toEqual(['E3', 'G3', 'A3', 'B3', 'D4', 'E4']);
  });

  it('Mi menor natural = E F# G A B C D', () => {
    const seq = buildScaleSequence({ tonic: 'E', type: 'minor', startOctave: 3, direction: 'up' });
    expect(seq).toEqual(['E3', 'F#3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4']);
  });

  it('up-down: sube y baja sin repetir la nota más aguda', () => {
    const seq = buildScaleSequence({ tonic: 'C', type: 'majorPentatonic', startOctave: 4, direction: 'up-down' });
    expect(seq).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'A4', 'G4', 'E4', 'D4', 'C4']);
  });

  it('lanza con un tipo de escala desconocido', () => {
    expect(() => buildScaleSequence({ tonic: 'C', type: 'lydian', startOctave: 4 })).toThrow();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/scales.test.js -t buildScaleSequence`
Expected: FAIL — `buildScaleSequence is not a function`.

- [ ] **Step 3: Implementar `buildScaleSequence`**

```js
// src/lib/scales.js (añadir al final)
/**
 * Construye una secuencia de notas científicas para una escala.
 * @param {{ tonic: string, type: keyof typeof SCALE_INTERVALS, startOctave: number,
 *           octaves?: number, direction?: 'up' | 'up-down' }} opts
 * @returns {string[]} Notas ascendiendo hasta la tónica+octavas y, si up-down, de vuelta.
 */
export function buildScaleSequence({ tonic, type, startOctave, octaves = 1, direction = 'up-down' }) {
  const intervals = SCALE_INTERVALS[type];
  if (!intervals) throw new Error(`Unknown scale type: ${type}`);
  const rootMidi = noteToMidi(`${tonic}${startOctave}`);
  const upMidi = [];
  for (let o = 0; o < octaves; o++) {
    for (const step of intervals) upMidi.push(rootMidi + o * 12 + step);
  }
  upMidi.push(rootMidi + octaves * 12); // tónica de cierre, una octava arriba
  const up = upMidi.map(midiToLabel);
  if (direction === 'up') return up;
  const down = up.slice(0, -1).reverse(); // baja sin repetir la nota más aguda
  return [...up, ...down];
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/scales.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scales.js tests/scales.test.js
git commit -m "feat(afinador): buildScaleSequence con direccion up/up-down"
```

---

### Task 3: `scales.js` — `pickStartOctave`

**Files:**
- Modify: `src/lib/scales.js`
- Test: `tests/scales.test.js`

- [ ] **Step 1: Añadir el test que falla**

```js
// tests/scales.test.js (añadir)
import { pickStartOctave } from '../src/lib/scales.js';

describe('pickStartOctave', () => {
  it('elige una octava cuya secuencia de 1 octava entra en el rango', () => {
    const oct = pickStartOctave({ tonic: 'C', type: 'major', rangeLow: 'C3', rangeHigh: 'C5' });
    expect(oct).toBe(3);
    // La secuencia resultante cae dentro de [C3, C5].
    const seq = buildScaleSequence({ tonic: 'C', type: 'major', startOctave: oct, direction: 'up' });
    expect(seq[0]).toBe('C3');
    expect(seq[seq.length - 1]).toBe('C4');
  });

  it('devuelve un entero entre 1 y 6', () => {
    const oct = pickStartOctave({ tonic: 'E', type: 'minor', rangeLow: 'E2', rangeHigh: 'E4' });
    expect(Number.isInteger(oct)).toBe(true);
    expect(oct).toBeGreaterThanOrEqual(1);
    expect(oct).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/scales.test.js -t pickStartOctave`
Expected: FAIL — `pickStartOctave is not a function`.

- [ ] **Step 3: Implementar `pickStartOctave`**

```js
// src/lib/scales.js (añadir al final)
/**
 * Elige la octava inicial que mejor centra la secuencia dentro del rango vocal.
 * Prefiere octavas donde la secuencia entra completa; entre ellas, la más centrada.
 * @param {{ tonic: string, type: keyof typeof SCALE_INTERVALS, rangeLow: string,
 *           rangeHigh: string, octaves?: number }} opts
 * @returns {number} Octava inicial (1..6).
 */
export function pickStartOctave({ tonic, rangeLow, rangeHigh, octaves = 1 }) {
  const lowMidi = noteToMidi(rangeLow);
  const highMidi = noteToMidi(rangeHigh);
  const center = (lowMidi + highMidi) / 2;
  const span = octaves * 12;
  let best = 4;
  let bestScore = Infinity;
  for (let oct = 1; oct <= 6; oct++) {
    const rootMidi = noteToMidi(`${tonic}${oct}`);
    const seqCenter = rootMidi + span / 2;
    const fits = rootMidi >= lowMidi && rootMidi + span <= highMidi;
    const score = Math.abs(seqCenter - center) + (fits ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = oct;
    }
  }
  return best;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/scales.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scales.js tests/scales.test.js
git commit -m "feat(afinador): pickStartOctave centra la escala en el rango vocal"
```

---

### Task 4: `warmup.js` — runs de calentamiento

**Files:**
- Create: `src/lib/warmup.js`
- Test: `tests/warmup.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/warmup.test.js
import { describe, it, expect } from 'vitest';
import { buildWarmup, DEFAULT_RANGES } from '../src/lib/warmup.js';

describe('buildWarmup', () => {
  it('genera runs 1-2-3-2-1 cubriendo el rango dado', () => {
    const seq = buildWarmup({ rangeLow: 'C4', rangeHigh: 'E4' });
    // Único run posible: C4 D4 E4 D4 C4 (el siguiente empezaría en C#4 y E natural+4 se sale).
    expect(seq).toEqual(['C4', 'D4', 'E4', 'D4', 'C4']);
  });

  it('encadena varios runs subiendo de a un semitono', () => {
    const seq = buildWarmup({ rangeLow: 'C4', rangeHigh: 'F4' });
    expect(seq.slice(0, 5)).toEqual(['C4', 'D4', 'E4', 'D4', 'C4']);
    expect(seq.slice(5, 10)).toEqual(['C#4', 'D#4', 'F4', 'D#4', 'C#4']);
  });

  it('cae al rango por defecto de la voz cuando falta rango', () => {
    const seq = buildWarmup({ voiceType: 'bajo' });
    expect(seq[0]).toBe('E2'); // DEFAULT_RANGES.bajo = ['E2','E4']
    expect(seq.length).toBeGreaterThan(0);
  });

  it('expone rangos por defecto para las 4 voces', () => {
    expect(DEFAULT_RANGES).toMatchObject({
      soprano: ['C4', 'C6'],
      contralto: ['F3', 'F5'],
      tenor: ['C3', 'C5'],
      bajo: ['E2', 'E4'],
    });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/warmup.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/warmup.js"`.

- [ ] **Step 3: Implementar `warmup.js`**

```js
// src/lib/warmup.js
/**
 * warmup.js — Genera el calentamiento de voz guiado: runs ascendentes (patrón
 * 1-2-3-2-1 sobre la escala mayor) que recorren el rango de la nota grave a la aguda.
 * Puro y síncrono.
 */
import { noteToMidi } from './notes.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Rangos por defecto por tipo de voz (fallback si el perfil no tiene rango). */
export const DEFAULT_RANGES = {
  soprano: ['C4', 'C6'],
  contralto: ['F3', 'F5'],
  tenor: ['C3', 'C5'],
  bajo: ['E2', 'E4'],
};

// Patrón melódico de cada run: tónica, 2ª mayor, 3ª mayor y vuelta.
const RUN_OFFSETS = [0, 2, 4, 2, 0];
const RUN_TOP = Math.max(...RUN_OFFSETS);

function midiToLabel(midi) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/**
 * @param {{ rangeLow?: string, rangeHigh?: string, voiceType?: string }} [opts]
 * @returns {string[]} Secuencia plana de notas a cantar.
 */
export function buildWarmup({ rangeLow, rangeHigh, voiceType } = {}) {
  let low = rangeLow;
  let high = rangeHigh;
  if (!low || !high) {
    const fallback = DEFAULT_RANGES[voiceType] || DEFAULT_RANGES.tenor;
    [low, high] = fallback;
  }
  const lowMidi = noteToMidi(low);
  const highMidi = noteToMidi(high);
  const seq = [];
  for (let start = lowMidi; start + RUN_TOP <= highMidi; start += 1) {
    for (const off of RUN_OFFSETS) seq.push(midiToLabel(start + off));
  }
  return seq;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/warmup.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/warmup.js tests/warmup.test.js
git commit -m "feat(afinador): generador de calentamiento de voz por rango"
```

---

### Task 5: `exerciseEngine.js` — motor de progreso

**Files:**
- Create: `src/lib/exerciseEngine.js`
- Test: `tests/exerciseEngine.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/exerciseEngine.test.js
import { describe, it, expect } from 'vitest';
import { createExercise } from '../src/lib/exerciseEngine.js';

const tuned = (note, octave) => ({ note, octave, cents: 2, hz: 440, midi: 69, held: false });

describe('createExercise', () => {
  it('current() canoniza el primer objetivo', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    expect(ex.current()).toEqual({ note: 'A', octave: 4, label: 'A4' });
  });

  it('avanza tras holdFrames frames afinados consecutivos', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    expect(ex.push(tuned('A', 4)).holdCount).toBe(1);
    expect(ex.push(tuned('A', 4)).holdCount).toBe(2);
    const r = ex.push(tuned('A', 4));
    expect(r.justAdvanced).toBe(true);
    expect(ex.current()).toEqual({ note: 'C', octave: 5, label: 'C5' });
  });

  it('un null (silencio) resetea el holdCount', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 3 });
    ex.push(tuned('A', 4));
    expect(ex.push(null).holdCount).toBe(0);
  });

  it('una nota equivocada resetea el holdCount', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 3 });
    ex.push(tuned('A', 4));
    expect(ex.push(tuned('B', 4)).holdCount).toBe(0);
  });

  it('skip() cuenta como fallo y avanza', () => {
    const ex = createExercise({ sequence: ['A4', 'C5'], holdFrames: 3 });
    ex.skip();
    expect(ex.current()).toEqual({ note: 'C', octave: 5, label: 'C5' });
    expect(ex.summary()).toMatchObject({ total: 2, hits: 0, misses: 1 });
  });

  it('summary() final cuenta aciertos y done', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 1 });
    const r = ex.push(tuned('A', 4));
    expect(r.done).toBe(true);
    expect(ex.summary()).toMatchObject({ total: 1, hits: 1, misses: 0 });
  });

  it('reset() vuelve al inicio', () => {
    const ex = createExercise({ sequence: ['A4'], holdFrames: 1 });
    ex.push(tuned('A', 4));
    ex.reset();
    expect(ex.current()).toEqual({ note: 'A', octave: 4, label: 'A4' });
    expect(ex.summary()).toMatchObject({ hits: 0, misses: 0 });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/exerciseEngine.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/exerciseEngine.js"`.

- [ ] **Step 3: Implementar `exerciseEngine.js`**

```js
// src/lib/exerciseEngine.js
/**
 * exerciseEngine.js — Motor de progreso para el modo Entrenar.
 * Recibe la salida ya estabilizada del afinador (pitchStabilizer) y avanza
 * por la secuencia cuando el usuario sostiene la nota afinada N frames.
 * Puro: no toca DOM ni audio.
 */
import { noteToFrequency, frequencyToNote, matchesTarget } from './notes.js';

/**
 * @param {{ sequence: string[], holdFrames?: number }} opts
 */
export function createExercise({ sequence, holdFrames = 8 } = {}) {
  // Canoniza cada etiqueta para que coincida con la salida de frequencyToNote.
  const targets = (sequence || []).map((label) => {
    const canon = frequencyToNote(noteToFrequency(label));
    return { note: canon.note, octave: canon.octave, label: `${canon.note}${canon.octave}` };
  });
  let index = 0;
  let holdCount = 0;
  const results = [];

  function current() {
    return index < targets.length ? targets[index] : null;
  }

  function advance(hit) {
    results.push({ target: targets[index], hit });
    index += 1;
    holdCount = 0;
  }

  function push(stab) {
    const target = current();
    let justAdvanced = false;
    if (target !== null) {
      if (stab && matchesTarget(stab, target)) {
        holdCount += 1;
        if (holdCount >= holdFrames) {
          advance(true);
          justAdvanced = true;
        }
      } else {
        holdCount = 0; // silencio o nota equivocada
      }
    }
    return {
      index: Math.min(index, targets.length),
      total: targets.length,
      target: current(),
      holdCount,
      justAdvanced,
      done: current() === null,
    };
  }

  function skip() {
    if (current() !== null) advance(false);
    return { index, total: targets.length, target: current(), done: current() === null };
  }

  function summary() {
    const hits = results.filter((r) => r.hit).length;
    return { total: targets.length, hits, misses: results.length - hits, results };
  }

  function reset() {
    index = 0;
    holdCount = 0;
    results.length = 0;
  }

  return { current, push, skip, summary, reset };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/exerciseEngine.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/exerciseEngine.js tests/exerciseEngine.test.js
git commit -m "feat(afinador): motor de ejercicio con avance por hold"
```

---

### Task 6: `tonePlayer.js` — tono de referencia

**Files:**
- Create: `src/lib/tonePlayer.js`
- Test: `tests/tonePlayer.test.js`

> Este módulo lo reutiliza el Grupo B (validación/calibración). Crearlo aquí primero.

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/tonePlayer.test.js
import { describe, it, expect, vi } from 'vitest';
import { createTonePlayer } from '../src/lib/tonePlayer.js';

function makeMockAudio() {
  const osc = {
    type: '',
    frequency: { value: 0 },
    connect: vi.fn(() => gain),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => ctx.destination),
    disconnect: vi.fn(),
  };
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    resume: vi.fn(),
    close: vi.fn(),
  };
  const AudioContextClass = vi.fn(() => ctx);
  return { AudioContextClass, ctx, osc, gain };
}

describe('createTonePlayer', () => {
  it('play() configura un oscilador sine a la frecuencia pedida y lo conecta', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440, 800);
    expect(m.osc.type).toBe('sine');
    expect(m.osc.frequency.value).toBe(440);
    expect(m.osc.connect).toHaveBeenCalledWith(m.gain);
    expect(m.gain.connect).toHaveBeenCalledWith(m.ctx.destination);
    expect(m.osc.start).toHaveBeenCalled();
    expect(m.osc.stop).toHaveBeenCalled();
  });

  it('crea el AudioContext perezosamente (no en el constructor)', () => {
    const m = makeMockAudio();
    createTonePlayer({ AudioContextClass: m.AudioContextClass });
    expect(m.AudioContextClass).not.toHaveBeenCalled();
  });

  it('stop() detiene un oscilador en curso sin lanzar', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440);
    expect(() => player.stop()).not.toThrow();
    expect(m.osc.disconnect).toHaveBeenCalled();
  });

  it('close() cierra el AudioContext', () => {
    const m = makeMockAudio();
    const player = createTonePlayer({ AudioContextClass: m.AudioContextClass });
    player.play(440);
    player.close();
    expect(m.ctx.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/tonePlayer.test.js`
Expected: FAIL — `Failed to resolve import "../src/lib/tonePlayer.js"`.

- [ ] **Step 3: Implementar `tonePlayer.js`**

```js
// src/lib/tonePlayer.js
/**
 * tonePlayer.js — Reproduce un tono de referencia anclado a A4=440 (el "mundo real").
 * Oscilador `sine` con envolvente attack/release (~20ms) para evitar clicks.
 * El AudioContext se crea perezosamente (requiere gesto de usuario en iOS).
 * `AudioContextClass` es inyectable para tests.
 */
export function createTonePlayer({ AudioContextClass } = {}) {
  const Ctor = AudioContextClass || globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = null;
  let osc = null;
  let gain = null;

  function ensureCtx() {
    if (!ctx) ctx = new Ctor();
    return ctx;
  }

  function stop() {
    if (osc) {
      try {
        osc.stop();
      } catch (_e) {
        /* ya detenido */
      }
      osc.disconnect();
      osc = null;
    }
    if (gain) {
      gain.disconnect();
      gain = null;
    }
  }

  function play(hz, durationMs = 800) {
    const c = ensureCtx();
    if (c.state === 'suspended' && c.resume) c.resume();
    stop();
    const now = c.currentTime;
    const end = now + durationMs / 1000;
    osc = c.createOscillator();
    gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.setValueAtTime(0.2, Math.max(now + 0.02, end - 0.02));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(end);
  }

  function close() {
    stop();
    if (ctx && ctx.close) {
      ctx.close();
      ctx = null;
    }
  }

  return { play, stop, close };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/tonePlayer.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tonePlayer.js tests/tonePlayer.test.js
git commit -m "feat(afinador): tonePlayer con oscilador sine y envolvente"
```

---

### Task 7: `Tuner.js` — modo `entrenar` (picker + runner)

**Files:**
- Modify: `src/components/Tuner.js`
- Test: `tests/tuner.test.js`

- [ ] **Step 1: Añadir el test de render del picker (falla)**

```js
// tests/tuner.test.js (añadir al final, antes de cerrar el archivo)
// `bodyEntrenarPicker` es export puro que renderiza el selector inicial del modo Entrenar.
const { bodyEntrenarPicker } = await import('../src/components/Tuner.js');

describe('bodyEntrenarPicker', () => {
  it('ofrece calentamiento por rango y los 4 presets de escala', () => {
    const html = bodyEntrenarPicker();
    expect(html).toContain('data-train="warmup"');
    expect(html).toContain('data-preset="c-major-pentatonic"');
    expect(html).toContain('data-preset="c-major"');
    expect(html).toContain('data-preset="e-minor-pentatonic"');
    expect(html).toContain('data-preset="e-minor"');
    expect(html).toContain('id="train-fit-range"'); // toggle "ajustar a mi rango"
  });

  it('no usa emojis', () => {
    expect(bodyEntrenarPicker()).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/tuner.test.js -t bodyEntrenarPicker`
Expected: FAIL — `bodyEntrenarPicker is not a function`.

- [ ] **Step 3: Añadir imports, el modo y el renderer puro**

En `src/components/Tuner.js`, ampliar el import de `notes.js` y añadir los nuevos imports tras la línea `import { icon } from '../lib/icons.js';`:

```js
import { buildScaleSequence, pickStartOctave, EXERCISE_PRESETS } from '../lib/scales.js';
import { buildWarmup } from '../lib/warmup.js';
import { createExercise } from '../lib/exerciseEngine.js';
import { createTonePlayer } from '../lib/tonePlayer.js';
import { getProfile } from '../lib/authStore.js';
```

> Nota: `getSession`/`refreshProfile` ya se importan de `../lib/authStore.js`; añade `getProfile` a ese import existente en lugar de duplicar la línea.

Añadir el modo a `MODES`:

```js
const MODES = [
  { id: 'guitar', label: `${icon('audio-lines', { size: 15 })} Guitarra` },
  { id: 'voice', label: `${icon('mic', { size: 15 })} Voz` },
  { id: 'song', label: `${icon('music', { size: 15 })} Canción` },
  { id: 'range', label: `${icon('ruler', { size: 15 })} Rango` },
  { id: 'entrenar', label: `${icon('activity', { size: 15 })} Entrenar` },
];
```

Añadir el renderer puro del picker (junto a los otros `body*`, p.ej. tras `bodyFreeNote`):

```js
/**
 * Picker inicial del modo Entrenar: calentamiento por rango o ejercicio de escala.
 * Render puro (string) para testear sin DOM.
 * @returns {string}
 */
export function bodyEntrenarPicker() {
  const presets = EXERCISE_PRESETS.map(
    (p) => `<button class="tuner-train__preset" data-preset="${p.id}">${p.label}</button>`,
  ).join('');
  return `
    <div class="tuner-train">
      <p class="tuner-train__hint">Elegí un entrenamiento</p>
      <button class="btn btn--primary tuner-train__warmup" data-train="warmup">
        ${icon('flame', { size: 15 })} Calentamiento por mi rango
      </button>
      <div class="tuner-train__divider">o ejercicio de escala</div>
      <div class="tuner-train__presets" role="group" aria-label="Escalas">
        ${presets}
      </div>
      <label class="tuner-train__fit">
        <input type="checkbox" id="train-fit-range" /> Ajustar la escala a mi rango
      </label>
    </div>
  `;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm vitest run tests/tuner.test.js -t bodyEntrenarPicker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tuner.js tests/tuner.test.js
git commit -m "feat(afinador): modo Entrenar con picker de calentamiento y escalas"
```

---

### Task 8: `Tuner.js` — runner del entrenamiento (estado + handler + UI)

**Files:**
- Modify: `src/components/Tuner.js`

> Esta tarea cablea la lógica en el componente (sin nuevos exports puros, ya cubiertos por los tests de las Tasks 1-7). Verificación: render manual + suite verde.

- [ ] **Step 1: Añadir estado del modo entrenar dentro de `renderTuner`**

Junto a los otros bloques de estado (tras la sección "Nota libre"), añadir:

```js
  // Estado del modo Entrenar.
  let exercise = null; // ReturnType<typeof createExercise> | null
  let exerciseDone = false;
  const tonePlayer = createTonePlayer({});

  /**
   * Arranca un entrenamiento a partir de una secuencia de notas.
   * @param {string[]} sequence
   */
  function startExercise(sequence) {
    if (!sequence || sequence.length === 0) {
      alert('No pude armar el ejercicio. Configurá tu rango en el perfil.');
      return;
    }
    exercise = createExercise({ sequence, holdFrames: 8 });
    exerciseDone = false;
    paintBody();
    const first = exercise.current();
    if (first) tonePlayer.play(noteToFrequency(first.label));
  }
```

- [ ] **Step 2: Añadir el binder del picker y el renderer del runner**

Dentro de `renderTuner`, junto a `bindFreeNotePicker`, añadir:

```js
  function bindEntrenarPicker() {
    const fit = bodyEl.querySelector('#train-fit-range');
    const profile = getProfile();
    bodyEl.querySelector('[data-train="warmup"]')?.addEventListener('click', () => {
      startExercise(
        buildWarmup({
          rangeLow: profile?.vocalRangeLow,
          rangeHigh: profile?.vocalRangeHigh,
          voiceType: profile?.voiceType,
        }),
      );
    });
    bodyEl.querySelectorAll('.tuner-train__preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = EXERCISE_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (!preset) return;
        const fitRange = !!fit?.checked && profile?.vocalRangeLow && profile?.vocalRangeHigh;
        const startOctave = fitRange
          ? pickStartOctave({
              tonic: preset.tonic,
              type: preset.type,
              rangeLow: profile.vocalRangeLow,
              rangeHigh: profile.vocalRangeHigh,
            })
          : preset.tonic === 'C'
            ? 4
            : 3;
        startExercise(
          buildScaleSequence({ tonic: preset.tonic, type: preset.type, startOctave }),
        );
      });
    });
  }

  function renderExerciseRunner() {
    const st = exercise.push(null); // estado actual sin avanzar (target ya está fijado)
    const target = st.target;
    bodyEl.innerHTML = `
      <div class="tuner-train-run">
        <div class="tuner-train-run__progress">Nota ${Math.min(st.index + 1, st.total)} / ${st.total}</div>
        <div class="tuner-train-run__target" id="train-target">${target ? target.label : '—'}</div>
        <button class="btn btn--sm" id="train-ref">${icon('volume-2', { size: 14 })} Tono de referencia</button>
        <div class="tuner-readout" id="tuner-readout" data-status="">
          <div class="tuner-readout__note">—</div>
          <div class="tuner-readout__meta">— Hz · —¢</div>
        </div>
        ${renderGauge()}
        <div class="tuner-train-run__actions">
          <button class="btn btn--secondary" id="train-skip">Saltar</button>
          <button class="btn btn--secondary" id="train-quit">Terminar</button>
        </div>
      </div>
    `;
    bodyEl.querySelector('#train-ref')?.addEventListener('click', () => {
      if (target) tonePlayer.play(noteToFrequency(target.label));
    });
    bodyEl.querySelector('#train-skip')?.addEventListener('click', () => {
      const r = exercise.skip();
      if (r.done) finishExercise();
      else {
        renderExerciseRunner();
        tonePlayer.play(noteToFrequency(r.target.label));
      }
    });
    bodyEl.querySelector('#train-quit')?.addEventListener('click', () => {
      exercise = null;
      paintBody();
    });
  }

  function finishExercise() {
    const s = exercise.summary();
    exerciseDone = true;
    bodyEl.innerHTML = `
      <div class="tuner-empty">
        <h2>${icon('check-circle', { size: 22 })} Entrenamiento completado</h2>
        <p>Aciertos: <strong>${s.hits}</strong> / ${s.total}</p>
        <button class="btn btn--primary" id="train-again">Repetir</button>
      </div>
    `;
    bodyEl.querySelector('#train-again')?.addEventListener('click', () => {
      exercise.reset();
      exerciseDone = false;
      paintBody();
      const first = exercise.current();
      if (first) tonePlayer.play(noteToFrequency(first.label));
    });
  }
```

- [ ] **Step 3: Añadir el handler de pitch y cablearlo en `paintBody`/`dispatchPitch`**

Añadir el handler junto a los otros `handlePitch*`:

```js
  function handlePitchEntrenar(stab) {
    if (!exercise || exerciseDone) return;
    if (stab === null) {
      renderReadout(bodyEl, { label: '—', hz: null, cents: null });
      setNeedle(bodyEl, 0, '');
      exercise.push(null);
      return;
    }
    renderReadout(bodyEl, { label: `${stab.note}${stab.octave}`, hz: stab.hz, cents: stab.cents });
    setNeedle(bodyEl, stab.cents, colorFromCents(stab.cents));
    const r = exercise.push(stab);
    if (r.justAdvanced) {
      if (r.done) finishExercise();
      else {
        renderExerciseRunner();
        tonePlayer.play(noteToFrequency(r.target.label));
      }
    }
  }
```

En `dispatchPitch`, añadir la rama:

```js
    if (mode === 'entrenar') return handlePitchEntrenar(payload);
```

En `paintBody`, añadir la rama del modo entrenar (tras la rama `range`):

```js
    } else if (mode === 'entrenar') {
      if (!exercise) {
        bodyEl.innerHTML = bodyEntrenarPicker();
        bindEntrenarPicker();
      } else if (exerciseDone) {
        finishExercise();
      } else {
        renderExerciseRunner();
      }
    }
```

- [ ] **Step 4: Limpiar el tono al salir del afinador**

En `cleanupOnHashChange`, tras `detector.stop()`, añadir el cierre del tono:

```js
      tonePlayer.close();
```

(colocarlo dentro del bloque `if (!window.location.hash.startsWith('#/afinador'))`).

Y en el handler de cambio de pestaña (`tabsEl.addEventListener('click', ...)`), tras `stabilizer.reset();` resetear el ejercicio al cambiar de modo:

```js
    exercise = null;
    exerciseDone = false;
    tonePlayer.stop();
```

- [ ] **Step 5: Verificar suite + lint**

Run: `pnpm vitest run`
Expected: PASS (toda la suite, incluidos los nuevos tests).

Run: `pnpm lint`
Expected: sin errores.

- [ ] **Step 6: Verificación manual (browser)**

Run: `pnpm dev`, navegar a `#/afinador`, pestaña **Entrenar**:
- "Calentamiento por mi rango" arranca runs; al sostener cada nota afinada (~8 frames) avanza y suena el siguiente tono.
- Cada preset de escala arranca su secuencia; con el toggle "Ajustar a mi rango" la octava cambia.
- "Saltar"/"Terminar"/"Repetir" funcionan; al final se ve el resumen de aciertos.

- [ ] **Step 7: Commit**

```bash
git add src/components/Tuner.js
git commit -m "feat(afinador): runner de entrenamiento con tono de referencia y avance por hold"
```

---

## Notas de estilo (opcional, recomendado)

Añadir clases CSS para `.tuner-train`, `.tuner-train__preset`, `.tuner-train-run`, etc. en `src/styles/tuner.css` siguiendo las clases existentes (`.tuner-free`, `.tuner-range`). No es bloqueante para la lógica, pero mejora el acabado. Si se añade, incluirlo en el commit de la Task 8 o en un commit `style(afinador): estilos del modo Entrenar`.
