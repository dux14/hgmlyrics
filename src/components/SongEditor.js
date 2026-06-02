/**
 * SongEditor.js — Block-based Song Editor
 *
 * Visual block editor (Notion/Worship Tools style) for creating and editing songs.
 * Features: section blocks, line rows, voice assignment (line + word-level),
 * chord editor (UltimateGuitar style), import modal, and live preview.
 */

import { fetchSongDetail, refreshData, invalidateSongDetailCache } from '../lib/store.js';
import { navigate } from '../router.js';
import { getSession, isFeatureEnabled } from '../lib/authStore.js';
import { renderSongView } from './SongView.js';
import {
  CANONICAL_VOICE_ORDER,
  VOICE_TYPES,
  validateSongV3,
  getVoiceLabel,
  isValidNote,
} from '../lib/voiceSystem.js';
import {
  normalizeRange,
  buildCharStripHTML,
  deleteGroupAt,
  applyGroupsForRange,
} from '../lib/editorSelection.js';
import { icon } from '../lib/icons.js';

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
            l.text.trim() !== '' || (l.chords && l.chords.length > 0) || l.annotation || l.spoken,
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

/**
 * Parse imported plain text into block structure
 */
function parseImportText(text) {
  const blocks = [];
  const rawLines = text.split('\n');
  let current = null;
  let sectionCounter = 0;

  for (const rawLine of rawLines) {
    const sectionMatch = rawLine.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current) blocks.push(current);
      const label = sectionMatch[1];
      current = {
        id: `section-imp-${sectionCounter++}-${Date.now()}`,
        type: guessType(label),
        label,
        lines: [],
      };
    } else if (rawLine.trim() === '') {
      // Blank line — if we have no current section and have accumulated lines, push as new section
      if (current && current.lines.length > 0) {
        blocks.push(current);
        current = null;
      }
    } else {
      if (!current) {
        current = {
          id: `section-imp-${sectionCounter++}-${Date.now()}`,
          type: 'verse',
          label: `Verso ${sectionCounter}`,
          lines: [],
        };
      }

      // Parse inline chords
      const { text: cleanText, chords } = parseLineChords(rawLine);

      current.lines.push({
        id: `line-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: cleanText,
        groups: [],
        chords: chords || [],
        annotation: false,
      });
    }
  }

  if (current && current.lines.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Parse inline chords [Am]text [F]text → { text, chords }
 */
function parseLineChords(lineText) {
  const chords = [];
  let cleanText = '';
  const regex = /\[([A-G][#b]?(?:m|maj|min|dim|aug|sus|add)?[0-9]?(?:\/[A-G][#b]?)?)\]/g;
  let lastEnd = 0;
  let match;
  while ((match = regex.exec(lineText)) !== null) {
    cleanText += lineText.slice(lastEnd, match.index);
    chords.push({ ch: match[1], pos: cleanText.length });
    lastEnd = match.index + match[0].length;
  }
  cleanText += lineText.slice(lastEnd);
  return { text: cleanText, chords: chords.length > 0 ? chords : undefined };
}

function guessType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) return 'verse';
  if (lower.includes('coro') || lower.includes('chorus')) return 'chorus';
  if (lower.includes('puente') || lower.includes('bridge')) return 'bridge';
  if (lower.includes('pre')) return 'prechorus';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro')) return 'outro';
  return 'verse';
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
    container.innerHTML = `
      <div class="editor fade-in" style="display: flex; justify-content: center; align-items: center; min-height: 50vh;">
        <p style="color: var(--color-text-secondary); font-size: 1.1rem;">${icon('music', { size: 18, className: 'loading-pulse' })} Cargando canción...</p>
      </div>
    `;
    existingSong = await fetchSongDetail(editId);
    if (!existingSong) {
      container.innerHTML = `
        <div class="editor fade-in" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 50vh; gap: 1rem;">
          <p style="color: var(--color-text-secondary); font-size: 1.1rem; display: inline-flex; align-items: center; gap: 0.4em;">${icon('frown', { size: 18 })} No se encontró la canción.</p>
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
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label" for="song-genre">Género</label>
            <input class="form-group__input" id="song-genre" type="text" placeholder="Pop/Worship" value="${escapeHtml(existingSong?.genre || '')}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label" for="song-cejilla">Cejilla</label>
            <input class="form-group__input" id="song-cejilla" type="number" min="0" max="12" placeholder="0" value="${existingSong?.cejilla || ''}" />
          </div>
        </div>
      </div>

      <!-- Voice -->
      <div class="editor__section">
        <h2 class="editor__section-title">Tipo de voz</h2>
        <div class="form-group">
          <label class="form-group__label">Porcentaje: <span id="voice-value">♂ ${existingSong?.voicePercent?.male ?? 50}% / ♀ ${100 - (existingSong?.voicePercent?.male ?? 50)}%</span></label>
          <div class="voice-slider">
            <span style="font-size: 0.8rem;">♂</span>
            <input type="range" id="voice-range" min="0" max="100" value="${existingSong?.voicePercent?.male ?? 50}" />
            <span style="font-size: 0.8rem;">♀</span>
          </div>
        </div>
      </div>

      <!-- Cover Image -->
      <div class="editor__section">
        <h2 class="editor__section-title">Portada del álbum</h2>
        <div class="image-upload" id="image-upload-area">
          <div id="image-preview"></div>
          <p class="image-upload__text" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('camera', { size: 18 })} Haz clic o arrastra una imagen aquí</p>
          <input type="file" id="cover-input" accept="image/*" style="display: none;" />
        </div>
      </div>

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
        <h2 class="editor__section-title" style="margin-top: var(--space-lg);">Links de voces (Drive)</h2>
        <div id="editor-voice-links"></div>
        <button class="btn btn--secondary" id="add-voice-link-btn" type="button" style="margin-top: var(--space-sm);">+ Agregar link de voz</button>
      </div>

      ${
        v2Enabled
          ? `<!-- Roster de voces (v2) -->
      <section class="editor-roster editor__section" id="editor-roster">
        <h2 class="editor__section-title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('users', { size: 18 })} Voces de la canción</h2>
        <div id="roster-list"></div>
        <button class="btn btn--secondary" id="add-roster-voice" type="button" style="margin-top: var(--space-sm); display: inline-flex; align-items: center; gap: 0.4em;">${icon('plus', { size: 16 })} Añadir voz</button>
      </section>`
          : ''
      }

      <!-- Block Editor -->
      <div class="editor__section">
        <h2 class="editor__section-title">Letras</h2>
        <div class="block-editor" id="block-editor"></div>
        <div class="block-editor__controls">
          <button class="btn btn--secondary block-editor__add-section" id="add-section-btn">+ Agregar sección</button>
          <button class="btn btn--secondary block-editor__import-btn" id="import-btn" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('download', { size: 16 })} Importar texto</button>
        </div>
      </div>

      <!-- Live Preview -->
      <div class="editor__section">
        <h2 class="editor__section-title">Vista previa</h2>
        <div class="editor__preview" id="block-preview">
          <div id="preview-content"></div>
        </div>
      </div>

      <!-- Save error (inline, gated visibility) -->
      <div class="editor__save-error" id="editor-save-error" role="alert" hidden></div>

      <!-- Actions -->
      <div class="editor__actions">
        <button class="btn btn--secondary" id="editor-cancel">Cancelar</button>
        ${existingSong ? `<button class="btn btn--secondary" id="editor-delete" style="color: var(--color-error); border-color: var(--color-error); margin-right: auto; display: inline-flex; align-items: center; gap: 0.4em;">${icon('trash', { size: 16 })} Eliminar</button>` : ''}
        <button class="btn btn--primary" id="editor-save" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('save', { size: 16 })} Guardar canción</button>
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
    if (e.dataTransfer.files.length > 0) handleImageFile(e.dataTransfer.files[0], imagePreview);
  });
  coverInput.addEventListener('change', () => {
    if (coverInput.files.length > 0) handleImageFile(coverInput.files[0], imagePreview);
  });

  // ─── Links Editor ───
  const voiceLinksEl = container.querySelector('#editor-voice-links');
  let voiceLinkItems = [];

  function renderVoiceLinks() {
    voiceLinksEl.innerHTML = voiceLinkItems
      .map(
        (item, i) => `
        <div class="editor__row-3" style="align-items: flex-end; margin-bottom: var(--space-sm);" data-vlink="${i}">
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label">Voz</label>
            <select class="form-group__input" data-action="vlink-voice" data-idx="${i}">
              ${VOICE_TYPES.map((v) => `<option value="${v.id}" ${item.voiceType === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">URL (Drive)</label>
            <input class="form-group__input" type="url" placeholder="https://drive.google.com/..." data-action="vlink-url" data-idx="${i}" value="${escapeHtml(item.url || '')}" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label class="form-group__label">Etiqueta</label>
            <input class="form-group__input" type="text" placeholder="Partitura" data-action="vlink-label" data-idx="${i}" value="${escapeHtml(item.label || '')}" />
          </div>
          <button class="btn btn--secondary" style="color: var(--color-error); border-color: var(--color-error); padding: 0.5rem;" data-action="vlink-delete" data-idx="${i}" type="button" aria-label="Eliminar enlace">${icon('close', { size: 16 })}</button>
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
        '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Aún no hay voces. Añade al menos una para asignar voces y tono por rango.</p>';
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
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">Nombre</label>
            <input class="form-group__input" type="text" data-action="roster-name" data-idx="${i}" value="${escapeHtml(v.name || '')}" placeholder="Voz ${i + 1}" />
          </div>
          <div class="form-group" style="flex: 2;">
            <label class="form-group__label">Categoría</label>
            <select class="form-group__input" data-action="roster-category" data-idx="${i}">
              ${CANONICAL_VOICE_ORDER.map((c) => `<option value="${c}" ${v.category === c ? 'selected' : ''}>${getVoiceLabel(c)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
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

  // ─── Block Editor Core ───
  const editorRoot = container.querySelector('#block-editor');

  function renderBlocks() {
    editorRoot.innerHTML = blocks
      .map((block, bi) => renderSectionBlock(block, bi, blocks.length))
      .join('');
    updatePreview();
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
        updatePreview();
      }
    } else if (action === 'change-label') {
      const si = parseInt(e.target.dataset.section);
      if (blocks[si]) {
        blocks[si].label = e.target.value;
        updatePreview();
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
      if (found) openChordEditor(found.line);
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
      if (found) openTonoEditor(found.line);
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
    }
  });

  // ─── Tono editor por línea (v2, gated): silabación + voz→sílaba + notas ───
  //
  // Modal autocontenido. Muta line.syllables (Task 3) y line.voiceLines (Task 4)
  // directamente sobre el objeto de la línea en `blocks`. La selección de
  // sílabas reusa el modelo tap-anchor-extend del editor de voces, pero a nivel
  // de sílaba en vez de carácter.
  // ─── Editor de Voces y Tono por LÍNEA (v3, gated por voz_tono) ───
  // Flujo: 1) tap inicio→tap fin sobre las letras (rango de caracteres),
  // 2) elegir voz del roster, 3) escribir nota a mano (validada, opcional),
  // 4) "Agregar grupo". Lista de grupos con borrar. Muta line.groups.
  function openTonoEditor(line) {
    if (!Array.isArray(line.groups)) line.groups = [];

    const sel = { anchor: null, focus: null }; // índices de carácter
    let perVoice = {}; // voiceId → { included, note, invalid }
    let formError = '';

    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    document.body.appendChild(overlay);
    // El modal se crea UNA vez; render() solo actualiza su contenido (evita que
    // la animación de entrada se reproduzca en cada interacción).
    const modalEl = document.createElement('div');
    modalEl.className = 'import-modal tono-editor';
    overlay.appendChild(modalEl);

    function close() {
      overlay.remove();
      renderBlocks();
      updatePreview();
    }

    function currentRange() {
      if (sel.anchor === null) return null;
      if (sel.focus === null) return { start: sel.anchor, end: sel.anchor + 1 };
      return normalizeRange(sel.anchor, sel.focus);
    }

    function rosterVoice(id) {
      return voiceRoster.find((v) => v.id === id) || null;
    }

    // Siembra el estado por voz desde los grupos que coinciden con el rango actual.
    function seedPerVoice() {
      const range = currentRange();
      const map = {};
      for (const v of voiceRoster) {
        const g = range
          ? line.groups.find(
              (x) => x.start === range.start && x.end === range.end && x.voiceId === v.id,
            )
          : null;
        const note = g && g.note !== null && g.note !== undefined ? g.note : '';
        map[v.id] = { included: !!g, note, invalid: false };
      }
      return map;
    }

    function render() {
      const text = line.text || '';
      const range = currentRange();
      const strip = buildCharStripHTML(text, range);

      const voiceRows =
        voiceRoster.length === 0
          ? '<p class="tono-editor__hint">Añade voces en el roster (arriba) para asignar.</p>'
          : voiceRoster
              .map((v) => {
                const st = perVoice[v.id] || { included: false, note: '', invalid: false };
                const on = st.included;
                return `<div class="voice-note-row">
                  <button class="voice-pick${on ? ' voice-pick--active' : ''}" data-voice="${v.id}" type="button" aria-pressed="${on}">
                    <span class="voice-pick__dot" style="background: var(--color-voice-${v.category})"></span>
                    ${escapeHtml(v.name || getVoiceLabel(v.category))}
                  </button>
                  <input class="form-group__input voice-note-row__note${st.invalid ? ' form-group__input--invalid' : ''}" data-note-for="${v.id}" type="text" value="${escapeHtml(st.note)}" placeholder="Ej: B3 (vacío = sin nota)" aria-invalid="${st.invalid}" />
                </div>`;
              })
              .join('');

      const groupRows =
        line.groups.length === 0
          ? '<p class="tono-editor__hint">Aún no hay grupos en esta línea.</p>'
          : line.groups
              .map((g, i) => {
                const v = rosterVoice(g.voiceId);
                const cat = v?.category || 'soprano';
                const vname = v
                  ? escapeHtml(v.name || getVoiceLabel(v.category))
                  : '(voz eliminada)';
                const seg = escapeHtml(text.slice(g.start, g.end)) || '·';
                const note = g.note === null || g.note === undefined ? '—' : escapeHtml(g.note);
                return `<div class="group-row">
                  <span class="group-row__seg">${seg}</span>
                  <span class="group-row__voice"><span class="voice-pick__dot" style="background: var(--color-voice-${cat})"></span>${vname}</span>
                  <span class="group-row__note">${note}</span>
                  <button class="group-row__del" data-del-idx="${i}" type="button" aria-label="Eliminar grupo">${icon('trash', { size: 14 })}</button>
                </div>`;
              })
              .join('');

      modalEl.innerHTML = `
          <div class="import-modal__header">
            <h3 class="import-modal__title" style="display:inline-flex;align-items:center;gap:0.4em;">${icon('music', { size: 18 })} Voces y tono</h3>
            <button class="import-modal__close" data-tono="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>1 · Toca el inicio y el fin del rango</span></div>
            <div class="char-strip">${strip}</div>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>2 · Notas por voz (vacío = esa voz no canta el rango)</span></div>
            <div class="voice-note-grid">${voiceRows}</div>
            <button class="btn btn--primary" data-tono="apply" type="button" style="margin-top: var(--space-sm);"${range ? '' : ' disabled'}>${icon('plus', { size: 14 })} Agregar grupos del rango</button>
            ${formError ? `<p class="tono-editor__error" role="alert">${escapeHtml(formError)}</p>` : ''}
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>Grupos de la línea</span></div>
            <div class="group-list">${groupRows}</div>
          </div>

          <div class="import-modal__actions">
            <button class="btn btn--primary" data-tono="done" type="button">Listo</button>
          </div>`;
    }

    // Escribir una nota actualiza el estado SIN re-render (preserva el caret) y
    // auto-incluye la voz; el chip se actualiza directamente por DOM.
    overlay.addEventListener('input', (e) => {
      const id = e.target.dataset.noteFor;
      if (!id || !perVoice[id]) return;
      perVoice[id].note = e.target.value;
      perVoice[id].invalid = false;
      if (e.target.value.trim() !== '') perVoice[id].included = true;
      const chip = overlay.querySelector(`.voice-pick[data-voice="${id}"]`);
      if (chip) {
        chip.classList.toggle('voice-pick--active', perVoice[id].included);
        chip.setAttribute('aria-pressed', String(perVoice[id].included));
      }
      e.target.classList.remove('form-group__input--invalid');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const tono = e.target.closest('[data-tono]')?.dataset.tono;
      if (tono === 'close' || tono === 'done') return close();
      if (tono === 'apply') {
        const range = currentRange();
        if (!range) return;
        let bad = false;
        for (const v of voiceRoster) {
          const st = perVoice[v.id];
          const raw = st ? st.note.trim() : '';
          if (st && st.included && raw !== '' && !isValidNote(raw)) {
            st.invalid = true;
            bad = true;
          }
        }
        if (bad) {
          formError = 'Corrige las notas inválidas (notación científica, ej: B3).';
          render();
          return;
        }
        formError = '';
        const perVoiceArray = voiceRoster.map((v) => {
          const st = perVoice[v.id] || { included: false, note: '' };
          const raw = st.note.trim();
          return { voiceId: v.id, included: st.included, note: raw === '' ? null : raw };
        });
        line.groups = applyGroupsForRange(line.groups, range, perVoiceArray);
        sel.anchor = null;
        sel.focus = null;
        perVoice = seedPerVoice();
        render();
        return;
      }
      const voiceBtn = e.target.closest('[data-voice]');
      if (voiceBtn) {
        const id = voiceBtn.dataset.voice;
        if (perVoice[id]) {
          perVoice[id].included = !perVoice[id].included;
          render();
        }
        return;
      }
      const delBtn = e.target.closest('[data-del-idx]');
      if (delBtn) {
        const i = Number.parseInt(delBtn.dataset.delIdx, 10);
        if (!Number.isNaN(i)) {
          line.groups = deleteGroupAt(line.groups, i);
          perVoice = seedPerVoice();
          render();
        }
        return;
      }
      const charBtn = e.target.closest('.char-cell');
      if (charBtn) {
        const i = Number.parseInt(charBtn.dataset.char, 10);
        if (Number.isNaN(i)) return;
        if (sel.anchor === null || sel.focus !== null) {
          sel.anchor = i;
          sel.focus = null;
        } else {
          sel.focus = i;
        }
        perVoice = seedPerVoice();
        render();
      }
    });

    perVoice = seedPerVoice();
    render();
  }

  /** Popup de Acordes por rango (pos = inicio del rango). Muta line.chords=[{ch,pos}]. */
  function openChordEditor(line) {
    if (!Array.isArray(line.chords)) line.chords = [];
    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    document.body.appendChild(overlay);
    // Modal persistente: render() solo actualiza su contenido, así la animación
    // de entrada (modalIn) no se reproduce en cada interacción.
    const modalEl = document.createElement('div');
    modalEl.className = 'import-modal tono-editor';
    overlay.appendChild(modalEl);

    const sel = { anchor: null, focus: null };
    let chordDraft = '';

    const close = () => {
      overlay.remove();
      renderBlocks();
      updatePreview();
    };
    const currentRange = () => {
      if (sel.anchor === null) return null;
      if (sel.focus === null) return { start: sel.anchor, end: sel.anchor + 1 };
      return normalizeRange(sel.anchor, sel.focus);
    };
    const setChord = (pos, ch) => {
      const clean = (ch || '').trim();
      const existing = line.chords.find((c) => c.pos === pos);
      if (!clean) {
        line.chords = line.chords.filter((c) => c.pos !== pos);
      } else if (existing) {
        existing.ch = clean;
      } else {
        line.chords.push({ ch: clean, pos });
      }
      line.chords.sort((a, b) => a.pos - b.pos);
    };

    function render() {
      const text = line.text || '';
      const range = currentRange();
      const strip = buildCharStripHTML(text, range);
      const pos = range ? range.start : null;
      const existing = pos === null ? null : line.chords.find((c) => c.pos === pos);

      const chordRows =
        line.chords.length === 0
          ? '<p class="tono-editor__hint">Aún no hay acordes en esta línea.</p>'
          : line.chords
              .map((c) => {
                const at = escapeHtml(text.slice(c.pos, c.pos + 1)) || '⌑';
                return `<div class="group-row">
                  <span class="group-row__seg">${escapeHtml(c.ch)}</span>
                  <span class="group-row__voice">en "${at}" (pos ${c.pos})</span>
                  <button class="group-row__del" data-del-pos="${c.pos}" type="button" aria-label="Quitar acorde">${icon('trash', { size: 14 })}</button>
                </div>`;
              })
              .join('');

      const canAdd = pos !== null;
      modalEl.innerHTML = `
          <div class="import-modal__header">
            <h3 class="import-modal__title" style="display:inline-flex;align-items:center;gap:0.4em;">${icon('audio-lines', { size: 18 })} Acordes</h3>
            <button class="import-modal__close" data-chord="close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>1 · Toca dónde empieza el acorde</span></div>
            <div class="char-strip">${strip}</div>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>2 · Acorde</span></div>
            <div class="chord-editor__assign">
              <input class="form-group__input" data-chord="input" type="text" value="${escapeHtml(chordDraft || existing?.ch || '')}" placeholder="Ej: Am, F#m, G7" />
              <button class="btn btn--primary" data-chord="apply" type="button"${canAdd ? '' : ' disabled'}>${icon('plus', { size: 14 })} Guardar</button>
            </div>
          </div>

          <div class="tono-editor__step">
            <div class="tono-editor__step-head"><span>Acordes de la línea</span></div>
            <div class="group-list">${chordRows}</div>
          </div>

          <div class="import-modal__actions">
            <button class="btn btn--primary" data-chord="done" type="button">Listo</button>
          </div>`;
    }

    overlay.addEventListener('input', (e) => {
      if (e.target.dataset.chord === 'input') chordDraft = e.target.value;
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return close();
      const act = e.target.closest('[data-chord]')?.dataset.chord;
      if (act === 'close' || act === 'done') return close();
      if (act === 'apply') {
        const range = currentRange();
        if (!range) return;
        setChord(range.start, chordDraft);
        sel.anchor = null;
        sel.focus = null;
        chordDraft = '';
        render();
        return;
      }
      const delBtn = e.target.closest('[data-del-pos]');
      if (delBtn) {
        const p = Number.parseInt(delBtn.dataset.delPos, 10);
        if (!Number.isNaN(p)) {
          setChord(p, '');
          render();
        }
        return;
      }
      const charBtn = e.target.closest('.char-cell');
      if (charBtn) {
        const i = Number.parseInt(charBtn.dataset.char, 10);
        if (Number.isNaN(i)) return;
        if (sel.anchor === null || sel.focus !== null) {
          sel.anchor = i;
          sel.focus = null;
        } else {
          sel.focus = i;
        }
        chordDraft = '';
        render();
      }
    });

    render();
  }

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
    showImportModal();
  });

  function showImportModal() {
    const overlay = document.createElement('div');
    overlay.className = 'import-modal__overlay';
    overlay.innerHTML = `
      <div class="import-modal">
        <div class="import-modal__header">
          <h3 class="import-modal__title" style="display: inline-flex; align-items: center; gap: 0.4em;">${icon('download', { size: 18 })} Importar texto</h3>
          <button class="import-modal__close" id="import-close" aria-label="Cerrar">${icon('close', { size: 18 })}</button>
        </div>
        <p class="import-modal__hint">
          Pega las letras. Las secciones se detectan con <code>[Verso 1]</code>, <code>[Coro]</code>, etc.
          Las líneas vacías separan secciones automáticamente.
        </p>
        <textarea class="import-modal__textarea" id="import-textarea" placeholder="[Verso 1]\nPrimera línea de la canción\nSegunda línea\n\n[Coro]\nEstribillo aquí..."></textarea>
        <div class="import-modal__preview" id="import-preview">
          <p style="color: var(--color-text-secondary); font-size: 0.85rem;">La vista previa aparecerá aquí...</p>
        </div>
        <div class="import-modal__actions">
          <button class="btn btn--secondary" id="import-cancel-btn">Cancelar</button>
          <button class="btn btn--primary" id="import-confirm-btn">Importar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#import-textarea');
    const previewEl = overlay.querySelector('#import-preview');

    textarea.addEventListener('input', () => {
      const parsed = parseImportText(textarea.value);
      if (parsed.length === 0) {
        previewEl.innerHTML =
          '<p style="color: var(--color-text-secondary); font-size: 0.85rem;">La vista previa aparecerá aquí...</p>';
        return;
      }
      previewEl.innerHTML = parsed
        .map(
          (block) =>
            `<div style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-primary); margin-bottom: 0.25rem; text-transform: uppercase;">${escapeHtml(block.label)}</div>
          ${block.lines.map((l) => `<div style="font-size: 0.85rem; padding: 1px 0;">${escapeHtml(l.text)}</div>`).join('')}
        </div>`,
        )
        .join('');
    });

    overlay.querySelector('#import-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#import-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#import-confirm-btn').addEventListener('click', () => {
      const parsed = parseImportText(textarea.value);
      if (parsed.length > 0) {
        blocks.push(...parsed);
        renderBlocks();
      }
      overlay.remove();
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    textarea.focus();
  }

  // ─── Preview ───
  function updatePreview() {
    const previewEl = container.querySelector('#preview-content');
    const sections = blocksToSectionsV3(blocks);
    if (sections.length === 0 || sections.every((s) => s.lines.length === 0)) {
      previewEl.innerHTML =
        '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Agrega secciones y letras para ver la vista previa.</p>';
      return;
    }

    // Build a draft song object for renderSongView
    const title = container.querySelector('#song-title')?.value?.trim() || 'Sin título';
    const artist = container.querySelector('#song-artist')?.value?.trim() || 'Hakuna Group Music';
    const album = container.querySelector('#song-album')?.value?.trim() || '';
    const year = container.querySelector('#song-year')?.value || '';
    const genre = container.querySelector('#song-genre')?.value?.trim() || '';
    const malePercent = Number.parseInt(container.querySelector('#voice-range')?.value) || 50;
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    const draftSong = {
      isPreview: true,
      title,
      artist,
      album,
      year,
      genre,
      voiceType,
      voicePercent: { male: malePercent, female: 100 - malePercent },
      coverImage: '',
      sections,
    };

    if (v2Enabled && voiceRoster.length > 0) {
      draftSong.schemaVersion = 3;
      draftSong.voiceRoster = voiceRoster;
    }

    renderSongView(previewEl, draftSong);
  }

  // ─── Initial render ───
  renderBlocks();

  // ─── Cancel ───
  container
    .querySelector('#editor-cancel')
    .addEventListener('click', () => navigate(from ? '/song/' + from : '/admin'));

  // ─── Delete ───
  if (existingSong) {
    container
      .querySelector('#editor-delete')
      ?.addEventListener('click', () => handleDelete(existingSong));
  }

  // ─── Save ───
  container
    .querySelector('#editor-save')
    .addEventListener('click', () =>
      handleSave(container, existingSong, blocks, voiceLinkItems, { v2Enabled, voiceRoster, from }),
    );
}

/* ─── Image handling ─── */

let compressedCoverBlob = null;

function handleImageFile(file, previewEl) {
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
        compressedCoverBlob = blob;
        const previewUrl = URL.createObjectURL(blob);
        previewEl.innerHTML = `
          <img class="image-upload__preview" src="${previewUrl}" alt="Preview" />
          <p style="font-size: 0.75rem; color: var(--color-text-secondary); margin-top: 0.5rem;">
            WebP · ${width}×${height} · ${(blob.size / 1024).toFixed(1)} KB
          </p>
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
    let voiceType;
    if (malePercent >= 70) voiceType = 'male';
    else if (malePercent <= 30) voiceType = 'female';
    else voiceType = 'mixed';

    let coverImage = existingSong?.coverImage || `${albumSlug}.webp`;
    const token = getSession()?.access_token;

    // 1. Upload new image if present
    if (compressedCoverBlob) {
      const fd = new FormData();
      fd.append('cover', compressedCoverBlob, `${albumSlug}.webp`);
      const imgRes = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        coverImage = imgData.url;
      }
    }

    // 2. Save song data
    const cejilla = Number.parseInt(container.querySelector('#song-cejilla').value) || null;

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
      sections: blocksToSectionsV3(blocks),
    };

    // ─── v3: sólo cuando hay roster. Sin roster, el payload es de forma v1. ───
    if (roster.length > 0) {
      newSong.schemaVersion = 3;
      newSong.voiceRoster = roster;
      try {
        validateSongV3(newSong);
      } catch (e) {
        showSaveError(container, `No se pudo guardar (tono): ${e.message}`);
        return;
      }
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

    if (!res.ok) throw new Error('Error guardando la canción');

    const links = collectLinks(container, voiceLinkItems);
    if (links.platforms.length > 0 || links.voices.length > 0) {
      await fetch(`${API_URL}/songs/${songId}/links`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(links),
      });
    }

    // El SW cachea el detalle (StaleWhileRevalidate); sin esto el lector
    // mostraría la versión vieja en la primera visita tras editar.
    await invalidateSongDetailCache(songId);
    await refreshData();
    navigate(postSaveTarget({ from: v2.from || null, isNew: !existingSong }));
    showToast('Canción guardada correctamente');
  } catch (err) {
    console.error(err);
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('save', { size: 16 })} Guardar canción`;
  }
}

/* ─── Delete ─── */

async function handleDelete(song) {
  if (!confirm(`¿Estás seguro de que deseas eliminar la canción "${song.title}"?`)) return;
  const token = getSession()?.access_token;
  try {
    const res = await fetch(`${API_URL}/songs/${song.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Error al eliminar');
    await refreshData();
    navigate('/admin/edit');
    showToast('Canción eliminada');
  } catch (e) {
    console.error(e);
    showToast('Error: ' + e.message);
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

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
