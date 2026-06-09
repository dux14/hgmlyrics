# HKN Lyrics

Wiki de letras de Hakuna Group Music: buscador instantáneo, filtros por álbum,
afinador vocal y modo offline (PWA instalable).

**Producción:** https://hgmlyrics.vercel.app

## Stack

- Vanilla JS (ES modules) + Vite 7 + vite-plugin-pwa
- Vercel Functions (`api/`) para el backend
- Supabase (Postgres, Auth, Storage)
- Vitest 4 para tests, FlexSearch para búsqueda, idb-keyval para cache offline

## Getting started

```bash
git clone https://github.com/dux14/hgmlyrics.git
cd hgmlyrics
pnpm install
cp .env.example .env   # rellenar valores
pnpm dev               # solo front
pnpm dev:vercel        # front + funciones api/ en :3000
```

Variables de entorno (ver `.env.example`): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL`, `ADMIN_EMAILS`.

## Scripts

- `pnpm build` — build de producción
- `pnpm test` / `pnpm test:ci` — tests (watch / run + coverage)
- `pnpm lint` / `pnpm lint:fix` — ESLint sobre `src/`
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm optimize:covers` — optimiza portadas de `public/covers/`

## Estructura

```
src/components/   componentes vanilla (funciones que devuelven DOM)
src/lib/          lógica: búsqueda, afinador, auth, offline, feature flags
api/              Vercel Functions (auth, songs, admin, social, upload)
api/_lib/         helpers compartidos (auth, db, http, storage)
supabase/         migraciones SQL (Supabase CLI)
tests/            Vitest + e2e
```
