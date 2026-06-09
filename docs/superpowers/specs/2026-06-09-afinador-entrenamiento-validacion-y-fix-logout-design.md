# Afinador: entrenamiento + validación, y fix de logout — Design Spec

> Refinado en sesión de brainstorming (samu-flow) el 2026-06-09. Rama de trabajo: `beta-stems`.
> Este spec alimenta TRES writing-plans independientes (Grupos A, B, C) que viven en
> `docs/superpowers/plans/` junto al plan de stems (`2026-06-03-separacion-stems-voces.md`).

## Objetivo

Tres ajustes sobre la app de letras/karaoke (Vanilla JS + Vite, backend Vercel `api/`, Supabase):

1. **Afinador — Entrenamiento (Grupo A):** calentamiento de voz guiado + ejercicios por escalas.
2. **Afinador — Validación/Calibración (Grupo B):** comprobar que la nota detectada corresponde a la "vida real".
3. **Fix bug (Grupo C):** logout que a veces aterriza en `/favoritos` (intermitente, desde cualquier página).

## Contexto del código (verificado por lectura)

- **Detección:** `src/lib/pitch.js` — YIN puro (`detectPitch(buffer, sampleRate, opts)`) + `createPitchDetector({onPitch,onError,onState})` (mic → AnalyserNode → rAF ~30 Hz). `shouldAutoStartMic(state)`.
- **Notas:** `src/lib/notes.js` — A4=440/MIDI 69. `frequencyToNote(hz)`, `noteToFrequency(str)`, `noteToMidi`, `getScaleNotes(key)` (mayor `[0,2,4,5,7,9,11]` / menor natural `[0,2,3,5,7,8,10]`), `matchesTarget(detected,target)` (mismo nombre+octava y |cents|<10), `nearestString`.
- **Estabilizador:** `src/lib/pitchStabilizer.js` — `createPitchStabilizer({medianWindow,holdMs,noteStableFrames,emaAlpha,now})`; `push(sample)` → `{hz,note,octave,cents,midi,held}|null`; `reset()`. `now` inyectable.
- **UI afinador:** `src/components/Tuner.js` — `MODES = [guitar, voice, song, range]`; `renderTuner(container,{query})`; helpers exportados/puros `bodySong`, `bodyFreeNote`, `sanitizeFreeNote`; gauge reutilizable (`renderGauge`, `setNeedle`, `renderReadout`, `colorFromCents`, `clampCents`). Ciclo de mic en `requestMic()`/`dispatchPitch()`; cleanup en `hashchange`.
- **Claves:** `src/lib/musicKeys.js` — `MUSICAL_KEYS` (24: 12 tónicas × {major,minor}, sostenidos). `isValidKey`.
- **Perfil:** `getProfile()` (authStore) expone `voiceType` (`soprano|contralto|tenor|bajo`), `voiceSubtype`, `vocalRangeLow`, `vocalRangeHigh` (notación científica, p.ej. `"D2"`). Se guarda vía `PATCH /api/profile/me`.
- **Auth/Router:** `src/lib/authStore.js` (`signOut()`, `onAuthStateChange` async → `notify()`); `src/router.js` (`navigate(path)` empuja hash o fuerza `resolve()`; `guardedRoute` redirige a `navigate('/login?next=<path>')`); `src/components/AuthButton.js:81-84` logout = `await signOut(); cleanup(); navigate('/login')`; `next` solo lo consume `AuthCallback.js:44`. Rutas guardadas en `main.js:122-210` (incluye `/favoritos`, `/afinador`).
- **Tests:** Vitest + jsdom. Módulos puros sin stubs; componentes con `vi.mock` de `../src/styles/*.css`, `../src/lib/supabase.js`, `../src/lib/store.js`, `../src/lib/pitch.js` (ver `tests/tuner.test.js`). Convención: copy en español, código en inglés, Prettier singleQuote printWidth 100, `pnpm lint` antes de commit.

## Decisiones de diseño (refinadas con el usuario)

1. **Tonalidad de ejercicios:** *ambas, seleccionables* — modo "Calentamiento por mi rango" (transpuesto al `vocalRangeLow/High`) y modo "Ejercicio de escala" (tonalidad fija, con toggle "ajustar a mi rango").
2. **Guía/feedback:** *tono de referencia (oscilador Web Audio) + validación por hold* — avanza al sostener la nota afinada N frames.
3. **Validación "nota real":** *combinar loopback + calibración manual* — auto-test de loopback (la app emite tono conocido, el mic lo capta, se mide el offset en cents) + offset de calibración manual persistido y un control de A4.
4. **Bug logout:** *intermitente desde cualquier página* → tratar con causa-raíz-primero (systematic-debugging), no parchear a ciegas.

---

## Grupo A — Afinador: Entrenamiento

**Plan:** `docs/superpowers/plans/2026-06-09-afinador-entrenamiento.md`

### Módulos nuevos (puros, testeables)
- `src/lib/scales.js`
  - `SCALE_INTERVALS = { major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], majorPentatonic:[0,2,4,7,9], minorPentatonic:[0,3,5,7,10] }`.
  - `EXERCISE_PRESETS` (4): `c-major-pentatonic` ("Do Mayor · pentatónica", tónica `C`, `majorPentatonic`), `c-major` ("Do Mayor · natural", `C`, `major`), `e-minor-pentatonic` ("Mi menor · pentatónica", `E`, `minorPentatonic`), `e-minor` ("Mi menor · natural", `E`, `minor`).
  - `buildScaleSequence({ tonic, type, startOctave, octaves=1, direction='up-down' })` → array de notas científicas (sostenidos) ascendiendo a la tónica+12 y, si `up-down`, descendiendo de vuelta. Validación de notas correctas: C mayor pent = `C D E G A`; Mi menor pent = `E G A B D`; Mi menor natural = `E F# G A B C D`.
  - `pickStartOctave({ tonic, type, rangeLow, rangeHigh })` → octava inicial que mejor encaja la secuencia en el rango (centrada).
- `src/lib/warmup.js`
  - `DEFAULT_RANGES = { soprano:['C4','C6'], contralto:['F3','F5'], tenor:['C3','C5'], bajo:['E2','E4'] }`.
  - `buildWarmup({ rangeLow, rangeHigh, voiceType })` → secuencia de runs ascendentes (patrón 1-2-3-2-1 sobre escala mayor, offsets `[0,2,4,2,0]`) empezando en cada paso desde la nota grave hasta cubrir hasta la aguda; cae a `DEFAULT_RANGES[voiceType]` si falta rango. Devuelve array plano de notas.
- `src/lib/exerciseEngine.js`
  - `createExercise({ sequence, holdFrames=8 })` → `{ current(), push(stab), skip(), summary(), reset() }`.
  - `current()` → target canónico `{note,octave}` (canonizado vía `frequencyToNote(noteToFrequency(label))`) o `null` si terminó.
  - `push(stab)` → si `matchesTarget(stab,current)` incrementa holdCount; al llegar a `holdFrames` registra acierto y avanza; `stab===null` resetea holdCount. Devuelve `{index,total,target,holdCount,justAdvanced,done}`.
  - `skip()` → registra fallo y avanza. `summary()` → `{total,hits,misses,results}`.
- `src/lib/tonePlayer.js`
  - `createTonePlayer({ AudioContextClass })` → `{ play(hz,durationMs=800), stop(), close() }`. Oscilador `sine` + `GainNode` con envolvente attack/release (~20ms) para evitar clicks. `AudioContext` lazy (gesto de usuario). Inyectable para test (verifica `frequency.value` y wiring con mock).

### UI
- Añadir modo `entrenar` a `MODES` en `Tuner.js` (icono `dumbbell`/`activity`). Cuerpo:
  1. Picker: "Calentamiento por mi rango" | "Ejercicio de escala" (+ selector de los 4 presets + toggle "ajustar a mi rango").
  2. Runner: muestra "Objetivo: <nota>", botón/auto de tono de referencia (`tonePlayer`), reutiliza `renderGauge`/`setNeedle`/`renderReadout`, animación de acierto, progreso "nota X / N".
  3. Resumen final (aciertos/fallos, opción "Repetir").
- `handlePitchEntrenar(stab)` alimenta `exerciseEngine.push` y refresca UI; al `justAdvanced` reproduce el siguiente tono.

### Tests
- `tests/scales.test.js` (secuencias y notas correctas, pickStartOctave), `tests/warmup.test.js` (runs y fallback), `tests/exerciseEngine.test.js` (avance por hold, skip, summary), `tests/tonePlayer.test.js` (wiring con AudioContext mock).

---

## Grupo B — Afinador: Validación y calibración

**Plan:** `docs/superpowers/plans/2026-06-09-afinador-validacion-calibracion.md`
**Dependencia:** usa `src/lib/tonePlayer.js` del Grupo A (si se implementa antes, crearlo aquí según anexo).

### Módulos nuevos (puros)
- `src/lib/calibration.js`
  - `CAL_KEY='hkn-tuner-cal-cents'`. `getCalibrationCents()` (clamp `[-100,100]`, default 0), `setCalibrationCents(c)`.
  - `applyCalibration(hz, calCents)` → `hz * 2^(-calCents/1200)` (calCents>0 = el dispositivo lee sostenido; se corrige bajando el hz antes de `frequencyToNote`).
  - `centsToA4(cents)` = `440 * 2^(cents/1200)`; `a4ToCents(hz)` = `1200*log2(hz/440)` (para el control manual de A4).
- `src/lib/loopbackTest.js`
  - Puro: `medianOffsetCents(measurements)` con `measurements=[{expectedHz,detectedHz}]`, cents por muestra `1200*log2(detected/expected)`, devuelve la mediana.
  - Orquestador `runLoopbackTest({ tonePlayer, detector, notes=['A4','C4','E4'] })` → reproduce cada tono, recoge detecciones, retorna `{ok, offsetCents, detail}` (verificación de audio = manual; aviso "usar altavoz, no audífonos").

### Integración de calibración
- Aplicar `applyCalibration` al `hz` entrante en `Tuner.js` antes de `stabilizer.push` (punto único; no se tocan los call-sites de `notes.js`). El tono de referencia se mantiene anclado a 440 (es el "mundo real").

### UI
- Añadir modo `calibrar` a `MODES` (icono `settings`/`gauge`). Cuerpo: botón "Probar afinador" (corre loopback, muestra `offsetCents` y pass/fail), CTA "Aplicar ajuste (+X¢)" → `setCalibrationCents`, slider manual de A4 (415–466 Hz) ↔ cents, botón "Restablecer".

### Tests
- `tests/calibration.test.js` (applyCalibration, centsToA4/a4ToCents, persistencia con localStorage mock), `tests/loopbackTest.test.js` (medianOffsetCents).

---

## Grupo C — Fix bug logout → favoritos

**Plan:** `docs/superpowers/plans/2026-06-09-fix-logout-favoritos.md`
**Método:** superpowers:systematic-debugging — causa raíz ANTES de fix.

### Sospechosos (confirmados por lectura)
- `AuthButton.js:81-84`: `await signOut(); navigate('/login')` empuja al history (sin `replace`); corre en carrera con `onAuthStateChange` async (`authStore.js:103-112`).
- `router.js:171`: rutas guardadas redirigen con `navigate('/login?next=<path>')` **empujando** history; `next` solo lo consume `AuthCallback.js:44`. Si durante el logout se re-resuelve una ruta guardada con sesión ya `null`, puede escribirse/propagarse `next=/favoritos` y el back/forward o un re-resolve deja entrar a favoritos.

### Pasos del plan
1. Reproducir + instrumentar (logs de `navigate`/`guardedRoute`/`onAuthStateChange`) desde varias rutas hasta confirmar la causa raíz.
2. Test que falla: simular `signOut` + secuencia de navegación y afirmar que se aterriza en `/login` sin re-entrar a ruta guardada (`tests/router.test.js` o `tests/authLogout.test.js`).
3. Fix probable: `navigate('/login', { replace })` en logout limpiando `next` pendiente + redirección de `guardedRoute` con `replace` (no acumular history) + cerrar la ventana de re-resolve durante el signout. (Añadir soporte `{replace}` a `navigate` vía `history.replaceState`.)
4. Verificar: logout desde **cualquier** ruta → `/login`; back no re-expone favoritos; suite verde.

### Criterios de aceptación
- Logout desde `/`, `/favoritos`, `/afinador`, `/perfil`, `/amigos` → siempre `/login`.
- El botón "atrás" tras logout no muestra contenido protegido.
- `pnpm vitest run` y `pnpm lint` verdes.

---

## Orden sugerido de ejecución
Grupo A (crea `tonePlayer`) → Grupo B (lo reutiliza) → Grupo C (independiente, puede ir en cualquier momento). Cada grupo: TDD, commits frecuentes, guard de rama `beta-stems`.
