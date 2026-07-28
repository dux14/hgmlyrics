// src/components/VozEditor.js
// Editor admin para crear/editar voces en off.
// Segmented Editar / Vista previa: un panel a la vez (mobile-first).
// El preview reutiliza el helper compartido con WeeklyWordView (contrato
// público de weekly-word.css), para que ambas vistas nunca diverjan.

import '../styles/weekly-word.css';
import '../styles/voz-editor.css';
import '../styles/editor.css'; // B4 (perf): .editor__* — movido desde app.css
import { navigate } from '../router.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { vozHeroBodyHtml } from '../lib/vozHeroBody.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';
import { getSession } from '../lib/authStore.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelLongText } from '../lib/skeleton.js';
import { invalidateWeeklyWords } from '../lib/weeklyWords.js';

// Colores litúrgicos disponibles como chips (mismos values que liturgical_color).
const COLOR_OPTIONS = ['green', 'purple', 'white', 'red'];
const COLOR_LABELS = { green: 'Verde', purple: 'Morado', white: 'Blanco', red: 'Rojo' };
// El acento de "Blanco" es claro (crema): su chip seleccionado lleva texto oscuro.
const CHIP_DARK_TEXT = new Set(['white']);

function authHeader() {
  const s = getSession();
  return s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : {};
}

async function fetchOrdo(date) {
  const res = await fetch(`/api/ordo/${date}`, { headers: authHeader() });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Ajusta una fecha YYYY-MM-DD al domingo de su semana (el domingo anterior o
 * el mismo día si ya es domingo). La voz en off siempre se ancla al domingo.
 * @param {string} value - YYYY-MM-DD
 * @returns {string} YYYY-MM-DD del domingo
 */
function snapToSunday(value) {
  if (!value) return value;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0 = domingo
  if (day !== 0) dt.setDate(dt.getDate() - day);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function saveWord(id, fields) {
  const url = id ? `/api/weekly-words/${id}` : '/api/weekly-words';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

/**
 * Markup de los chips de color litúrgico.
 * @param {string} selected - value seleccionado ('' = ninguno)
 * @returns {string}
 */
function colorChipsHtml(selected) {
  return COLOR_OPTIONS.map((c) => {
    const { accent } = liturgicalPalette(c);
    const textColor = CHIP_DARK_TEXT.has(c) ? '#241d0c' : '#ffffff';
    const checked = selected === c;
    return `<button type="button" class="voz-editor__color-chip" data-color="${c}" role="radio" aria-checked="${checked}" style="--chip-accent: ${accent}; --chip-text: ${textColor};">
      <span class="voz-editor__color-chip-dot"></span>${COLOR_LABELS[c]}
    </button>`;
  }).join('');
}

/**
 * Retorna una Promise que se resuelve cuando la región está pintada. Eso permite
 * que los llamadores (y los tests) hagan `await renderVozEditor(container, id)`.
 * El retry interno de renderAsyncRegion vuelve a invocar renderAsyncRegion(opts)
 * directamente — la Promise original ya estará resuelta, lo que es aceptable.
 * @param {HTMLElement} container
 * @param {string|null} wordId - null para crear nuevo
 */
export function renderVozEditor(container, wordId = null) {
  if (!wordId) {
    _mountVozForm(container, null, null);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    renderAsyncRegion(container, {
      skeleton: () => skelLongText(),
      fetcher: () =>
        fetch(`/api/weekly-words/${wordId}`, { headers: authHeader() }).then((res) =>
          res.ok ? res.json() : null,
        ),
      // render recibe null si el servidor devuelve !ok (abre el form en blanco,
      // comportamiento original). renderAsyncRegion llama empty() solo si está
      // definido; al omitirlo, render(null) se invoca directamente.
      render: (word) => {
        _mountVozForm(container, word, wordId);
        resolve();
      },
      onError: () => {
        resolve();
        return `<div class="empty-state fade-in"><p class="empty-state__text">No se pudo cargar la voz en off.</p><button class="btn btn--primary" data-retry>Reintentar</button></div>`;
      },
    });
  });
}

function _mountVozForm(container, word, wordId) {
  container.innerHTML = `
    <div class="voz-editor fade-in">
      <header class="voz-editor__topbar">
        <h1 class="editor__title voz-editor__title">${wordId ? 'Editar voz en off' : 'Nueva voz en off'}</h1>
        ${
          wordId
            ? `<button type="button" class="voz-editor__delete-btn" id="voz-delete" aria-label="Eliminar voz en off">${icon('trash', { size: 18 })}</button>`
            : ''
        }
      </header>

      <div class="voz-editor__seg" role="tablist">
        <button type="button" class="voz-editor__seg-tab is-active" id="voz-tab-edit" data-panel="edit" role="tab" aria-selected="true" aria-controls="voz-panel-edit">Editar</button>
        <button type="button" class="voz-editor__seg-tab" id="voz-tab-preview" data-panel="preview" role="tab" aria-selected="false" aria-controls="voz-panel-preview">Vista previa</button>
      </div>

      <div id="voz-panel-edit" class="voz-editor__panel" role="tabpanel" aria-labelledby="voz-tab-edit">
        <form id="voz-form" class="voz-editor__form">
          <div class="voz-editor__load-ordo-block">
            <button type="button" class="voz-editor__load-ordo-btn" id="voz-load-ordo">
              ${icon('download', { size: 16 })}
              <span>Cargar desde ordo</span>
            </button>
            <p class="voz-editor__load-ordo-hint">Autocompleta cita, título litúrgico, color y evangelio del domingo elegido.</p>
            <span id="voz-ordo-status" class="voz-editor__status"></span>
          </div>

          <div class="voz-editor__row-2">
            <div>
              <label class="editor__label" for="voz-sunday-date">Domingo</label>
              <input type="date" id="voz-sunday-date" class="editor__input" value="${escapeHtml(word?.sunday_date ?? '')}">
            </div>
            <div>
              <label class="editor__label" for="voz-gospel-ref">Cita</label>
              <input type="text" id="voz-gospel-ref" class="editor__input" placeholder="Jn 14,6" value="${escapeHtml(word?.gospel_ref ?? '')}">
            </div>
          </div>

          <div>
            <label class="editor__label" for="voz-liturgical-title">Título litúrgico</label>
            <input type="text" id="voz-liturgical-title" class="editor__input" placeholder="XI Domingo del Tiempo Ordinario" value="${escapeHtml(word?.liturgical_title ?? '')}">
          </div>

          <div>
            <span class="editor__label">Color litúrgico</span>
            <div class="voz-editor__color-chips" role="radiogroup" aria-label="Color litúrgico" id="voz-color-chips">
              ${colorChipsHtml(word?.liturgical_color ?? '')}
            </div>
          </div>

          <div>
            <label class="editor__label" for="voz-body">Voz en off</label>
            <textarea id="voz-body" class="editor__input editor__input--mono" rows="12">${escapeHtml(word?.voiceover_body ?? '')}</textarea>
            <p class="voz-editor__hint">La cita bíblica y la reflexión se separan solas</p>
          </div>

          <div>
            <label class="editor__label" for="voz-title">Título de búsqueda</label>
            <input type="text" id="voz-title" class="editor__input" placeholder="Ej. La vid y los sarmientos" value="${escapeHtml(word?.title ?? '')}">
          </div>

          <details class="voz-editor__gospel-details">
            <summary class="voz-editor__gospel-summary">Evangelio del día</summary>
            <textarea id="voz-gospel-body" class="editor__input editor__input--mono editor__input--gospel" rows="8">${escapeHtml(word?.gospel_body ?? '')}</textarea>
          </details>
        </form>
      </div>

      <div id="voz-panel-preview" class="voz-editor__panel voz-view" role="tabpanel" aria-labelledby="voz-tab-preview" hidden>
        <div id="voz-preview-content"></div>
      </div>

      <div class="voz-editor__footer">
        <div id="voz-error" class="voz-editor__error"></div>
        <div class="voz-editor__footer-actions">
          <button type="button" class="btn btn--secondary btn--icon" id="voz-save-draft">
            ${icon('save', { size: 16 })} Guardar borrador
          </button>
          <button type="button" class="btn btn--primary btn--icon" id="voz-publish">
            ${icon('check', { size: 16 })} Publicar
          </button>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('#voz-sunday-date');
  const titleSearchInput = container.querySelector('#voz-title');
  const refInput = container.querySelector('#voz-gospel-ref');
  const titleInput = container.querySelector('#voz-liturgical-title');
  const colorChipsEl = container.querySelector('#voz-color-chips');
  const bodyArea = container.querySelector('#voz-body');
  const gospelArea = container.querySelector('#voz-gospel-body');
  const previewEl = container.querySelector('#voz-preview-content');
  const statusEl = container.querySelector('#voz-ordo-status');
  const errorEl = container.querySelector('#voz-error');

  let selectedColor = word?.liturgical_color ?? '';

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = msg ? 'block' : 'none';
  }

  function applyColor(color) {
    selectedColor = color || '';
    colorChipsEl.querySelectorAll('.voz-editor__color-chip').forEach((chip) => {
      chip.setAttribute('aria-checked', String(chip.dataset.color === selectedColor));
    });
  }

  function updatePreview() {
    const previewWord = {
      sunday_date: dateInput.value,
      gospel_ref: refInput.value.trim(),
      liturgical_title: titleInput.value.trim(),
      liturgical_color: selectedColor,
      voiceover_body: bodyArea.value,
      gospel_body: gospelArea.value.trim(),
    };
    const palette = liturgicalPalette(previewWord.liturgical_color);
    const gradient = coverGradient(palette);
    previewEl.innerHTML = vozHeroBodyHtml(previewWord);
    const heroEl = previewEl.querySelector('.voz-view__hero');
    if (heroEl) {
      heroEl.style.setProperty('--liturgical-gradient', gradient);
      heroEl.style.setProperty('--liturgical-accent', palette.accent);
      heroEl.style.setProperty('--liturgical-text', palette.text);
      heroEl.style.setProperty('--liturgical-bg', palette.bg ?? 'transparent');
    }
  }

  [bodyArea, gospelArea, refInput, titleInput, dateInput].forEach((el) => {
    el.addEventListener('input', updatePreview);
  });
  colorChipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.voz-editor__color-chip');
    if (!chip) return;
    applyColor(selectedColor === chip.dataset.color ? '' : chip.dataset.color);
    updatePreview();
  });
  updatePreview();

  // Segmented Editar / Vista previa: alterna panel visible (uno a la vez).
  const segTabs = container.querySelectorAll('.voz-editor__seg-tab');
  const panels = {
    edit: container.querySelector('#voz-panel-edit'),
    preview: container.querySelector('#voz-panel-preview'),
  };
  segTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panel;
      segTabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      Object.entries(panels).forEach(([key, panel]) => {
        panel.hidden = key !== target;
      });
      if (target === 'preview') updatePreview();
    });
  });

  // La voz en off es "de la semana": ancla cualquier fecha elegida al domingo.
  dateInput.addEventListener('change', () => {
    const snapped = snapToSunday(dateInput.value);
    if (snapped && snapped !== dateInput.value) {
      dateInput.value = snapped;
      statusEl.textContent = 'Ajustado al domingo de esa semana';
    }
    // Refresca la vista previa con la fecha ya anclada al domingo (el evento
    // `input` previo pudo pintarla con la fecha sin ajustar).
    updatePreview();
  });

  container.querySelector('#voz-load-ordo')?.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) {
      showError('Selecciona una fecha primero');
      return;
    }
    // Status inline de acción de campo — no es un loader full-screen, se deja como está.
    statusEl.textContent = 'Cargando ordo…';
    try {
      const data = await fetchOrdo(date);
      if (!data) {
        statusEl.textContent = 'No disponible para esta fecha';
        return;
      }
      refInput.value = data.gospelRef || '';
      titleInput.value = data.liturgicalTitle || '';
      applyColor(data.liturgicalColor || '');
      gospelArea.value = data.gospelBody || '';
      statusEl.textContent = 'Ordo cargado';
      updatePreview();
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    }
  });

  async function doSave(publish) {
    showError('');
    const sunday_date = dateInput.value;
    const gospel_ref = refInput.value.trim();
    const voiceover_body = bodyArea.value.trim();
    if (!sunday_date) {
      showError('Selecciona una fecha');
      return;
    }
    if (!gospel_ref) {
      showError('La cita es requerida');
      return;
    }
    if (!voiceover_body) {
      showError('El bloque de voz en off no puede estar vacío');
      return;
    }
    try {
      const saved = await saveWord(wordId, {
        sunday_date,
        gospel_ref,
        title: titleSearchInput.value.trim() || null,
        liturgical_title: titleInput.value.trim() || null,
        liturgical_color: selectedColor || null,
        voiceover_body,
        gospel_body: gospelArea.value.trim() || null,
        published: publish,
      });
      invalidateWeeklyWords();
      navigate(`/voz/${saved.id}`);
    } catch (e) {
      showError(e.message);
    }
  }

  container.querySelector('#voz-save-draft')?.addEventListener('click', () => doSave(false));
  container.querySelector('#voz-publish')?.addEventListener('click', () => doSave(true));

  container.querySelector('#voz-delete')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta voz en off? Esta acción no se puede deshacer.')) return;
    try {
      await fetch(`/api/weekly-words/${wordId}`, { method: 'DELETE', headers: authHeader() });
      invalidateWeeklyWords();
      navigate('/voces');
    } catch (e) {
      showError(e.message);
    }
  });
}
