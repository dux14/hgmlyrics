# Fix: logout que a veces aterriza en /favoritos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging para confirmar la causa raíz ANTES de tocar código de producción, y superpowers:subagent-driven-development (o executing-plans) para ejecutar las tareas. Steps usan checkbox (`- [ ]`).
>
> **GUARD DE RAMA (obligatorio):** todo el trabajo va en la rama `beta-stems`. Antes de CUALQUIER edición ejecuta `git branch --show-current`; si no estás en `beta-stems`, haz `git checkout beta-stems`. NUNCA commitees a `master`.

**Goal:** Eliminar el comportamiento intermitente por el que hacer *logout* termina mostrando `/favoritos` (u otra ruta protegida) en vez de `/login`, y evitar que el botón "atrás" tras el logout re-exponga contenido protegido.

**Architecture:** El logout (`AuthButton.js`) hace `await signOut(); navigate('/login')`, que empuja al history y corre en carrera con el callback async `onAuthStateChange` (`authStore.js`). Las rutas protegidas redirigen con `navigate('/login?next=<path>')` **empujando** history (`router.js:171`). La corrección endurece la navegación de salida: se añade soporte `{ replace }` a `navigate` (vía `history.replaceState` + re-resolve forzado y síncrono) y se usa en el logout y en la redirección del guard, de modo que la entrada protegida no quede en el history ni pueda re-resolverse durante el signout.

**Tech Stack:** Vanilla JS, router hash-based (`src/router.js`), `history.replaceState`, Vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-09-afinador-entrenamiento-validacion-y-fix-logout-design.md`

**Convenciones del repo que DEBES seguir:**
- `pnpm` siempre, nunca `npm`/`yarn`.
- Tests en `tests/*.test.js`. El router se testea con import directo y `refresh()`/`navigate()` (ver `tests/router.test.js`).
- Comentarios y copy en español; código (nombres) en inglés.
- Prettier: singleQuote, printWidth 100. `pnpm lint` antes de cada commit.
- **Todos los commits terminan con la línea:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/router.js` | Modify | `navigate(path, { replace })` + redirección del guard con `replace` |
| `src/components/AuthButton.js` | Modify | Logout usa `navigate('/login', { replace: true })` |
| `tests/authLogout.test.js` | Create | Regresión: tras signOut se aterriza en /login y no se re-resuelve ruta protegida |
| `tests/router.test.js` | Modify | Cobertura de `navigate` con `{ replace }` |

---

### Task 0: Verificar rama

- [ ] **Step 1: Confirmar `beta-stems`**

```bash
cd /Users/samu/code/personal/Mark-N-Hkl/hgmlyrics
git branch --show-current   # Expected: beta-stems
```

---

### Task 1: Reproducir e instrumentar (causa raíz primero)

> **NO escribas el fix todavía.** Primero confirma el mecanismo con instrumentación temporal. Esta tarea no commitea cambios de producción; los logs se revierten en la Task 5.

**Files:**
- Modify (temporal): `src/router.js`, `src/lib/authStore.js`, `src/components/AuthButton.js`

- [ ] **Step 1: Añadir logs temporales**

En `src/router.js`, dentro de `resolve()`, justo tras calcular `path`/`query`:

```js
  console.debug('[dbg][router] resolve', { fullPath, prev: currentRoute });
```

En `src/router.js`, dentro de `navigate()`, al entrar:

```js
  console.debug('[dbg][router] navigate', { path, currentHash: window.location.hash });
```

En `src/router.js`, dentro de `guardedRoute(...)`, en la rama no autenticado (antes del `navigate('/login?next=...')`):

```js
      console.debug('[dbg][guard] not-auth redirect from', path);
```

En `src/lib/authStore.js`, dentro del callback de `onAuthStateChange`, al entrar:

```js
    console.debug('[dbg][auth] onAuthStateChange', _event, !!session);
```

En `src/components/AuthButton.js`, en el handler de logout, antes y después de `navigate('/login')`:

```js
        console.debug('[dbg][logout] before navigate, hash=', window.location.hash);
        await signOut();
        cleanup();
        console.debug('[dbg][logout] after signOut, navigating to /login');
        navigate('/login');
```

- [ ] **Step 2: Reproducir desde varias rutas**

Run: `pnpm dev`. Con sesión iniciada, hacer logout desde el menú estando en **cada** una de: `#/`, `#/favoritos`, `#/afinador`, `#/perfil`, `#/amigos`. Abrir la consola del navegador y, en cada caso, capturar la secuencia de `[dbg]`.

- [ ] **Step 3: Confirmar el mecanismo y anotarlo**

Buscar en los logs el orden real de eventos. Confirmar cuál de estas hipótesis ocurre (o documentar la observada):
- (H1) Tras `navigate('/login')`, un `resolve()` re-entra a una ruta protegida (`[dbg][router] resolve` con `fullPath` de favoritos) porque el `hashchange` de la URL previa aún está encolado.
- (H2) `onAuthStateChange` llega DESPUÉS del `navigate`, disparando un re-render/re-resolve que reabre la ruta previa.
- (H3) Un `?next=/favoritos` remanente de una redirección previa del guard se propaga al volver a `/login`.

Anotar la causa confirmada como comentario al inicio de `tests/authLogout.test.js` (Task 2) y/o en el spec. **La corrección de la Task 3-4 (forzar `/login` con `replace` + re-resolve síncrono, sin dejar la ruta protegida en history) neutraliza H1, H2 y H3**, por lo que es válida una vez confirmada cualquiera de ellas.

- [ ] **Step 4: Quitar los logs temporales (de momento)**

Revertir los `console.debug('[dbg]...` añadidos en el Step 1 ANTES de continuar (se reintroducirán solo si hace falta más diagnóstico). No commitear nada en esta tarea.

```bash
git checkout -- src/router.js src/lib/authStore.js src/components/AuthButton.js
```

---

### Task 2: Test de regresión que falla

**Files:**
- Create: `tests/authLogout.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
// tests/authLogout.test.js
/**
 * Regresión del bug: logout que a veces aterriza en una ruta protegida.
 * Causa raíz confirmada en investigación (Task 1): <ANOTAR Hx aquí>.
 * El fix endurece la navegación de salida con navigate(path, { replace }).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  route,
  navigate,
  guardedRoute,
  configureAuth,
  refresh,
  getCurrentPath,
} from '../src/router.js';

describe('navigate con { replace }', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('aterriza en el destino y re-resuelve de forma síncrona', () => {
    const login = vi.fn();
    route('/login', login);
    navigate('/login', { replace: true });
    expect(getCurrentPath()).toBe('/login');
    expect(login).toHaveBeenCalled();
  });
});

describe('logout no re-expone una ruta protegida', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('tras signOut, ir a /login no vuelve a invocar el handler protegido', () => {
    let authed = true;
    configureAuth({
      isAuthenticated: () => authed,
      needsOnboarding: () => false,
      isAdmin: () => false,
    });
    const favHandler = vi.fn();
    const loginHandler = vi.fn();
    guardedRoute('/favoritos', favHandler);
    route('/login', loginHandler);

    // Usuario autenticado en /favoritos.
    window.location.hash = '/favoritos';
    refresh();
    expect(favHandler).toHaveBeenCalledTimes(1);

    // Logout: la sesión cae y navegamos a /login con replace.
    authed = false;
    navigate('/login', { replace: true });

    expect(getCurrentPath()).toBe('/login');
    expect(loginHandler).toHaveBeenCalled();
    // El handler protegido NO se vuelve a invocar tras el logout.
    expect(favHandler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run tests/authLogout.test.js`
Expected: FAIL — el primer test falla porque `navigate` ignora el 2º argumento y NO re-resuelve de forma síncrona (`login` no se llama / `getCurrentPath()` no es `/login`).

---

### Task 3: Soporte `{ replace }` en `navigate`

**Files:**
- Modify: `src/router.js`

- [ ] **Step 1: Reescribir `navigate`**

Reemplazar la función `navigate` en `src/router.js` por:

```js
/**
 * Navigate to a hash route.
 * @param {string} path - e.g., '/song/my-song-id'
 * @param {{ replace?: boolean }} [opts] - replace: usa history.replaceState y
 *   re-resuelve de forma síncrona (no deja la ruta actual en el history).
 */
export function navigate(path, { replace = false } = {}) {
  const currentHash = window.location.hash;
  const targetHash = path.startsWith('#') ? path : `#${path}`;

  if (replace) {
    // Reemplaza la entrada actual (la protegida no queda en el history) y
    // fuerza el re-resolve: replaceState no dispara 'hashchange'.
    window.history.replaceState(null, '', targetHash);
    currentRoute = null;
    resolve();
    return;
  }

  if (currentHash === targetHash) {
    // Hash is already set, hashchange won't fire — force re-resolve
    currentRoute = null;
    resolve();
  } else {
    window.location.hash = path;
  }
}
```

- [ ] **Step 2: Correr el test de la Task 2**

Run: `pnpm vitest run tests/authLogout.test.js`
Expected: PASS (ambos describe).

- [ ] **Step 3: Añadir cobertura en `router.test.js`**

```js
// tests/router.test.js — dentro de describe('navigate', ...)
it('with { replace } resolves synchronously without leaving a history entry', () => {
  const handler = vi.fn();
  route('/login', handler);
  navigate('/login', { replace: true });
  expect(handler).toHaveBeenCalled();
  expect(getCurrentPath()).toBe('/login');
});
```

- [ ] **Step 4: Correr router.test.js**

Run: `pnpm vitest run tests/router.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/router.js tests/authLogout.test.js tests/router.test.js
git commit -m "feat(router): navigate soporta { replace } con re-resolve sincrono"
```

---

### Task 4: Usar `replace` en logout y en la redirección del guard

**Files:**
- Modify: `src/components/AuthButton.js`
- Modify: `src/router.js`

- [ ] **Step 1: Logout con replace**

En `src/components/AuthButton.js`, el handler de `#logout-btn`:

```js
      menu.querySelector('#logout-btn').addEventListener('click', async () => {
        await signOut();
        cleanup();
        navigate('/login', { replace: true });
      });
```

- [ ] **Step 2: Redirección del guard con replace**

En `src/router.js`, dentro de `guardedRoute`, la rama de no autenticado:

```js
    if (!authAdapter.isAuthenticated()) {
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
      return;
    }
```

> Esto evita que la URL protegida se acumule en el history al ser pateada a login, cerrando la vía por la que "atrás" re-exponía contenido protegido.

- [ ] **Step 3: Verificar suite completa**

Run: `pnpm vitest run`
Expected: PASS (incluye `router.test.js`, `authLogout.test.js`, `authStore.test.js` y el resto).

- [ ] **Step 4: Commit**

```bash
git add src/components/AuthButton.js src/router.js
git commit -m "fix(auth): logout y guard redirigen con replace para no reabrir rutas protegidas"
```

---

### Task 5: Verificación final y limpieza

**Files:**
- (verificación; sin nuevos cambios salvo que la Task 1 dejara logs)

- [ ] **Step 1: Confirmar que no quedan logs `[dbg]`**

Run: `git grep -n "\[dbg\]" src/ ; echo "exit:$?"`
Expected: sin coincidencias (`exit:1` de grep significa "nada encontrado"). Si aparece alguno, eliminarlo y commitear.

- [ ] **Step 2: Verificación manual de los criterios de aceptación**

Run: `pnpm dev`. Con sesión iniciada, hacer logout desde **cada** ruta y confirmar:
- Logout desde `#/`, `#/favoritos`, `#/afinador`, `#/perfil`, `#/amigos` → **siempre** termina en `#/login`.
- Tras el logout, el botón "atrás" del navegador **no** muestra contenido protegido (redirige a login).
- Repetir el logout 5–10 veces desde `#/favoritos` para descartar la intermitencia original.

- [ ] **Step 3: Suite + lint verdes**

Run: `pnpm vitest run`
Expected: PASS.

Run: `pnpm lint`
Expected: sin errores.

---

## Criterios de aceptación

- Logout desde `/`, `/favoritos`, `/afinador`, `/perfil`, `/amigos` → siempre `/login`.
- El botón "atrás" tras logout no muestra contenido protegido.
- `pnpm vitest run` y `pnpm lint` verdes.
- No quedan `console.debug('[dbg]...')` en el código.

## Nota sobre el método

Si la instrumentación de la Task 1 revela una causa raíz distinta a H1/H2/H3 (p. ej. un segundo origen de logout, o un estado de sesión que no se limpia), **detente y ajusta el fix** antes de continuar: el objetivo es la causa raíz confirmada, no aplicar el parche a ciegas. El endurecimiento con `replace` es la corrección esperada para las hipótesis identificadas por lectura del código.
