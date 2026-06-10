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
import { getSession, getProfile } from '../lib/authStore.js';
import { supabase } from '../lib/supabase.js';
import { WorldRoster } from './WorldRoster.js';
import { ZoneChat } from './ZoneChat.js';
import { joinZone } from '../lib/zoneChannel.js';

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
let _rosterEl = null;
let _chatEl = null;
let _zoneChannel = null;
let _wrapperEl = null;

function teardown() {
  if (_game) {
    _game.destroy(true);
    _game = null;
  }
  if (_zoneChannel) {
    _zoneChannel.leave();
    _zoneChannel = null;
  }
  if (_wrapperEl) {
    _wrapperEl.remove();
    _wrapperEl = null;
  }
  if (_rosterEl) {
    _rosterEl.remove();
    _rosterEl = null;
  }
  if (_chatEl) {
    _chatEl.remove();
    _chatEl = null;
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
        <h2 class="empty-state__title">Sin conexión</h2>
        <p class="empty-state__text">El mundo necesita conexión.</p>
      </div>
    `;
    return;
  }

  if (gate === 'login') {
    // En la práctica guardedRoute ya redirige; este branch es defensivo.
    container.innerHTML = `
      <div class="empty-state fade-in">
        <p class="empty-state__text">Debes iniciar sesión para entrar al mundo.</p>
      </div>
    `;
    return;
  }

  // gate === 'ok'
  // Envolver canvas + roster en un contenedor relativo para posicionar el overlay
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%;height:100vh;overflow:hidden;';
  _wrapperEl = wrapper;
  container.appendChild(wrapper);

  const host = document.createElement('div');
  host.id = 'world-canvas';
  host.style.cssText = 'width:100%;height:100vh;overflow:hidden;background:#000;';
  wrapper.appendChild(host);

  // Roster overlay
  const roster = WorldRoster();
  _rosterEl = roster.el;
  wrapper.appendChild(roster.el);

  // Chat por zona overlay (oculto hasta entrar a una zona)
  const chat = ZoneChat();
  _chatEl = chat.el;
  wrapper.appendChild(chat.el);

  // Contexto de red
  const me = {
    id: user.id,
    name: getProfile()?.username || 'Invitado',
  };

  // Envío local: publica al canal de la zona y hace eco en la propia lista
  // (el canal usa broadcast { self:false }, así que no hay eco del servidor).
  chat.onSend((text) => {
    if (!_zoneChannel) return;
    _zoneChannel.send(text);
    chat.addMessage({ uid: me.id, name: me.name, text, ts: Date.now(), self: true });
  });

  // Transición de zona: salir del canal anterior, entrar al nuevo (o ninguno).
  const onZoneChange = (zone) => {
    if (_zoneChannel) {
      _zoneChannel.leave();
      _zoneChannel = null;
    }
    chat.setZone(zone); // truthy → muestra+limpia; null → oculta+limpia
    if (zone) {
      _zoneChannel = joinZone({
        supabase,
        channelId: zone.channelId,
        user: { id: me.id, display_name: me.name },
      });
      _zoneChannel.onMessage((msg) => chat.addMessage(msg));
    }
  };

  try {
    const { createGame } = await import('../world/createGame.js');
    _game = createGame('world-canvas', { supabase, me, onRoster: roster.setRoster, onZoneChange });
    startHashGuard();
  } catch (err) {
    console.error('[mundo] no se pudo iniciar la escena Phaser', err);
    teardown();
    container.innerHTML = `
      <div class="empty-state fade-in">
        <h2 class="empty-state__title">Error al cargar el mundo</h2>
        <p class="empty-state__text">No se pudo iniciar la escena. Recarga la página.</p>
      </div>
    `;
  }
}
