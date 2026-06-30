// src/components/VozEditor.js
// Editor admin para crear/editar voces en off.
// Split: formulario izquierda, preview en vivo derecha (o stacked en mobile).

import '../styles/weekly-word.css';
import { navigate } from '../router.js';
import { splitVoiceover } from '../lib/voiceover.js';
import { liturgicalPalette, coverGradient } from '../lib/liturgicalColor.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';
import { getSession } from '../lib/authStore.js';

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
 * @param {HTMLElement} container
 * @param {string|null} wordId - null para crear nuevo
 */
export async function renderVozEditor(container, wordId = null) {
  let word = null;

  if (wordId) {
    container.innerHTML = `<div class="empty-state fade-in"><div class="empty-state__icon">${icon('gospel', { size: 40 })}</div><h2>Cargando…</h2></div>`;
    try {
      const res = await fetch(`/api/weekly-words/${wordId}`, { headers: authHeader() });
      if (res.ok) word = await res.json();
    } catch (_e) {
      /* ignore */
    }
  }

  container.innerHTML = `
    <div class="voz-editor fade-in">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/admin" id="voz-ed-admin">Admin</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${wordId ? 'Editar voz en off' : 'Nueva voz en off'}</span>
      </nav>
      <h1 class="editor__title voz-editor__title">${wordId ? 'Editar voz en off' : 'Nueva voz en off'}</h1>

      <div class="voz-editor__body">
        <!-- Formulario -->
        <form id="voz-form" class="voz-editor__form">
          <div>
            <label class="editor__label" for="voz-sunday-date">Domingo</label>
            <input type="date" id="voz-sunday-date" class="editor__input" value="${escapeHtml(word?.sunday_date ?? '')}">
            <button type="button" class="btn btn--sm voz-editor__load-ordo-btn" id="voz-load-ordo">
              ${icon('download', { size: 14 })} Cargar desde ordo
            </button>
            <span id="voz-ordo-status" class="voz-editor__status"></span>
          </div>

          <div>
            <label class="editor__label" for="voz-title">Título (para búsqueda)</label>
            <input type="text" id="voz-title" class="editor__input" placeholder="Ej. La vid y los sarmientos" value="${escapeHtml(word?.title ?? '')}">
          </div>

          <div>
            <label class="editor__label" for="voz-gospel-ref">Referencia del evangelio</label>
            <input type="text" id="voz-gospel-ref" class="editor__input" placeholder="Jn 14,6" value="${escapeHtml(word?.gospel_ref ?? '')}">
          </div>

          <div>
            <label class="editor__label" for="voz-liturgical-title">Título litúrgico</label>
            <input type="text" id="voz-liturgical-title" class="editor__input" placeholder="XI Domingo del Tiempo Ordinario" value="${escapeHtml(word?.liturgical_title ?? '')}">
          </div>

          <div>
            <label class="editor__label" for="voz-liturgical-color">Color litúrgico</label>
            <select id="voz-liturgical-color" class="editor__input">
              <option value="">— sin color —</option>
              ${Object.entries({ green: 'Verde', purple: 'Morado', white: 'Blanco', red: 'Rojo' })
                .map(
                  ([c, label]) =>
                    `<option value="${c}"${word?.liturgical_color === c ? ' selected' : ''}>${label}</option>`,
                )
                .join('')}
            </select>
          </div>

          <div>
            <label class="editor__label" for="voz-body">Voz en off (pegar bloque completo)</label>
            <textarea id="voz-body" class="editor__input editor__input--mono" rows="12">${escapeHtml(word?.voiceover_body ?? '')}</textarea>
          </div>

          <details class="voz-editor__gospel-details">
            <summary class="voz-editor__gospel-summary">Evangelio del ordo (editable / colapsado)</summary>
            <textarea id="voz-gospel-body" class="editor__input editor__input--mono editor__input--gospel" rows="8">${escapeHtml(word?.gospel_body ?? '')}</textarea>
          </details>

          <div id="voz-error" class="voz-editor__error"></div>

          <div class="voz-editor__actions">
            <button type="button" class="btn btn--secondary btn--icon" id="voz-save-draft">
              ${icon('save', { size: 16 })} Guardar borrador
            </button>
            <button type="button" class="btn btn--primary btn--icon" id="voz-publish">
              ${icon('check', { size: 16 })} Publicar
            </button>
            ${wordId ? `<button type="button" class="btn btn--danger voz-editor__delete-btn" id="voz-delete">Eliminar</button>` : ''}
          </div>
        </form>

        <!-- Preview en vivo -->
        <div id="voz-preview" class="voz-preview">
          <p class="voz-preview__label">Vista previa en vivo</p>
          <div id="voz-preview-content"></div>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('#voz-sunday-date');
  const titleSearchInput = container.querySelector('#voz-title');
  const refInput = container.querySelector('#voz-gospel-ref');
  const titleInput = container.querySelector('#voz-liturgical-title');
  const colorSelect = container.querySelector('#voz-liturgical-color');
  const bodyArea = container.querySelector('#voz-body');
  const gospelArea = container.querySelector('#voz-gospel-body');
  const previewEl = container.querySelector('#voz-preview-content');
  const statusEl = container.querySelector('#voz-ordo-status');
  const errorEl = container.querySelector('#voz-error');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = msg ? 'block' : 'none';
  }

  function updatePreview() {
    const palette = liturgicalPalette(colorSelect.value);
    const gradient = coverGradient(palette);
    const { scripture, reflection } = splitVoiceover(bodyArea.value, gospelArea.value);
    const gospelRef = refInput.value.trim();
    // El hero usa el contrato de weekly-word.css: asigna custom props litúrgicas
    // en el propio elemento; los estilos (.voz-view__hero, etc.) los consume ese CSS.
    previewEl.innerHTML = `
      <div class="voz-view__hero" style="--liturgical-gradient: ${gradient}; --liturgical-accent: ${palette.accent}; --liturgical-text: ${palette.text}; --liturgical-bg: ${palette.bg ?? 'transparent'};">
        <p class="voz-view__eyebrow"><span class="voz-view__eyebrow-inner">${icon('gospel', { size: 13 })} Palabra de la semana</span></p>
        <h2 class="voz-view__title">${escapeHtml(gospelRef || 'Referencia del evangelio')}</h2>
        ${titleInput.value ? `<p class="voz-view__meta">${escapeHtml(titleInput.value)}</p>` : ''}
      </div>
      ${scripture ? `<pre class="voz__prose voz__scripture">${escapeHtml(scripture)}</pre>` : ''}
      ${
        reflection
          ? `
        <div class="voz__reflection-sep">${icon('sparkles', { size: 12 })} Reflexión</div>
        <pre class="voz__prose voz__reflection">${escapeHtml(reflection)}</pre>`
          : ''
      }
      ${!scripture && !reflection && bodyArea.value ? `<pre class="voz__prose">${escapeHtml(bodyArea.value)}</pre>` : ''}
    `;
  }

  [bodyArea, gospelArea, refInput, titleInput, colorSelect].forEach((el) => {
    el.addEventListener('input', updatePreview);
  });
  updatePreview();

  // La voz en off es "de la semana": ancla cualquier fecha elegida al domingo.
  dateInput.addEventListener('change', () => {
    const snapped = snapToSunday(dateInput.value);
    if (snapped && snapped !== dateInput.value) {
      dateInput.value = snapped;
      statusEl.textContent = 'Ajustado al domingo de esa semana';
    }
  });

  container.querySelector('#voz-ed-admin')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/admin');
  });

  container.querySelector('#voz-load-ordo')?.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) {
      showError('Selecciona una fecha primero');
      return;
    }
    statusEl.textContent = 'Cargando ordo…';
    try {
      const data = await fetchOrdo(date);
      if (!data) {
        statusEl.textContent = 'No disponible para esta fecha';
        return;
      }
      refInput.value = data.gospelRef || '';
      titleInput.value = data.liturgicalTitle || '';
      colorSelect.value = data.liturgicalColor || '';
      gospelArea.value = data.gospelBody || '';
      statusEl.textContent = 'ordo cargado ✓';
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
      showError('Referencia del evangelio requerida');
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
        liturgical_color: colorSelect.value || null,
        voiceover_body,
        gospel_body: gospelArea.value.trim() || null,
        published: publish,
      });
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
      navigate('/voces');
    } catch (e) {
      showError(e.message);
    }
  });
}
