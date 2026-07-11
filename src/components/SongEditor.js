/**
 * SongEditor.js — Block-based Song Editor
 *
 * Visual block editor (Notion/Worship Tools style) for creating and editing songs.
 * Features: section blocks, line rows, voice assignment (line + word-level),
 * chord editor (UltimateGuitar style), import modal, and live preview.
 */

import { fetchSongDetail, refreshData, invalidateSongDetailCache } from '../lib/store.js';
import { songToChordPro } from '../lib/importParse.js';
import { MUSICAL_KEYS, chordProKeyToCanonical } from '../lib/musicKeys.js';
import { navigate } from '../router.js';
import { getSession, isFeatureEnabled } from '../lib/authStore.js';
import { renderSections } from './SongView.js';
import {
  CANONICAL_VOICE_ORDER,
  VOICE_LINK_TYPES,
  validateSongPreSave,
  getVoiceLabel,
  isValidNote,
} from '../lib/voiceSystem.js';
import { getChordNotation } from '../lib/chordNotation.js';
import { openChordEditorModal } from './editor/ChordEditorModal.js';
import { openTonoEditorModal } from './editor/TonoEditorModal.js';
import { openImportModal } from './editor/ImportModal.js';
import { createSongAudioSection } from './editor/SongAudioSection.js';
import {
  fetchSectionAudio,
  createSectionAudio,
  uploadSectionAudioFile,
  deleteSectionAudio,
} from '../lib/sectionAudioApi.js';
import { readAudioDuration } from '../lib/stemsApi.js';
import { icon } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';
import { showToast } from '../lib/toast.js';
import { skelLongText } from '../lib/skeleton.js';

const SECTION_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const PREVIEW_DEBOUNCE_MS = 300;

// Espeja VOICE_SCOPES del endpoint (api/songs/[id]/section-audio.js): las 4
// voces SATB + lead/backing del Estudio. '' = Mezcla (voiceScope null).
const AUDIO_VOICE_SCOPES = [
  { id: '', label: 'Mezcla' },
  { id: 'soprano', label: 'Soprano' },
  { id: 'contralto', label: 'Contralto' },
  { id: 'tenor', label: 'Tenor' },
  { id: 'bass', label: 'Bajo' },
  { id: 'lead', label: 'Voz líder' },
  { id: 'backing', label: 'Coros' },
];

function audioScopeLabel(voiceScope) {
  const found = AUDIO_VOICE_SCOPES.find((s) => s.id === (voiceScope ?? ''));
  return found ? found.label : voiceScope;
}

const API_URL = '/api';

const LINK_PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'apple_music', label: 'Apple Music' },
  { id: 'deezer', label: 'Deezer' },
  { id: 'amazon_music', label: 'Amazon Music' },
  { id: 'tidal', label: 'Tidal' },
  { id: 'soundcloud', label: 'SoundCloud' },
];

const SECTION_TYPES = [
  { type: 'verse', label: 'Verso' },
  { type: 'chorus', label: 'Coro' },
  { type: 'bridge', label: 'Puente' },
  { type: 'prechorus', label: 'Pre-Coro' },
  { type: 'intro', label: 'Intro' },
  { type: 'outro', label: 'Outro' },
];

/* ─── Data conversion helpers ─── */

/**
 * Convert song sections from DB to editable block structure
 */
function sectionsToBlocks(sections) {
  if (!sections || !Array.isArray(sections)) return [];
  return sections.map((section, si) => ({
    id: `section-${si}-${Date.now()}`,
    type: section.type || 'verse',
    label: section.label || 'Verso',
    speedPreset: typeof section.speedPreset === 'number' ? section.speedPreset : null,
    lines: (section.lines || []).map((line, li) => ({
      id: `line-${si}-${li}-${Date.now()}`,
      text: line.text || '',
      groups: Array.isArray(line.groups)
        ? line.groups.map((g) => ({
            start: g.start,
            end: g.end,
            voiceId: g.voiceId,
            note: g.note ?? null,
          }))
        : [],
      chords: Array.isArray(line.chords) ? line.chords.map((c) => ({ pos: c.pos, ch: c.ch })) : [],
      annotation: line.annotation || false,
      spoken: line.spoken || false,
    })),
  }));
}

/**
 * v3: serializa el modelo de bloques al schema v3 — `groups`/`chords` por línea
 * (capas independientes) + `speedPreset` por sección. Sin `voiceRanges` ni
 * `voiceLines` (el coloreado de Letra se eliminó en Fase 2).
 * @param {Array} blocks
 * @returns {Array}
 */
export function blocksToSectionsV3(blocks) {
  return blocks.map((block) => {
    const section = {
      type: block.type,
      label: block.label,
      lines: block.lines
        .filter(
          (l) =>
            l.text.trim() !== '' ||
            (l.chords && l.chords.length > 0) ||
            // groups: conserva la línea aunque el texto quede vacío para no perder la
            // voz/tono asignado en silencio; validateSongPreSave avisa al guardar.
            (Array.isArray(l.groups) && l.groups.length > 0) ||
            l.annotation ||
            l.spoken,
        )
        .map((l) => {
          const line = { text: l.text };
          if (Array.isArray(l.groups) && l.groups.length > 0) {
            line.groups = l.groups.map((g) => ({
              start: g.start,
              end: g.end,
              voiceId: g.voiceId,
              note: g.note ?? null,
            }));
          }
          if (Array.isArray(l.chords) && l.chords.length > 0) {
            line.chords = l.chords.map((c) => ({ pos: c.pos, ch: c.ch }));
          }
          if (l.annotation) line.annotation = true;
          if (l.spoken) line.spoken = true;
          return line;
        }),
    };
    if (typeof block.speedPreset === 'number' && !Number.isNaN(block.speedPreset)) {
      section.speedPreset = block.speedPreset;
    }
    return section;
  });
}

/* ─── Unique ID generator ─── */
let _idCounter = 0;
function uid() {
  return `uid-${Date.now()}-${_idCounter++}`;
}

/* ─── Main Render ─── */

/**
 * Render the block-based song editor
 * @param {HTMLElement} container
 * @param {string} [editId]
 * @param {{from?: string|null}} [opts] - Si viene `from`, al guardar/cancelar se vuelve a /song/<from>.
 */
export async function renderSongEditor(container, editId, { from = null } = {}) {
  let existingSong = null;

  if (editId) {
    // Skeleton por región mientras carga el detalle de la canción.
    // renderAsyncRegion no aplica aquí: el resto del editor (1400+ líneas de
    // event listeners) vive en el mismo scope async y no puede extraerse a un
    // callback sin una refactorización mayor. El async/await ya maneja el ciclo.
    container.innerHTML = `<div class="editor editor--loading fade-in" aria-busy="true">${skelLongText()}</div>`;
    existingSong = await fetchSongDetail(editId);
    if (!existingSong) {
      container.innerHTML = `
        <div class="editor editor--notfound fade-in">
          <p class="editor__state-text">${icon('frown', { size: 18 })} No se encontró la canción.</p>
          <button class="btn btn--secondary" id="editor-back-home">← Volver</button>
        </div>
      `;
      container
        .querySelector('#editor-back-home')
        ?.addEventListener('click', () => navigate(from ? '/song/' + from : '/admin/edit'));
      return;
    }
  }

  // Editable state
  const blocks = existingSong ? sectionsToBlocks(existingSong.sections) : [];

  // ─── v2 (Tono) gating ───
  // When false, EVERYTHING below related to voz_tono is skipped so the v1
  // render output, event wiring and save payload stay byte-for-byte identical.
  const v2Enabled = isFeatureEnabled('voz_tono');
  const voiceRoster = v2Enabled
    ? Array.isArray(existingSong?.voiceRoster)
      ? existingSong.voiceRoster.map((v) => ({ ...v }))
      : []
    : [];

  // Build the editor HTML
  container.innerHTML = `
    <div class="editor fade-in">
      <h1 class="editor__title">${existingSong ? 'Editar canción' : 'Nueva canción'}</h1>

      <!-- Basic Info -->
      <div class="editor__section">
        <h2 class="editor__section-title">Información básica</h2>
        <div class="form-group">
          <label class="form-group__label" for="song-title">Título *</label>
          <input class="form-group__input" id="song-title" type="text" placeholder="Nombre de la canción" value="${escapeHtml(existingSong?.title || '')}" required />
        </div>
        <div class="form-group">
          <label class="form-group__label" for="song-artist">Artista</label>
          <input class="form-group__input" id="song-artist" type="text" placeholder="Hakuna Group Music" value="${escapeHtml(existingSong?.artist || 'Hakuna Group Music')}" />
        </div>
        <div class="editor__row-3">
          <div class="form-group">
            <label class="form-group__label" for="song-album">Álbum</label>
            <input class="form-group__input" id="song-album" type="text" placeholder="Nombre del álbum" value="${escapeHtml(existingSong?.album || '')}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-order">Orden</label>
            <input class="form-group__input" id="song-order" type="number" placeholder="Ej: 1" value="${existingSong?.albumOrder || ''}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-year">Año</label>
            <input class="form-group__input" id="song-year" type="number" placeholder="2024" value="${existingSong?.year || ''}" />
          </div>
        </div>
        <div class="editor__row-3">
          <div class="form-group">
            <label class="form-group__label" for="song-genre">Género</label>
            <input class="form-group__input" id="song-genre" type="text" placeholder="Pop/Worship" value="${escapeHtml(existingSong?.genre || '')}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-cejilla">Cejilla</label>
            <input class="form-group__input" id="song-cejilla" type="number" min="0" max="12" placeholder="0" value="${existingSong?.cejilla || ''}" />
          </div>
          <div class="form-group">
            <label class="form-group__label" for="song-key">Tono</label>
            <select class="form-group__input" id="song-key">
              <option value="">Sin especificar</option>
              ${MUSICAL_KEYS.map(
                (k) =>
                  `<option value="${k}"${existingSong?.key === k ? ' selected' : ''}>${k}</option>`,
              ).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Voice -->
      <div class="editor__section">
        <h2 class="editor__section-title">Tipo de voz</h2>
        <div class="form-group">
          <label class="form-group__label">Porcentaje: <span id="voice-value">♂ ${existingSong?.voicePercent?.male ?? 50}% / ♀ ${100 - (existingSong?.voicePercent?.male ?? 50)}%</span></label>
          <div class="voice-slider">
            <span class="voice-slider__icon">♂</span>
            <input type="range" id="voice-range" min="0" max="100" value="${existingSong?.voicePercent?.male ?? 50}" />
            <span class="voice-slider__icon">♀</span>
          </div>
        </div>
      </div>

      <!-- Cover Image -->
      <div class="editor__section">
        <h2 class="editor__section-title">Portada del álbum</h2>
        <div class="image-upload" id="image-upload-area">
          <div id="image-preview"></div>
          <p class="image-upload__text">${icon('camera', { size: 18 })} Haz clic o arrastra una imagen aquí</p>
          <input type="file" id="cover-input" accept="image/*" class="editor__cover-input" />
        </div>
      </div>

      <!-- Song audio (mp3 completo + sincronía) -->
      <div class="editor__section" id="editor-song-audio"></div>

      <!-- Links -->
      <div class="editor__section">
        <h2 class="editor__section-title">Links de plataformas</h2>
        <div id="editor-platform-links">
          ${LINK_PLATFORMS.map(
            (p) => `
            <div class="form-group">
              <label class="form-group__label" for="link-${p.id}">${p.label}</label>
              <input class="form-group__input" id="link-${p.id}" type="url" placeholder="https://..." data-platform="${p.id}" />
            </div>
          `,
          ).join('')}
        </div>
        <h2 class="editor__section-title editor__section-title--spaced">Links de voces (Drive)</h2>
        <div id="editor-voice-links"></div>
        <button class="btn btn--secondary editor__add-link-btn" id="add-voice-link-btn" type="button">+ Agregar link de voz</button>
      </div>

      ${
        v2Enabled
          ? `<!-- Roster de voces (v2) -->
      <section class="editor-roster editor__section" id="editor-roster">
        <h2 class="editor__section-title editor__section-title--flex">${icon('users', { size: 18 })} Voces de la canción</h2>
        <div id="roster-list"></div>
        <button class="btn btn--secondary editor__roster-add-btn" id="add-roster-voice" type="button">${icon('plus', { size: 16 })} Añadir voz</button>
      </section>`
          : ''
      }

      <!-- Block Editor -->
      <div class="editor__section">
        <h2 class="editor__section-title">Letras</h2>
        <div class="block-editor" id="block-editor"></div>
        <div class="block-editor__controls">
          <button class="btn btn--secondary block-editor__add-section" id="add-section-btn">+ Agregar sección</button>
          <button class="btn btn--secondary block-editor__import-btn" id="import-btn">${icon('download', { size: 16 })} Importar letra</button>
          <button class="btn btn--secondary block-editor__export-btn" id="export-chordpro-btn" type="button">${icon('download', { size: 16 })} Exportar ChordPro</button>
        </div>
      </div>

      <!-- Save error (inline, gated visibility) -->
      <div class="editor__save-error" id="editor-save-error" role="alert" hidden></div>

      <!-- Actions -->
      <div class="editor__actions">
        <button class="btn btn--secondary" id="editor-cancel">Cancelar</button>
        ${existingSong ? `<button class="btn btn--secondary btn--danger btn--icon btn--delete-action" id="editor-delete">${icon('trash', { size: 16 })} Eliminar</button>` : ''}
        <button class="btn btn--primary btn--icon" id="editor-save">${icon('save', { size: 16 })} Guardar canción</button>
      </div>
    </div>
  `;

  // ─── Setup event listeners ───

  // Voice range slider
  const voiceRange = container.querySelector('#voice-range');
  const voiceValue = container.querySelector('#voice-value');
  voiceRange.addEventListener('input', () => {
    const male = voiceRange.value;
    voiceValue.textContent = `♂ ${male}% / ♀ ${100 - male}%`;
  });

  // Image upload
  const uploadArea = container.querySelector('#image-upload-area');
  const coverInput = container.querySelector('#cover-input');
  const imagePreview = container.querySelector('#image-preview');
  // Estado de la portada elegida en ESTA sesión del editor (closure, no global de
  // módulo): evita que la portada de una canción se filtre al guardado de otra.
  const coverState = { blob: null };
  uploadArea.addEventListener('click', () => coverInput.click());
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--color-primary)';
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '';
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '';
    if (e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0], imagePreview, coverState);
    }
  });
  coverInput.addEventListener('change', () => {
    if (coverInput.files.length > 0) handleImageFile(coverInput.files[0], imagePreview, coverState);
  });

  // ─── Links Editor ───
  const voiceLinksEl = container.querySelector('#editor-voice-links');
  let voiceLinkItems = [];

  function renderVoiceLinks() {
    voiceLinksEl.innerHTML = voiceLinkItems
      .map(
        (item, i) => `
        <div class="editor__row-3 editor__vlink-row" data-vlink="${i}">
          <div class="form-group">
            <label class="form-group__label">Voz</label>
            <select class="form-group__input" data-action="vlink-voice" data-idx="${i}">
              ${VOICE_LINK_TYPES.map((v) => `<option value="${v.id}" ${item.voiceType === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-group__label">URL (Drive)</label>
            <input class="form-group__input" type="url" placeholder="https://drive.google.com/..." data-action="vlink-url" data-idx="${i}" value="${escapeHtml(item.url || '')}" />
          </div>
          <div class="form-group">
            <label class="form-group__label">Etiqueta</label>
            <input class="form-group__input" type="text" placeholder="Partitura" data-action="vlink-label" data-idx="${i}" value="${escapeHtml(item.label || '')}" />
          </div>
          <button class="btn btn--secondary btn--danger btn--compact" data-action="vlink-delete" data-idx="${i}" type="button" aria-label="Eliminar enlace">${icon('close', { size: 16 })}</button>
        </div>
      `,
      )
      .join('');
  }

  voiceLinksEl.addEventListener('input', (e) => {
    const idx = parseInt(e.target.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (e.target.dataset.action === 'vlink-url') voiceLinkItems[idx].url = e.target.value;
    if (e.target.dataset.action === 'vlink-label') voiceLinkItems[idx].label = e.target.value;
  });

  voiceLinksEl.addEventListener('change', (e) => {
    const idx = parseInt(e.target.dataset.idx);
    if (Number.isNaN(idx)) return;
    if (e.target.dataset.action === 'vlink-voice') voiceLinkItems[idx].voiceType = e.target.value;
  });

  voiceLinksEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="vlink-delete"]');
    if (!btn) return;
    voiceLinkItems.splice(parseInt(btn.dataset.idx), 1);
    renderVoiceLinks();
  });

  container.querySelector('#add-voice-link-btn').addEventListener('click', () => {
    voiceLinkItems.push({ voiceType: 'soprano', url: '', label: '' });
    renderVoiceLinks();
  });

  if (editId) {
    fetch(`${API_URL}/songs/${editId}/links`)
      .then((r) => (r.ok ? r.json() : { platforms: [], voices: [] }))
      .then(({ platforms, voices }) => {
        for (const p of platforms) {
          const input = container.querySelector(`#link-${p.platform}`);
          if (input) input.value = p.url;
        }
        voiceLinkItems = voices.map((v) => ({
          voiceType: v.voiceType,
          url: v.url,
          label: v.label || '',
        }));
        renderVoiceLinks();
      })
      .catch(() => {});
  }

  renderVoiceLinks();

  // ─── Roster de voces (v2, gated) ───
  const rosterListEl = v2Enabled ? container.querySelector('#roster-list') : null;

  function renderRoster() {
    if (!rosterListEl) return;
    if (voiceRoster.length === 0) {
      rosterListEl.innerHTML =
        '<p class="editor__empty-hint">Aún no hay voces. Añade al menos una para asignar voces y tono por rango.</p>';
      return;
    }
    rosterListEl.innerHTML = voiceRoster
      .map((v, i) => {
        const keyInvalid =
          v.referenceKey !== null &&
          v.referenceKey !== undefined &&
          v.referenceKey !== '' &&
          !isValidNote(v.referenceKey);
        return `
        <div class="roster-row" data-roster-idx="${i}">
          <div class="form-group form-group--flex-2">
            <label class="form-group__label">Nombre</label>
            <input class="form-group__input" type="text" data-action="roster-name" data-idx="${i}" value="${escapeHtml(v.name || '')}" placeholder="Voz ${i + 1}" />
          </div>
          <div class="form-group form-group--flex-2">
            <label class="form-group__label">Categoría</label>
            <select class="form-group__input" data-action="roster-category" data-idx="${i}">
              ${CANONICAL_VOICE_ORDER.map((c) => `<option value="${c}" ${v.category === c ? 'selected' : ''}>${getVoiceLabel(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group form-group--flex-1">
            <label class="form-group__label">Tono ref.</label>
            <input class="form-group__input ${keyInvalid ? 'form-group__input--invalid' : ''}" type="text" data-action="roster-refkey" data-idx="${i}" value="${escapeHtml(v.referenceKey || '')}" placeholder="Ej: B3" aria-invalid="${keyInvalid}" />
          </div>
          <button class="btn btn--secondary roster-row__delete" data-action="roster-delete" data-idx="${i}" type="button" aria-label="Eliminar voz">${icon('trash', { size: 16 })}</button>
        </div>`;
      })
      .join('');
  }

  /**
   * Remove all references to a roster id from every line's voiceLines.
   * @param {string} rosterId
   */
  function purgeRosterIdFromLines(rosterId) {
    for (const block of blocks) {
      for (const line of block.lines) {
        if (Array.isArray(line.groups) && line.groups.length > 0) {
          line.groups = line.groups.filter((g) => g.voiceId !== rosterId);
        }
      }
    }
  }

  if (v2Enabled) {
    rosterListEl.addEventListener('input', (e) => {
      const idx = Number.parseInt(e.target.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      const action = e.target.dataset.action;
      if (action === 'roster-name') {
        voiceRoster[idx].name = e.target.value;
      } else if (action === 'roster-refkey') {
        const val = e.target.value.trim();
        voiceRoster[idx].referenceKey = val === '' ? null : val;
        const invalid = val !== '' && !isValidNote(val);
        e.target.classList.toggle('form-group__input--invalid', invalid);
        e.target.setAttribute('aria-invalid', String(invalid));
      }
    });

    rosterListEl.addEventListener('change', (e) => {
      const idx = Number.parseInt(e.target.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      if (e.target.dataset.action === 'roster-category') {
        voiceRoster[idx].category = e.target.value;
      }
    });

    rosterListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="roster-delete"]');
      if (!btn) return;
      const idx = Number.parseInt(btn.dataset.idx, 10);
      if (Number.isNaN(idx) || !voiceRoster[idx]) return;
      const removed = voiceRoster.splice(idx, 1)[0];
      if (removed) purgeRosterIdFromLines(removed.id);
      renderRoster();
      renderBlocks();
    });

    container.querySelector('#add-roster-voice').addEventListener('click', () => {
      voiceRoster.push({
        id: uid(),
        name: `Voz ${voiceRoster.length + 1}`,
        category: 'soprano',
        referenceKey: null,
      });
      renderRoster();
    });

    renderRoster();
  }

  // ─── Audio por sección (admin, subida independiente del guardado) ───
  // Un solo GET al abrir el editor (fetchSectionAudio ya tolera cualquier
  // fallo y resuelve []); el resto del flujo (POST/PUT/DELETE) es local por
  // sección y no bloquea "Guardar canción".
  let sectionAudioItems = [];
  const audioUiState = new Map(); // block.id → { expanded, uploading, error }

  function getAudioUi(blockId) {
    if (!audioUiState.has(blockId)) {
      audioUiState.set(blockId, { expanded: false, uploading: false, error: null });
    }
    return audioUiState.get(blockId);
  }

  // ─── Vista previa por sección (en vivo) ───
  // Reusa renderSections (el pipeline real del lector) en vez de imitar el
  // render. Cada sección tiene su propio toggle + debounce: escribir en una
  // línea NUNCA dispara un renderBlocks completo (perdería el foco/caret),
  // solo re-pinta el panel de SU sección, y solo si está expandido.
  const previewUiState = new Map(); // block.id → { expanded }
  const previewTimers = new Map(); // block.id → timeout id

  function getPreviewUi(blockId) {
    if (!previewUiState.has(blockId)) previewUiState.set(blockId, { expanded: false });
    return previewUiState.get(blockId);
  }

  function renderSectionPreviewContent(block) {
    const [section] = blocksToSectionsV3([block]);
    if (!section || section.lines.length === 0) {
      return '<p class="editor__preview-hint">Agrega letra para ver la vista previa.</p>';
    }
    // viewMode 'chords': muestra letra + acordes flotantes (si hay) — más útil
    // en el editor que 'lyrics' (que oculta los acordes por completo).
    return renderSections([section], { viewMode: 'chords', notation: getChordNotation() });
  }

  function schedulePreviewUpdate(blockId) {
    if (!getPreviewUi(blockId).expanded) return;
    const existing = previewTimers.get(blockId);
    if (existing) clearTimeout(existing);
    previewTimers.set(
      blockId,
      setTimeout(() => {
        previewTimers.delete(blockId);
        const panel = editorRoot.querySelector(`[data-section-preview-content="${blockId}"]`);
        const block = blocks.find((b) => b.id === blockId);
        if (panel && block) panel.innerHTML = renderSectionPreviewContent(block);
      }, PREVIEW_DEBOUNCE_MS),
    );
  }

  function renderSectionPreviewControl(block, index) {
    const ui = getPreviewUi(block.id);
    return `
      <div class="section-preview" data-section-preview="${index}">
        <button class="section-preview__toggle" data-action="toggle-preview" data-section="${index}" type="button" aria-expanded="${ui.expanded}">
          ${icon('eye', { size: 14 })} Vista previa
          ${icon(ui.expanded ? 'chevron-up' : 'chevron-down', { size: 14 })}
        </button>
        ${
          ui.expanded
            ? `<div class="section-preview__panel" data-section-preview-content="${block.id}">${renderSectionPreviewContent(block)}</div>`
            : ''
        }
      </div>`;
  }

  // ─── Block Editor Core ───
  const editorRoot = container.querySelector('#block-editor');

  function renderBlocks() {
    editorRoot.innerHTML = blocks
      .map((block, bi) => renderSectionBlock(block, bi, blocks.length))
      .join('');
  }

  function renderSectionAudioControl(block, index) {
    const items = sectionAudioItems.filter((it) => it.sectionIndex === index);
    const ui = getAudioUi(block.id);
    const badge =
      items.length > 0 ? `<span class="section-audio__badge">${items.length}</span>` : '';

    const rows = items
      .map(
        (it) => `
          <div class="section-audio__row" data-audio-id="${it.id}">
            <span class="section-audio__row-label">${escapeHtml(audioScopeLabel(it.voiceScope))}${it.label ? ` · ${escapeHtml(it.label)}` : ''}</span>
            <button class="btn btn--secondary btn--danger btn--compact" data-action="delete-section-audio" data-audio-id="${it.id}" type="button" aria-label="Eliminar audio">${icon('trash', { size: 14 })}</button>
          </div>`,
      )
      .join('');

    return `
      <div class="section-audio" data-section-audio="${index}">
        <button class="section-audio__toggle" data-action="toggle-audio" data-section="${index}" type="button" aria-expanded="${ui.expanded}">
          ${icon('audio-lines', { size: 14 })} Audio${badge}
          ${icon(ui.expanded ? 'chevron-up' : 'chevron-down', { size: 14 })}
        </button>
        ${
          ui.expanded
            ? `<div class="section-audio__panel">
                ${items.length > 0 ? `<div class="section-audio__list">${rows}</div>` : '<p class="section-audio__hint">Sin audio en esta sección.</p>'}
                <div class="section-audio__upload">
                  <select class="form-group__input section-audio__scope" data-action="audio-scope" data-section="${index}">
                    ${AUDIO_VOICE_SCOPES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
                  </select>
                  <input class="form-group__input section-audio__label" type="text" placeholder="Etiqueta (opcional)" data-action="audio-label" data-section="${index}" />
                  <label class="btn btn--secondary section-audio__file-btn">
                    ${icon('upload', { size: 14 })} Subir audio
                    <input type="file" accept="audio/*" data-action="upload-audio-file" data-section="${index}" ${ui.uploading ? 'disabled' : ''} hidden />
                  </label>
                </div>
                ${ui.uploading ? '<p class="section-audio__status">Subiendo...</p>' : ''}
                ${ui.error ? `<p class="section-audio__error" role="alert">${escapeHtml(ui.error)}</p>` : ''}
              </div>`
            : ''
        }
      </div>`;
  }

  async function handleSectionAudioUpload(fileInput, index) {
    const file = fileInput.files?.[0];
    if (!file) return;
    const block = blocks[index];
    if (!block) return;
    const ui = getAudioUi(block.id);

    if (!existingSong) {
      ui.error = 'Guarda la canción antes de subir audio';
      ui.expanded = true;
      renderBlocks();
      return;
    }

    if (file.size > SECTION_AUDIO_MAX_BYTES) {
      ui.error = 'El archivo supera el límite de 25 MB';
      ui.expanded = true;
      renderBlocks();
      return;
    }

    const panel = fileInput.closest('.section-audio__upload');
    const voiceScope = panel?.querySelector('[data-action="audio-scope"]')?.value || null;
    const label = panel?.querySelector('[data-action="audio-label"]')?.value?.trim() || null;

    ui.uploading = true;
    ui.error = null;
    ui.expanded = true;
    renderBlocks();

    // Si el slot ya tenía audio, el POST de más abajo lo upsertea reusando la
    // MISMA storage_key (ver postSectionAudio en api/songs/[id]/section-audio.js)
    // — el archivo viejo no se toca hasta que el PUT lo sobrescribe. Lo
    // guardamos antes para decidir la compensación si el PUT falla.
    const hadExistingAudio = sectionAudioItems.some(
      (it) => it.sectionIndex === index && it.voiceScope === voiceScope,
    );
    let createdId = null;

    try {
      const durationSec = await readAudioDuration(file);
      const { uploadUrl, id } = await createSectionAudio(existingSong.id, {
        sectionIndex: index,
        voiceScope,
        label,
        durationSec: durationSec || null,
      });
      createdId = id;
      await uploadSectionAudioFile(uploadUrl, file);
      sectionAudioItems = sectionAudioItems.filter(
        (it) => !(it.sectionIndex === index && it.voiceScope === voiceScope),
      );
      sectionAudioItems.push({
        id,
        sectionIndex: index,
        voiceScope,
        label,
        durationSec: durationSec || null,
      });
      showToast('Audio subido correctamente', { duration: 3000 });
    } catch (err) {
      // El POST (createSectionAudio) ya upsertea la fila antes del PUT; si fue
      // el PUT el que falló, la fila quedó apuntando a una key sin archivo (o,
      // en una re-subida, al archivo viejo intacto). El POST fallando no crea
      // nada, así que no hay nada que compensar en ese caso (createdId nulo).
      if (createdId && !hadExistingAudio) {
        // Slot nuevo: sin archivo en storage, la fila quedó rota. Best-effort,
        // no debe tapar el error original que se muestra abajo.
        try {
          await deleteSectionAudio(existingSong.id, createdId);
        } catch {
          // silencioso a propósito
        }
      } else if (createdId && hadExistingAudio) {
        // Re-subida: el archivo viejo sigue en storage bajo la misma key —
        // borrar la fila lo dejaría huérfano. Solo re-sincronizamos el estado
        // local con el servidor (que aún referencia el audio viejo).
        try {
          sectionAudioItems = await fetchSectionAudio(existingSong.id);
        } catch {
          // best-effort; conserva sectionAudioItems tal como estaba
        }
      }
      ui.error = err.message || 'No se pudo subir el audio';
    } finally {
      ui.uploading = false;
      renderBlocks();
    }
  }

  function renderSectionBlock(block, index, total) {
    const typeOptions = SECTION_TYPES.map(
      (s) =>
        `<option value="${s.type}" ${s.type === block.type ? 'selected' : ''}>${s.label}</option>`,
    ).join('');

    const linesHtml = block.lines
      .map((line, li) => renderLineRow(line, li, block.lines.length, block.id))
      .join('');

    return `
      <div class="section-block" data-section-id="${block.id}" data-section-index="${index}">
        <div class="section-block__header">
          <div class="section-block__header-left">
            <select class="section-block__type-select" data-action="change-type" data-section="${index}">
              ${typeOptions}
            </select>
            <input class="section-block__label-input" type="text" value="${escapeHtml(block.label)}" data-action="change-label" data-section="${index}" placeholder="Nombre de la sección" />
          </div>
          <div class="section-block__header-actions">
            ${
              v2Enabled
                ? `<label class="section-block__speed" title="Velocidad de scroll sugerida (F)">
                    <span class="section-block__speed-label">Vel.</span>
                    <input class="section-block__speed-input" type="number" min="0" max="100" placeholder="—" value="${typeof block.speedPreset === 'number' ? block.speedPreset : ''}" data-action="change-speed" data-section="${index}" aria-label="Velocidad de scroll sugerida (0-100)" />
                  </label>`
                : ''
            }
            ${index > 0 ? `<button class="section-block__btn" data-action="move-section-up" data-section="${index}" title="Mover arriba" aria-label="Mover arriba">${icon('chevron-up', { size: 18 })}</button>` : ''}
            ${index < total - 1 ? `<button class="section-block__btn" data-action="move-section-down" data-section="${index}" title="Mover abajo" aria-label="Mover abajo">${icon('chevron-down', { size: 18 })}</button>` : ''}
            <button class="section-block__btn section-block__btn--danger" data-action="delete-section" data-section="${index}" title="Eliminar sección" aria-label="Eliminar sección">${icon('trash', { size: 16 })}</button>
          </div>
        </div>
        <div class="section-block__lines">
          ${linesHtml}
        </div>
        <button class="section-block__add-line" data-action="add-line" data-section="${index}">+ Agregar línea</button>
        ${renderSectionPreviewControl(block, index)}
        ${renderSectionAudioControl(block, index)}
      </div>
    `;
  }

  function renderLineRow(line, _lineIndex, _totalLines, _sectionId) {
    const mainContent = `<input class="line-row__input" type="text" value="${escapeHtml(line.text)}" data-action="edit-text" data-line-id="${line.id}" placeholder="Escribe la línea aquí..." />`;

    return `
      <div class="line-row" data-line-id="${line.id}">
        <div class="line-row__main">
          ${mainContent}
          <div class="line-row__actions">
            ${v2Enabled ? `<button class="line-row__btn line-row__btn--tono${line.groups && line.groups.length > 0 ? ' line-row__btn--active' : ''}" data-action="open-tono" data-line-id="${line.id}" title="Voces y tono" aria-label="Voces y tono">${icon('music', { size: 16 })}</button>` : ''}
            <button class="line-row__btn ${line.chords && line.chords.length > 0 ? 'line-row__btn--active' : ''}" data-action="open-chords" data-line-id="${line.id}" title="Acordes" aria-label="Acordes">${icon('audio-lines', { size: 16 })}</button>
            <button class="line-row__btn ${line.annotation ? 'line-row__btn--active line-row__btn--annotation' : ''}" data-action="toggle-annotation" data-line-id="${line.id}" title="Marcar como anotación/guía" aria-label="Marcar como anotación/guía">${icon('tag', { size: 16 })}</button>
            <button class="line-row__btn ${line.spoken ? 'line-row__btn--active' : ''}" data-action="toggle-spoken" data-line-id="${line.id}" title="Marcar como recitado (texto hablado)" aria-label="Marcar como recitado">${icon('message', { size: 16 })}</button>
            <button class="line-row__btn line-row__btn--delete" data-action="delete-line" data-line-id="${line.id}" title="Eliminar" aria-label="Eliminar línea">${icon('close', { size: 16 })}</button>
          </div>
        </div>
      </div>
    `;
  }

  // Find line/section by IDs
  function findLine(lineId) {
    for (const block of blocks) {
      const line = block.lines.find((l) => l.id === lineId);
      if (line) return { block, line };
    }
    return null;
  }

  // ─── Event delegation for block editor ───
  editorRoot.addEventListener('input', (e) => {
    const action = e.target.dataset.action;
    if (action === 'edit-text') {
      const found = findLine(e.target.dataset.lineId);
      if (found) {
        found.line.text = e.target.value;
        schedulePreviewUpdate(found.block.id);
      }
    } else if (action === 'change-label') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].label = e.target.value;
        schedulePreviewUpdate(blocks[si].id);
      }
    } else if (action === 'change-speed') {
      if (!v2Enabled) return;
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        const raw = e.target.value.trim();
        if (raw === '') {
          blocks[si].speedPreset = null;
        } else {
          const n = Number.parseInt(raw, 10);
          blocks[si].speedPreset = Number.isNaN(n) ? null : Math.max(0, Math.min(100, n));
        }
      }
    }
  });

  editorRoot.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'change-type') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].type = e.target.value;
        renderBlocks();
      }
    } else if (e.target.dataset.action === 'upload-audio-file') {
      const si = parseInt(e.target.dataset.section);
      handleSectionAudioUpload(e.target, si);
    }
  });

  editorRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'add-line') {
      const si = parseInt(btn.dataset.section);
      blocks[si].lines.push({
        id: uid(),
        text: '',
        groups: [],
        chords: [],
        annotation: false,
        spoken: false,
      });
      renderBlocks();
      // Focus the new line input
      const lastInput = editorRoot.querySelector(
        `[data-section-index="${si}"] .line-row:last-child .line-row__input`,
      );
      lastInput?.focus();
    } else if (action === 'delete-line') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.block.lines = found.block.lines.filter((l) => l.id !== btn.dataset.lineId);
        renderBlocks();
      }
    } else if (action === 'open-chords') {
      const found = findLine(btn.dataset.lineId);
      if (found) openChordEditorModal(found.line, { blocks, onClose: renderBlocks });
    } else if (action === 'toggle-annotation') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.annotation = !found.line.annotation;
        renderBlocks();
      }
    } else if (action === 'toggle-spoken') {
      const found = findLine(btn.dataset.lineId);
      if (found) {
        found.line.spoken = !found.line.spoken;
        renderBlocks();
      }
    } else if (action === 'open-tono') {
      if (!v2Enabled) return;
      const found = findLine(btn.dataset.lineId);
      if (found) openTonoEditorModal(found.line, { voiceRoster, onClose: renderBlocks });
    } else if (action === 'move-section-up') {
      const si = parseInt(btn.dataset.section);
      if (si > 0) {
        [blocks[si - 1], blocks[si]] = [blocks[si], blocks[si - 1]];
        renderBlocks();
      }
    } else if (action === 'move-section-down') {
      const si = parseInt(btn.dataset.section);
      if (si < blocks.length - 1) {
        [blocks[si], blocks[si + 1]] = [blocks[si + 1], blocks[si]];
        renderBlocks();
      }
    } else if (action === 'delete-section') {
      const si = parseInt(btn.dataset.section);
      if (confirm(`¿Eliminar la sección "${blocks[si].label}"?`)) {
        blocks.splice(si, 1);
        renderBlocks();
      }
    } else if (action === 'toggle-preview') {
      const si = parseInt(btn.dataset.section);
      const block = blocks[si];
      if (block) {
        const ui = getPreviewUi(block.id);
        ui.expanded = !ui.expanded;
        renderBlocks();
      }
    } else if (action === 'toggle-audio') {
      const si = parseInt(btn.dataset.section);
      const block = blocks[si];
      if (block) {
        const ui = getAudioUi(block.id);
        ui.expanded = !ui.expanded;
        renderBlocks();
      }
    } else if (action === 'delete-section-audio') {
      if (!existingSong) return;
      if (!confirm('¿Eliminar el audio de esta sección?')) return;
      const audioId = btn.dataset.audioId;
      deleteSectionAudio(existingSong.id, audioId)
        .then(() => {
          sectionAudioItems = sectionAudioItems.filter((it) => it.id !== audioId);
          showToast('Audio eliminado', { duration: 3000 });
          renderBlocks();
        })
        .catch((err) => showToast('Error: ' + err.message, { type: 'error', duration: 3000 }));
    }
  });

  // Add section button
  container.querySelector('#add-section-btn').addEventListener('click', () => {
    const verseCount = blocks.filter((b) => b.type === 'verse').length;
    blocks.push({
      id: uid(),
      type: 'verse',
      label: `Verso ${verseCount + 1}`,
      lines: [{ id: uid(), text: '', groups: [], chords: [], annotation: false }],
    });
    renderBlocks();
    // Focus the new section's first input
    const lastSection = editorRoot.querySelector('.section-block:last-child .line-row__input');
    lastSection?.focus();
  });

  // ─── Import Modal ───
  container.querySelector('#import-btn').addEventListener('click', () => {
    openImportModal({
      onImport: (parsed) => {
        if (parsed.length > 0) {
          blocks.push(...parsed);
          renderBlocks();
        }
        fillMetaFromImport(parsed.meta);
      },
    });
  });

  // Rellena metadata (title/artist/key/capo) desde directivas ChordPro SOLO si
  // el campo del formulario está vacío — nunca pisa un valor ya cargado.
  function fillMetaFromImport(meta) {
    if (!meta) return;
    const titleEl = container.querySelector('#song-title');
    if (meta.title && titleEl && !titleEl.value.trim()) titleEl.value = meta.title;
    const artistEl = container.querySelector('#song-artist');
    if (meta.artist && artistEl && !artistEl.value.trim()) artistEl.value = meta.artist;
    const keyEl = container.querySelector('#song-key');
    if (meta.key && keyEl && !keyEl.value) {
      const canonical = chordProKeyToCanonical(meta.key);
      if (canonical) keyEl.value = canonical;
    }
    const cejillaEl = container.querySelector('#song-cejilla');
    if (meta.capo !== undefined && cejillaEl && !cejillaEl.value) {
      cejillaEl.value = String(meta.capo);
    }
  }

  // ─── Export ChordPro ───
  container.querySelector('#export-chordpro-btn').addEventListener('click', () => {
    const title = container.querySelector('#song-title')?.value?.trim() || 'Sin título';
    const artist = container.querySelector('#song-artist')?.value?.trim() || '';
    const key = container.querySelector('#song-key')?.value || '';
    const cejilla = container.querySelector('#song-cejilla')?.value || '';
    const song = {
      title,
      artist,
      key,
      cejilla,
      sections: blocksToSectionsV3(blocks),
    };
    const text = songToChordPro(song);
    const blob = new Blob([text], { type: 'text/plain' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${title}.cho`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  });

  // ─── Initial render ───
  renderBlocks();

  // Un solo GET al abrir el editor; fetchSectionAudio ya tolera cualquier
  // fallo y resuelve [] (los badges simplemente no aparecen).
  if (editId) {
    fetchSectionAudio(editId).then((items) => {
      sectionAudioItems = items;
      renderBlocks();
    });
  }

  // Audio completo + sincronía: componente aparte con su propio polling
  // (vive fuera de renderBlocks, sobrevive a los re-renders de bloques y
  // solo se apaga al navegar fuera del editor — ver destroy() abajo).
  const songAudioSection = createSongAudioSection({ songId: existingSong?.id ?? null });
  container.querySelector('#editor-song-audio').replaceWith(songAudioSection.el);

  // ─── Cancel ───
  container.querySelector('#editor-cancel').addEventListener('click', () => {
    songAudioSection.destroy();
    navigate(from ? '/song/' + from : '/admin');
  });

  // ─── Delete ───
  if (existingSong) {
    container
      .querySelector('#editor-delete')
      ?.addEventListener('click', () => handleDelete(songAudioSection.destroy, existingSong));
  }

  // ─── Save ───
  container.querySelector('#editor-save').addEventListener('click', () =>
    handleSave(container, existingSong, blocks, voiceLinkItems, {
      v2Enabled,
      voiceRoster,
      from,
      destroySongAudio: songAudioSection.destroy,
      coverState,
    }),
  );
}

/* ─── Image handling ─── */

function handleImageFile(file, previewEl, coverState) {
  if (!file.type.startsWith('image/')) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 800;
    let { width, height } = img;
    if (width > MAX || height > MAX) {
      const ratio = Math.min(MAX / width, MAX / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        coverState.blob = blob;
        const previewUrl = URL.createObjectURL(blob);
        previewEl.innerHTML = `
          <img class="image-upload__preview" src="${previewUrl}" alt="Preview" />
          <p class="image-upload__meta">WebP · ${width}×${height} · ${(blob.size / 1024).toFixed(1)} KB</p>
        `;
      },
      'image/webp',
      0.8,
    );
  };
  img.src = url;
}

/* ─── Save ─── */

function collectLinks(container, voiceLinkItems) {
  const platforms = [];
  for (const p of LINK_PLATFORMS) {
    const input = container.querySelector(`#link-${p.id}`);
    if (input?.value?.trim()) {
      platforms.push({ platform: p.id, url: input.value.trim() });
    }
  }
  const voices = voiceLinkItems
    .filter((v) => v.url?.trim())
    .map((v) => ({ voiceType: v.voiceType, url: v.url.trim(), label: v.label?.trim() || null }));
  return { platforms, voices };
}

/**
 * Destino de navegación tras guardar el editor.
 * @param {{from: string|null, isNew: boolean}} opts
 * @returns {string} ruta hash (sin '#')
 */
export function postSaveTarget({ from, isNew }) {
  if (from) return '/song/' + from;
  return isNew ? '/admin' : '/admin/edit';
}

async function handleSave(container, existingSong, blocks, voiceLinkItems, v2 = {}) {
  const btn = container.querySelector('#editor-save');
  const roster = v2.v2Enabled ? v2.voiceRoster || [] : [];
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  clearSaveError(container);

  try {
    const title = container.querySelector('#song-title').value.trim();
    if (!title) {
      container.querySelector('#song-title').focus();
      throw new Error('El título es requerido');
    }

    const artist = container.querySelector('#song-artist').value.trim() || 'Hakuna Group Music';
    const album = container.querySelector('#song-album').value.trim() || 'Sin álbum';
    const albumOrder = Number.parseInt(container.querySelector('#song-order').value) || 0;
    const year =
      Number.parseInt(container.querySelector('#song-year').value) || new Date().getFullYear();
    const genre = container.querySelector('#song-genre').value.trim() || '';
    const malePercent = Number.parseInt(container.querySelector('#voice-range').value);

    const songId = existingSong?.id || crypto.randomUUID();
    const albumSlug = generateSlug(album);
    const coverKey = coverImageKey(album);
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    let coverImage = existingSong?.coverImage || `${albumSlug}.webp`;
    const token = getSession()?.access_token;

    // 1. Upload new image if present
    if (v2.coverState?.blob) {
      const fd = new FormData();
      fd.append('cover', v2.coverState.blob, coverKey);
      const imgRes = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!imgRes.ok) {
        showSaveError(container, 'No se pudo subir la portada. Reintenta o quita la imagen.');
        return;
      }
      const imgData = await imgRes.json();
      coverImage = imgData.url;
    }

    // 2. Save song data
    const cejilla = Number.parseInt(container.querySelector('#song-cejilla').value) || null;
    const key = container.querySelector('#song-key')?.value || null;

    const newSong = {
      id: songId,
      title,
      artist,
      album,
      albumSlug,
      year,
      genre,
      voiceType,
      voicePercent: { male: malePercent, female: 100 - malePercent },
      coverImage,
      albumOrder,
      cejilla,
      key,
      sections: blocksToSectionsV3(blocks),
    };

    // ─── v3: sólo cuando hay roster. Sin roster, el payload es de forma v1. ───
    if (roster.length > 0) {
      newSong.schemaVersion = 3;
      newSong.voiceRoster = roster;
    }

    // Links en el mismo payload: el back los guarda en la MISMA transacción
    // que la canción (guardado atómico, ver api/songs/[id].js).
    const links = collectLinks(container, voiceLinkItems);
    newSong.platformLinks = links.platforms;
    newSong.voiceLinks = links.voices;

    // Validación pre-guardado: bloquea el envío con un mensaje legible por
    // sección/línea (acorde fuera de texto, nota inválida, etc.) en vez de
    // dejar que el back rechace el request con el "Error guardando" opaco.
    const { valid, errors } = validateSongPreSave(newSong);
    if (!valid) {
      showSaveError(container, errors[0]);
      return;
    }

    const method = existingSong ? 'PUT' : 'POST';
    const url = existingSong ? `${API_URL}/songs/${existingSong.id}` : `${API_URL}/songs`;

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(newSong),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Error guardando la canción');
    }

    // El SW cachea el detalle (StaleWhileRevalidate); sin esto el lector
    // mostraría la versión vieja en la primera visita tras editar.
    await invalidateSongDetailCache(songId);
    await refreshData();
    v2.destroySongAudio?.();
    navigate(postSaveTarget({ from: v2.from || null, isNew: !existingSong }));
    showToast('Canción guardada correctamente', { duration: 3000 });
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message, { type: 'error', duration: 3000 });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('save', { size: 16 })} Guardar canción`;
  }
}

/* ─── Delete ─── */

async function handleDelete(destroySongAudio, song) {
  if (!confirm(`¿Estás seguro de que deseas eliminar la canción "${song.title}"?`)) return;
  const token = getSession()?.access_token;
  try {
    const res = await fetch(`${API_URL}/songs/${song.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al eliminar');
    await refreshData();
    destroySongAudio?.();
    navigate('/admin/edit');
    showToast('Canción eliminada', { duration: 3000 });
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message, { type: 'error', duration: 3000 });
  }
}

/* ─── Utilities ─── */

function generateSlug(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

/**
 * Filename de portada legible y distinguible por álbum (slug + hash corto djb2
 * en base36 del nombre CRUDO del álbum), usado como nombre del archivo subido
 * a Storage. Dos álbumes con el mismo slug ya no comparten filename dentro de
 * la URL pública resultante (el backend antepone su propio prefijo único por
 * subida en `uploadCover`, así que esto no evita colisiones de objetos en
 * Storage — solo hace el nombre legible y distinguible por álbum).
 * Asume `album` no nulo/indefinido (invariante del llamador en handleSave).
 * @param {string} album
 */
export function coverImageKey(album) {
  let h = 5381;
  for (let i = 0; i < album.length; i++) h = ((h << 5) + h + album.charCodeAt(i)) >>> 0;
  return `${generateSlug(album)}-${h.toString(36)}.webp`;
}

/**
 * Show an inline, accessible save error next to the save button. Includes an
 * icon + text (not color-only) and is exposed via role="alert".
 * @param {HTMLElement} container
 * @param {string} message
 */
function showSaveError(container, message) {
  const el = container.querySelector('#editor-save-error');
  if (!el) return;
  el.innerHTML = `${icon('frown', { size: 16 })}<span>${escapeHtml(message)}</span>`;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** @param {HTMLElement} container */
function clearSaveError(container) {
  const el = container.querySelector('#editor-save-error');
  if (!el) return;
  el.hidden = true;
  el.innerHTML = '';
}
