/**
 * SongEditor.js — Song upload/edit form
 *
 * Full editor with lyrics textarea, section insertion, color picker,
 * image upload, and live preview. Downloads updated songs.json on save.
 */

import { getState, getSongById, fetchSongDetail, refreshData } from '../lib/store.js';
import { renderLogoutButton } from './AdminGate.js';
import { navigate } from '../router.js';
import { getToken } from '../lib/auth.js';

const API_URL = '/api';

const SECTION_TYPES = [
  { type: 'verse', label: 'Verso' },
  { type: 'chorus', label: 'Coro' },
  { type: 'bridge', label: 'Puente' },
  { type: 'prechorus', label: 'Pre-Coro' },
  { type: 'intro', label: 'Intro' },
  { type: 'outro', label: 'Outro' },
];

/**
 * Render the song editor
 * @param {HTMLElement} container
 * @param {string} [editId] - Song ID to edit (null for new song)
 */
export async function renderSongEditor(container, editId) {
  let existingSong = null;

  if (editId) {
    // Show loading state while fetching full song detail (with sections)
    container.innerHTML = `
      <div class="editor fade-in" style="display: flex; justify-content: center; align-items: center; min-height: 50vh;">
        <p style="color: var(--color-text-secondary); font-size: 1.1rem;">⏳ Cargando canción...</p>
      </div>
    `;
    existingSong = await fetchSongDetail(editId);
    if (!existingSong) {
      container.innerHTML = `
        <div class="editor fade-in" style="display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 50vh; gap: 1rem;">
          <p style="color: var(--color-text-secondary); font-size: 1.1rem;">❌ No se encontró la canción.</p>
          <button class="btn btn--secondary" id="editor-back-home">← Volver</button>
        </div>
      `;
      container.querySelector('#editor-back-home')?.addEventListener('click', () => navigate('/admin/edit'));
      return;
    }
  }

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
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
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
        <div class="form-group">
          <label class="form-group__label" for="song-genre">Género</label>
          <input class="form-group__input" id="song-genre" type="text" placeholder="Pop/Worship" value="${escapeHtml(existingSong?.genre || '')}" />
        </div>
      </div>

      <!-- Voice -->
      <div class="editor__section">
        <h2 class="editor__section-title">Tipo de voz</h2>
        <div class="form-group">
          <label class="form-group__label">Porcentaje: <span id="voice-value">♂ ${existingSong?.voicePercent?.male || 50}% / ♀ ${100 - (existingSong?.voicePercent?.male || 50)}%</span></label>
          <div class="voice-slider">
            <span style="font-size: 0.8rem;">♂</span>
            <input type="range" id="voice-range" min="0" max="100" value="${existingSong?.voicePercent?.male || 50}" />
            <span style="font-size: 0.8rem;">♀</span>
          </div>
        </div>
      </div>

      <!-- Cover Image -->
      <div class="editor__section">
        <h2 class="editor__section-title">Portada del álbum</h2>
        <div class="image-upload" id="image-upload-area">
          <div id="image-preview"></div>
          <p class="image-upload__text">📷 Haz clic o arrastra una imagen aquí</p>
          <input type="file" id="cover-input" accept="image/*" style="display: none;" />
        </div>
      </div>

      <!-- Lyrics Editor -->
      <div class="editor__section">
        <h2 class="editor__section-title">Letras</h2>
        <p style="font-size: 0.8rem; color: var(--color-text-secondary); margin-bottom: 0.75rem;">
          Usa los botones para insertar secciones. Para colorear una línea, usa <code>{#hex}</code> al inicio.
          Ej: <code>{#4FC3F7}Línea en cyan</code>
        </p>
        <div class="editor__section-btns" id="section-btns">
          ${SECTION_TYPES.map(
            (s) =>
              `<button class="editor__section-btn" data-section-type="${s.type}" data-section-label="${s.label}">[${s.label}]</button>`,
          ).join('')}
          <span style="border-left: 1px solid var(--color-border); margin: 0 0.25rem;"></span>
          <button class="editor__section-btn" data-color="#ff0002" style="color: #ff0002;">🎨 Rojo</button>
          <button class="editor__section-btn" data-color="#4FC3F7" style="color: #4FC3F7;">🎨 Cyan</button>
          <button class="editor__section-btn" data-color="#FF7043" style="color: #FF7043;">🎨 Coral</button>
          <button class="editor__section-btn" data-color="#AB47BC" style="color: #AB47BC;">🎨 Púrpura</button>
          <button class="editor__section-btn" data-color="#FFB74D" style="color: #FFB74D;">🎨 Dorado</button>
        </div>
        <textarea class="form-group__textarea" id="lyrics-textarea" placeholder="[Verso 1]&#10;Primera línea de la canción&#10;{#4FC3F7}Línea en color cyan&#10;&#10;[Coro]&#10;{#FF7043}Estribillo colorido&#10;Línea normal">${existingSong ? songToLyricsText(existingSong) : ''}</textarea>

        <!-- Preview -->
        <div class="editor__preview" id="lyrics-preview">
          <div class="editor__preview-title">Vista previa</div>
          <div id="preview-content"></div>
        </div>
      </div>

      <!-- Actions -->
      <div class="editor__actions">
        <button class="btn btn--secondary" id="editor-cancel">Cancelar</button>
        ${existingSong ? `<button class="btn btn--secondary" id="editor-delete" style="color: var(--color-error); border-color: var(--color-error); margin-right: auto;">🗑️ Eliminar</button>` : ''}
        <button class="btn btn--primary" id="editor-save">💾 Guardar canción</button>
      </div>
    </div>
  `;

  // Logout button
  renderLogoutButton(container.querySelector('.editor'));

  // Voice range
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
    if (e.dataTransfer.files.length > 0) {
      handleImageFile(e.dataTransfer.files[0], imagePreview);
    }
  });
  coverInput.addEventListener('change', () => {
    if (coverInput.files.length > 0) {
      handleImageFile(coverInput.files[0], imagePreview);
    }
  });

  // Section + color buttons
  const textarea = container.querySelector('#lyrics-textarea');
  container.querySelectorAll('.editor__section-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.sectionLabel) {
        // Section insertion
        const label = btn.dataset.sectionLabel;
        const insertion = `\n[${label}]\n`;
        const pos = textarea.selectionStart;
        textarea.value = textarea.value.slice(0, pos) + insertion + textarea.value.slice(pos);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = pos + insertion.length;
      } else if (btn.dataset.color) {
        // Color insertion — apply to current line
        const color = btn.dataset.color;
        const text = textarea.value;
        const start = textarea.selectionStart;
        // Find line start
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = text.indexOf('\n', start);
        const end = lineEnd === -1 ? text.length : lineEnd;
        const line = text.slice(lineStart, end);
        // Remove existing color prefix if any
        const cleanLine = line.replace(/^\{#[A-Fa-f0-9]{3,8}\}/, '');
        const coloredLine = `{${color}}${cleanLine}`;
        textarea.value = text.slice(0, lineStart) + coloredLine + text.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = lineStart + coloredLine.length;
      }
      updatePreview(textarea.value, container.querySelector('#preview-content'));
    });
  });

  // Live preview
  textarea.addEventListener('input', () => {
    updatePreview(textarea.value, container.querySelector('#preview-content'));
  });

  // Initial preview
  updatePreview(textarea.value, container.querySelector('#preview-content'));

  // Cancel
  container.querySelector('#editor-cancel').addEventListener('click', () => {
    navigate('/admin');
  });

  // Delete
  if (existingSong) {
    container.querySelector('#editor-delete').addEventListener('click', () => {
      handleDelete(existingSong);
    });
  }

  // Save
  container.querySelector('#editor-save').addEventListener('click', () => {
    handleSave(container, existingSong);
  });
}

/**
 * Convert song object to editable text format
 */
function songToLyricsText(song) {
  if (!song.sections || !Array.isArray(song.sections)) return '';
  return song.sections
    .map((section) => {
      const lines = section.lines
        .map((l) => (l.color ? `{${l.color}}${l.text}` : l.text))
        .join('\n');
      return `[${section.label}]\n${lines}`;
    })
    .join('\n\n');
}

/**
 * Parse lyrics text into sections array
 */
function parseLyricsText(text) {
  const sections = [];
  const lines = text.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }

      const label = sectionMatch[1];
      const type = guessType(label);
      currentSection = { type, label, lines: [] };
    } else if (currentSection) {
      // Parse optional color prefix: {#RRGGBB}text
      const colorMatch = line.match(/^\{(#[A-Fa-f0-9]{3,8})\}(.*)$/);
      if (colorMatch) {
        currentSection.lines.push({ text: colorMatch[2], color: colorMatch[1] });
      } else {
        currentSection.lines.push({ text: line, color: null });
      }
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  // Clean up trailing empty lines from each section so they don't multiply on repeated saves
  sections.forEach(section => {
    while (section.lines.length > 0 && section.lines[section.lines.length - 1].text.trim() === '') {
      section.lines.pop();
    }
  });

  return sections;
}

/**
 * Guess section type from label
 */
function guessType(label) {
  const lower = label.toLowerCase();
  if (lower.includes('verso') || lower.includes('verse')) {
    return 'verse';
  }
  if (lower.includes('coro') || lower.includes('chorus')) {
    return 'chorus';
  }
  if (lower.includes('puente') || lower.includes('bridge')) {
    return 'bridge';
  }
  if (lower.includes('pre')) {
    return 'prechorus';
  }
  if (lower.includes('intro')) {
    return 'intro';
  }
  if (lower.includes('outro')) {
    return 'outro';
  }
  return 'verse';
}

/**
 * Update the live preview
 */
function updatePreview(text, previewEl) {
  const sections = parseLyricsText(text);
  if (sections.length === 0) {
    previewEl.innerHTML = '<p style="color: var(--color-text-secondary); font-size: 0.875rem;">Escribe letras arriba para ver la vista previa.</p>';
    return;
  }

  previewEl.innerHTML = sections
    .map(
      (section) => `
    <div class="lyrics__section lyrics__section--${section.type}" style="margin-bottom: 1.25rem;">
      <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
      ${section.lines.map((l) => `<p class="lyrics__line" style="font-size: 1rem; line-height: 1.6;${l.color ? ` color: ${l.color};` : ''}">${l.text.trim() === '' ? '&nbsp;' : escapeHtml(l.text)}</p>`).join('')}
    </div>
  `,
    )
    .join('');
}

/**
 * Handle image file selection/drop
 */
/** @type {Blob|null} */
let compressedCoverBlob = null;

function handleImageFile(file, previewEl) {
  if (!file.type.startsWith('image/')) {
    return;
  }

  const img = new Image();
  const url = URL.createObjectURL(file);

  img.onload = () => {
    URL.revokeObjectURL(url);

    // Resize to max 800px and compress to WebP
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

/**
 * Handle save — upload image, then save song to backend
 */
async function handleSave(container, existingSong) {
  const btn = container.querySelector('#editor-save');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const title = container.querySelector('#song-title').value.trim();
    if (!title) {
      container.querySelector('#song-title').focus();
      throw new Error('El título es requerido');
    }

    const artist = container.querySelector('#song-artist').value.trim() || 'Hakuna Group Music';
    const album = container.querySelector('#song-album').value.trim() || 'Sin álbum';
    const albumOrder = parseInt(container.querySelector('#song-order').value) || 0;
    const year = parseInt(container.querySelector('#song-year').value) || new Date().getFullYear();
    const genre = container.querySelector('#song-genre').value.trim() || '';
    const malePercent = parseInt(container.querySelector('#voice-range').value);
    const lyricsText = container.querySelector('#lyrics-textarea').value;

    const songId = existingSong?.id || generateSlug(title, album);
    const albumSlug = generateSlug(album);
    const voiceType = malePercent >= 70 ? 'male' : malePercent <= 30 ? 'female' : 'mixed';

    let coverImage = existingSong?.coverImage || `${albumSlug}.webp`;

    const token = getToken();

    // 1. Upload new image if present
    if (compressedCoverBlob) {
      const fd = new FormData();
      fd.append('cover', compressedCoverBlob, `${albumSlug}.webp`);
      const imgRes = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        coverImage = imgData.url;
      }
    }

    // 2. Save song data
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
      sections: parseLyricsText(lyricsText)
    };

    const method = existingSong ? 'PUT' : 'POST';
    const url = existingSong ? `${API_URL}/songs/${existingSong.id}` : `${API_URL}/songs`;

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(newSong)
    });

    if (!res.ok) throw new Error('Error guardando la canción');

    // 3. Refresh data and navigate
    await refreshData();
    navigate('/');
    showToast('✅ Canción guardada correctamente');
    
  } catch (err) {
    console.error(err);
    showToast('❌ Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar canción';
  }
}

/**
 * Handle delete
 */
async function handleDelete(song) {
  if (!confirm(`¿Estás seguro de que deseas eliminar la canción "${song.title}"?`)) return;
  const token = getToken();
  try {
    const res = await fetch(`${API_URL}/songs/${song.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Error al eliminar');
    await refreshData();
    navigate('/admin/edit');
    showToast('🗑️ Canción eliminada');
  } catch(e) {
    console.error(e);
    showToast('❌ Error: ' + e.message);
  }
}

/**
 * Generate a URL-friendly slug
 */
function generateSlug(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Show toast
 */
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

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
