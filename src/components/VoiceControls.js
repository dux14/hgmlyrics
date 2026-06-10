/**
 * VoiceControls.js — Panel de controles de voz para el mundo virtual.
 *
 * Exporta:
 *   VoiceControls({ onActivate, onDeactivate, onMuteChange })
 *     → { el, addRemotePeer(peerId, stream), removeRemotePeer(peerId), destroy }
 *
 * Comportamiento:
 *   - El microfono se pide SOLO cuando el usuario hace clic en "Activar voz"
 *     (no en la importacion del modulo ni en la construccion del componente).
 *   - El boton de silencio activa/desactiva el track local (track.enabled).
 *   - Por cada peer (local + remoto) se crea un AnalyserNode → RMS → isSpeaking →
 *     indicador visual de "hablando".
 *   - La deteccion de nivel usa makeSpeakingSmoother para evitar parpadeo.
 *
 * Notas sobre WebAudio en jsdom:
 *   AudioContext/AnalyserNode no existen en jsdom. No se escriben tests de
 *   instanciacion de este componente; solo se testean helpers puros extraidos
 *   en voiceLevel.js.
 */

import { computeRms, makeSpeakingSmoother } from '../world/voiceLevel.js';

/** Umbral RMS para considerar que alguien esta hablando. */
const VOICE_THRESHOLD = 0.015;
/** Muestras consecutivas activas para activar el indicador (≈ 3 frames a 60fps). */
const ATTACK_FRAMES = 3;
/** Muestras consecutivas inactivas para desactivar el indicador (≈ 8 frames). */
const RELEASE_FRAMES = 8;
/** Intervalo en ms entre lecturas del AnalyserNode. */
const POLL_INTERVAL_MS = 50;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Crea un nodo analizador conectado al stream dado y empieza a sondear el
 * nivel de audio. Retorna un objeto para detener el sondeo y liberar recursos.
 *
 * @param {AudioContext} ctx
 * @param {MediaStream}  stream
 * @param {(speaking: boolean) => void} onSpeaking — callback al cambiar estado
 * @returns {{ stop: () => void }}
 */
function createLevelMonitor(ctx, stream, onSpeaking) {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.fftSize);
  const smooth = makeSpeakingSmoother({
    threshold: VOICE_THRESHOLD,
    attack: ATTACK_FRAMES,
    release: RELEASE_FRAMES,
  });

  let timerId = null;
  let lastSpeaking = false;

  function poll() {
    analyser.getByteTimeDomainData(buffer);
    const rms = computeRms(buffer);
    const speaking = smooth(rms);
    if (speaking !== lastSpeaking) {
      lastSpeaking = speaking;
      onSpeaking(speaking);
    }
  }

  timerId = setInterval(poll, POLL_INTERVAL_MS);

  return {
    stop() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      source.disconnect();
    },
  };
}

/**
 * Crea el elemento DOM de un indicador de peer (nombre + punto de actividad).
 *
 * @param {string} peerId
 * @param {string} [label]
 * @returns {{ el: HTMLElement, setSpeaking: (v: boolean) => void, remove: () => void }}
 */
function createPeerIndicator(peerId, label) {
  const el = document.createElement('div');
  el.dataset.peerId = peerId;
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'padding:2px 0',
    'font-size:12px',
    'font-family:sans-serif',
    'color:#e0e0e0',
  ].join(';');

  const dot = document.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = [
    'display:inline-block',
    'width:8px',
    'height:8px',
    'border-radius:50%',
    'background:#555',
    'transition:background 0.1s',
    'flex-shrink:0',
  ].join(';');

  const nameEl = document.createElement('span');
  nameEl.textContent = label || peerId.slice(0, 8);

  el.appendChild(dot);
  el.appendChild(nameEl);

  return {
    el,
    setSpeaking(speaking) {
      dot.style.background = speaking ? '#4caf50' : '#555';
      dot.title = speaking ? 'Hablando' : 'En silencio';
    },
    remove() {
      el.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Crea el panel de controles de voz.
 *
 * @param {{
 *   selfId?:       string,                           — id propio para el indicador local
 *   selfLabel?:    string,                           — etiqueta para el indicador local
 *   onActivate?:   (stream: MediaStream) => void,    — llamado al obtener el stream local
 *   onDeactivate?: () => void,                       — llamado al detener el stream local
 *   onMuteChange?: (muted: boolean) => void,         — llamado al cambiar silencio
 *   onPeerSpeaking?: (peerId: string, speaking: boolean) => void,
 * }} opts
 *
 * @returns {{
 *   el:               HTMLElement,
 *   addRemotePeer:    (peerId: string, stream: MediaStream, label?: string) => void,
 *   removeRemotePeer: (peerId: string) => void,
 *   destroy:          () => void,
 * }}
 */
export function VoiceControls({
  selfId = 'local',
  selfLabel = 'Tu',
  onActivate,
  onDeactivate,
  onMuteChange,
  onPeerSpeaking,
} = {}) {
  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {{ stop: () => void } | null} monitor del nivel local */
  let localMonitor = null;
  /** @type {boolean} */
  let muted = false;
  /** @type {boolean} */
  let voiceActive = false;

  /**
   * Map peerId → { monitor: { stop }, indicator }
   * @type {Map<string, { monitor: { stop: () => void }, indicator: object }>}
   */
  const remotePeers = new Map();

  // ---- Indicador local ----
  const localIndicator = createPeerIndicator(selfId, selfLabel + ' (tu)');

  // ---- Contenedor raiz ----
  const el = document.createElement('div');
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Controles de voz');
  el.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'pointer-events:auto',
  ].join(';');

  // ---- Fila de botones ----
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:6px;';

  const btnBaseStyle = [
    'background:rgba(0,0,0,0.6)',
    'border:1px solid rgba(255,255,255,0.2)',
    'border-radius:5px',
    'color:#e0e0e0',
    'font-size:12px',
    'font-family:sans-serif',
    'padding:5px 10px',
    'cursor:pointer',
  ].join(';');

  // Boton activar / desactivar voz
  const activateBtn = document.createElement('button');
  activateBtn.type = 'button';
  activateBtn.textContent = 'Activar voz';
  activateBtn.setAttribute('aria-label', 'Activar microfono');
  activateBtn.style.cssText = btnBaseStyle;

  // Boton silencio (oculto hasta que la voz este activa)
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.textContent = 'Silenciar';
  muteBtn.setAttribute('aria-label', 'Silenciar microfono');
  muteBtn.style.cssText = btnBaseStyle;
  muteBtn.hidden = true;

  btnRow.appendChild(activateBtn);
  btnRow.appendChild(muteBtn);

  // ---- Lista de indicadores de nivel ----
  const peerList = document.createElement('div');
  peerList.setAttribute('aria-label', 'Participantes de voz');
  peerList.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

  el.appendChild(btnRow);
  el.appendChild(peerList);

  // ---- Logica del boton "Activar voz" ----
  activateBtn.addEventListener('click', async () => {
    if (voiceActive) {
      // Desactivar: detener stream y monitores
      _stopVoice();
      return;
    }

    activateBtn.disabled = true;
    activateBtn.textContent = 'Activando…';

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });

      voiceActive = true;
      activateBtn.textContent = 'Desactivar voz';
      activateBtn.setAttribute('aria-label', 'Desactivar microfono');
      activateBtn.disabled = false;
      muteBtn.hidden = false;

      // Mostrar indicador local
      peerList.appendChild(localIndicator.el);

      // Iniciar monitor de nivel local
      audioCtx = new AudioContext();
      localMonitor = createLevelMonitor(audioCtx, localStream, (speaking) => {
        localIndicator.setSpeaking(speaking);
      });

      onActivate?.(localStream);
    } catch (err) {
      console.error('[VoiceControls] Error al obtener microfono:', err);
      activateBtn.textContent = 'Activar voz';
      activateBtn.disabled = false;
    }
  });

  // ---- Logica del boton de silencio ----
  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    muteBtn.textContent = muted ? 'Activar audio' : 'Silenciar';
    muteBtn.setAttribute('aria-label', muted ? 'Activar microfono' : 'Silenciar microfono');
    muteBtn.style.borderColor = muted ? 'rgba(255,80,80,0.5)' : 'rgba(255,255,255,0.2)';
    onMuteChange?.(muted);
  });

  // ---- Helpers privados ----

  function _stopVoice() {
    localMonitor?.stop();
    localMonitor = null;

    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null;

    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }

    voiceActive = false;
    muted = false;
    activateBtn.textContent = 'Activar voz';
    activateBtn.setAttribute('aria-label', 'Activar microfono');
    activateBtn.disabled = false;
    muteBtn.hidden = true;
    muteBtn.textContent = 'Silenciar';
    muteBtn.style.borderColor = 'rgba(255,255,255,0.2)';

    localIndicator.setSpeaking(false);
    localIndicator.el.remove();

    onDeactivate?.();
  }

  // ---- Interfaz publica ----

  /**
   * Agrega un peer remoto: conecta su stream al AnalyserNode y muestra indicador.
   *
   * @param {string}      peerId
   * @param {MediaStream} stream
   * @param {string}      [label]
   */
  function addRemotePeer(peerId, stream, label) {
    if (remotePeers.has(peerId)) return;

    const indicator = createPeerIndicator(peerId, label);
    peerList.appendChild(indicator.el);

    // Solo monitorear si hay AudioContext activo (voz local activa)
    let monitor = null;
    if (audioCtx) {
      monitor = createLevelMonitor(audioCtx, stream, (speaking) => {
        indicator.setSpeaking(speaking);
        onPeerSpeaking?.(peerId, speaking);
      });
    }

    remotePeers.set(peerId, { monitor, indicator });
  }

  /**
   * Elimina el peer remoto: detiene el monitor y quita el indicador.
   *
   * @param {string} peerId
   */
  function removeRemotePeer(peerId) {
    const entry = remotePeers.get(peerId);
    if (!entry) return;
    entry.monitor?.stop();
    entry.indicator.remove();
    remotePeers.delete(peerId);
  }

  /**
   * Destruye el componente: para todos los monitores, libera el stream local.
   */
  function destroy() {
    _stopVoice();
    remotePeers.forEach(({ monitor, indicator }) => {
      monitor?.stop();
      indicator.remove();
    });
    remotePeers.clear();
    el.remove();
  }

  return { el, addRemotePeer, removeRemotePeer, destroy };
}
