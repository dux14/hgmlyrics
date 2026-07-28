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
  // display controlado por setZone(): null → 'none', zona → ''
  const el = document.createElement('div');
  el.className = 'zc-overlay';
  el.style.display = 'none';

  // ── Panel visible ────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'zc-panel';
  el.appendChild(panel);

  // ── Encabezado con el nombre de la zona ─────────────────────────────────
  const header = document.createElement('div');
  header.className = 'zc-header';
  panel.appendChild(header);

  // ── Lista de mensajes ────────────────────────────────────────────────────
  const messageList = document.createElement('ul');
  messageList.className = 'zc-messages';
  panel.appendChild(messageList);

  // ── Fila de input ────────────────────────────────────────────────────────
  const inputRow = document.createElement('div');
  inputRow.className = 'zc-input-row';
  panel.appendChild(inputRow);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Escribe un mensaje...';
  input.className = 'zc-input';
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
    li.className = self ? 'zc-msg zc-msg--self' : 'zc-msg';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'zc-msg-name';
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
