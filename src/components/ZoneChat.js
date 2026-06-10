/**
 * ZoneChat.js — Overlay de chat por zona del mundo virtual.
 *
 * Panel oscuro semitransparente ubicado abajo a la izquierda sobre el canvas.
 * Usa textContent (nunca innerHTML) para evitar XSS con nombres/mensajes.
 *
 * Uso:
 *   const chat = ZoneChat();
 *   container.appendChild(chat.el);
 *   chat.setZone({ name: 'Plaza', channelId: 'plaza' });
 *   chat.onSend((text) => { /* enviar al canal * / });
 */

import { makeRateLimiter } from '../world/throttle.js';

/**
 * Valida y normaliza el texto de un mensaje antes de enviarlo.
 *
 * @param {string} raw           — Texto crudo del input.
 * @param {{ maxLen?: number }} [opts]
 * @returns {{ ok: false } | { ok: true, text: string }}
 */
export function prepareMessage(raw, { maxLen = 280 } = {}) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };
  if (trimmed.length > maxLen) return { ok: true, text: trimmed.slice(0, maxLen) };
  return { ok: true, text: trimmed };
}

/**
 * @typedef {{ name: string, channelId: string }} Zone
 * @typedef {{ name: string, text: string, ts?: number, self?: boolean }} ChatMessage
 */

/**
 * Crea el componente de chat por zona.
 * @returns {{
 *   el: HTMLElement,
 *   setZone: (zone: Zone | null) => void,
 *   addMessage: (msg: ChatMessage) => void,
 *   clear: () => void,
 *   onSend: (cb: (text: string) => void) => void,
 * }}
 */
export function ZoneChat() {
  // Anti-spam: máximo 1 envío cada 700 ms
  const rateLimiter = makeRateLimiter(700);

  /** @type {(text: string) => void} */
  let sendCallback = () => {};

  // ── Contenedor exterior ──────────────────────────────────────────────────
  // No intercepta clicks en el canvas (pointer-events:none).
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute',
    'bottom:12px',
    'left:12px',
    'pointer-events:none',
    'z-index:10',
    'display:none',
  ].join(';');

  // ── Panel visible ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:rgba(0,0,0,0.55)',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:6px',
    'padding:8px 12px',
    'min-width:200px',
    'max-width:300px',
    'pointer-events:auto',
    'font-family:sans-serif',
    'font-size:12px',
    'color:#e0e0e0',
    'display:flex',
    'flex-direction:column',
    'gap:6px',
  ].join(';');
  el.appendChild(panel);

  // ── Encabezado con el nombre de la zona ─────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'font-weight:600;color:#90caf9;';
  panel.appendChild(header);

  // ── Lista de mensajes ────────────────────────────────────────────────────
  const messageList = document.createElement('ul');
  messageList.style.cssText = [
    'list-style:none',
    'margin:0',
    'padding:0',
    'max-height:180px',
    'overflow-y:auto',
    'display:flex',
    'flex-direction:column',
    'gap:2px',
  ].join(';');
  panel.appendChild(messageList);

  // ── Fila de input ────────────────────────────────────────────────────────
  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:4px;';
  panel.appendChild(inputRow);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Escribe un mensaje...';
  input.style.cssText = [
    'flex:1',
    'background:rgba(255,255,255,0.08)',
    'border:1px solid rgba(255,255,255,0.2)',
    'border-radius:4px',
    'padding:4px 6px',
    'color:#e0e0e0',
    'font-size:12px',
    'font-family:sans-serif',
    'outline:none',
  ].join(';');
  inputRow.appendChild(input);

  // ── Lógica de envío ──────────────────────────────────────────────────────
  function attemptSend() {
    const result = prepareMessage(input.value);
    if (!result.ok) return;

    const allowed = rateLimiter(Date.now());
    if (!allowed) return;

    sendCallback(result.text);
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptSend();
  });

  // ── API pública ──────────────────────────────────────────────────────────

  /**
   * Muestra el overlay con la zona indicada (truthy) u oculta y limpia (null).
   * @param {Zone | null} zone
   */
  function setZone(zone) {
    if (!zone) {
      el.style.display = 'none';
      clear();
      return;
    }
    header.textContent = zone.name;
    clear();
    el.style.display = '';
  }

  /**
   * Agrega un mensaje a la lista. Usa textContent para evitar XSS.
   * @param {ChatMessage} msg
   */
  function addMessage({ name, text, self = false }) {
    const li = document.createElement('li');
    li.style.cssText = [
      'padding:2px 0',
      'word-break:break-word',
      self ? 'color:#90caf9' : 'color:#e0e0e0',
    ].join(';');

    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:600;margin-right:4px;';
    nameSpan.textContent = name + ':';

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    li.appendChild(nameSpan);
    li.appendChild(textSpan);
    messageList.appendChild(li);

    // Scroll al último mensaje
    messageList.scrollTop = messageList.scrollHeight;
  }

  /** Vacía la lista de mensajes. */
  function clear() {
    messageList.replaceChildren();
  }

  /**
   * Registra el callback que se invoca cuando el usuario envía un mensaje válido.
   * @param {(text: string) => void} cb
   */
  function onSend(cb) {
    sendCallback = cb;
  }

  return { el, setZone, addMessage, clear, onSend };
}
