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
import { AvatarCreator } from './AvatarCreator.js';
import { WorldCredits } from './WorldCredits.js';
import { Joystick } from './Joystick.js';
import { VoiceControls } from './VoiceControls.js';
import { joinZone } from '../lib/zoneChannel.js';
import { joinSignaling } from '../lib/voiceSignaling.js';
import { joinWorldAdmin } from '../lib/worldAdminChannel.js';
import { createVoiceMesh } from '../world/voiceMesh.js';
import { getIceServers } from '../world/iceConfig.js';
import { capPublishers } from '../world/voicePolicy.js';
import { loadActiveMap } from '../world/worldMapStore.js';

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
let _avatarCreator = null;
let _worldCredits = null;
let _overlayBtnsEl = null;
let _zoneChannel = null;
/** @type {{ broadcastMapUpdated: Function, onMapUpdated: Function, leave: Function }|null} */
let _adminChannel = null;
let _wrapperEl = null;
let _joystick = null;
let _reconnectEl = null;
/** @type {{ el: HTMLElement, addRemotePeer: Function, removeRemotePeer: Function, clearRemotePeers: Function, destroy: Function }|null} */
let _voiceControls = null;
/** @type {{ setPeers: Function, onRemoteStream: Function, onPeerSpeaking: Function, closeAll: Function }|null} */
let _voiceMesh = null;
/** @type {{ sendSignal: Function, onSignal: Function, leave: Function }|null} */
let _voiceSignaling = null;
/** @type {MediaStream|null} stream local de audio (usado para proveer al mesh) */
let _localStream = null;
/** @type {{ channelId: string, name: string }|null} zona activa al momento de la desconexion */
let _currentZone = null;

function teardown() {
  if (_game) {
    _game.destroy(true);
    _game = null;
  }
  if (_zoneChannel) {
    _zoneChannel.leave();
    _zoneChannel = null;
  }
  if (_adminChannel) {
    _adminChannel.leave();
    _adminChannel = null;
  }
  if (_voiceMesh) {
    _voiceMesh.closeAll();
    _voiceMesh = null;
  }
  if (_voiceSignaling) {
    _voiceSignaling.leave();
    _voiceSignaling = null;
  }
  if (_voiceControls) {
    _voiceControls.destroy();
    _voiceControls = null;
  }
  _localStream = null;
  _currentZone = null;
  if (_avatarCreator) {
    _avatarCreator.destroy();
    _avatarCreator = null;
  }
  if (_worldCredits) {
    _worldCredits.close();
    _worldCredits.el.remove();
    _worldCredits = null;
  }
  if (_joystick) {
    _joystick.destroy();
    _joystick.el.remove();
    _joystick = null;
  }
  if (_reconnectEl) {
    _reconnectEl.remove();
    _reconnectEl = null;
  }
  if (_overlayBtnsEl) {
    _overlayBtnsEl.remove();
    _overlayBtnsEl = null;
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
  host.style.cssText = 'width:100%;height:100vh;overflow:hidden;background:#000;touch-action:none;';
  host.setAttribute('role', 'application');
  host.setAttribute('aria-label', 'Mundo virtual — muevete con WASD, flechas o el joystick tactil');
  wrapper.appendChild(host);

  // Roster overlay
  const roster = WorldRoster();
  _rosterEl = roster.el;
  wrapper.appendChild(roster.el);

  // Chat por zona overlay (oculto hasta entrar a una zona)
  const chat = ZoneChat();
  _chatEl = chat.el;
  wrapper.appendChild(chat.el);

  // AvatarCreator overlay
  const avatarCreator = AvatarCreator();
  _avatarCreator = avatarCreator;
  wrapper.appendChild(avatarCreator.el);

  // WorldCredits overlay
  const worldCredits = WorldCredits();
  _worldCredits = worldCredits;
  wrapper.appendChild(worldCredits.el);

  // Botones de acceso a overlays (esquina superior derecha)
  const overlayBtns = document.createElement('div');
  overlayBtns.style.cssText = [
    'position:absolute',
    'top:12px',
    'right:12px',
    'z-index:20',
    'display:flex',
    'gap:6px',
    'pointer-events:auto',
  ].join(';');
  _overlayBtnsEl = overlayBtns;

  const btnStyle = [
    'background:rgba(0,0,0,0.6)',
    'border:1px solid rgba(255,255,255,0.2)',
    'border-radius:5px',
    'color:#e0e0e0',
    'font-size:12px',
    'font-family:sans-serif',
    'padding:5px 10px',
    'cursor:pointer',
  ].join(';');

  const avatarBtn = document.createElement('button');
  avatarBtn.type = 'button';
  avatarBtn.textContent = 'Editar avatar';
  avatarBtn.setAttribute('aria-label', 'Editar avatar');
  avatarBtn.style.cssText = btnStyle;
  avatarBtn.addEventListener('click', () => avatarCreator.open());
  overlayBtns.appendChild(avatarBtn);

  const creditsBtn = document.createElement('button');
  creditsBtn.type = 'button';
  creditsBtn.textContent = 'Creditos';
  creditsBtn.setAttribute('aria-label', 'Ver creditos de los assets');
  creditsBtn.style.cssText = btnStyle;
  creditsBtn.addEventListener('click', () => worldCredits.open());
  overlayBtns.appendChild(creditsBtn);

  wrapper.appendChild(overlayBtns);

  // ---- Overlay de reconexión (M5.3) ----
  // role=status + aria-live para anunciar la caída de conexión a lectores de pantalla.
  const reconnectEl = document.createElement('div');
  reconnectEl.setAttribute('role', 'status');
  reconnectEl.setAttribute('aria-live', 'polite');
  reconnectEl.hidden = true;
  reconnectEl.textContent = 'Reconectando…';
  reconnectEl.style.cssText = [
    'position:absolute',
    'top:12px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:30',
    'background:rgba(120,40,40,0.92)',
    'border:1px solid rgba(255,255,255,0.25)',
    'border-radius:5px',
    'color:#fff',
    'font-size:13px',
    'font-family:sans-serif',
    'padding:6px 14px',
    'pointer-events:none',
  ].join(';');
  _reconnectEl = reconnectEl;
  wrapper.appendChild(reconnectEl);

  // Estado de conexión: muestra el overlay al caer; al reconectar, re-suscribe
  // la señalizacion de voz y reconcilia el mesh con la presencia actual.
  let _wasDisconnected = false;
  const onStatus = (state) => {
    if (!_reconnectEl) return;
    // Visible mientras NO esté conectado (disconnected o connecting).
    _reconnectEl.hidden = state === 'connected';

    if (state === 'connected' && _wasDisconnected) {
      // Re-suscribir señalizacion y reconciliar el mesh si habia zona y microfono.
      // El canal de señalizacion Supabase se cierra al caer la conexion; hay que
      // recrearlo. El mesh tambien se recrea para que su handler onSignal apunte
      // al nuevo canal; diffPeers se encarga de solo abrir las conexiones nuevas.
      if (_currentZone && _localStream) {
        // Limpiar peers remotos anteriores para que el roster se reconstruya limpio.
        _voiceControls?.clearRemotePeers();

        if (_voiceMesh) {
          _voiceMesh.closeAll();
        }
        if (_voiceSignaling) {
          _voiceSignaling.leave();
        }

        _voiceSignaling = joinSignaling({
          supabase,
          channelId: _currentZone.channelId,
          user: { id: me.id },
        });

        _voiceMesh = createVoiceMesh({
          signaling: _voiceSignaling,
          getLocalStream: () => _localStream,
          iceServers: getIceServers(import.meta.env),
          selfId: me.id,
        });

        _voiceMesh.onRemoteStream((peerId, stream) => {
          _voiceControls?.addRemotePeer(peerId, stream);
        });

        // Reconciliar el mesh con el roster actual post-reconexion.
        _voiceMesh.setPeers(capPublishers(_zonePeerIds));
      }
    }

    _wasDisconnected = state === 'disconnected';
  };

  // ---- Joystick táctil (M5.1/5.2) — solo en dispositivos de puntero grueso ----
  const inputRef = { vector: { x: 0, y: 0 } };
  const isCoarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (isCoarse) {
    _joystick = Joystick({ onChange: (v) => (inputRef.vector = v) });
    _joystick.el.style.position = 'absolute';
    _joystick.el.style.left = '20px';
    _joystick.el.style.bottom = '20px';
    _joystick.el.style.zIndex = '25';
    _joystick.el.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(_joystick.el);
  }

  // Contexto de red
  const me = {
    id: user.id,
    name: getProfile()?.username || 'Invitado',
  };

  // ---- Panel de controles de voz (esquina inferior derecha) ----
  // Nota de diseño: el peer set del mesh viene de WorldScene.peers (presencia
  // global). El canal de señalizacion es por zona (signal:{channelId}); solo
  // los peers que estén en la misma zona joinean ese canal, por lo que el
  // filtrado real ocurre en la capa de señalizacion. No se duplica la logica
  // de membresía por zona aquí (ver spec §Design note).
  const voiceControls = VoiceControls({
    selfId: me.id,
    selfLabel: me.name,
    onActivate(stream) {
      _localStream = stream;
      // Si ya habia un mesh activo (zona con voz), re-alimentar el stream.
      // El mesh original fue creado con getLocalStream() === null; al tener
      // el stream ahora, re-establecemos las conexiones para la zona actual
      // llamando a setPeers con la lista ya registrada (si la hay).
      // La renegociacion completa queda para A3; aqui nos limitamos a dar el
      // stream al contexto del mesh.
    },
    onDeactivate() {
      _localStream = null;
      if (_voiceMesh) {
        _voiceMesh.closeAll();
        _voiceMesh = null;
      }
      if (_voiceSignaling) {
        _voiceSignaling.leave();
        _voiceSignaling = null;
      }
    },
  });
  _voiceControls = voiceControls;

  voiceControls.el.style.cssText = [
    'position:absolute',
    'bottom:12px',
    'right:12px',
    'z-index:22',
    'pointer-events:auto',
    'background:rgba(0,0,0,0.55)',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:6px',
    'padding:8px 10px',
  ].join(';');
  wrapper.appendChild(voiceControls.el);

  // Envío local: publica al canal de la zona y hace eco en la propia lista
  // (el canal usa broadcast { self:false }, así que no hay eco del servidor).
  chat.onSend((text) => {
    if (!_zoneChannel) return;
    _zoneChannel.send(text);
    chat.addMessage({ uid: me.id, name: me.name, text, ts: Date.now(), self: true });
  });

  /**
   * Peers de voz actuales (uid[] excluye self). Se actualizan en cada zonechange.
   * @type {string[]}
   */
  let _zonePeerIds = [];

  // Transición de zona: salir del canal anterior, entrar al nuevo (o ninguno).
  const onZoneChange = (zone) => {
    // Registrar la zona activa para poder re-suscribir la señalizacion en reconexion.
    _currentZone = zone ?? null;
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

    // ---- Voz: cambiar de zona ----
    // Limpiar peers remotos de la zona anterior antes de cerrar mesh/señalizacion.
    _voiceControls?.clearRemotePeers();

    // Cerrar el mesh + señalizacion anteriores (si los hay).
    if (_voiceMesh) {
      _voiceMesh.closeAll();
      _voiceMesh = null;
    }
    if (_voiceSignaling) {
      _voiceSignaling.leave();
      _voiceSignaling = null;
    }

    if (!zone || !_localStream) {
      // Sin zona o sin microfono: no hay nada que conectar.
      _zonePeerIds = [];
      return;
    }

    // Crear nueva señalizacion para esta zona y un nuevo mesh.
    // Peer set inicial: vacío — se actualiza al recibir onPeerJoin/onPeerLeave
    // (ver _pushVoicePeers abajo).
    _voiceSignaling = joinSignaling({
      supabase,
      channelId: zone.channelId,
      user: { id: me.id },
    });

    _voiceMesh = createVoiceMesh({
      signaling: _voiceSignaling,
      getLocalStream: () => _localStream,
      iceServers: getIceServers(import.meta.env),
      selfId: me.id,
    });

    _voiceMesh.onRemoteStream((peerId, stream) => {
      _voiceControls?.addRemotePeer(peerId, stream);
    });

    // Alimentar el mesh con los peers de zona actuales (respetando el cap).
    _voiceMesh.setPeers(capPublishers(_zonePeerIds));
  };

  /**
   * Actualiza la lista de peers de voz para la zona actual.
   * Aplica el cap de publicadores (max 8) antes de alimentar el mesh.
   * La seleccion es determinista (orden lex), por lo que todos los clientes
   * de la zona eligen el mismo subconjunto sin coordinacion central.
   *
   * @param {string[]} peerIds — uid[] de todos los peers en presencia (excluye self)
   */
  function _pushVoicePeers(peerIds) {
    _zonePeerIds = peerIds;
    if (_voiceMesh) {
      _voiceMesh.setPeers(capPublishers(peerIds));
    }
  }

  try {
    // Cargar el mapa activo ANTES de crear el juego Phaser para poder pasarle
    // el descriptor ya resuelto. Si la DB no tiene mapa activo o falla, el
    // descriptor de dev se usa transparentemente (sin cambio visual).
    const mapDescriptor = await loadActiveMap({ supabase });

    const { createGame } = await import('../world/createGame.js');
    _game = createGame('world-canvas', {
      supabase,
      me,
      mapDescriptor,
      onRoster(entries) {
        roster.setRoster(entries);
        // Derivar lista de peers para el mesh (excluir self).
        const peerIds = entries.filter((e) => e.uid !== me.id).map((e) => e.uid);
        _pushVoicePeers(peerIds);
      },
      onZoneChange,
      input: inputRef,
      onStatus,
    });

    // Suscribir al canal de administración para recarga en caliente del mapa (E4.2).
    // Cuando el admin activa un mapa nuevo, se recibe map-updated → cargar el nuevo
    // descriptor y reiniciar la escena WorldScene sin perder la sesión de auth/presencia.
    _adminChannel = joinWorldAdmin({ supabase });
    _adminChannel.onMapUpdated(async () => {
      try {
        const newDescriptor = await loadActiveMap({ supabase });
        // Actualizar el descriptor en el registry del juego para que la escena lo
        // lea en preload() al reiniciarse.
        _game?.registry.set('worldMapDescriptor', newDescriptor);
        // Reiniciar la escena WorldScene: shutdown + create (preload re-corre).
        // La conexión de presencia/realtime vive en el Game (no en la escena), así
        // que sobrevive al restart. La sesión de auth del usuario no se toca.
        const scene = _game?.scene.getScene('WorldScene');
        if (scene) {
          scene.scene.restart();
        }
      } catch (err) {
        console.warn('[mundo] No se pudo recargar el mapa en caliente:', err);
      }
    });

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
