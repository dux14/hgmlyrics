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
  el.setAttribute('aria-label', 'Creditos de assets');
  el.setAttribute('aria-modal', 'true');
  el.style.cssText = [
    'display:none',
    'position:absolute',
    'inset:0',
    'background:rgba(0,0,0,0.8)',
    'z-index:50',
    'align-items:center',
    'justify-content:center',
    'font-family:sans-serif',
    'font-size:13px',
    'color:#e0e0e0',
  ].join(';');

  // ── Modal interior ───────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.style.cssText = [
    'background:#1e1e2e',
    'border:1px solid rgba(255,255,255,0.15)',
    'border-radius:10px',
    'padding:20px 24px',
    'max-width:560px',
    'width:90%',
    'max-height:80vh',
    'display:flex',
    'flex-direction:column',
    'gap:12px',
  ].join(';');
  el.appendChild(modal);

  // ── Cabecera ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

  const title = document.createElement('h2');
  title.style.cssText = 'margin:0;font-size:15px;color:#90caf9;';
  title.textContent = 'Creditos — Assets LPC';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar creditos');
  closeBtn.style.cssText = [
    'background:none',
    'border:none',
    'color:#aaa',
    'font-size:20px',
    'cursor:pointer',
    'line-height:1',
    'padding:0',
  ].join(';');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => close());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // ── Contenido scrollable ─────────────────────────────────────────────────
  const pre = document.createElement('pre');
  pre.style.cssText = [
    'margin:0',
    'overflow-y:auto',
    'max-height:55vh',
    'white-space:pre-wrap',
    'word-break:break-word',
    'font-family:monospace',
    'font-size:12px',
    'line-height:1.5',
    'color:#ccc',
    'background:#13131f',
    'border-radius:4px',
    'padding:12px',
  ].join(';');
  modal.appendChild(pre);

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
      pre.textContent = 'Cargando creditos...';
      try {
        const res = await fetch('/world/CREDITS.txt');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        // XSS-safe: textContent, nunca innerHTML
        pre.textContent = text;
        loaded = true;
      } catch (err) {
        console.error('[WorldCredits] error al cargar CREDITS.txt', err);
        pre.textContent = 'No se pudieron cargar los creditos.';
      }
    }
  }

  function close() {
    el.style.display = 'none';
    document.removeEventListener('keydown', onKeydown);
  }

  return { el, open, close };
}
