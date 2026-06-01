# Reporte de hardening y auditoría — iniciativa Voz/Tono/Afinador (A–G)

> Fecha: 2026-06-01 · Rama: `feat/voz-tono-afinador`
> Plan: `docs/superpowers/plans/2026-06-01-G-hardening-auditoria.md`
> Spec: `docs/superpowers/specs/2026-06-01-G-hardening-auditoria.md`

Pase de cierre que verifica que A–F entran sin degradar mobile-first,
performance, PWA/a11y, carga, seguridad y testing. Cada hallazgo abajo fue
verificado leyendo el código (no copiado del plan).

---

## REGRESIÓN v1 (paridad de render)

- `tests/regression-v1.test.js` (2 tests) — **PASS**.
  - `upgradeLegacySong` no altera `line.text`.
  - `buildHighlightedHTML` produce HTML **byte-idéntico** antes/después del
    upgrade (las `voiceRanges` originales se conservan para lectura dual v1↔v2).
- Esto prueba que las canciones v1 existentes siguen renderizando exactamente
  igual tras introducir el modelo v2.

---

## SECURITY (Task 4)

Verificado leyendo el código en esta rama.

### 1. Gating server-side de feature flags (real, no solo UI)

- `api/_lib/auth.js` → `requireFlag(req, sql, key)` resuelve los flags efectivos
  del usuario (catálogo `feature_flags` + asignaciones `feature_flag_users`,
  match por email **o** username, case-insensitive) y, si el flag no está
  habilitado, lanza `Error('Feature not enabled')` con `e.status = 403`
  (`api/_lib/auth.js:75-92`). Es defensa en profundidad: no confía en el gating
  de UI.
- `api/admin/feature-flags.js` llama `await requireAdmin(req, sql)` **antes** de
  cualquier rama de método (GET/POST/DELETE) — `feature-flags.js:53`, antes de
  `list`/`addAssignment`/`removeAssignment`. Escrituras (POST/DELETE) quedan
  cubiertas. `requireAdmin` valida usuario vía `supabase.auth.getUser()`, luego
  `ADMIN_EMAILS` (re-evaluado por request) con fallback a `profiles.is_admin`, y
  lanza 403 si no es admin (`auth.js:50-65`).

### 2. XSS — todo valor controlado por el usuario pasa por escapeHtml

- `buildSyllableNotesHTML` (`src/lib/voiceSystem.js:375-390`): el texto de
  sílaba y la nota ruby se emiten vía `escapeHtml(...)`; el extensor de melisma
  usa un carácter literal, no datos del usuario. (Test de escape en
  `tests/voiceSystem.test.js`.)
- AdminDashboard (feature-flags UI): `f.key`, `f.description`, `u.email`,
  `u.username` se renderizan con `escapeHtmlLocal(...)`
  (`src/components/AdminDashboard.js:57-64`).
- Editor (roster/notas): `roster-name`, `roster-refkey`, `vlink-url`,
  `vlink-label`, título/artista/álbum/género se emiten con `escapeHtml(...)`
  (`src/components/SongEditor.js:305-328, 477-481, 556-566`).
- Botón "Afinar" del lector: la nota de referencia se escapa
  (`const safeRef = escapeHtml(refNote)`) antes de inyectarse en `data-ref` y
  el label, y se `encodeURIComponent` al navegar
  (`src/components/SongView.js:496-499`). Chips de categoría/persona del modo
  Tono escapan label y nombre (`SongView.js:705, 515`).

### 3. Open-redirect — descartado

- El afinador deriva `from` vía `parseTunerTarget` → `fromSongId`
  (`src/lib/notes.js:98-103`). El único uso es
  `navigate('/song/' + target.fromSongId)` (`src/components/Tuner.js:272`), una
  ruta hash interna. No hay redirección externa: `from` nunca se usa como URL ni
  como `location.href`. El parámetro `ref` se valida contra `TUNER_NOTE_RE`
  (solo notas tipo `B3`), descartando inyección por la query.

### 4. Validación server-side de canciones — AHORA aplicada (cierre del gap)

- **Antes:** `api/songs/[id].js` `update()` persistía `voice_roster` /
  `schema_version` con un `TODO(Plan D)` y **sin validación server-side**. La
  validación del editor en cliente no es un control de seguridad.
- **Ahora:** `update()` importa `validateSongV2` desde
  `../../src/lib/voiceSystem.js` y, cuando `s.schemaVersion === 2`, la corre
  dentro de try/catch; si lanza, responde `400 { error: e.message }` y retorna
  **sin persistir** (`api/songs/[id].js:48-58`). Las canciones v1
  (`schemaVersion !== 2`) saltan la validación — comportamiento sin cambios.
  `validateSongV2` valida categorías de roster, ids únicos, `referenceKey` como
  nota válida, rangos de sílabas (sin overlap, dentro de `text.length`),
  referencias `voiceLines→roster` existentes, alineación
  `sungSyllables`/`notes` y notas válidas (`voiceSystem.js:292-343`).
- Cobertura: `tests/apiSongsValidation.test.js` (source-assertion, estilo de
  `apiSongsV2.test.js`) — confirma el import, el guard `schemaVersion === 2`, la
  respuesta 400 con return y la eliminación del TODO. **PASS** (4 tests).

### 5. RLS — emails de feature flags no legibles por anon/auth

- `supabase/migrations/20260601163352_feature_flags.sql`: ambas tablas tienen
  `ENABLE ROW LEVEL SECURITY`. Hay una policy de SELECT solo para el **catálogo**
  (`feature_flags_read` sobre `feature_flags`, no sensible). **No existe ninguna
  policy de SELECT sobre `feature_flag_users`**, así que los emails/usernames de
  asignación no son legibles por roles anon/authenticated; solo la API
  (service role, que bypassa RLS) los lee. `songs` requiere auth para SELECT
  (`songs_authenticated_read`, migration `20260522031737`).

**Resultado security: sin hallazgos abiertos.** El único gap concreto
(validación server-side de v2) quedó cerrado en este pase.

---

## A11Y / MOBILE (Task 5)

### Arreglado en este pase

- **Estado activo de los chips de filtro Tono ahora es programático.** Los chips
  de categoría y de persona (en `SongView.js` `renderTonoFilters` /
  `renderPersonRow`) comunicaban su selección solo visualmente. Se añadió
  `aria-pressed` (`"true"`/`"false"`) a ambos sets y se mantiene en sincronía en
  `selectCategory` y `selectPerson` (`SongView.js:536-548`). El chip activo no es
  color-only: ya tenía borde + fondo vía `.tono-chip--active`, confirmado. Cambio
  mínimo, sin tocar el flujo de selección.

### Verificado presente (arreglado en pases A–F)

- **Contraste de la nota ruby en tenor, tema claro.** Override dedicado:
  `.lyrics__line--tono.voice-text--tenor .syll__note { color: #8a6800 }`
  (`components.css:1299-1301`), con restauración del token `--color-voice-tenor`
  bajo `[data-theme='dark']` (`:1302-1304`). Oscurece solo la nota ruby en claro
  (el token global de tenor era <4.5:1 a tamaño pequeño), sin alterar el
  resaltado de voces v1.

### reduced-motion + aria-live (confirmado)

- **reduced-motion honrado en ambos caminos:**
  - Transición de filtros gateada:
    `@media (prefers-reduced-motion: reduce) { .lyrics__filter-row { transition: none } }`
    (`components.css:1382-1386`).
  - Interpolación de autoscroll gateada: `SongView.js:956` calcula
    `reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches`
    y, bajo reduced-motion, salta directo sin transición suave
    (`SongView.js:991-992`) y no interpola la velocidad por sección
    (`SongView.js:1046-1048`).
- **aria-live:** el encabezado de voz activa `#tono-active-voice` lleva
  `aria-live="polite"` (`SongView.js:715`); el cambio de voz/persona lo actualiza
  vía `updateActiveVoiceHeading`, anunciándolo a lectores de pantalla. Las filas
  de chips llevan `role="group"` con `aria-label` ("Categoría de voz" / "Voz").

### Diferido (documentado, NO arreglado en este pase)

- **(a) Opacidad de sílabas no cantadas (`.syll--dimmed { opacity: 0.4 }`,
  `components.css:1312-1313`).** Baja el contraste de las palabras de-enfatizadas
  de la letra. Es de-énfasis intencional y consistente con la convención
  existente `.voice-text--dimmed { opacity: 0.35 }` (`components.css:1257-1258`).
  Se deja como decisión de diseño; el texto cantado (foco) mantiene contraste
  pleno.
- **(b) El modal del note-picker del editor (`openTonoEditor` en
  `SongEditor.js:892`) no atrapa el foco ni cierra con Escape.** Follow-up
  conocido de accesibilidad del editor (superficie admin, no de lectura). No se
  aborda aquí para mantener el pase mínimo.

### Mobile (sin regresión observada)

- Las superficies nuevas (chips Tono, fila de personas, botón Afinar, controles
  −/+ de scroll) reutilizan tokens y patrones mobile-first existentes. La fila de
  personas usa scroll horizontal aislado. Verificación visual fina a 375px /
  landscape se valida en el preview de Vercel (entorno headless local no permite
  medición de viewport fiel).

---
