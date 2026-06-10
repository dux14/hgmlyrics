/**
 * WorldPage.js — Mundo virtual: host de la escena Phaser.
 *
 * Exporta:
 *  - resolveWorldGate({ user, online }) → 'login' | 'offline' | 'ok'
 *  - renderWorldPage(container)
 *
 * Teardown: registra una guarda de hashchange que destruye el juego Phaser
 * al salir de #/mundo (mismo patrón que StudioPage.js).
 */
import { getSession } from '../lib/authStore.js';

// ---------------------------------------------------------------------------
// Lógica pura — testeable con Vitest/jsdom sin Phaser
// ---------------------------------------------------------------------------

/**
 * Decide el estado de la puerta de entrada al mundo.
 * @param {{ user: object|null|undefined, online: boolean }} opts
 * @returns {'login'|'offline'|'ok'}
 */
export function resolveWorldGate({ user, online }) {
  if (!user) return 'login';
  if (!online) return 'offline';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Teardown — guarda de hashchange
// ---------------------------------------------------------------------------

let _game = null;
let _hashGuardHandler = null;

function teardown() {
  if (_game) {
    _game.destroy(true);
    _game = null;
  }
  if (_hashGuardHandler) {
    window.removeEventListener('hashchange', _hashGuardHandler);
    _hashGuardHandler = null;
  }
}

function startHashGuard() {
  if (_hashGuardHandler) return;
  _hashGuardHandler = () => {
    if (!window.location.hash.startsWith('#/mundo')) {
      teardown();
    }
  };
  window.addEventListener('hashchange', _hashGuardHandler);
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Renderiza el mundo virtual en `container`.
 * Llama a createGame internamente cuando el gate es 'ok'.
 * @param {HTMLElement} container
 */
export async function renderWorldPage(container) {
  container.innerHTML = '';

  const user = getSession()?.user ?? null;
  const online = navigator.onLine;
  const gate = resolveWorldGate({ user, online });

  if (gate === 'offline') {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <h2 class="empty-state__title">Sin conexion</h2>
        <p class="empty-state__text">El mundo necesita conexion.</p>
      </div>
    `;
    return;
  }

  if (gate === 'login') {
    // En la práctica guardedRoute ya redirige; este branch es defensivo.
    container.innerHTML = `
      <div class="empty-state fade-in">
        <p class="empty-state__text">Debes iniciar sesion para entrar al mundo.</p>
      </div>
    `;
    return;
  }

  // gate === 'ok'
  const host = document.createElement('div');
  host.id = 'world-canvas';
  host.style.cssText = 'width:100%;height:100vh;overflow:hidden;background:#000;';
  container.appendChild(host);

  const { createGame } = await import('../world/createGame.js');
  _game = createGame('world-canvas');
  startHashGuard();
}
