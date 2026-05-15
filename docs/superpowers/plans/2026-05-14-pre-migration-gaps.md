# Pre-Migration Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar Tiers 1+2 del audit `docs/superpowers/specs/2026-05-14-claude-md-gaps-audit-design.md` antes de iniciar la migración Render+Turso → Vercel+Supabase. Cierra gaps 3, 6, 7, 2, 8 de CLAUDE.md §12.

**Architecture:** 6 tareas distribuidas en 5 bloques (A-E). Las tareas tocan paths separados cuando es posible para permitir paralelización; donde hay dependencia de archivo (server/index.js, vite.config.js), se ordenan secuencialmente.

**Tech Stack:** Node 24, pnpm, Vite 7, Vitest 4, Supertest, GitHub Actions, @lhci/cli, @libsql/client (in-memory SQLite para tests).

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `server/index.js` | Modify | Fail-fast en boot si faltan env vars; export `app` separado de `.listen()` |
| `server/db.js` | Modify | Soporte `DB_URL` override para tests; export `resetDb()` |
| `.env.example` | Create | Plantilla raíz con vars del frontend (vacía hoy — placeholder para futuro) |
| `server/.env.example` | Create | Plantilla backend con `JWT_SECRET`, `ADMIN_PIN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` |
| `server/package.json` | Modify | Añadir `vitest`, `supertest`, `@vitest/coverage-v8` como devDeps; cambiar script `test` |
| `server/vitest.config.js` | Create | Config con `environment: 'node'`, setup file, coverage para `server/index.js` y `server/db.js` |
| `server/tests/setup.js` | Create | Setea env vars de test antes de cualquier import |
| `server/tests/helpers.js` | Create | `seedSong()`, `clearDb()`, factory de tokens JWT para tests |
| `server/tests/health.test.js` | Create | `/health`, `/api/version` |
| `server/tests/auth.test.js` | Create | `/api/auth/login` (PIN válido/inválido, missing PIN) |
| `server/tests/songs-read.test.js` | Create | `/api/songs`, `/api/songs/all`, `/api/songs/:id`, `/api/songs/search` |
| `server/tests/songs-write.test.js` | Create | `POST/PUT/DELETE /api/songs` (auth required) |
| `.github/workflows/ci.yml` | Create | Workflow lint + test frontend + test backend + build + Lighthouse CI |
| `.lighthouserc.json` | Create | Config Lighthouse CI con thresholds PWA≥0.95, Perf≥0.80 |
| `vite.config.js` | Modify | Regex Workbox excluye `/api/songs/all`, bump cacheName, `build.chunkSizeWarningLimit: 250` |

---

## Task 1: Bloque A — Security hardfix (Gap 3)

**Files:**
- Modify: `server/index.js:43,64-65` y boot section
- Create: `.env.example`
- Create: `server/.env.example`

- [ ] **Step 1.1: Crear `server/.env.example`**

```bash
cat > server/.env.example <<'EOF'
# Backend environment — copy to server/.env for local dev.
# Never commit the populated .env.

# Required: admin login PIN for the wiki editor panel.
ADMIN_PIN=__SET_ME__

# Required: secret for signing JWTs. 32+ random bytes recommended.
# Generate locally with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=__SET_ME__

# Optional: Turso embedded replica. If omitted, falls back to local sqlite.db.
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# Optional: backend HTTP port. Defaults to 3000.
PORT=3000
EOF
```

- [ ] **Step 1.2: Crear `.env.example` en la raíz**

```bash
cat > .env.example <<'EOF'
# Frontend environment — copy to .env for local dev.
# Vite expone vars prefijadas con VITE_. Hoy el frontend no consume ninguna,
# así que este archivo queda como placeholder versionado.

# Example placeholder for future use:
# VITE_API_BASE_URL=http://localhost:3000
EOF
```

- [ ] **Step 1.3: Modificar `server/index.js` — añadir validación fail-fast tras los requires**

Localizar la sección de imports (líneas 1-10) y añadir el bloque de validación inmediatamente después de `const { all, get, run } = require('./db');` y antes de `const app = express();`.

Reemplazar:

```javascript
const { all, get, run } = require('./db');

const app = express();
```

por:

```javascript
const { all, get, run } = require('./db');

// Fail-fast: rechazar arranque sin secrets críticos definidos.
const REQUIRED_ENV = ['ADMIN_PIN', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `❌ Missing required env vars: ${missing.join(', ')}.\n` +
      `   Copy server/.env.example → server/.env and fill the values.`
  );
  process.exit(1);
}

const app = express();
```

- [ ] **Step 1.4: Modificar `server/index.js:64` — eliminar fallback `'1234'`**

Reemplazar:

```javascript
  if (pin === (process.env.ADMIN_PIN || '1234')) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
```

por:

```javascript
  if (pin === process.env.ADMIN_PIN) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '7d' });
```

(La validación del Step 1.3 ya garantiza que ambas vars existen al llegar aquí.)

- [ ] **Step 1.5: Verificar que el servidor falla sin env vars**

Run:
```bash
cd server && unset ADMIN_PIN JWT_SECRET && node index.js; echo "exit=$?"
```
Expected: log `❌ Missing required env vars: ADMIN_PIN, JWT_SECRET` y `exit=1`.

- [ ] **Step 1.6: Verificar que el servidor arranca con env vars**

Run:
```bash
cd server && ADMIN_PIN=test JWT_SECRET=test PORT=3099 timeout 2 node index.js; echo "exit=$?"
```
Expected: log `Server running on http://localhost:3099` y `exit=124` (timeout kill, no error).

- [ ] **Step 1.7: Commit**

```bash
git add server/index.js server/.env.example .env.example
git commit -m "fix(server): fail-fast on missing ADMIN_PIN/JWT_SECRET (gap 3)"
```

---

## Task 2: Bloque E — Workbox cache fix (Gap 8)

**Files:**
- Modify: `vite.config.js:42-54`

- [ ] **Step 2.1: Modificar `vite.config.js` — regex Workbox excluye `/api/songs/all` + bump cacheName**

Reemplazar el segundo entry de `runtimeCaching` (el de `api-songs-detail`):

```javascript
          {
            // Cache individual song detail API
            urlPattern: /\/api\/songs\/[^/]+$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-songs-detail',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
```

por:

```javascript
          {
            // Cache individual song detail API.
            // Exclude /api/songs/all explicitly: it's prefetched into IndexedDB
            // by src/lib/offlineCache.js and must always reflect server `version`.
            // cacheName bumped to v2 to evict caches contaminated by previous
            // regex that captured /api/songs/all.
            urlPattern: /\/api\/songs\/(?!all$)[^/]+$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-songs-detail-v2',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
```

- [ ] **Step 2.2: Verificar build produce SW válido**

Run:
```bash
pnpm build
grep -c "api-songs-detail-v2" dist/sw.js && grep -c "api-songs-detail[^-]" dist/sw.js
```
Expected: `1` (nuevo cache presente) y `0` (cache viejo ya no aparece como standalone).

- [ ] **Step 2.3: Verificar regex excluye `/api/songs/all` en runtime**

Run:
```bash
node -e "const re = /\/api\/songs\/(?!all\$)[^/]+\$/i; console.log('all:', re.test('/api/songs/all')); console.log('abc:', re.test('/api/songs/abc')); console.log('all-2:', re.test('/api/songs/all-2'));"
```
Expected:
```
all: false
abc: true
all-2: true
```

- [ ] **Step 2.4: Commit**

```bash
git add vite.config.js
git commit -m "fix(pwa): exclude /api/songs/all from Workbox SWR cache (gap 8)"
```

---

## Task 3: Bloque B — CI baseline (Gap 7)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 3.1: Crear `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      HUSKY: '0'
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.1.1

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install root deps
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Frontend tests
        run: pnpm test:ci

      - name: Install server deps
        working-directory: server
        run: pnpm install --frozen-lockfile

      - name: Backend tests
        working-directory: server
        env:
          ADMIN_PIN: ci-pin
          JWT_SECRET: ci-secret-do-not-use-in-prod
          DB_URL: ':memory:'
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **Step 3.2: Verificar sintaxis YAML**

Run:
```bash
node -e "const yaml = require('js-yaml'); console.log(yaml.load(require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')))" 2>&1 || \
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```
Expected: parseo exitoso sin errores.

- [ ] **Step 3.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions baseline — lint + tests + build (gap 7)"
```

> Nota: branch protection en `master` requiriendo este workflow es config manual en GitHub UI; fuera de scope del plan.

---

## Task 4: Bloque C — Backend testability refactor (Gap 6, parte 1)

**Files:**
- Modify: `server/db.js`
- Modify: `server/index.js:286-289` (bottom: listen + exports)
- Modify: `server/package.json`
- Create: `server/vitest.config.js`
- Create: `server/tests/setup.js`
- Create: `server/tests/helpers.js`

- [ ] **Step 4.1: Modificar `server/db.js` — soporte `DB_URL` override**

Reemplazar las líneas 4-19 (bloque de `isProduction` y `createClient`):

```javascript
// Embedded Replica mode:
// - In production: local replica file syncs with Turso cloud.
//   Reads are instant (local file), writes go to remote then sync back.
// - In development: uses local sqlite.db directly (no remote).
const isProduction = !!process.env.TURSO_DATABASE_URL;

const client = isProduction
  ? createClient({
      url: `file:${path.resolve(__dirname, 'local-replica.db')}`,
      syncUrl: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
      syncInterval: 60, // auto-sync every 60 seconds
    })
  : createClient({
      url: `file:${path.resolve(__dirname, 'sqlite.db')}`,
    });
```

por:

```javascript
// Client modes (resolved at module load):
// 1. DB_URL set        → use it directly (tests use ':memory:').
// 2. TURSO_DATABASE_URL → embedded replica mode (production).
// 3. fallback           → local sqlite.db (development).
const isTest = !!process.env.DB_URL;
const isProduction = !isTest && !!process.env.TURSO_DATABASE_URL;

const client = isTest
  ? createClient({ url: process.env.DB_URL })
  : isProduction
    ? createClient({
        url: `file:${path.resolve(__dirname, 'local-replica.db')}`,
        syncUrl: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
        syncInterval: 60, // auto-sync every 60 seconds
      })
    : createClient({
        url: `file:${path.resolve(__dirname, 'sqlite.db')}`,
      });
```

- [ ] **Step 4.2: Modificar `server/db.js` — export helper `resetDb` para tests**

Localizar la línea final `module.exports = { client, run, all, get };` y reemplazar por:

```javascript
/**
 * Drop and recreate the songs table. ONLY for tests with DB_URL=:memory:.
 * Throws if invoked in production.
 */
async function resetDb() {
  if (!process.env.DB_URL) {
    throw new Error('resetDb() only allowed when DB_URL is set (test mode)');
  }
  await dbReady;
  await client.execute('DROP TABLE IF EXISTS songs');
  await initDB();
}

module.exports = { client, run, all, get, resetDb };
```

- [ ] **Step 4.3: Modificar `server/index.js` — separar listen del export**

Localizar las líneas 285-289 (bottom):

```javascript
// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
module.exports = { app, authMiddleware };
```

Reemplazar por:

```javascript
module.exports = { app, authMiddleware };

// START SERVER (only when run as CLI, never on require/import).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 4.4: Modificar `server/package.json` — devDeps y script de test**

Reemplazar el archivo entero:

```json
{
  "name": "server",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "build": "cd .. && npm install --include=dev --ignore-scripts && npm run build",
    "migrate": "node migrate-to-turso.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "@libsql/client": "^0.15.0",
    "bcryptjs": "^3.0.3",
    "compression": "^1.8.1",
    "cors": "^2.8.6",
    "dotenv": "^17.3.1",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "multer": "^2.1.1"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^4.1.0",
    "supertest": "^7.0.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 4.5: Instalar deps de server**

Run:
```bash
cd server && pnpm install
```
Expected: instala vitest, supertest, @vitest/coverage-v8; `pnpm-lock.yaml` creado/actualizado en `server/`.

- [ ] **Step 4.6: Crear `server/vitest.config.js`**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['index.js', 'db.js'],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
});
```

- [ ] **Step 4.7: Crear `server/tests/setup.js`**

```javascript
// Runs BEFORE any test file imports the app.
// Sets env vars so server/index.js boot validation passes and db.js
// uses an in-memory SQLite instead of touching the filesystem.

process.env.ADMIN_PIN = 'test-pin-1234';
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
process.env.DB_URL = ':memory:';
process.env.NODE_ENV = 'test';
// Ensure no Turso embedded mode kicks in.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
```

- [ ] **Step 4.8: Crear `server/tests/helpers.js`**

```javascript
const jwt = require('jsonwebtoken');
const { run, resetDb } = require('../db');

/**
 * Sign a JWT as admin using the test JWT_SECRET.
 * @returns {string} Bearer token (without "Bearer " prefix).
 */
function makeAdminToken() {
  return jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Insert a song row directly via the db helpers.
 * @param {object} overrides Optional fields to override the default fixture.
 */
async function seedSong(overrides = {}) {
  const fixture = {
    id: 'song-1',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    albumSlug: 'test-album',
    year: 2024,
    genre: 'pop',
    voiceType: 'SATB',
    voicePercentMale: 50,
    voicePercentFemale: 50,
    coverImage: '/covers/test.webp',
    sections: JSON.stringify([{ type: 'verse', text: 'la la la' }]),
    albumOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cejilla: null,
    ...overrides,
  };
  await run(
    `INSERT INTO songs (
      id, title, artist, album, albumSlug, year, genre,
      voiceType, voicePercentMale, voicePercentFemale, coverImage,
      sections, albumOrder, createdAt, updatedAt, cejilla
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fixture.id, fixture.title, fixture.artist, fixture.album, fixture.albumSlug,
      fixture.year, fixture.genre, fixture.voiceType,
      fixture.voicePercentMale, fixture.voicePercentFemale, fixture.coverImage,
      fixture.sections, fixture.albumOrder,
      fixture.createdAt, fixture.updatedAt, fixture.cejilla,
    ]
  );
  return fixture;
}

module.exports = { makeAdminToken, seedSong, resetDb };
```

- [ ] **Step 4.9: Commit**

```bash
git add server/db.js server/index.js server/package.json server/pnpm-lock.yaml server/vitest.config.js server/tests/setup.js server/tests/helpers.js
git commit -m "refactor(server): testability — DB_URL override, conditional listen, vitest scaffold (gap 6 prep)"
```

---

## Task 5: Bloque C — Backend test suites (Gap 6, parte 2)

**Files:**
- Create: `server/tests/health.test.js`
- Create: `server/tests/auth.test.js`
- Create: `server/tests/songs-read.test.js`
- Create: `server/tests/songs-write.test.js`

> Cada step de este task escribe el test (TDD: ya tenemos la implementación, los tests validan paridad). Después de cada archivo de test se corre vitest para verificar PASS.

- [ ] **Step 5.1: Crear `server/tests/health.test.js`**

```javascript
const request = require('supertest');
const { app } = require('../index');
const { resetDb } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('GET /health', () => {
  it('responds with "ok"', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});

describe('GET /api/version', () => {
  it('returns a numeric dataVersion', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(typeof res.body.dataVersion).toBe('number');
    expect(res.body.dataVersion).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5.2: Correr health tests**

Run:
```bash
cd server && pnpm test -- tests/health.test.js
```
Expected: 2 tests PASS.

- [ ] **Step 5.3: Crear `server/tests/auth.test.js`**

```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const { resetDb } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/auth/login', () => {
  it('returns 400 when PIN missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PIN/i);
  });

  it('returns 401 with wrong PIN', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: 'wrong-pin' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns a valid JWT with the correct PIN', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ pin: process.env.ADMIN_PIN });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.admin).toBe(true);
    expect(payload.exp - payload.iat).toBeGreaterThan(60 * 60 * 24 * 6); // ~7d
  });
});
```

- [ ] **Step 5.4: Correr auth tests**

Run:
```bash
cd server && pnpm test -- tests/auth.test.js
```
Expected: 3 tests PASS.

- [ ] **Step 5.5: Crear `server/tests/songs-read.test.js`**

```javascript
const request = require('supertest');
const { app } = require('../index');
const { resetDb, seedSong } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/songs', () => {
  it('returns empty list when no songs seeded', async () => {
    const res = await request(app).get('/api/songs');
    expect(res.status).toBe(200);
    expect(res.body.songs).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('returns seeded songs with voicePercent object', async () => {
    await seedSong({ id: 's1', title: 'Uno' });
    await seedSong({ id: 's2', title: 'Dos', album: 'Other', albumOrder: 2 });

    const res = await request(app).get('/api/songs');
    expect(res.status).toBe(200);
    expect(res.body.songs).toHaveLength(2);
    const first = res.body.songs[0];
    expect(first.voicePercent).toEqual({ male: 50, female: 50 });
    expect(first).not.toHaveProperty('voicePercentMale');
    expect(first).not.toHaveProperty('voicePercentFemale');
  });
});

describe('GET /api/songs/all', () => {
  it('returns songs with parsed sections and Cache-Control no-store', async () => {
    await seedSong({ id: 's1' });
    const res = await request(app).get('/api/songs/all');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.songs).toHaveLength(1);
    expect(res.body.songs[0].sections).toEqual([
      { type: 'verse', text: 'la la la' },
    ]);
    expect(typeof res.body.version).toBe('number');
  });
});

describe('GET /api/songs/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/songs/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns full song with sections parsed', async () => {
    await seedSong({ id: 'abc' });
    const res = await request(app).get('/api/songs/abc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('abc');
    expect(res.body.sections).toEqual([
      { type: 'verse', text: 'la la la' },
    ]);
    expect(res.body.voicePercent).toEqual({ male: 50, female: 50 });
  });
});

describe('GET /api/songs/search', () => {
  it('returns empty results for empty query', async () => {
    const res = await request(app).get('/api/songs/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('is accent-insensitive', async () => {
    await seedSong({ id: 's1', title: 'Canción de prueba' });
    const res = await request(app).get('/api/songs/search?q=cancion');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe('s1');
  });

  it('matches against title/album/artist', async () => {
    await seedSong({ id: 's1', title: 'Foo', album: 'Bar', artist: 'Baz' });
    const r1 = await request(app).get('/api/songs/search?q=foo');
    const r2 = await request(app).get('/api/songs/search?q=bar');
    const r3 = await request(app).get('/api/songs/search?q=baz');
    expect(r1.body.results).toHaveLength(1);
    expect(r2.body.results).toHaveLength(1);
    expect(r3.body.results).toHaveLength(1);
  });
});
```

- [ ] **Step 5.6: Correr songs-read tests**

Run:
```bash
cd server && pnpm test -- tests/songs-read.test.js
```
Expected: 8 tests PASS.

- [ ] **Step 5.7: Crear `server/tests/songs-write.test.js`**

```javascript
const request = require('supertest');
const { app } = require('../index');
const { resetDb, seedSong, makeAdminToken } = require('./helpers');

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/songs (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/songs')
      .send({ id: 'x', title: 'X' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .post('/api/songs')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send({ id: 'x', title: 'X' });
    expect(res.status).toBe(401);
  });

  it('inserts a song with admin token', async () => {
    const token = makeAdminToken();
    const res = await request(app)
      .post('/api/songs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'new-song',
        title: 'New',
        artist: 'A',
        album: 'B',
        albumSlug: 'b',
        year: 2025,
        genre: 'rock',
        voiceType: 'SATB',
        voicePercent: { male: 60, female: 40 },
        coverImage: null,
        sections: [{ type: 'verse', text: 'hi' }],
        albumOrder: 1,
        cejilla: 3,
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe('new-song');

    const fetched = await request(app).get('/api/songs/new-song');
    expect(fetched.status).toBe(200);
    expect(fetched.body.title).toBe('New');
    expect(fetched.body.voicePercent).toEqual({ male: 60, female: 40 });
    expect(fetched.body.sections).toEqual([{ type: 'verse', text: 'hi' }]);
    expect(fetched.body.cejilla).toBe(3);
  });
});

describe('PUT /api/songs/:id (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).put('/api/songs/x').send({ title: 'X' });
    expect(res.status).toBe(401);
  });

  it('updates an existing song with admin token', async () => {
    await seedSong({ id: 's1', title: 'Original' });
    const token = makeAdminToken();
    const res = await request(app)
      .put('/api/songs/s1')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated',
        artist: 'A',
        album: 'B',
        albumSlug: 'b',
        year: 2025,
        genre: 'pop',
        voiceType: 'SATB',
        voicePercent: { male: 50, female: 50 },
        coverImage: null,
        sections: [],
        albumOrder: 0,
        cejilla: null,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const fetched = await request(app).get('/api/songs/s1');
    expect(fetched.body.title).toBe('Updated');
  });
});

describe('DELETE /api/songs/:id (auth required)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).delete('/api/songs/x');
    expect(res.status).toBe(401);
  });

  it('removes the song with admin token', async () => {
    await seedSong({ id: 's1' });
    const token = makeAdminToken();
    const res = await request(app)
      .delete('/api/songs/s1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const fetched = await request(app).get('/api/songs/s1');
    expect(fetched.status).toBe(404);
  });
});

describe('writes bump dataVersion', () => {
  it('increments dataVersion after a POST', async () => {
    const before = (await request(app).get('/api/version')).body.dataVersion;
    // Wait 5ms to guarantee Date.now() advances.
    await new Promise((r) => setTimeout(r, 5));
    const token = makeAdminToken();
    await request(app)
      .post('/api/songs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'v-test',
        title: 'V',
        artist: '',
        album: '',
        albumSlug: '',
        year: 2025,
        genre: '',
        voiceType: '',
        voicePercent: { male: 50, female: 50 },
        coverImage: null,
        sections: [],
        albumOrder: 0,
        cejilla: null,
      });
    const after = (await request(app).get('/api/version')).body.dataVersion;
    expect(after).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 5.8: Correr songs-write tests**

Run:
```bash
cd server && pnpm test -- tests/songs-write.test.js
```
Expected: 8 tests PASS.

- [ ] **Step 5.9: Correr todo el suite con coverage**

Run:
```bash
cd server && pnpm test -- --coverage
```
Expected: 21 tests PASS (2 health + 3 auth + 8 songs-read + 8 songs-write). Coverage de `index.js` y `db.js` ≥70% statements.

- [ ] **Step 5.10: Commit**

```bash
git add server/tests/
git commit -m "test(server): integration tests for health/auth/songs endpoints (gap 6)"
```

---

## Task 6: Bloque D — Perf budget + Lighthouse CI (Gap 2)

**Files:**
- Modify: `vite.config.js` (añadir `chunkSizeWarningLimit`)
- Create: `.lighthouserc.json`
- Modify: `.github/workflows/ci.yml` (extender con step Lighthouse)

- [ ] **Step 6.1: Modificar `vite.config.js` — añadir `chunkSizeWarningLimit`**

Localizar el bloque `build:` (líneas 88-98 tras Task 2) y modificar para añadir el campo:

```javascript
  build: {
    target: 'es2020',
    minify: 'terser',
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks: {
          flexsearch: ['flexsearch'],
        },
      },
    },
  },
```

- [ ] **Step 6.2: Crear `.lighthouserc.json`**

```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:4173/"],
      "startServerCommand": "pnpm preview --port 4173",
      "startServerReadyPattern": "Local:",
      "numberOfRuns": 3,
      "settings": {
        "preset": "desktop",
        "chromeFlags": "--no-sandbox --headless=new"
      }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["warn", { "minScore": 0.8 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "categories:best-practices": ["warn", { "minScore": 0.9 }],
        "categories:pwa": ["error", { "minScore": 0.95 }]
      }
    },
    "upload": {
      "target": "temporary-public-storage"
    }
  }
}
```

- [ ] **Step 6.3: Extender `.github/workflows/ci.yml` con step Lighthouse**

Añadir al final del job `test`, después del step `Build`:

```yaml
      - name: Install Lighthouse CI
        run: pnpm add -g @lhci/cli@^0.14.0

      - name: Lighthouse CI
        run: lhci autorun
        env:
          LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

(El `LHCI_GITHUB_APP_TOKEN` es opcional — sin él, Lighthouse igual corre y sube a temporary public storage; con él, postea status check al PR. Configurar a posteriori.)

- [ ] **Step 6.4: Verificar `vite build` warning si chunk > 250KB**

Run:
```bash
pnpm build
```
Expected: build exitoso. Si algún chunk supera 250KB se loggea warning (informativo, no falla).

- [ ] **Step 6.5: Verificar `.lighthouserc.json` parsea**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('.lighthouserc.json', 'utf8'))" && echo OK
```
Expected: `OK`.

- [ ] **Step 6.6: Commit**

```bash
git add vite.config.js .lighthouserc.json .github/workflows/ci.yml
git commit -m "ci: chunkSizeWarningLimit + Lighthouse CI thresholds (gap 2)"
```

---

## Task 7: Wrap-up — actualizar CLAUDE.md §12

**Files:**
- Modify: `CLAUDE.md` (sección "Gaps detectados")

> Nota: `CLAUDE.md` está agregada a `.gitignore` por el usuario (cambio WIP). Si sigue ignorada al ejecutar este task, hacer `git add -f CLAUDE.md` SOLO si el usuario lo aprueba; si no, dejar la actualización local sin commit y avisar.

- [ ] **Step 7.1: Verificar estado de tracking de CLAUDE.md**

Run:
```bash
git check-ignore CLAUDE.md; echo "exit=$?"
```
Expected: si imprime `CLAUDE.md` con `exit=0` → está ignorada. Si `exit=1` → tracked normalmente.

- [ ] **Step 7.2: Modificar `CLAUDE.md §12` — marcar gaps cerrados**

En la tabla de gaps, añadir una columna final "Estado" (o un sufijo en la columna existente) marcando:

| # | Marcar como |
|---|---|
| 2 | ✅ resuelto en `chore/pre-migration-gaps` |
| 3 | ✅ resuelto en `chore/pre-migration-gaps` |
| 5 | ⛔ descartado (decisión arquitectónica, won't fix) |
| 6 | ✅ resuelto en `chore/pre-migration-gaps` |
| 7 | ✅ resuelto en `chore/pre-migration-gaps` |
| 8 | ✅ resuelto en `chore/pre-migration-gaps` |
| 1, 9 | ⏸️ diferido |
| 4, 10 | ➡️ se resuelve en migración Vercel+Supabase |

(Editar manualmente la tabla preservando formato existente.)

- [ ] **Step 7.3: Commit (solo si CLAUDE.md está tracked)**

Run:
```bash
git check-ignore CLAUDE.md > /dev/null; if [ $? -eq 1 ]; then \
  git add CLAUDE.md && \
  git commit -m "docs(claude-md): mark gaps 2,3,5,6,7,8 resolved/discarded"; \
else \
  echo "CLAUDE.md ignored — skipping commit, user will manage manually"; \
fi
```

---

## Final verification

- [ ] **Step F.1: Suite completo local**

Run:
```bash
pnpm install --frozen-lockfile && \
pnpm lint && \
pnpm test:ci && \
(cd server && pnpm install --frozen-lockfile && \
  ADMIN_PIN=test JWT_SECRET=test DB_URL=:memory: pnpm test) && \
pnpm build
```
Expected: todo verde. Si algo falla, fix antes de seguir.

- [ ] **Step F.2: Sanity check de archivos creados/modificados**

Run:
```bash
git log --oneline master..HEAD
git diff --stat master..HEAD
```
Expected: ~6-7 commits, archivos esperados (`server/index.js`, `server/db.js`, `server/package.json`, `server/tests/*`, `vite.config.js`, `.github/workflows/ci.yml`, `.lighthouserc.json`, `.env.example`, `server/.env.example`).

- [ ] **Step F.3: Push y abrir PR (opcional, decisión del usuario)**

Run:
```bash
git push -u origin chore/pre-migration-gaps
gh pr create --title "Pre-migration gaps: security, CI, tests, perf budget, Workbox fix" --body "$(cat <<'EOF'
## Summary
Implementa Tiers 1+2 del audit `docs/superpowers/specs/2026-05-14-claude-md-gaps-audit-design.md` antes de migrar Render+Turso → Vercel+Supabase.

Cierra:
- Gap 3: fallbacks de `ADMIN_PIN`/`JWT_SECRET` removidos, fail-fast en boot
- Gap 6: 21 tests de integración para backend (health, auth, songs CRUD)
- Gap 7: GitHub Actions CI baseline (lint + tests + build + Lighthouse)
- Gap 2: `chunkSizeWarningLimit` + Lighthouse CI con thresholds PWA≥0.95
- Gap 8: regex Workbox excluye `/api/songs/all`, cacheName bumped a v2

Difiere:
- Gap 4, 10: se resuelven en plan de migración separado
- Gap 1, 9: housekeeping post-migración

Descarta:
- Gap 5: hash router SEO como decisión arquitectónica (won't fix)

## Test plan
- [ ] CI verde en este PR
- [ ] Levantar local con `ADMIN_PIN=... JWT_SECRET=... cd server && pnpm start` — debe arrancar
- [ ] Quitar `JWT_SECRET` del entorno — debe rechazar arranque con mensaje claro
- [ ] `pnpm build && pnpm preview` y abrir DevTools → Application → Service Workers, verificar cache `api-songs-detail-v2` y NO `api-songs-detail`
EOF
)"
```

---

## Dependency graph (para paralelización con subagent-driven-development)

```
Task 1 (server/index.js A) ─┐
                            ├─→ Task 4 (server/index.js C) ─→ Task 5 (tests)
Task 2 (vite.config.js E) ──┤
                            ├─→ Task 6 (vite.config.js D + CI ext)
Task 3 (CI baseline)  ──────┘                              └─→ Task 7 (wrap-up)
```

- **Paralelizable en wave 1:** Task 1, Task 2, Task 3
- **Wave 2 (tras wave 1):** Task 4 (depende de Task 1), Task 6 (depende de Task 2 + Task 3)
- **Wave 3 (tras Task 4):** Task 5
- **Wave 4 (tras todo):** Task 7

---

## Notes para el ejecutor

- Cualquier instalación con `npm`/`yarn` en local viola la regla del proyecto: usar `pnpm` siempre.
- El `pre-commit` hook de Husky correrá ESLint + Prettier en archivos `.js`/`.css`/`.html`/`.json`. No usar `--no-verify`.
- Si los tests del Task 5 fallan por diferencias entre SQLite in-memory y Turso (ej. tipos de fechas), ese es el primer hallazgo de paridad — documentarlo en el PR description, no silenciarlo.
- `pnpm-workspace.yaml` NO se crea: el server es un sub-proyecto con `pnpm install` propio, no un workspace formal del monorepo. Esto se podría cambiar post-migración.
