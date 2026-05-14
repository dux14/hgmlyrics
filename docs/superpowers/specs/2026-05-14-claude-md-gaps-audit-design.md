# CLAUDE.md Gaps Audit — Pre-Migration Spec

**Date:** 2026-05-14
**Branch:** `chore/pre-migration-gaps`
**Scope:** Auditoría priorizada de los 10 gaps documentados en `CLAUDE.md §12` bajo la lente de la migración inminente Render+Turso → Vercel+Supabase (big-bang).
**Outcome target:** Plan ejecutable de Tiers 1+2 (gaps 3, 7, 6, 2, 8) antes de iniciar el plan de migración (Prompt 2). Tiers 3+4 quedan documentados como diferidos.

---

## 1. Contexto

HKN Lyrics es una PWA Vanilla JS (Vite + vite-plugin-pwa) con backend Express + Turso embedded replica, deployada en Render Oregon `starter`. CLAUDE.md declara 5 prioridades no-negociables (mobile-first, performance, caching, PWA, offline-first) y lista 10 gaps entre esas prioridades y el código real.

Se ha tomado la decisión de migrar el stack a **Vercel Functions + Supabase Postgres** en modalidad **big-bang con ventana de mantenimiento**. Esta decisión condiciona el ranking de los gaps: algunos cambian de "deuda menor" a "bloqueante", otros desaparecen o se resuelven naturalmente con el rediseño.

---

## 2. Verificaciones realizadas

| Gap | Verificación | Resultado |
|---|---|---|
| 1 | `grep "max-width" src/styles/*.css` | 5 media queries `max-width: 767px` confirmadas en `admin.css:139,247,837`, `layout.css:367`, `components.css:486` |
| 2 | Inspección de `vite.config.js` y `.github/` | No hay `chunkSizeWarningLimit`, no hay workflows |
| 3 | `server/index.js:64-65` | Fallbacks `'1234'` (ADMIN_PIN) y `'secret'` (JWT_SECRET) confirmados |
| 6 | `server/package.json:10` | `"test": "echo \"Error: no test specified\" && exit 1"` confirmado |
| 7 | `ls .github` | Directorio no existe |
| 8 | `server/index.js:168,181` + `vite.config.js:42` | `/api/songs/all` responde `Cache-Control: no-store`. Regex Workbox `/api/songs/[^/]+$/i` SÍ matchea `/api/songs/all`. **Descripción CLAUDE.md imprecisa** — Workbox runtime caching no respeta `no-store`, el SW captura igual. Concern real: cache stale de hasta 7 días en `api-songs-detail`. |
| 9 | `src/lib/offlineCache.js:52` | `catch (_) { }` silencioso, sin retry confirmado |

---

## 3. Tabla de gaps con criticidad dual (pre/post-migración)

| # | Gap | Prioridad NN | Esfuerzo | Sev. actual | Sev. post-migración | Trayectoria | Tier |
|---|---|---|---|---|---|---|---|
| 3 | Fallbacks `'1234'` / `'secret'` | — (security) | XS | CRÍTICA | CRÍTICA | = | **1** |
| 6 | Sin tests backend | — | M | Media | CRÍTICA | ↑↑ | **1** |
| 10 | Cache in-memory + cold start | Performance, Caching | M-L | Aceptable (warm dyno) | CRÍTICA (cold por invocación) | ↑↑↑ | **1** |
| 4 | Uploads en FS efímero | — | M | Alta | CRÍTICA (FS read-only en Vercel) | ↑↑ | **1** |
| 7 | Sin CI | — | S | Media | Alta (necesario para validar preview deploys) | ↑ | **1** |
| 2 | Sin perf budget / Lighthouse CI | Performance, PWA | S | Alta | Alta | = | **2** |
| 8 | `no-store` no bypasea Workbox | Caching, Offline | XS | Baja-Media | Baja-Media | = | **2** |
| 1 | 5 `max-width` media queries | Mobile-first | S | Baja (cosmética) | Baja | = | **3** |
| 9 | Sin retry en offlineCache | Offline-first | XS | Baja | Baja | = | **3** |
| 5 | Hash router SEO | — | XL | Decisión arquitectónica | Decisión arquitectónica | = | **4** (descartar) |

---

## 4. Justificación del ranking

### Por qué Gap 3 es Tier 1 inquebrantable
`'1234'` como fallback de ADMIN_PIN y `'secret'` como fallback de JWT_SECRET son una vulnerabilidad activa. Si en cualquier momento las env vars no se evalúan correctamente (despliegue mal configurado, build sin acceso a secrets, error tipográfico en clave), el sistema queda con credenciales públicas y predecibles. Durante una migración multi-paso (Render → Vercel) las oportunidades de mis-configuración se multiplican. Fix: eliminar los fallbacks, hacer fail-fast con `throw new Error('...')` si faltan las vars.

### Por qué Gap 10 es el más subestimado
En Render `starter`, el proceso queda caliente entre requests salvo períodos largos de inactividad — el `songsCache` con TTL de 5 minutos funciona razonablemente. En Vercel Functions cada invocación puede ser un cold-start independiente, especialmente bajo tráfico bajo. Resultado: el cache jamás se llena de forma estable y CADA request hace un `SELECT * FROM songs`. Esto es incompatible con la prioridad NN §5.3 (caching agresivo).

**Tres alternativas para reemplazarlo:**
1. **Vercel Runtime Cache API** — KV ephemeral per-region, tag-based invalidation, compartido entre invocaciones. Mejor encaje conceptual.
2. **Edge Config** — solo lectura, perfecto para datos casi-estáticos (catálogo de canciones cambia raro). Sub-15ms p99 globalmente.
3. **Supabase como cache implícito** — consultar siempre, confiar en connection pooling + Postgres buffer cache. Sin capa propia.

Decisión recomendada: **Vercel Runtime Cache API** para `/api/songs` (lista) y `/api/songs/all` (catálogo offline). Endpoints `/api/songs/:id` consultan directo a Supabase (suficientemente rápido).

### Por qué Gap 6 es bloqueante de la migración
Sin tests backend no podemos verificar paridad de comportamiento entre el Express+SQLite actual y el Vercel Functions+Postgres futuro. Diferencias silenciosas (tipos de fechas, JSON columns, AUTOINCREMENT vs IDENTITY, boolean handling) pueden romper el cliente sin que nadie lo note hasta que un usuario reporte. Los tests escritos para validar el backend actual servirán **idénticos** post-migración como tests de paridad.

**Endpoints a cubrir mínimo (8):**
- `GET /api/version`
- `GET /api/songs` (lista con filtros)
- `GET /api/songs/all` (catálogo completo)
- `GET /api/songs/:id` (detalle con sections deserializadas)
- `POST /api/auth/login` (PIN válido/inválido)
- `POST /api/songs` (auth required)
- `PUT /api/songs/:id` (auth required)
- `DELETE /api/songs/:id` (auth required)

### Por qué Gap 7 va antes que Gap 6
Sin CI los tests del Gap 6 quedan en local. La utilidad de los tests escala con su frecuencia de ejecución. Setup mínimo de GitHub Actions corriendo `pnpm install && pnpm lint && pnpm test:ci && pnpm build` en PRs es una tarde de trabajo y multiplica el valor de Gap 6.

### Combo Gap 2 + Gap 7
Una vez existe el workflow de CI, añadir Lighthouse CI cuesta marginal: un step adicional con `@lhci/cli` apuntando a la PR preview URL. Esto cierra el gap de §5.2 (performance crítico) y §5.4 (PWA score ≥95 verificable).

### Gap 8: bug real, descripción imprecisa
Workbox `StaleWhileRevalidate` no respeta `Cache-Control: no-store` por defecto — solo filtra por `cacheableResponse: { statuses: [0, 200] }`. El regex `urlPattern: /\/api\/songs\/[^/]+$/i` matchea `/api/songs/all` (3 caracteres no-slash). Por tanto el SW está cacheando hasta 7 días respuestas de `/api/songs/all` en `api-songs-detail`, lo que puede servir versiones obsoletas si el cliente no usa el endpoint `/api/version` para invalidar manualmente.

Fix: cambiar el `urlPattern` a un regex que excluya `all` explícitamente: `/\/api\/songs\/(?!all$)[^/]+$/i`. XS effort.

### Por qué Gaps 1, 9 se difieren
- **Gap 1** (mobile-first): la deuda es cosmética y los archivos afectados se tocarán inevitablemente al refactorizar UI futura. Convertir hoy es trabajo mecánico sin riesgo, pero también sin urgencia. Política recomendada: cuando se toque cualquiera de los 4 archivos CSS afectados, normalizar el archivo entero a `min-width` como parte del cambio.
- **Gap 9** (no retry): el daño es que un usuario nuevo sin red no obtiene catálogo offline hasta el siguiente arranque PWA — molestia, no falla crítica. Añadir retry exponencial con jitter cuesta XS pero no compite por atención con Tier 1.

### Por qué Gap 5 se descarta
Migrar de hash router a History API requiere un servidor (o función edge) que sirva `index.html` para todas las rutas no-API, y para SEO real requiere SSR — incompatible con stack Vanilla JS sin rewrite a Next.js. El proyecto es una wiki interna para coros (no público abierto); SEO no es prioridad. Cerrar como "won't fix" en la próxima edición de CLAUDE.md.

---

## 5. Plan de ataque (Tiers 1+2)

Esta rama (`chore/pre-migration-gaps`) implementa los Tiers 1+2 en este orden. Cada bloque se commitea por separado para facilitar revisión y rollback.

### Bloque A — Security hardfix (Gap 3)
**Esfuerzo:** XS
**Archivos:** `server/index.js`, `.env.example` (nuevo en raíz y/o `server/.env.example`)
**Cambios:**
- Línea 64: eliminar `|| '1234'`; si `process.env.ADMIN_PIN` está vacío al arranque, `throw new Error('ADMIN_PIN env var required')`.
- Línea 65: eliminar `|| 'secret'`; mismo tratamiento para `JWT_SECRET`.
- Validación al boot del servidor (no en cada request) para que el proceso falle fast si la config está rota.
- Crear `.env.example` (raíz para Vite, `server/.env.example` para backend) con los nombres de las vars requeridas y valores placeholder (`__SET_ME__`). Documenta sin filtrar secretos.

### Bloque B — CI baseline (Gap 7)
**Esfuerzo:** S
**Archivos:** `.github/workflows/ci.yml` (nuevo)
**Cambios:**
- Workflow `ci.yml` triggered en `pull_request` y `push` a `master`.
- Steps: `actions/checkout` → `pnpm/action-setup` (versión coincidente con local: 11.1.1) → `actions/setup-node@v4` (Node 24) → `pnpm install` → `pnpm lint` → `pnpm test:ci` → `pnpm build`.
- Cache de pnpm store para velocidad.
- Status check obligatorio en branch protection (configuración manual fuera del repo).

### Bloque C — Tests backend (Gap 6)
**Esfuerzo:** M
**Archivos:**
- `server/package.json` — añadir devDeps: `vitest`, `supertest`, `@vitest/coverage-v8`. Cambiar `test` script.
- `server/tests/` (nuevo) — tests por endpoint.
- `server/index.js` — exportar la `app` (no llamar a `.listen()` directamente) para que tests la importen sin levantar puerto.
**Estrategia de tests:**
- Base de datos en memoria: `createClient({ url: ':memory:' })` por test suite, seedeada con fixture mínima.
- Tests no tocan Turso real; el adapter abstrae `dbReady`.
- Cobertura mínima Tier 1: 8 endpoints listados, happy path + 1 error path cada uno.

### Bloque D — Performance budget + Lighthouse CI (Gap 2)
**Esfuerzo:** S
**Archivos:**
- `vite.config.js` — añadir `build.chunkSizeWarningLimit: 250` (KB).
- `.github/workflows/ci.yml` — extender con step Lighthouse CI usando `@lhci/cli`.
- `.lighthouserc.json` — config con thresholds: PWA ≥95, Performance ≥80, Accessibility ≥90, Best Practices ≥90.
- Lighthouse corre contra `pnpm preview` server.

### Bloque E — Workbox cache fix (Gap 8)
**Esfuerzo:** XS
**Archivos:** `vite.config.js`
**Cambios:**
- Línea 42: `urlPattern: /\/api\/songs\/[^/]+$/i` → `urlPattern: /\/api\/songs\/(?!all$)[^/]+$/i`.
- Comentario explicando por qué `/api/songs/all` se excluye (prefetch offline lo gestiona IndexedDB, no SW cache).
- Bump del `cacheName` `api-songs-detail` → `api-songs-detail-v2` para invalidar caches existentes en clientes que ya cachearon mal `/api/songs/all`. La eviction del cache viejo es automática vía Workbox cleanup en activación del nuevo SW.

---

## 6. Lo que esta rama NO incluye

- Gaps 4, 10 — se resuelven en la migración (Prompt 2), no aquí. Razón: ambos son cambios de arquitectura que solo tienen sentido contra el stack destino.
- Gap 1 (mobile-first CSS) — diferido. Se atacará oportunísticamente al tocar cada archivo.
- Gap 9 (retry offlineCache) — diferido. Quick win para una rama posterior aparte.
- Gap 5 — descartado. Documentar en CLAUDE.md como "won't fix" en próxima edición.
- Cualquier refactor no listado en los 5 bloques A-E.

---

## 7. Criterios de éxito de la rama

- [ ] Bloque A: `server/index.js` no arranca sin `ADMIN_PIN` y `JWT_SECRET` definidas
- [ ] Bloque B: `gh actions list` muestra workflow `ci.yml` corriendo en PRs
- [ ] Bloque C: `cd server && pnpm test` ejecuta ≥8 tests verdes; CI lo corre
- [ ] Bloque D: `vite build` warning si algún chunk pasa 250KB; Lighthouse CI corre en PR y publica score
- [ ] Bloque E: en build de producción, el SW NO cachea respuestas de `/api/songs/all`
- [ ] CLAUDE.md actualizada: §12 marca gaps 3,7,6,2,8 como "resueltos en chore/pre-migration-gaps"; gap 5 como "descartado"

---

## 8. Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| Eliminar fallbacks de Gap 3 rompe entorno de algún dev local sin `.env` | Crear `.env.example` como parte de Bloque A (ver archivos en bloque). Mensaje de error del throw indica qué var falta. |
| Tests con SQLite in-memory divergen de comportamiento Turso real | Tests cubren contrato HTTP, no implementación. La paridad se valida post-migración con los mismos tests contra Vercel preview |
| Lighthouse CI flaky en runners GitHub | Configurar `numberOfRuns: 3` con mediana, márgenes amplios en thresholds |
| Husky pre-commit hook se ejecuta en CI y duplica trabajo | Skip con `HUSKY=0` env en GitHub Actions |

---

## 9. Próximos pasos tras aprobación

1. Usuario aprueba este spec
2. Invocar `superpowers:writing-plans` para generar plan de implementación detallado por bloque
3. Ejecutar plan (probablemente con `superpowers:subagent-driven-development` dado que los 5 bloques son independientes entre sí)
4. PR a master con squash por bloque
5. Una vez merged: iniciar Prompt 2 (plan de migración Render+Turso → Vercel+Supabase)
