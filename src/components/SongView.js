/**
 * SongView.js — Lyrics reader component (Upgraded)
 *
 * Displays song lyrics with section labels, voice-colored highlights,
 * word-level voice spans, font size controls, breadcrumb navigation,
 * album navigation bar, voice part filter with premium chips,
 * chord display with transposition, and album navigation.
 */

import { getSongById, filterByAlbum, fetchSongDetail, getAdjacentSongs } from '../lib/store.js';
import { navigate } from '../router.js';
import {
  upgradeLegacySong,
  rosterByCategory,
  getVoiceLabel,
  tonoGeneralForVoice,
  firstNoteForVoice,
} from '../lib/voiceSystem.js';
import {
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildTonoLineHTML,
  buildMixedLineHTML,
} from '../lib/lyricsRender.js';
import { isAdmin, isFeatureEnabled } from '../lib/authStore.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import { openVoiceSheet } from './VoiceSheet.js';
import { presetToSpeed, stepToward, shouldShowFab } from '../lib/autoscroll.js';
import { escapeHtml } from '../lib/escape.js';
import { enterStage } from './StageMode.js';

const FONT_SIZE_KEY = 'hkn-lyrics-font-size';
const FONT_STEP = 0.125; // rem
const FONT_MIN = 0.875;
const FONT_MAX = 2.5;

// Autoscroll config
const AUTOSCROLL_SPEED_KEY = 'hkn-autoscroll-speed';
const AUTOSCROLL_SPEED_MIN = 0.01;
const AUTOSCROLL_SPEED_MAX = 2.0;
const AUTOSCROLL_SPEED_STEP = 0.05;
const AUTOSCROLL_SPEED_DEFAULT = 0.5;
const AUTOSCROLL_BASE_PX_PER_FRAME = 1.8;
const AUTOSCROLL_COLLAPSE_DELAY = 1500;
// Fracción del paso manual aplicada por frame al converger hacia el preset de
// sección (más bajo = transición más suave). Ver Plan F.
const AUTOSCROLL_CONVERGENCE_RATE = 0.5;

function getFontSize() {
  try {
    const stored = localStorage.getItem(FONT_SIZE_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= FONT_MIN && val <= FONT_MAX) return val;
    }
  } catch (_e) {
    /* ignore */
  }
  return 1.25;
}

function saveFontSize(size) {
  try {
    localStorage.setItem(FONT_SIZE_KEY, size.toString());
  } catch (_e) {
    /* ignore */
  }
}

function songHasChords(song) {
  if (!song.sections) return false;
  return song.sections.some((s) => s.lines?.some((l) => l.chords && l.chords.length > 0));
}

/**
 * Detect if a line is a timing/performance guide (e.g. "4 TIEMPOS", "4 VUELTAS 🎸", "🎻")
 * These are visual cues for performers, not actual lyrics
 */
function isTimingGuide(text) {
  if (!text || text.trim() === '') return false;
  const t = text.trim();
  // Pattern: number + time unit (with optional emojis)
  if (/^\d+\s*(TIEMPOS?|VUELTAS?|COMPAS(ES)?|BEATS?)/iu.test(t)) return true;
  // Pattern: solo instrument emoji or negated instrument
  if (/^[(\s]*[🎸🎻🥁🎹🎺🎷🪘🎶🎵⚡🔥❌🚫\s)]+$/u.test(t)) return true;
  // Pattern: word "HOMBRES" or "MUJERES" as voice guide
  if (/^(HOMBRES|MUJERES|TODOS|TODAS)$/iu.test(t)) return true;
  return false;
}

/**
 * Parse a timing guide line into a structured label
 * Returns { count, unit, instruments } or null
 */
function parseTimingGuide(text) {
  const trimmed = text.trim();
  // Match patterns like "4 TIEMPOS", "3 VUELTAS 🎸"
  const match = trimmed.match(/^(\d+)\s*(TIEMPOS?|VUELTAS?|COMPAS(?:ES)?|BEATS?)\s*(.*)$/i);
  if (match) {
    return { count: match[1], unit: match[2].toUpperCase(), extra: match[3].trim() };
  }
  // Pure instrument/emoji markers: "🎻", "(🚫🎻)"
  return { count: null, unit: null, extra: trimmed };
}

function getVoiceBadgeClass(voiceType) {
  if (voiceType === 'male') return 'voice-badge--male';
  if (voiceType === 'female') return 'voice-badge--female';
  return 'voice-badge--mixed';
}

function getVoiceTypeLabel(voiceType) {
  if (voiceType === 'male') return 'Masculina';
  if (voiceType === 'female') return 'Femenina';
  return 'Mixta';
}

/**
 * Render the song view
 * @param {HTMLElement} container
 * @param {string|object} songIdOrData - Either a song ID string, or a full song object (with isPreview flag)
 */
export async function renderSongView(container, songIdOrData) {
  const isPreview = typeof songIdOrData === 'object' && songIdOrData !== null;
  let song = null;
  let songId = null;

  if (isPreview) {
    song = songIdOrData;
  } else {
    songId = songIdOrData;
    song = getSongById(songId);

    // If no sections cached, fetch full detail from API
    if (!song?.sections?.length) {
      container.innerHTML = `
        <div class="empty-state fade-in">
          <div class="empty-state__icon">${icon('music', { size: 48, className: 'loading-pulse' })}</div>
          <h2 class="empty-state__title">Cargando...</h2>
        </div>
      `;
      const detail = await fetchSongDetail(songId);
      if (detail) song = detail;
    }
  }

  // Lectura dual: normaliza v1 → v2 en memoria (inerte para v2 y para el
  // render de Letra/Acordes, que sigue leyendo text/chords/voiceRanges).
  if (song) song = upgradeLegacySong(song);

  if (!song) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">Canción no encontrada</h2>
        <p class="empty-state__text">La canción que buscas no existe o fue eliminada.</p>
        <button class="btn btn--primary" style="margin-top: 1rem;" id="go-home-btn">Volver al inicio</button>
      </div>
    `;
    container.querySelector('#go-home-btn')?.addEventListener('click', () => navigate('/'));
    return;
  }

  let fontSize = getFontSize();
  // viewMode: 'lyrics' | 'chords' | 'tono'. showChords se deriva para no tocar
  // la rama de acordes existente.
  let viewMode = 'lyrics';
  let showChords = false;
  let transposeSemitones = 0;
  let useFlats = false;
  // Modo Tono: solo con el flag voz_tono. activeRosterId/activeCategory dirigen
  // el disclosure categoría→persona del modo notas.
  const tonoEnabled = isFeatureEnabled('voz_tono');
  let activeCategory = null;
  let activeRosterId = null;

  const hasChords = songHasChords(song);
  // Vista combinada (Acordes+Voz, Wave 4): voz activa del modo Acordes,
  // independiente de la de Tono. Solo con flag voz_tono + roster + acordes.
  let chordsCategory = null;
  let chordsVoiceId = null;
  let voicePanelOpen = false;
  const mixAvailable = tonoEnabled && (song.voiceRoster || []).length > 0 && hasChords;

  const voiceBadgeClass = getVoiceBadgeClass(song.voiceType);
  const voiceLabel = getVoiceTypeLabel(song.voiceType);

  const coverUrl = song.coverImage
    ? song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
      ? song.coverImage
      : `/covers/${song.coverImage}`
    : '';

  // Leer ?lista= del hash (p. ej. #/song/abc?lista=xyz)
  const _hashQuery = new URLSearchParams((globalThis.location?.hash ?? '').split('?')[1] || '');
  const listId = isPreview ? null : _hashQuery.get('lista') || null;

  let adjacent;
  let listName = null;
  if (isPreview) {
    adjacent = { prev: null, next: null, currentIndex: 0, total: 0 };
  } else if (listId) {
    // Carga lists.js dinámicamente para no añadir supabase al bundle de tests
    const listsLib = await import('../lib/lists.js');
    // Intenta usar el contexto en memoria; si no existe (recarga), lo rehidrata
    let adj = listsLib.getAdjacentInList(listId, 'song', songId);
    if (!adj) {
      try {
        const listData = await listsLib.getList(listId);
        const orderedItems = (listData.items ?? listData.songs ?? []).map((it) => {
          if (typeof it === 'string') return { item_type: 'song', item_id: it };
          if (it.item_type) return { item_type: it.item_type, item_id: it.item_id };
          return { item_type: 'song', item_id: it.song_id ?? it.id ?? it };
        });
        listsLib.setActiveContext({ listId, name: listData.name, orderedItems });
        listName = listData.name;
        adj = listsLib.getAdjacentInList(listId, 'song', songId);
      } catch (_e) {
        // Si falla la carga de lista, caer al comportamiento normal
      }
    } else {
      listName = listsLib.getActiveContext()?.name ?? null;
    }
    adjacent = adj ?? getAdjacentSongs(songId);
  } else {
    adjacent = getAdjacentSongs(songId);
  }
  const hasNav = !isPreview && (adjacent.prev || adjacent.next);
  // El modo Tono está disponible si el flag está activo y la canción tiene
  // roster de voces. La fila toggle aparece si hay acordes o si hay Tono.
  const tonoAvailable = tonoEnabled && (song.voiceRoster || []).length > 0;
  const showToggle = hasChords || tonoAvailable;

  container.innerHTML = `
    <div class="song-view fade-in">
      ${
        !isPreview
          ? `
      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="breadcrumb-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/" data-album="${song.albumSlug}" id="breadcrumb-album">${escapeHtml(song.album || '')}</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(song.title)}</span>
      </nav>
      `
          : ''
      }

      <!-- Song Header -->
      <div class="song-view__header">
        ${
          coverUrl
            ? `
        <img
          class="song-view__cover"
          src="${coverUrl}"
          alt="Portada de ${escapeHtml(song.album || '')}"
          width="80"
          height="80"
          decoding="async"
          onerror="this.src='${COVER_PLACEHOLDER}'"
        />
        `
            : ''
        }
        <div class="song-view__meta">
          <h1 class="song-view__title${!isPreview ? ' song-view__title--linked' : ''}" id="song-title-link">${escapeHtml(song.title || 'Sin título')}${!isPreview ? '<svg class="song-view__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' : ''}</h1>
          <p class="song-view__album">${escapeHtml(song.artist || '')} — ${escapeHtml(song.album || '')}</p>
          <p class="song-view__year">${escapeHtml(String(song.year || ''))} · ${escapeHtml(song.genre || '')}</p>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span>
            <div class="voice-bar" style="width: 80px;">
              <div class="voice-bar__male" style="width: ${song.voicePercent?.male ?? 50}%"></div>
              <div class="voice-bar__female" style="width: ${100 - (song.voicePercent?.male ?? 50)}%"></div>
            </div>
          </div>
        </div>
      </div>

      ${
        !isPreview
          ? `
      <!-- Controls toolbar — grouped by function -->
      <div class="song-toolbar">
        <!-- Zone: Reading -->
        <div class="song-toolbar__group">
          <div class="font-controls" style="margin-bottom: 0;">
            <button class="font-controls__btn" id="font-decrease" aria-label="Reducir tamaño de letra">A−</button>
            <span class="font-controls__label" id="font-size-label">${fontSize.toFixed(2)}</span>
            <button class="font-controls__btn" id="font-increase" aria-label="Aumentar tamaño de letra">A+</button>
            <button class="font-controls__btn font-controls__stage" id="enter-stage-btn" aria-label="Modo escenario">${icon('maximize', { size: 18 })}</button>
          </div>
          ${
            showToggle
              ? `
          <div class="chord-toggle" id="chord-toggle" style="margin-bottom: 0;">
            <button class="chord-toggle__btn chord-toggle__btn--active" data-mode="lyrics">Letra</button>
            ${hasChords ? `<button class="chord-toggle__btn" data-mode="chords">Acordes</button>` : ''}
            ${tonoAvailable ? `<button class="chord-toggle__btn" data-mode="tono">Tono</button>` : ''}
          </div>
          `
              : ''
          }
          <button class="song-toolbar__voices" id="open-voice-sheet" aria-label="Control de voces">${icon('sliders', { size: 18 })}</button>
        </div>

        ${
          isAdmin()
            ? `
        <!-- Zone: Actions -->
        <div class="song-toolbar__group song-toolbar__group--actions">
          <a href="#/admin/edit/${song.id}?from=${song.id}" class="btn btn--secondary song-toolbar__btn">${icon('pencil', { size: 16 })} Editar</a>
        </div>
        `
            : ''
        }
      </div>

      ${
        hasChords || (song.cejilla && song.cejilla > 0)
          ? `
      <!-- Wave 4: cajas temáticas del modo Acordes — Guitarra y Voz -->
      <div class="chords-extras" id="chords-extras" style="display: none;">
        <div class="tool-box">
          <div class="tool-box__title">${icon('audio-lines', { size: 13 })} Guitarra</div>
          <div class="tool-box__row">
            ${
              song.cejilla && song.cejilla > 0
                ? `<div class="cejilla-badge" title="Colocar cejilla en el traste ${song.cejilla}">
                     <span class="cejilla-badge__icon">${icon('audio-lines', { size: 15 })}</span>
                     <span class="cejilla-badge__text">Cejilla: ${song.cejilla}</span>
                   </div>`
                : ''
            }
            ${
              hasChords
                ? `<div class="transpose-controls" id="transpose-controls">
                     <button class="transpose-btn" id="transpose-down">−½</button>
                     <span class="transpose-value" id="transpose-value">0</span>
                     <button class="transpose-btn" id="transpose-up">+½</button>
                     <span class="filter-separator"></span>
                     <button class="transpose-notation-toggle" id="notation-toggle">♯ / ♭</button>
                   </div>`
                : ''
            }
          </div>
        </div>
        ${mixAvailable ? renderVoicePanel(song) : ''}
      </div>
      `
          : ''
      }

      ${tonoAvailable ? renderTonoFilters(song) : ''}
      `
          : `
      ${
        showToggle
          ? `
      <!-- Chord Toggle (Preview mode) -->
      <div style="margin-bottom: var(--space-md);">
        <div class="chord-toggle" id="chord-toggle" style="margin-bottom: 0;">
          <button class="chord-toggle__btn chord-toggle__btn--active" data-mode="lyrics">Letra</button>
          ${hasChords ? `<button class="chord-toggle__btn" data-mode="chords">Acordes</button>` : ''}
          ${tonoAvailable ? `<button class="chord-toggle__btn" data-mode="tono">Tono</button>` : ''}
        </div>
      </div>
      `
          : ''
      }
      ${
        mixAvailable
          ? `<div class="chords-extras" id="chords-extras" style="display: none;">${renderVoicePanel(song)}</div>`
          : ''
      }
      ${tonoAvailable ? renderTonoFilters(song) : ''}
      `
      }

      <!-- Lyrics -->
      <div class="lyrics" id="lyrics-content">
        ${renderSections(song.sections || [], { viewMode, transposeSemitones, useFlats, activeVoiceId: activeRosterId, activeCategory, chordsVoiceId, chordsCategory })}
      </div>

      ${
        hasNav
          ? `
      <!-- Album Navigation -->
      <nav class="song-nav" id="song-nav" aria-label="Navegación del álbum">
        <button class="song-nav__btn song-nav__btn--prev" id="nav-prev" aria-label="Canción anterior">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <span class="song-nav__info">${listName ? `${escapeHtml(listName)} · ` : ''}${adjacent.currentIndex + 1} / ${adjacent.total}</span>
        <button class="song-nav__btn song-nav__btn--next" id="nav-next" aria-label="Canción siguiente">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 6 15 12 9 18"></polyline>
          </svg>
        </button>
      </nav>
      `
          : ''
      }
    </div>
  `;

  // Helper to re-render lyrics
  function reRenderLyrics() {
    const lyricsEl = container.querySelector('#lyrics-content');
    if (lyricsEl) {
      lyricsEl.innerHTML = renderSections(song.sections || [], {
        viewMode,
        transposeSemitones,
        useFlats,
        activeVoiceId: activeRosterId,
        activeCategory,
        chordsVoiceId,
        chordsCategory,
      });
      if (!isPreview) applyFontSize(fontSize);
    }
  }

  // Show controls relevant to the current mode: cejilla + transposition belong
  // to chords mode; tono filters to tono mode.
  function applyModeVisibility() {
    const isTono = viewMode === 'tono';
    const chordsExtrasEl = container.querySelector('#chords-extras');
    if (chordsExtrasEl) chordsExtrasEl.style.display = showChords ? 'flex' : 'none';
    const tonoFiltersEl = container.querySelector('#tono-filters');
    if (tonoFiltersEl) tonoFiltersEl.style.display = isTono ? '' : 'none';
    // Re-asegura el estado del panel Voz al cambiar de modo (defensivo).
    syncVoicePanel();
  }

  // ── Tono mode: disclosure categoría → persona ──
  function updateActiveVoiceHeading() {
    const headingEl = container.querySelector('#tono-active-voice');
    if (!headingEl) return;
    if (!activeRosterId) {
      headingEl.textContent = activeCategory ? 'Elegí una voz' : 'Elegí una categoría';
      updateTuneAction();
      return;
    }
    const voice = (song.voiceRoster || []).find((v) => v.id === activeRosterId);
    headingEl.textContent = voice ? `Voz activa: ${voice.name}` : '';
    updateTuneAction();
  }

  // Dos botones: Afinar · tono general (referenceKey o 1ª nota) y Afinar · 1ª nota.
  // Sólo con activeRosterId y el flag afinador_shortcut; si no hay notas, no aparece.
  // En preview no hay song.id (draft del editor) → sin botones (URL rota si no).
  function updateTuneAction() {
    const slot = container.querySelector('#tono-tune-action');
    if (!slot) return;
    if (isPreview || !activeRosterId || !isFeatureEnabled('afinador_shortcut')) {
      slot.innerHTML = '';
      return;
    }
    const general = tonoGeneralForVoice(song, activeRosterId);
    const first = firstNoteForVoice(song, activeRosterId);
    const btns = [];
    if (general) {
      btns.push(
        `<button class="btn btn--sm" data-ref="${escapeHtml(general)}">${icon('mic', { size: 14 })} Afinar · ${escapeHtml(general)}</button>`,
      );
    }
    if (first && first !== general) {
      btns.push(
        `<button class="btn btn--sm" data-ref="${escapeHtml(first)}">${icon('mic', { size: 14 })} 1ª nota · ${escapeHtml(first)}</button>`,
      );
    }
    slot.innerHTML = btns.join('');
    slot.querySelectorAll('[data-ref]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ref = btn.dataset.ref;
        navigate(
          `/afinador?mode=song&songId=${encodeURIComponent(song.id)}` +
            `&ref=${encodeURIComponent(ref)}&from=${encodeURIComponent(song.id)}`,
        );
      });
    });
  }

  function renderPersonRow() {
    const rowEl = container.querySelector('#tono-person-row');
    if (!rowEl) return;
    if (!activeCategory) {
      rowEl.innerHTML = '';
      return;
    }
    const people = rosterByCategory(song, activeCategory);
    // Una sola persona en la categoría: el chip de categoría ya la representa,
    // así que la fila de persona sería un duplicado. selectCategory ya la
    // autoselecciona; no renderizamos nada aquí.
    if (people.length <= 1) {
      rowEl.innerHTML = '';
      return;
    }
    rowEl.innerHTML = people
      .map((p) => {
        const note = tonoGeneralForVoice(song, p.id);
        const noteHtml = note ? `<span class="tono-chip__note">${escapeHtml(note)}</span>` : '';
        return `
        <button class="tono-chip tono-chip--person${p.id === activeRosterId ? ' tono-chip--active' : ''}" data-roster-id="${p.id}" aria-pressed="${p.id === activeRosterId}">
          <span class="voice-filter__label-text">${escapeHtml(p.name)}</span>
          ${noteHtml}
        </button>`;
      })
      .join('');
    rowEl.querySelectorAll('[data-roster-id]').forEach((btn) => {
      btn.addEventListener('click', () => selectPerson(btn.dataset.rosterId));
    });
  }

  function selectPerson(rosterId) {
    activeRosterId = rosterId;
    container.querySelectorAll('#tono-person-row .tono-chip').forEach((c) => {
      const isActive = c.dataset.rosterId === rosterId;
      c.classList.toggle('tono-chip--active', isActive);
      c.setAttribute('aria-pressed', String(isActive));
    });
    updateActiveVoiceHeading();
    reRenderLyrics();
  }

  function selectCategory(category) {
    activeCategory = category;
    activeRosterId = null;
    container.querySelectorAll('#tono-category-row .tono-chip').forEach((c) => {
      const isActive = c.dataset.category === category;
      c.classList.toggle('tono-chip--active', isActive);
      c.setAttribute('aria-pressed', String(isActive));
    });
    renderPersonRow();
    // Autoselección si la categoría tiene una sola persona.
    const people = rosterByCategory(song, category);
    if (people.length === 1) {
      selectPerson(people[0].id);
    } else {
      updateActiveVoiceHeading();
      reRenderLyrics();
    }
  }

  // Al entrar a Tono sin selección previa, preseleccionar la primera categoría
  // (y su persona si es única) para que el modo muestre algo de inmediato.
  function ensureTonoSelection() {
    if (activeCategory) {
      updateActiveVoiceHeading();
      return;
    }
    const categories = rosterCategories(song);
    if (categories.length > 0) selectCategory(categories[0]);
  }

  if (tonoAvailable) {
    container.querySelectorAll('#tono-category-row [data-category]').forEach((btn) => {
      btn.addEventListener('click', () => selectCategory(btn.dataset.category));
    });
    updateActiveVoiceHeading();
  }

  if (!isPreview) applyFontSize(fontSize);
  applyModeVisibility();

  // Mode toggle (Letra / Acordes / Tono) — works in both normal and preview mode
  if (showToggle) {
    container.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.mode;
        showChords = viewMode === 'chords';
        container
          .querySelectorAll('.chord-toggle__btn')
          .forEach((c) => c.classList.toggle('chord-toggle__btn--active', c === btn));
        applyModeVisibility();
        if (viewMode === 'tono') ensureTonoSelection();
        reRenderLyrics();
      });
    });
  }

  // ── Vista combinada: panel Voz del modo Acordes (Wave 4) ──
  function syncVoicePanel() {
    const panel = container.querySelector('#voice-panel');
    if (!panel) return;
    const body = panel.querySelector('#voice-panel-body');
    const toggle = panel.querySelector('#voice-panel-toggle');
    const label = panel.querySelector('#voice-panel-label');
    const close = panel.querySelector('#voice-panel-close');
    if (body) body.hidden = !voicePanelOpen;
    if (toggle) toggle.setAttribute('aria-expanded', String(voicePanelOpen));
    const voice = (song.voiceRoster || []).find((v) => v.id === chordsVoiceId);
    if (label) {
      label.innerHTML = voice
        ? `${icon('mic', { size: 13 })} Voz · ${escapeHtml(voice.name)}`
        : `${icon('mic', { size: 13 })} Voz`;
    }
    if (close) close.hidden = !chordsVoiceId;
    panel.querySelectorAll('#voice-panel-categories .tono-chip').forEach((c) => {
      const isActive = c.dataset.category === chordsCategory;
      c.classList.toggle('tono-chip--active', isActive);
      c.setAttribute('aria-pressed', String(isActive));
    });
  }

  function renderChordsPersonRow() {
    const rowEl = container.querySelector('#voice-panel-people');
    if (!rowEl) return;
    if (!chordsCategory) {
      rowEl.innerHTML = '';
      return;
    }
    const people = rosterByCategory(song, chordsCategory);
    if (people.length <= 1) {
      rowEl.innerHTML = '';
      return;
    }
    rowEl.innerHTML = people
      .map(
        (p) => `
        <button class="tono-chip tono-chip--person voice-panel__chip${p.id === chordsVoiceId ? ' tono-chip--active' : ''}" data-mix-roster-id="${p.id}" aria-pressed="${p.id === chordsVoiceId}">
          <span class="voice-filter__label-text">${escapeHtml(p.name)}</span>
        </button>`,
      )
      .join('');
    rowEl.querySelectorAll('[data-mix-roster-id]').forEach((btn) => {
      btn.addEventListener('click', () => selectChordsPerson(btn.dataset.mixRosterId));
    });
  }

  function selectChordsPerson(rosterId) {
    chordsVoiceId = rosterId;
    renderChordsPersonRow();
    syncVoicePanel();
    reRenderLyrics();
  }

  function selectChordsCategory(category) {
    chordsCategory = category;
    chordsVoiceId = null;
    renderChordsPersonRow();
    const people = rosterByCategory(song, category);
    if (people.length === 1) {
      selectChordsPerson(people[0].id);
    } else {
      syncVoicePanel();
      reRenderLyrics();
    }
  }

  if (mixAvailable) {
    container.querySelector('#voice-panel-toggle')?.addEventListener('click', () => {
      voicePanelOpen = !voicePanelOpen;
      syncVoicePanel();
    });
    container.querySelector('#voice-panel-close')?.addEventListener('click', () => {
      chordsVoiceId = null;
      chordsCategory = null;
      voicePanelOpen = false;
      syncVoicePanel();
      renderChordsPersonRow();
      reRenderLyrics();
    });
    container.querySelectorAll('#voice-panel-categories [data-category]').forEach((btn) => {
      btn.addEventListener('click', () => selectChordsCategory(btn.dataset.category));
    });
  }

  // ── Preview mode: skip remaining interactive controls ──
  if (isPreview) return;

  // Font controls
  container.querySelector('#font-decrease')?.addEventListener('click', () => {
    fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  container.querySelector('#font-increase')?.addEventListener('click', () => {
    fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  container.querySelector('#enter-stage-btn')?.addEventListener('click', () => {
    const sv = container.querySelector('.song-view');
    if (sv) enterStage(sv);
  });

  // Breadcrumb
  container.querySelector('#breadcrumb-album')?.addEventListener('click', (e) => {
    e.preventDefault();
    filterByAlbum(song.albumSlug);
    navigate('/');
  });

  // Title → links page
  container.querySelector('#song-title-link')?.addEventListener('click', () => {
    navigate(`/song/${songId}/links`);
  });

  // Chord toggle — only transpose and notation for full mode (already set up above)
  if (hasChords) {
    container.querySelector('#transpose-down')?.addEventListener('click', () => {
      transposeSemitones--;
      container.querySelector('#transpose-value').textContent = transposeSemitones;
      reRenderLyrics();
    });

    container.querySelector('#transpose-up')?.addEventListener('click', () => {
      transposeSemitones++;
      container.querySelector('#transpose-value').textContent = transposeSemitones;
      reRenderLyrics();
    });

    container.querySelector('#notation-toggle')?.addEventListener('click', () => {
      useFlats = !useFlats;
      container.querySelector('#notation-toggle').textContent = useFlats ? '♭ → ♯' : '♯ / ♭';
      reRenderLyrics();
    });
  }

  // Album / lista navigation
  if (hasNav) {
    const listSuffix = listId ? `?lista=${listId}` : '';
    container.querySelector('#nav-prev')?.addEventListener('click', () => {
      if (adjacent.prev)
        {navigate(`/song/${adjacent.prev.item_id ?? adjacent.prev.id}${listSuffix}`);}
    });
    container.querySelector('#nav-next')?.addEventListener('click', () => {
      if (adjacent.next)
        {navigate(`/song/${adjacent.next.item_id ?? adjacent.next.id}${listSuffix}`);}
    });
  }

  // ── VoiceSheet: control de voces (solo movil, <768px) ──
  container.querySelector('#open-voice-sheet')?.addEventListener('click', () => {
    openVoiceSheet({
      song,
      activeCategory,
      transposeValue: transposeSemitones,
      useFlats,
      fontLabel: fontSize.toFixed(2),
      onSelectCategory: (cat) => selectCategory(cat),
      onTranspose: (dir) => {
        transposeSemitones += dir;
        const tv = container.querySelector('#transpose-value');
        if (tv) tv.textContent = transposeSemitones;
        const vt = document.querySelector('#vsheet-tono');
        if (vt) vt.textContent = transposeSemitones;
        reRenderLyrics();
      },
      onToggleNotation: () => {
        useFlats = !useFlats;
        reRenderLyrics();
      },
      onFont: (dir) => {
        fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + dir * FONT_STEP));
        applyFontSize(fontSize);
        saveFontSize(fontSize);
        const fl = container.querySelector('#font-size-label');
        if (fl) fl.textContent = fontSize.toFixed(2);
        const vf = document.querySelector('#vsheet-font');
        if (vf) vf.textContent = fontSize.toFixed(2);
      },
    });
  });

  // ── Feature 1: Autoscroll FAB ──
  setupAutoscroll(container, song.id);

  // Favorita lives on the song card cover in the list view now.
}

/**
 * Categorías de voz presentes en el roster, en orden canónico.
 * @param {object} song
 * @returns {string[]}
 */
function rosterCategories(song) {
  const order = ['soprano', 'contralto', 'tenor', 'bass'];
  const present = new Set((song.voiceRoster || []).map((v) => v.category));
  return order.filter((c) => present.has(c));
}

/**
 * Header del modo Tono: categorías en grid 2×2; al elegir una con varias voces
 * se despliega el panel lateral de voces. La nota (tono general) va dentro del
 * chip. Dos botones Afinar (tono general / 1ª nota) bajo el grid.
 * @param {object} song
 * @returns {string}
 */
function renderTonoFilters(song) {
  const categories = rosterCategories(song);
  const catChips = categories
    .map((c) => {
      const people = rosterByCategory(song, c);
      // Nota en el chip sólo si la categoría tiene una sola voz (su tono general).
      const note = people.length === 1 ? tonoGeneralForVoice(song, people[0].id) : null;
      const noteHtml = note ? `<span class="tono-chip__note">${escapeHtml(note)}</span>` : '';
      return `
      <button class="tono-chip tono-chip--category" data-category="${c}" aria-pressed="false">
        <span class="voice-filter__dot" style="background: var(--color-voice-${c})"></span>
        <span class="voice-filter__label-text">${escapeHtml(getVoiceLabel(c))}</span>
        ${noteHtml}
      </button>`;
    })
    .join('');
  return `
    <div class="lyrics__tono-filters" id="tono-filters" style="display: none;">
      <div class="lyrics__tono-grid">
        <div class="lyrics__tono-categories" id="tono-category-row" role="group" aria-label="Categoría de voz">
          ${catChips}
        </div>
        <div class="lyrics__tono-voices" id="tono-person-row" role="group" aria-label="Voz"></div>
      </div>
      <p class="lyrics__tono-active" id="tono-active-voice" aria-live="polite"></p>
      <div class="lyrics__tono-tune" id="tono-tune-action"></div>
    </div>`;
}

/**
 * Caja «Voz» del modo Acordes (Wave 4): plegada muestra solo el título;
 * expandida, grid de categorías + fila de personas (disclosure como Tono).
 * El cierre «Solo acordes» vive en el título. Iconos lucide, nunca emojis.
 * @param {object} song
 * @returns {string}
 */
export function renderVoicePanel(song) {
  const categories = rosterCategories(song);
  const catChips = categories
    .map(
      (c) => `
      <button class="tono-chip tono-chip--category voice-panel__chip" data-category="${c}" aria-pressed="false">
        <span class="voice-filter__dot" style="background: var(--color-voice-${c})"></span>
        <span class="voice-filter__label-text">${escapeHtml(getVoiceLabel(c))}</span>
      </button>`,
    )
    .join('');
  return `
    <div class="tool-box voice-panel" id="voice-panel">
      <div class="tool-box__title voice-panel__title">
        <button class="voice-panel__toggle" id="voice-panel-toggle" aria-expanded="false" aria-controls="voice-panel-body">
          <span id="voice-panel-label">${icon('mic', { size: 13 })} Voz</span>
          <span class="voice-panel__chevron">${icon('chevron-down', { size: 14 })}</span>
        </button>
        <button class="voice-panel__close" id="voice-panel-close" hidden>
          ${icon('close', { size: 12 })} Solo acordes
        </button>
      </div>
      <div class="voice-panel__body" id="voice-panel-body" hidden>
        <div class="voice-panel__grid" id="voice-panel-categories" role="group" aria-label="Categoría de voz">
          ${catChips}
        </div>
        <div class="voice-panel__people" id="voice-panel-people" role="group" aria-label="Voz"></div>
      </div>
    </div>`;
}

/**
 * Render del cuerpo del lector (string puro). Letra blanco plano; Acordes con
 * acordes flotantes + letra atenuada; Tono con la voz activa coloreada + nota.
 * Cuando se pasa `chordsVoiceId` en modo `chords`, cada línea se renderiza en
 * vista combinada (3 rieles: acorde / letra / nota de voz).
 * @param {Array} sections
 * @param {{ viewMode?: 'lyrics'|'chords'|'tono', transposeSemitones?: number,
 *           useFlats?: boolean, activeVoiceId?: string|null,
 *           activeCategory?: string|null,
 *           chordsVoiceId?: string|null,
 *           chordsCategory?: string|null }} [opts]
 * @returns {string} HTML
 */
export function renderSections(sections, opts = {}) {
  const {
    viewMode = 'lyrics',
    transposeSemitones = 0,
    useFlats = false,
    activeVoiceId = null,
    activeCategory = null,
    chordsVoiceId = null,
    chordsCategory = null,
  } = opts;
  const showChords = viewMode === 'chords';
  const colorClass = activeCategory ? `voice-text--${activeCategory}` : '';
  const mixColorClass = chordsCategory ? `voice-text--${chordsCategory}` : '';

  return (sections || [])
    .map(
      (section) => `
    <div class="lyrics__section lyrics__section--${section.type}"${
      typeof section.speedPreset === 'number' ? ` data-speed-preset="${section.speedPreset}"` : ''
    }>
      <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
      ${(section.lines || [])
        .map((line) => {
          const text = line.text || '';

          // ── Recitado (texto hablado, no cantado): itálica atenuada, ancho
          //    completo, en todos los modos. Sin groups/chords → excluido de
          //    Tono/Acordes/afinador de forma natural.
          if (line.spoken) {
            return `<p class="lyrics__line lyrics__line--spoken">${buildLetraLineHTML(text)}</p>`;
          }

          // ── Annotation / Timing guide ──
          if (line.annotation || isTimingGuide(text)) {
            const guide = parseTimingGuide(text);
            const guideContent = guide.count
              ? `<span class="timing-guide__count">${guide.count}</span><span class="timing-guide__unit">${guide.unit}</span>${guide.extra ? `<span class="timing-guide__extra">${escapeHtml(guide.extra)}</span>` : ''}`
              : `<span class="timing-guide__extra">${escapeHtml(guide.extra)}</span>`;
            return `<div class="timing-guide">${guideContent}</div>`;
          }

          // ── Tono: voz activa coloreada + nota flotante ──
          if (viewMode === 'tono' && activeVoiceId) {
            if (text.trim() === '') return `<p class="lyrics__line">&nbsp;</p>`;
            const inner = buildTonoLineHTML(line, activeVoiceId, colorClass);
            return `<p class="lyrics__line lyrics__line--tono">${inner}</p>`;
          }

          // ── Combinada (Acordes + Voz): 3 rieles estrictos ──
          if (showChords && chordsVoiceId) {
            if (text.trim() === '') return `<p class="lyrics__line">&nbsp;</p>`;
            const inner = buildMixedLineHTML(
              line,
              line.chords || [],
              chordsVoiceId,
              mixColorClass,
              {
                transposeSemitones,
                useFlats,
              },
            );
            return `<p class="lyrics__line lyrics__line--mix">${inner}</p>`;
          }

          // ── Líneas vacías ──
          if (text.trim() === '') {
            return showChords ? '' : `<p class="lyrics__line">&nbsp;</p>`;
          }

          // ── Acordes: letra atenuada + acordes flotantes ──
          if (showChords && line.chords?.length > 0) {
            const inner = buildChordsLineHTML(text, line.chords, { transposeSemitones, useFlats });
            return `<p class="lyrics__line lyrics__line--chords">${inner}</p>`;
          }
          if (showChords) {
            // En modo acordes, una línea sin acordes va atenuada pero plana.
            return `<p class="lyrics__line lyrics__line--chords lyrics__line--no-chord">${buildChordsLineHTML(text, [])}</p>`;
          }

          // ── Letra (default): blanco plano ──
          return `<p class="lyrics__line">${buildLetraLineHTML(text)}</p>`;
        })
        .join('')}
    </div>
  `,
    )
    .join('');
}

/**
 * Apply font size to lyrics lines and chord pairs
 */
function applyFontSize(size) {
  const lyricsEl = document.querySelector('#lyrics-content');
  if (lyricsEl) {
    lyricsEl.querySelectorAll('.lyrics__line').forEach((line) => {
      line.style.fontSize = `${size}rem`;
    });
    // Scale chord lines too — the inline pair approach means chords scale with text
    lyricsEl.querySelectorAll('.chord-line').forEach((line) => {
      line.style.fontSize = `${size}rem`;
    });
  }
}

/* ─── Feature 1: Autoscroll ─── */

function getAutoscrollSpeed(songId) {
  try {
    const perSong = songId && localStorage.getItem(`${AUTOSCROLL_SPEED_KEY}:${songId}`);
    const stored = perSong ?? localStorage.getItem(AUTOSCROLL_SPEED_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= AUTOSCROLL_SPEED_MIN && val <= AUTOSCROLL_SPEED_MAX) return val;
    }
  } catch (_e) {
    /* ignore */
  }
  return AUTOSCROLL_SPEED_DEFAULT;
}

function saveAutoscrollSpeed(speed, songId) {
  try {
    const key = songId ? `${AUTOSCROLL_SPEED_KEY}:${songId}` : AUTOSCROLL_SPEED_KEY;
    localStorage.setItem(key, speed.toString());
  } catch (_e) {
    /* ignore */
  }
}

const PLAY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>`;
const PAUSE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`;

function speedToPercentLabel(speed) {
  return `${Math.round(speed * 100)}%`;
}

function setupAutoscroll(_container, songId) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scrollSpeed = getAutoscrollSpeed(songId);
  let targetSpeed = scrollSpeed;
  let isScrolling = false;
  let rafId = null;
  let ignoreScrollUntil = 0; // Debounce: ignore scroll events briefly after starting
  let collapseTimer = null;

  // Inject FAB
  const fab = document.createElement('div');
  fab.className = 'autoscroll-fab';
  fab.innerHTML = `
    <button class="autoscroll-fab__btn autoscroll-fab__btn--main" id="autoscroll-toggle" aria-label="Autoscroll play/pause" title="Autoscroll">
      <span class="autoscroll-fab__icon" id="autoscroll-icon">${PLAY_ICON_SVG}</span>
    </button>
    <div class="autoscroll-fab__controls" id="autoscroll-controls">
      <button class="autoscroll-fab__btn autoscroll-fab__btn--speed" id="autoscroll-slower" aria-label="Más lento" title="Más lento">−</button>
      <span class="autoscroll-fab__speed" id="autoscroll-speed-label">${speedToPercentLabel(scrollSpeed)}</span>
      <button class="autoscroll-fab__btn autoscroll-fab__btn--speed" id="autoscroll-faster" aria-label="Más rápido" title="Más rápido">+</button>
    </div>
  `;
  document.body.appendChild(fab);

  // ── Visibilidad del FAB según el header (Plan #3) ──
  let headerVisible = true; // al cargar estás en el tope → header visible

  function applyFabVisibility() {
    if (fab.classList.contains('autoscroll-fab--stage')) return; // en escenario lo controla StageMode
    fab.classList.toggle('autoscroll-fab--hidden', !shouldShowFab(headerVisible, isScrolling));
  }
  applyFabVisibility(); // estado inicial: oculto en el header

  const headerEl = document.querySelector('.song-view__header');
  const headerIo = headerEl
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) headerVisible = entry.isIntersecting;
          applyFabVisibility();
        },
        { threshold: 0 },
      )
    : null;
  if (headerIo && headerEl) headerIo.observe(headerEl);

  // ── Velocidad objetivo por sección (speedPreset → targetSpeed) ──
  // Las secciones sin data-speed-preset no se observan, así que targetSpeed
  // permanece igual a scrollSpeed y la interpolación es un no-op (backward-compat).
  const speedRange = { min: AUTOSCROLL_SPEED_MIN, max: AUTOSCROLL_SPEED_MAX };
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const preset = Number.parseFloat(entry.target.getAttribute('data-speed-preset'));
        const mapped = presetToSpeed(preset, speedRange);
        if (mapped !== null) {
          targetSpeed = mapped;
          // Sin transición suave bajo reduced-motion: salto directo.
          if (reducedMotion) {
            scrollSpeed = targetSpeed;
            updateSpeedLabel();
          }
        }
      }
    },
    { threshold: 0.5 },
  );
  document.querySelectorAll('.lyrics__section[data-speed-preset]').forEach((el) => io.observe(el));

  const toggleBtn = fab.querySelector('#autoscroll-toggle');
  const iconEl = fab.querySelector('#autoscroll-icon');
  const controlsEl = fab.querySelector('#autoscroll-controls');
  const speedLabel = fab.querySelector('#autoscroll-speed-label');

  function updateSpeedLabel() {
    speedLabel.textContent = speedToPercentLabel(scrollSpeed);
  }

  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    if (!isScrolling) return;
    collapseTimer = setTimeout(() => {
      if (isScrolling) fab.classList.add('autoscroll-fab--collapsed');
    }, AUTOSCROLL_COLLAPSE_DELAY);
  }

  function expandFab() {
    fab.classList.remove('autoscroll-fab--collapsed');
    scheduleCollapse();
  }

  function startScroll() {
    isScrolling = true;
    applyFabVisibility();
    // Ignore touch/wheel events for 500ms after starting to prevent false-positive pause
    ignoreScrollUntil = Date.now() + 500;
    iconEl.innerHTML = PAUSE_ICON_SVG;
    toggleBtn.setAttribute('aria-label', 'Pausar autoscroll');
    toggleBtn.classList.add('autoscroll-fab__btn--active');
    controlsEl.classList.add('autoscroll-fab__controls--visible');
    scheduleCollapse();

    // Disable CSS smooth scroll — Safari iOS ignores programmatic scroll when it’s active
    document.documentElement.style.scrollBehavior = 'auto';

    let lastTime = performance.now();
    let accumulated = 0; // Sub-pixel accumulator (Safari truncates fractional scrollTop)

    function step(now) {
      if (!isScrolling) return;
      const delta = now - lastTime;
      lastTime = now;
      // Acercar suavemente scrollSpeed a la velocidad objetivo del preset de
      // sección. Bajo reduced-motion no se interpola (el salto ya ocurrió al
      // entrar la sección). Sin presets, targetSpeed === scrollSpeed → no-op.
      if (!reducedMotion && scrollSpeed !== targetSpeed) {
        const next = stepToward(
          scrollSpeed,
          targetSpeed,
          AUTOSCROLL_SPEED_STEP * (delta / 16.67) * AUTOSCROLL_CONVERGENCE_RATE,
        );
        // Solo reescribir el label si el valor mostrado cambia (evita escritura
        // de DOM por frame durante la convergencia).
        const labelChanged = speedToPercentLabel(next) !== speedToPercentLabel(scrollSpeed);
        scrollSpeed = next;
        if (labelChanged) updateSpeedLabel();
      }
      // 60fps baseline: pixels = basePx * speed * (delta / 16.67)
      accumulated += AUTOSCROLL_BASE_PX_PER_FRAME * scrollSpeed * (delta / 16.67);

      // Only scroll whole pixels (Safari ignores fractional values)
      if (accumulated >= 1) {
        const px = Math.floor(accumulated);
        accumulated -= px;
        window.scrollTo({
          top: (window.pageYOffset || 0) + px,
          behavior: 'instant',
        });
      }

      // Stop if at the bottom
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (scrollTop + window.innerHeight >= docHeight - 2) {
        stopScroll();
        return;
      }
      rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
  }

  function stopScroll() {
    isScrolling = false;
    applyFabVisibility();
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    clearTimeout(collapseTimer);
    iconEl.innerHTML = PLAY_ICON_SVG;
    toggleBtn.setAttribute('aria-label', 'Activar autoscroll');
    toggleBtn.classList.remove('autoscroll-fab__btn--active');
    fab.classList.remove('autoscroll-fab--collapsed');
    // Restore CSS smooth scroll
    document.documentElement.style.scrollBehavior = '';
  }

  // Toggle play/pause — when collapsed, first tap expands; second tap toggles
  toggleBtn.addEventListener('click', () => {
    if (isScrolling && fab.classList.contains('autoscroll-fab--collapsed')) {
      expandFab();
      return;
    }
    if (isScrolling) {
      stopScroll();
    } else {
      startScroll();
    }
  });

  // Speed controls — interacting also resets the collapse timer
  fab.querySelector('#autoscroll-slower').addEventListener('click', (e) => {
    e.stopPropagation();
    scrollSpeed = Math.max(AUTOSCROLL_SPEED_MIN, scrollSpeed - AUTOSCROLL_SPEED_STEP);
    scrollSpeed = Math.round(scrollSpeed * 100) / 100;
    // El ajuste manual gana sobre el preset hasta la próxima sección.
    targetSpeed = scrollSpeed;
    saveAutoscrollSpeed(scrollSpeed, songId);
    updateSpeedLabel();
    if (isScrolling) scheduleCollapse();
  });

  fab.querySelector('#autoscroll-faster').addEventListener('click', (e) => {
    e.stopPropagation();
    scrollSpeed = Math.min(AUTOSCROLL_SPEED_MAX, scrollSpeed + AUTOSCROLL_SPEED_STEP);
    scrollSpeed = Math.round(scrollSpeed * 100) / 100;
    // El ajuste manual gana sobre el preset hasta la próxima sección.
    targetSpeed = scrollSpeed;
    saveAutoscrollSpeed(scrollSpeed, songId);
    updateSpeedLabel();
    if (isScrolling) scheduleCollapse();
  });

  // Any touch on the FAB while collapsed → expand
  fab.addEventListener(
    'touchstart',
    () => {
      if (isScrolling && fab.classList.contains('autoscroll-fab--collapsed')) {
        expandFab();
      }
    },
    { passive: true },
  );

  // Pause on user manual scroll (touch or wheel) — but ignore touches on the FAB itself
  function onUserScroll(e) {
    if (!isScrolling) return;
    // Debounce: ignore events right after starting scroll
    if (Date.now() < ignoreScrollUntil) return;
    // Ignore touches/clicks on the FAB itself
    if (e.target && fab.contains(e.target)) return;
    stopScroll();
  }
  window.addEventListener('wheel', onUserScroll, { passive: true });
  window.addEventListener('touchmove', onUserScroll, { passive: true });

  // Cleanup when navigating away (hashchange)
  function cleanup() {
    stopScroll();
    clearTimeout(collapseTimer);
    io.disconnect();
    if (headerIo) headerIo.disconnect();
    fab.remove();
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
    window.removeEventListener('hashchange', cleanup);
  }
  window.addEventListener('hashchange', cleanup);
}
