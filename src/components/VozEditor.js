// src/components/VozEditor.js
// Editor admin para crear/editar voces en off.
// Split: formulario izquierda, preview en vivo derecha (o stacked en mobile).

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
    container.innerHTML = `<div class="empty-state fade-in"><div class="empty-state__icon">🕊</div><h2>Cargando…</h2></div>`;
    try {
      const res = await fetch(`/api/weekly-words/${wordId}`, { headers: authHeader() });
      if (res.ok) word = await res.json();
    } catch (_e) {
      /* ignore */
    }
  }

  container.innerHTML = `
    <div class="voz-editor fade-in" style="max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem;">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/admin" id="voz-ed-admin">Admin</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${wordId ? 'Editar voz en off' : 'Nueva voz en off'}</span>
      </nav>
      <h1 class="editor__title" style="margin: 1rem 0 1.5rem;">${wordId ? 'Editar voz en off' : 'Nueva voz en off'}</h1>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        <!-- Formulario -->
        <form id="voz-form" style="display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <label class="editor__label" for="voz-sunday-date">Domingo</label>
            <input type="date" id="voz-sunday-date" class="editor__input" value="${escapeHtml(word?.sunday_date ?? '')}">
            <button type="button" class="btn btn--sm" id="voz-load-ordo" style="margin-top: 0.5rem;">
              ${icon('download', { size: 14 })} Cargar desde ordo
            </button>
            <span id="voz-ordo-status" style="font-size: 0.75rem; margin-left: 0.5rem; color: var(--color-text-secondary);"></span>
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
              ${['green', 'purple', 'white', 'red']
                .map(
                  (c) =>
                    `<option value="${c}"${word?.liturgical_color === c ? ' selected' : ''}>${c}</option>`,
                )
                .join('')}
            </select>
          </div>

          <div>
            <label class="editor__label" for="voz-body">Voz en off (pegar bloque completo)</label>
            <textarea id="voz-body" class="editor__input" rows="12" style="resize: vertical; font-family: monospace;">${escapeHtml(word?.voiceover_body ?? '')}</textarea>
          </div>

          <details style="margin-top: 0.25rem;">
            <summary style="cursor: pointer; font-size: 0.85rem; color: var(--color-text-secondary);">Evangelio del ordo (editable / colapsado)</summary>
            <textarea id="voz-gospel-body" class="editor__input" rows="8" style="resize: vertical; margin-top: 0.5rem; font-family: monospace;">${escapeHtml(word?.gospel_body ?? '')}</textarea>
          </details>

          <div id="voz-error" style="color: var(--color-error); font-size: 0.85rem; display: none;"></div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button type="button" class="btn btn--secondary" id="voz-save-draft">
              ${icon('save', { size: 16 })} Guardar borrador
            </button>
            <button type="button" class="btn btn--primary" id="voz-publish">
              ${icon('check', { size: 16 })} Publicar
            </button>
            ${wordId ? `<button type="button" class="btn btn--danger" id="voz-delete" style="margin-left: auto;">Eliminar</button>` : ''}
          </div>
        </form>

        <!-- Preview en vivo -->
        <div id="voz-preview" style="background: var(--color-surface); border-radius: var(--border-radius-lg); padding: 1.5rem; overflow: auto; max-height: 90vh; position: sticky; top: 1rem;">
          <p style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-text-secondary); margin: 0 0 1rem;">Preview en vivo</p>
          <div id="voz-preview-content"></div>
        </div>
      </div>
    </div>
  `;

  const dateInput = container.querySelector('#voz-sunday-date');
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
    previewEl.innerHTML = `
      <div style="background: ${gradient}; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; color: ${palette.text};">
        <p style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8; margin: 0 0 0.25rem;">🕊 Palabra de la semana</p>
        <h2 style="font-size: 1.4rem; margin: 0;">${escapeHtml(gospelRef || 'Referencia del evangelio')}</h2>
        ${titleInput.value ? `<p style="font-size: 0.8rem; opacity: 0.8; margin: 0.5rem 0 0;">${escapeHtml(titleInput.value)}</p>` : ''}
      </div>
      ${scripture ? `<div style="border-left: 3px solid ${palette.accent}; padding-left: 0.75rem; margin-bottom: 1rem; font-style: italic; color: var(--color-text-secondary); white-space: pre-wrap;">${escapeHtml(scripture)}</div>` : ''}
      ${
        reflection
          ? `
        <div style="text-align: center; margin: 0.75rem 0; color: ${palette.accent}; font-weight: 600; font-size: 0.8rem;">✦ Reflexión</div>
        <div style="white-space: pre-wrap; color: var(--color-text);">${escapeHtml(reflection)}</div>`
          : ''
      }
      ${!scripture && !reflection && bodyArea.value ? `<div style="white-space: pre-wrap; color: var(--color-text);">${escapeHtml(bodyArea.value)}</div>` : ''}
    `;
  }

  [bodyArea, gospelArea, refInput, titleInput, colorSelect].forEach((el) => {
    el.addEventListener('input', updatePreview);
  });
  updatePreview();

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
