/**
 * AvatarCreator.js — Creador de avatar por capas (LPC).
 *
 * Abre un overlay modal donde el usuario elige bodyType y opciones de capas,
 * ve un preview del frame quieto (fila down, columna 0) y puede guardar el
 * spritesheet completo (576×256) en Supabase.
 *
 * Uso:
 *   const creator = AvatarCreator();
 *   container.appendChild(creator.el);
 *   creator.open();
 *
 * Supuestos:
 *   - Config inicial: bodyType = primer bodyType del manifest, body = primera opción,
 *     capas no-required default a null (sin selección = sin capa).
 *   - El spritesheet LPC tiene 9 columnas × 4 filas de frames 64×64 → 576×256 px total.
 *   - Frame del preview: fila "down" (índice 2), columna 0 → recorte (0, 128, 64, 64).
 *   - Orden de composición: zPos ascendente (body 10 → legs 20 → torso 35 → hair 120).
 *   - En jsdom el canvas no pinta (sin contexto 2D real), pero la lógica de carga
 *     de Image y composeLayers se ejecuta igualmente.
 */

import { composeLayers } from '../world/avatarCompositor.js';
import { saveAvatar } from '../lib/worldAvatarStore.js';
import { getSession } from '../lib/authStore.js';
import { supabase } from '../lib/supabase.js';

// ---------------------------------------------------------------------------
// Funciones puras — exportadas para tests
// ---------------------------------------------------------------------------

/**
 * Construye la config inicial a partir del manifest.
 * Capas no-required → null. Body siempre usa la primera opción.
 *
 * @param {object} manifest
 * @returns {{ bodyType: string, layers: Record<string, string|null> }}
 */
export function defaultConfig(manifest) {
  const bodyType = manifest.bodyTypes[0].id;
  const layers = {};
  for (const layer of manifest.layers) {
    if (layer.required) {
      layers[layer.key] = layer.options[0].id;
    } else {
      layers[layer.key] = null;
    }
  }
  return { bodyType, layers };
}

/**
 * Resuelve las fuentes de capas activas para la config dada, ordenadas por zPos
 * ascendente. Siempre incluye body. Capas con selección null se saltan (excepto
 * las requeridas).
 *
 * @param {{ bodyType: string, layers: Record<string, string|null> }} config
 * @param {object} manifest
 * @returns {Array<{ key: string, zPos: number, url: string }>}
 */
export function orderedLayerSources(config, manifest) {
  const result = [];

  for (const layer of manifest.layers) {
    const selectedId = config.layers[layer.key];
    if (selectedId === null || selectedId === undefined) continue;

    const option = layer.options.find((o) => o.id === selectedId);
    if (!option) continue;

    const file = option.files[config.bodyType];
    if (!file) continue;

    result.push({
      key: layer.key,
      zPos: layer.zPos,
      url: `/world/${file}`,
    });
  }

  // Ordenar por zPos ascendente
  result.sort((a, b) => a.zPos - b.zPos);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Carga una Image desde una URL y la devuelve en una Promise.
 * Rechaza si hay error de carga.
 *
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar imagen: ${url}`));
    img.src = url;
  });
}

/**
 * Compone el frame de preview (fila down, col 0) a partir del spritesheet completo.
 * Dibuja cada capa sobre un canvas 64×64.
 *
 * @param {Array<HTMLImageElement>} spritesheets  — imágenes completas (576×256) en orden zPos.
 * @returns {HTMLCanvasElement}
 */
function composePreviewFrame(spritesheets) {
  // Frame "down mirando al frente": fila 2 (down), columna 0 → offset (0, 128)
  const FRAME_W = 64;
  const FRAME_H = 64;
  const FRAME_ROW_DOWN = 2;
  const sx = 0;
  const sy = FRAME_ROW_DOWN * FRAME_H; // 128

  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas; // jsdom sin contexto real

  for (const img of spritesheets) {
    if (!img) continue;
    ctx.drawImage(img, sx, sy, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Crea el overlay del creador de avatar.
 *
 * @returns {{ el: HTMLElement, open: () => void, close: () => void, destroy: () => void }}
 */
export function AvatarCreator() {
  let manifest = null;
  let config = null;

  // ── Fondo oscuro (backdrop) ──────────────────────────────────────────────
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Creador de avatar');
  el.setAttribute('aria-modal', 'true');
  el.style.cssText = [
    'display:none',
    'position:absolute',
    'inset:0',
    'background:rgba(0,0,0,0.75)',
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
    'max-width:480px',
    'width:90%',
    'max-height:90vh',
    'overflow-y:auto',
    'display:flex',
    'flex-direction:column',
    'gap:14px',
  ].join(';');
  el.appendChild(modal);

  // ── Cabecera ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';

  const title = document.createElement('h2');
  title.style.cssText = 'margin:0;font-size:16px;color:#90caf9;';
  title.textContent = 'Editar avatar';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cerrar creador de avatar');
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

  // ── Área de selectores ───────────────────────────────────────────────────
  const selectorsArea = document.createElement('div');
  selectorsArea.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
  modal.appendChild(selectorsArea);

  // ── Preview ──────────────────────────────────────────────────────────────
  const previewArea = document.createElement('div');
  previewArea.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';

  const previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:11px;color:#aaa;';
  previewLabel.textContent = 'Vista previa';
  previewArea.appendChild(previewLabel);

  const previewContainer = document.createElement('div');
  previewContainer.style.cssText = [
    'width:128px',
    'height:128px',
    'background:#111',
    'border:1px solid rgba(255,255,255,0.1)',
    'border-radius:6px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
  ].join(';');
  previewArea.appendChild(previewContainer);
  modal.appendChild(previewArea);

  // ── Estado de guardado ───────────────────────────────────────────────────
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:12px;text-align:center;min-height:18px;';
  modal.appendChild(statusEl);

  // ── Botón guardar ────────────────────────────────────────────────────────
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.style.cssText = [
    'background:#3a7bd5',
    'color:#fff',
    'border:none',
    'border-radius:6px',
    'padding:8px 16px',
    'cursor:pointer',
    'font-size:13px',
    'font-family:sans-serif',
    'align-self:flex-end',
  ].join(';');
  saveBtn.textContent = 'Guardar avatar';
  saveBtn.addEventListener('click', handleSave);
  modal.appendChild(saveBtn);

  // ── Cerrar con Esc ───────────────────────────────────────────────────────
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  // ---------------------------------------------------------------------------
  // Renderizado de selectores
  // ---------------------------------------------------------------------------

  function renderSelectors() {
    selectorsArea.replaceChildren();

    if (!manifest || !config) {
      const loading = document.createElement('div');
      loading.textContent = 'Cargando...';
      selectorsArea.appendChild(loading);
      return;
    }

    // Selector de bodyType
    const btRow = makeSelectRow({
      label: 'Tipo de cuerpo',
      options: manifest.bodyTypes.map((bt) => ({ value: bt.id, label: bt.name })),
      value: config.bodyType,
      onChange: (val) => {
        config.bodyType = val;
        updatePreview();
      },
    });
    selectorsArea.appendChild(btRow);

    // Selectores de capas
    for (const layer of manifest.layers) {
      const options = [];
      if (!layer.required) {
        options.push({ value: '', label: 'Ninguno' });
      }
      for (const opt of layer.options) {
        options.push({ value: opt.id, label: opt.name });
      }

      const current = config.layers[layer.key] ?? '';

      const row = makeSelectRow({
        label: layer.name,
        options,
        value: current,
        onChange: (val) => {
          config.layers[layer.key] = val === '' ? null : val;
          updatePreview();
        },
      });
      selectorsArea.appendChild(row);
    }
  }

  /**
   * Crea una fila label + <select>.
   */
  function makeSelectRow({ label, options, value, onChange }) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';

    const lbl = document.createElement('label');
    lbl.style.cssText = 'flex:1;color:#ccc;';
    lbl.textContent = label;

    const sel = document.createElement('select');
    sel.style.cssText = [
      'background:#2a2a3e',
      'border:1px solid rgba(255,255,255,0.2)',
      'border-radius:4px',
      'color:#e0e0e0',
      'padding:3px 6px',
      'font-size:12px',
      'font-family:sans-serif',
      'flex:1',
    ].join(';');

    for (const opt of options) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.value === value) optEl.selected = true;
      sel.appendChild(optEl);
    }

    sel.addEventListener('change', () => onChange(sel.value));

    lbl.htmlFor = sel.id = `ac-sel-${label.replace(/\s+/g, '-').toLowerCase()}`;
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------

  async function updatePreview() {
    if (!manifest || !config) return;

    previewContainer.replaceChildren();

    const sources = orderedLayerSources(config, manifest);
    if (sources.length === 0) return;

    try {
      const images = await Promise.all(sources.map((s) => loadImage(s.url)));
      const previewCanvas = composePreviewFrame(images);
      // Escalar 64→128 con CSS para mayor visibilidad
      previewCanvas.style.cssText = 'width:128px;height:128px;image-rendering:pixelated;';
      previewContainer.appendChild(previewCanvas);
    } catch {
      // En jsdom / entorno sin imágenes reales, simplemente no muestra nada.
    }
  }

  // ---------------------------------------------------------------------------
  // Guardar
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!manifest || !config) return;

    const user = getSession()?.user;
    if (!user) {
      statusEl.style.color = '#f48fb1';
      statusEl.textContent = 'No hay sesion activa.';
      return;
    }

    saveBtn.disabled = true;
    statusEl.style.color = '#90caf9';
    statusEl.textContent = 'Guardando...';

    try {
      const sources = orderedLayerSources(config, manifest);
      const images = await Promise.all(sources.map((s) => loadImage(s.url)));

      // Spritesheet completo: 9 cols × 64 = 576 ancho; 4 filas × 64 = 256 alto
      const SHEET_W = manifest.frame.w * manifest.frame.cols; // 576
      const SHEET_H = manifest.frame.h * manifest.frame.rows; // 256

      const sheet = composeLayers(images, { width: SHEET_W, height: SHEET_H });

      const blob = await new Promise((resolve, reject) => {
        sheet.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), 'image/png');
      });

      await saveAvatar({ supabase, user, config, blob });

      statusEl.style.color = '#a5d6a7';
      statusEl.textContent = 'Avatar guardado. Re-entra a /mundo para ver el cambio.';
    } catch (err) {
      console.error('[AvatarCreator] error al guardar', err);
      statusEl.style.color = '#f48fb1';
      statusEl.textContent = 'Error al guardar. Intenta de nuevo.';
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  async function open() {
    el.style.display = 'flex';
    closeBtn.focus();
    document.addEventListener('keydown', onKeydown);

    if (!manifest) {
      try {
        const res = await fetch('/world/lpc/manifest.json');
        manifest = await res.json();
        config = defaultConfig(manifest);
      } catch (err) {
        console.error('[AvatarCreator] error al cargar manifest', err);
        selectorsArea.replaceChildren();
        const errEl = document.createElement('div');
        errEl.style.color = '#f48fb1';
        errEl.textContent = 'Error al cargar el manifest.';
        selectorsArea.appendChild(errEl);
        return;
      }
    }

    renderSelectors();
    updatePreview();
  }

  function close() {
    el.style.display = 'none';
    document.removeEventListener('keydown', onKeydown);
  }

  function destroy() {
    close();
    el.remove();
  }

  return { el, open, close, destroy };
}
