import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelLongText } from '../lib/skeleton.js';

/**
 * WorldCredits.js — Overlay de créditos de assets LPC.
 *
 * Obligación de licencia: muestra el archivo CREDITS.txt (CC-BY-SA / OGA-BY / GPL)
 * en un modal accesible cada vez que el usuario lo solicita.
 *
 * Seguridad XSS: el contenido se asigna vía textContent (nunca innerHTML).
 *
 * Uso:
 *   const credits = WorldCredits();
 *   container.appendChild(credits.el);
 *   credits.open();
 */

/**
 * Crea el overlay de créditos LPC.
 *
 * @returns {{ el: HTMLElement, open: () => Promise<void>, close: () => void }}
 */
export function WorldCredits() {
  // ── Fondo oscuro (backdrop) ──────────────────────────────────────────────
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Créditos de assets');
  el.setAttribute('aria-modal', 'true');
  el.className = 'wc-backdrop';

  // ── Modal interior ───────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.className = 'wc-modal';
  el.appendChild(modal);

  // ── Cabecera ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'wc-header';

  const title = document.createElement('h2');
  title.className = 'wc-title';
  title.textContent = 'Créditos — Assets LPC';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar créditos');
  closeBtn.className = 'wc-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => close());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // ── Contenido scrollable ─────────────────────────────────────────────────
  // wc-region actúa como regionEl de renderAsyncRegion; pre es solo el texto.
  // Se usa un wrapper <div> porque onError inyecta <div class="empty-state">
  // y colocar un <div> dentro de <pre> sería HTML inválido.
  const region = document.createElement('div');
  region.className = 'wc-region';
  modal.appendChild(region);

  const pre = document.createElement('pre');
  pre.className = 'wc-pre';
  region.appendChild(pre);

  // ── Cerrar con Esc ───────────────────────────────────────────────────────
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  // ── Estado de carga ──────────────────────────────────────────────────────
  let loaded = false;

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  async function open() {
    el.style.display = 'flex';
    closeBtn.focus();
    document.addEventListener('keydown', onKeydown);

    if (!loaded) {
      renderAsyncRegion(region, {
        skeleton: () => skelLongText(),
        fetcher: async () => {
          const res = await fetch('/world/CREDITS.txt');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        },
        render: (text) => {
          // XSS-safe: textContent, nunca innerHTML
          pre.textContent = text;
          loaded = true;
        },
        onError: () => `
          <div class="empty-state">
            <p>No se pudieron cargar los créditos.</p>
            <button class="btn btn--primary" data-retry>Reintentar</button>
          </div>`,
      });
    }
  }

  function close() {
    el.style.display = 'none';
    document.removeEventListener('keydown', onKeydown);
  }

  return { el, open, close };
}
