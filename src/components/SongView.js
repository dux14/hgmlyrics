/**
 * SongView.js — Lyrics reader component (Upgraded)
 *
 * Displays song lyrics with section labels, voice-colored highlights,
 * word-level voice spans, font size controls, album navigation bar,
 * voice part filter with premium chips, chord display with transposition,
 * and album navigation.
 */

import { getSongById, fetchSongDetail, getAdjacentSongs } from '../lib/store.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelSongDetail } from '../lib/skeleton.js';
import { navigate, onRouteChange } from '../router.js';
import {
  upgradeLegacySong,
  rosterByCategory,
  getVoiceLabel,
  firstNoteForVoice,
} from '../lib/voiceSystem.js';
import {
  buildLetraLineHTML,
  buildChordsLineHTML,
  buildTonoLineHTML,
  buildMixedLineHTML,
  buildTransposeBubbleLabel,
  buildCejillaHint,
  transposeNote,
} from '../lib/lyricsRender.js';
import { getChordNotation, setChordNotation } from '../lib/chordNotation.js';
import { getTranspose, setTranspose, normalizeSemitones } from '../lib/transposeStore.js';
import { getLayers, setLayer, deriveViewMode } from '../lib/layerStore.js';
import { isAdmin, isFeatureEnabled } from '../lib/authStore.js';
import { icon, COVER_PLACEHOLDER } from '../lib/icons.js';
import { isFavorite, toggleFavorite } from '../lib/favorites.js';
import { recordVisit } from '../lib/recentVisits.js';
import '../styles/favorites.css';
import { openOptionsSheet } from './OptionsSheet.js';
import { openFloatingTuner } from './FloatingTuner.js';
import {
  presetToSpeed,
  stepToward,
  shouldShowFab,
  AUTOSCROLL_SPEED_MIN,
  AUTOSCROLL_SPEED_MAX,
  getAutoscrollSpeed,
  saveAutoscrollSpeed,
  speedToPercentLabel,
} from '../lib/autoscroll.js';
import { escapeHtml } from '../lib/escape.js';
import { enterImmersive } from './ImmersiveView.js';
import { normalizeSectionType } from '../lib/sectionTypes.js';

const FONT_SIZE_KEY = 'hkn-lyrics-font-size';
const FONT_STEP = 0.125; // rem
const FONT_MIN = 0.875;
const FONT_MAX = 2.5;

// Autoscroll config
const AUTOSCROLL_SPEED_STEP = 0.05;
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
 * Muestra un toast indicando si la canción fue agregada o eliminada de favoritos.
 * El botón "Deshacer" llama toggleFavorite de nuevo y actualiza el btn.
 * @param {boolean} added
 * @param {string} songId
 * @param {HTMLElement} favBtn
 */
function showFavToast(added, songId, favBtn) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  clearTimeout(toast._hideTimer);

  const label = added ? 'Agregada' : 'Eliminada';
  toast.innerHTML = `
    <span>${label}</span>
    <button class="fav-toast__undo" type="button" aria-label="Deshacer">· Deshacer</button>
  `;
  toast.classList.add('visible');

  toast.querySelector('.fav-toast__undo').addEventListener(
    'click',
    async () => {
      toast.classList.remove('visible');
      await toggleFavorite(songId);
      const nowOn = !added;
      if (favBtn) {
        favBtn.classList.toggle('is-on', nowOn);
        favBtn.setAttribute('aria-label', nowOn ? 'Quitar de favoritos' : 'Agregar a favoritos');
      }
    },
    { once: true },
  );

  toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

/**
 * Render the song view
 * @param {HTMLElement} container
 * @param {string|object} songIdOrData - Either a song ID string, or a full song object (with isPreview flag)
 */
export async function renderSongView(container, songIdOrData) {
  const isPreview = typeof songIdOrData === 'object' && songIdOrData !== null;
  let songId = null;

  if (isPreview) {
    // Preview: datos ya disponibles, render directo sin skeleton.
    await _renderSongBody(container, null, true, songIdOrData);
    return;
  }

  songId = songIdOrData;
  const cachedSong = getSongById(songId);

  if (cachedSong?.sections?.length) {
    // Canción ya en caché con secciones: render directo sin skeleton.
    await _renderSongBody(container, songId, false, cachedSong);
    recordVisit(songId);
    return;
  }

  // Sin secciones en caché: shell instantáneo + skeleton + fetch.
  container.innerHTML = `
    <div class="song-view__shell">
      <div class="song-view__region" aria-busy="true"></div>
    </div>
  `;
  const region = container.querySelector('.song-view__region');

  renderAsyncRegion(region, {
    skeleton: () => skelSongDetail(),
    fetcher: () => fetchSongDetail(songId),
    render: (detail) => {
      // Si el usuario ya navego fuera, la region fue removida del container y
      // _renderSongBody (que posee el container full-bleed) clobberearia la
      // pantalla nueva con esta canción tardía (bug de navegación #3).
      if (!container.contains(region)) return;
      _renderSongBody(container, songId, false, detail)
        .then(() => recordVisit(songId))
        .catch(() => {
          container.innerHTML = `
          <div class="empty-state">
            <h2 class="empty-state__title">No se pudo cargar la canción</h2>
            <a class="btn btn--primary" href="#/">Volver al inicio</a>
          </div>`;
        });
    },
    empty: () => `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">${icon('frown', { size: 48 })}</div>
        <h2 class="empty-state__title">Canción no encontrada</h2>
        <p class="empty-state__text">La canción que buscas no existe o fue eliminada.</p>
        <a class="btn btn--primary" style="margin-top: 1rem;" href="#/">Volver al inicio</a>
      </div>`,
    onError: () => `
      <div class="empty-state">
        <h2 class="empty-state__title">No se pudo cargar la canción</h2>
        <button class="btn btn--primary" data-retry>Reintentar</button>
      </div>`,
  });
}

// _renderSongBody: pinta la canción completa en container. Invocado desde
// renderSongView (rutas: preview directo, caché directa, fetch async).
async function _renderSongBody(container, songId, isPreview, song) {
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
  // Modo Tono: solo con el flag voz_tono. chordsCategory/chordsVoiceId (panel
  // Voz unificado) dirigen el disclosure categoría→persona del modo notas.
  const tonoEnabled = isFeatureEnabled('voz_tono');
  // hasChords/tonoAvailable se adelantan (antes vivían más abajo) porque la
  // derivación de viewMode (FIX finding 1) los necesita para intersectar la
  // preferencia global de capas con lo que la canción realmente soporta.
  const hasChords = songHasChords(song);
  const tonoAvailable = tonoEnabled && (song.voiceRoster || []).length > 0;
  // viewMode: 'lyrics' | 'chords' | 'tono' | 'mixed'. showChords se deriva para
  // no tocar la rama de acordes existente. 'mixed' es la combinación de las
  // capas Acordes+Tono (T3, toolbar de capas) — no es un modo exclusivo nuevo,
  // solo la representación interna de "ambas capas encendidas" para
  // renderSections/reRenderLyrics.
  let viewMode = 'lyrics';
  let showChords = false;
  // Capas de lectura (T3): Acordes y Tono ya no son un mode exclusivo en la
  // toolbar — son dos toggles independientes persistidos globalmente
  // (layerStore). `layers` es la preferencia GLOBAL cruda (persistida sin
  // tocar); `getEffectiveLayers` (FIX finding 1, CRITICAL) la intersecta con
  // hasChords/tonoAvailable de ESTA canción para que una capa encendida en
  // otra canción con acordes no sangre en una sin acordes (sin control para
  // apagarla, porque el toggle ni se pinta). Solo aplican fuera de preview: el
  // preview conserva el toggle viejo Letra/Acordes/Tono (chord-toggle) tal
  // cual, sin tocarlo.
  const layers = getLayers();
  function getEffectiveLayers() {
    return { chords: layers.chords && hasChords, tono: layers.tono && tonoAvailable };
  }
  if (!isPreview) {
    viewMode = deriveViewMode(getEffectiveLayers());
    showChords = viewMode === 'chords' || viewMode === 'mixed';
  }
  // Transposición persistida por canción (T3); preview no persiste (no hay id
  // estable de sesión ni beneficio de recordarla para una vista efímera).
  const savedTranspose = !isPreview ? getTranspose(songId) : { semitones: 0, useFlats: false };
  let transposeSemitones = savedTranspose.semitones;
  let useFlats = savedTranspose.useFlats;
  // API de setupAutoscroll (FIX 1): pauseAutoscroll detiene el motor rAF del
  // autoscroll clásico al entrar al escenario, para que no siga corriendo
  // detrás del overlay. Se asigna al llamar setupAutoscroll más abajo; el
  // handler de #enter-stage-btn ya solo registra el listener en este punto,
  // así que para cuando se dispare el click ya está poblada.
  let stageAutoscrollApi = null;
  // Audio por sección (F5): se resuelve lazy tras el render principal, no
  // bloquea. sectionsWithAudio alimenta el icono play junto al label de la
  // sección en la letra; sectionPlayerApi.pause() se engancha al mismo hook
  // del stage-btn que pausa el autoscroll clásico.
  let sectionPlayerApi = null;
  let sectionsWithAudio = new Set();
  // Afinador flotante (T5): bajo demanda desde el mic de la toolbar, null
  // hasta que se abre. Siempre disponible (afinador libre sin voz
  // seleccionada); refreshActiveVoiceNote() lo refresca junto con la voz
  // activa para que la nota objetivo la siga sin lógica aparte.
  let floatingTunerApi = null;

  // Selector de voz UNIFICADO (pivote modos excluyentes, post-QA visual): un
  // solo concepto de "mi voz" para Acordes (mezcla acordes+voz) y Tono (notas
  // por sílaba) — antes eran dos estados independientes (activeCategory/
  // activeRosterId para Tono via chips del hero, chordsCategory/chordsVoiceId
  // para Acordes+Voz via el panel). El panel Voz (renderVoicePanel) es ahora
  // EL selector en ambos modos; disponible siempre que haya roster (ya no
  // requiere acordes).
  let chordsCategory = null;
  let chordsVoiceId = null;
  let voicePanelOpen = false;
  const voicePanelAvailable = tonoAvailable;

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

  // Resolver el contexto de lista (prev/next dentro de la lista) implica
  // await import('lists') + getList() por red ANTES de pintar el cuerpo abajo.
  // Sin esto, la pantalla anterior (la lista) queda visible bajo la URL nueva
  // /song/:id mientras la red resuelve. Pinta un skeleton al instante para
  // limpiarla ya; el innerHTML del cuerpo lo reemplaza al terminar. Solo aplica
  // al caso con ?lista= (la rama sin lista y el preview pintan síncronamente).
  if (listId) container.innerHTML = skelSongDetail();

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
  // La fila toggle aparece si hay acordes o si hay Tono (hasChords/tonoAvailable
  // ya se calcularon arriba, junto a viewMode).
  const showToggle = hasChords || tonoAvailable;

  container.innerHTML = `
    <div class="song-view${!isPreview ? ' page--headerless' : ''} fade-in">
      <!-- Song Header -->
      <div class="song-view__header">
        <div class="song-view__cover-wrap">
          <img
            class="song-view__cover"
            src="${coverUrl || COVER_PLACEHOLDER}"
            alt="Portada de ${escapeHtml(song.album || '')}"
            width="80"
            height="80"
            decoding="async"
            onerror="this.src='${COVER_PLACEHOLDER}'"
          />
          ${
            !isPreview
              ? `<button class="fav-btn fav-btn--cover${songId && isFavorite(songId) ? ' is-on' : ''}" id="fav-btn" aria-label="Agregar a favoritos" aria-pressed="${songId && isFavorite(songId)}">${icon('heart', { size: 16 })}</button>`
              : ''
          }
        </div>
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
      <!-- Controls toolbar — modos excluyentes Letra/Acordes/Tono (pivote
           post-QA visual): #layer-chords/#layer-tono son un OR (activar uno
           apaga el otro; tap sobre el activo vuelve a Letra), exclusividad
           impuesta por layerStore. El mic del afinador vive acá, siempre
           visible (afinador libre si no hay voz elegida). A−/A+ y transpose
           viven solo en el sheet de opciones (#open-options-sheet). -->
      <div class="song-toolbar">
        ${hasChords ? `<button class="layer-toggle" id="layer-chords" aria-pressed="${layers.chords}">Acordes</button>` : ''}
        ${tonoAvailable ? `<button class="layer-toggle" id="layer-tono" aria-pressed="${layers.tono}">Tono</button>` : ''}
        <span class="song-toolbar__spacer"></span>
        <button class="song-toolbar__icon" id="hero-tuner-mic" aria-label="Afinar mi voz">${icon('mic', { size: 18 })}</button>
        <button class="song-toolbar__icon" id="enter-stage-btn" aria-label="Modo escenario">${icon('maximize', { size: 18 })}</button>
        <button class="song-toolbar__icon" id="open-options-sheet" aria-label="Opciones">${icon('sliders', { size: 18 })}</button>
        ${isAdmin() ? `<a href="#/admin/edit/${song.id}?from=${song.id}" class="song-toolbar__icon" aria-label="Editar">${icon('pencil', { size: 16 })}</a>` : ''}
      </div>

      ${
        (song.cejilla && song.cejilla > 0) || voicePanelAvailable
          ? `
      <!-- Cajas temáticas — Guitarra (cejilla, SOLO modo Acordes; ver
           applyModeVisibility) y Voz (selector único para "mi tono" en
           Acordes y para la voz activa en Tono). -->
      <div class="chords-extras" id="chords-extras" style="display: none;">
        ${
          song.cejilla && song.cejilla > 0
            ? `
        <div class="tool-box tool-box--row" id="guitar-box">
          <div class="tool-box__title">${icon('audio-lines', { size: 13 })} Guitarra</div>
          <div class="cejilla-badge" title="Colocar cejilla en el traste ${song.cejilla}">
            <span class="cejilla-badge__icon">${icon('audio-lines', { size: 15 })}</span>
            <span class="cejilla-badge__text" id="cejilla-badge-text">${escapeHtml(buildCejillaHint(song.key, song.cejilla, useFlats, getChordNotation()))}</span>
          </div>
        </div>
        `
            : ''
        }
        ${voicePanelAvailable ? renderVoicePanel(song) : ''}
      </div>
      `
          : ''
      }
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
        voicePanelAvailable
          ? `<div class="chords-extras" id="chords-extras" style="display: none;">${renderVoicePanel(song)}</div>`
          : ''
      }
      `
      }

      <!-- Lyrics -->
      <div class="lyrics" id="lyrics-content">
        ${renderSections(song.sections || [], { viewMode, transposeSemitones, useFlats, activeVoiceId: chordsVoiceId, activeCategory: chordsCategory, chordsVoiceId, chordsCategory, notation: getChordNotation() })}
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
        activeVoiceId: chordsVoiceId,
        activeCategory: chordsCategory,
        chordsVoiceId,
        chordsCategory,
        notation: getChordNotation(),
        sectionsWithAudio,
      });
      if (!isPreview) applyFontSize(fontSize);
      wireSectionPlayButtons();
    }
  }

  // Tap en la etiqueta de una sección con audio la reproduce (F5). Se
  // reconecta en cada reRenderLyrics porque el innerHTML pierde listeners.
  function wireSectionPlayButtons() {
    if (!sectionPlayerApi) return;
    container.querySelectorAll('[data-section-audio]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sectionPlayerApi.playSection(Number(btn.dataset.sectionAudio));
      });
    });
  }

  // Resalta la sección que suena ahora (.lyrics__section--playing); null
  // apaga el resaltado (pausa, fin de canción, cambio de scope).
  function highlightPlayingSection(sectionIndex) {
    container.querySelectorAll('#lyrics-content .lyrics__section').forEach((el) => {
      const isPlaying = sectionIndex !== null && Number(el.dataset.sectionIndex) === sectionIndex;
      el.classList.toggle('lyrics__section--playing', isPlaying);
    });
  }

  // Refresca el bubble de tono + hint de cejilla (no requieren re-pintar la
  // letra completa) y persiste la transposición por canción (T3).
  function refreshTransposeUI() {
    if (!isPreview) setTranspose(songId, { semitones: transposeSemitones, useFlats });
    const notation = getChordNotation();
    const cejillaTextEl = container.querySelector('#cejilla-badge-text');
    if (cejillaTextEl && song.cejilla) {
      cejillaTextEl.textContent = buildCejillaHint(song.key, song.cejilla, useFlats, notation);
    }
    refreshActiveVoiceNote();
  }

  // Show controls relevant to the current mode: cejilla + transposition belong
  // to chords mode; el panel Voz vive acá también para Tono. La caja Guitarra
  // es exclusiva de Acordes: en Tono se oculta y, si era la única caja, el
  // contenedor entero también (para no dejar un margen fantasma).
  function applyModeVisibility() {
    const chordsExtrasEl = container.querySelector('#chords-extras');
    const guitarBoxEl = container.querySelector('#guitar-box');
    if (guitarBoxEl) guitarBoxEl.style.display = showChords ? '' : 'none';
    if (chordsExtrasEl) {
      const hasVisibleBox = (guitarBoxEl && showChords) || voicePanelAvailable;
      chordsExtrasEl.style.display =
        (showChords || viewMode === 'tono') && hasVisibleBox ? 'flex' : 'none';
    }
    // Re-asegura el estado del panel Voz al cambiar de modo (defensivo).
    syncVoicePanel();
  }

  // Selector de voz unificado (panel #voice-panel): sirve tanto a Acordes
  // ("mi tono" → mezcla acordes+voz) como a Tono (notas por sílaba de la voz
  // activa) — un solo estado, chordsCategory/chordsVoiceId, sin importar el
  // modo. selectPerson/selectCategory también los usa el chip S·A·T·B del
  // escenario (setActiveVoice, ImmersiveView) para mantener paridad.
  function selectPerson(rosterId) {
    chordsVoiceId = rosterId;
    renderChordsPersonRow();
    syncVoicePanel();
    refreshActiveVoiceNote();
    reRenderLyrics();
  }

  function selectCategory(category) {
    chordsCategory = category;
    chordsVoiceId = null;
    renderChordsPersonRow();
    refreshActiveVoiceNote();
    // Autoselección si la categoría tiene una sola persona.
    const people = rosterByCategory(song, category);
    if (people.length === 1) {
      selectPerson(people[0].id);
    } else {
      syncVoicePanel();
      reRenderLyrics();
    }
  }

  // Limpia la voz seleccionada (botón de cierre del panel). Tono soporta "sin
  // voz activa" (letra sin resaltar, fallback existente en renderSections), así
  // que NO se fuerza la vuelta a modo Letra — se queda en el modo actual.
  function clearVoiceSelection() {
    chordsVoiceId = null;
    chordsCategory = null;
    voicePanelOpen = false;
    syncVoicePanel();
    renderChordsPersonRow();
    refreshActiveVoiceNote();
    reRenderLyrics();
  }

  // Refresca la nota objetivo del afinador flotante (si está abierto) según la
  // voz activa (chordsCategory) y la transposición/notación actuales. Es lo
  // único que sobrevive de la vieja updateHeroChips() tras quitar los chips
  // del hero (T5 → toolbar); el resto (chip DOM, atenuado) ya no aplica.
  function refreshActiveVoiceNote() {
    if (!floatingTunerApi) return;
    floatingTunerApi.setNote(
      chordsCategory
        ? heroChipTargetNote(song, chordsCategory, { transposeSemitones, useFlats })
        : null,
    );
  }

  if (!isPreview) applyFontSize(fontSize);
  applyModeVisibility();

  // Cambia de modo (Letra/Acordes/Tono) — solo lo usa el chord-toggle viejo
  // del preview, sin tocar.
  function switchViewMode(mode) {
    viewMode = mode;
    showChords = viewMode === 'chords' || viewMode === 'mixed';
    container
      .querySelectorAll('.chord-toggle__btn')
      .forEach((c) => c.classList.toggle('chord-toggle__btn--active', c.dataset.mode === mode));
    applyModeVisibility();
    reRenderLyrics();
  }

  // Mode toggle (Letra / Acordes / Tono) — solo queda en preview (chord-toggle
  // viejo, sin tocar). Fuera de preview la toolbar usa los modos excluyentes
  // (toggleLayer) en vez de este mode toggle.
  if (showToggle) {
    container.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => switchViewMode(btn.dataset.mode));
    });
  }

  // ── Modos excluyentes Letra/Acordes/Tono (pivote post-QA visual) ──
  // `layers` es la fuente de verdad persistida (layerStore, exclusiva); tras
  // togglear se relee fresca del store para reflejar la exclusividad que el
  // store ya impuso (activar una apaga la otra) — el estado local no puede
  // limitarse a invertir el propio booleano o queda desincronizado. Sin
  // auto-preselección de voz: al entrar a Tono el panel queda visible y la
  // letra se pinta plana (fallback existente) hasta que el usuario elige.
  function toggleLayer(name) {
    setLayer(name, !layers[name]);
    const fresh = getLayers();
    layers.chords = fresh.chords;
    layers.tono = fresh.tono;
    container.querySelector('#layer-chords')?.setAttribute('aria-pressed', String(layers.chords));
    container.querySelector('#layer-tono')?.setAttribute('aria-pressed', String(layers.tono));
    viewMode = deriveViewMode(getEffectiveLayers());
    showChords = viewMode === 'chords' || viewMode === 'mixed';
    // Al activar Tono sin voz elegida, el panel debe abrirse expandido: es el
    // camino para seleccionar la voz (spec del pivote), no tiene sentido
    // mostrarlo colapsado. Con voz ya elegida se respeta el estado actual.
    if (name === 'tono' && layers.tono && !chordsVoiceId) voicePanelOpen = true;
    applyModeVisibility();
    reRenderLyrics();
    // Crossfade 150ms ease-out (CSS respeta prefers-reduced-motion, ver
    // .lyrics--layer-fade en components.css).
    const lyricsEl = container.querySelector('#lyrics-content');
    if (lyricsEl) {
      lyricsEl.classList.remove('lyrics--layer-fade');
      void lyricsEl.offsetWidth; // reflow: reinicia la animación en clicks seguidos
      lyricsEl.classList.add('lyrics--layer-fade');
    }
  }

  container.querySelector('#layer-chords')?.addEventListener('click', () => toggleLayer('chords'));
  container.querySelector('#layer-tono')?.addEventListener('click', () => toggleLayer('tono'));

  // Task 4: clase en body mientras el afinador flotante está abierto — el
  // autoscroll FAB (fixed, ancla abajo) la usa para apilarse por encima del
  // widget en vez de taparlo. Se togglea en TODOS los caminos de cierre (X,
  // Escape, re-click del mic, route change, entrar al escenario).
  function setFloatingTunerOpen(open) {
    document.body.classList.toggle('floating-tuner-open', open);
  }

  // ── Afinador flotante: mic de la toolbar, bajo demanda. Toggle simple — un
  // segundo click en el mismo mic cierra la barra en vez de apilar otra. Se
  // monta en document.body (mismo patrón que autoscroll-fab) para que el
  // `position: fixed` no dependa de ancestros del árbol de la vista. Siempre
  // disponible (no gated por tonoAvailable): sin voz activa es un afinador
  // libre, igual que el de Herramientas.
  container.querySelector('#hero-tuner-mic')?.addEventListener('click', () => {
    if (floatingTunerApi) {
      floatingTunerApi.destroy();
      floatingTunerApi = null;
      setFloatingTunerOpen(false);
      return;
    }
    floatingTunerApi = openFloatingTuner(document.body, {
      note: chordsCategory
        ? heroChipTargetNote(song, chordsCategory, { transposeSemitones, useFlats })
        : null,
      voiceLabel: chordsCategory ? getVoiceLabel(chordsCategory) : 'Afinador',
      onClose: () => {
        floatingTunerApi = null;
        setFloatingTunerOpen(false);
      },
    });
    setFloatingTunerOpen(true);
  });

  // El afinador flotante no depende del audio por sección (F5): se destruye
  // en su propia suscripción a onRouteChange, mismo patrón que
  // destroySectionPlayer más abajo (logout/redirects no deben dejarlo vivo).
  // Solo fuera de preview: el preview (editor) no navega por router, no hay
  // ruta de la que salir.
  if (!isPreview) {
    const destroyFloatingTuner = () => {
      floatingTunerApi?.destroy();
      floatingTunerApi = null;
      setFloatingTunerOpen(false);
      unsubscribeFloatingTunerRoute();
    };
    const unsubscribeFloatingTunerRoute = onRouteChange(destroyFloatingTuner);
  }

  // ── Panel Voz (selector único, Acordes+Tono) ──
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
    if (close) {
      close.hidden = !chordsVoiceId;
      // En Tono, quitar la voz no significa "solo acordes" — el texto se
      // adapta al modo vigente.
      close.innerHTML =
        viewMode === 'tono'
          ? `${icon('close', { size: 12 })} Quitar voz`
          : `${icon('close', { size: 12 })} Solo acordes`;
    }
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
      btn.addEventListener('click', () => selectPerson(btn.dataset.mixRosterId));
    });
  }

  if (voicePanelAvailable) {
    container.querySelector('#voice-panel-toggle')?.addEventListener('click', () => {
      voicePanelOpen = !voicePanelOpen;
      syncVoicePanel();
    });
    container
      .querySelector('#voice-panel-close')
      ?.addEventListener('click', () => clearVoiceSelection());
    container.querySelectorAll('#voice-panel-categories [data-category]').forEach((btn) => {
      btn.addEventListener('click', () => selectCategory(btn.dataset.category));
    });
  }

  // ── Preview mode: skip remaining interactive controls ──
  if (isPreview) return;

  // Favorite button
  const favBtn = container.querySelector('#fav-btn');
  if (favBtn && songId) {
    favBtn.addEventListener('click', async () => {
      const wasOn = favBtn.classList.contains('is-on');
      await toggleFavorite(songId);
      favBtn.classList.toggle('is-on', !wasOn);
      favBtn.setAttribute('aria-pressed', String(!wasOn));
      favBtn.setAttribute('aria-label', wasOn ? 'Agregar a favoritos' : 'Quitar de favoritos');
      showFavToast(!wasOn, songId, favBtn);
    });
  }

  // Al salir del escenario (FIX finding 2): ImmersiveView togglea capas
  // directamente contra layerStore (mismo storage global), así que el closure
  // de SongView (layers/viewMode/aria-pressed/letra pintada) queda obsoleto si
  // el usuario las cambió adentro. Relee getLayers(), re-deriva viewMode (con
  // la misma intersección de disponibilidad de finding 1) y re-pinta.
  function resyncLayersFromStore() {
    const fresh = getLayers();
    layers.chords = fresh.chords;
    layers.tono = fresh.tono;
    container.querySelector('#layer-chords')?.setAttribute('aria-pressed', String(layers.chords));
    container.querySelector('#layer-tono')?.setAttribute('aria-pressed', String(layers.tono));
    viewMode = deriveViewMode(getEffectiveLayers());
    showChords = viewMode === 'chords' || viewMode === 'mixed';
    applyModeVisibility();
    reRenderLyrics();
  }

  container.querySelector('#enter-stage-btn')?.addEventListener('click', () => {
    const sv = container.querySelector('.song-view');
    if (sv) {
      // FIX finding 4: el afinador flotante (mic en vivo) no se pausa solo al
      // entrar al escenario — se destruye, mismo patrón que el route-change
      // teardown (destroyFloatingTuner más arriba).
      floatingTunerApi?.destroy();
      floatingTunerApi = null;
      setFloatingTunerOpen(false);
      enterImmersive(sv, {
        song,
        getActiveVoice: () => chordsVoiceId,
        getTranspose: () => ({ semitones: transposeSemitones, useFlats }),
        getNotation: () => getChordNotation(),
        setActiveVoice: (category, personId) => {
          selectCategory(category);
          // selectCategory ya autoselecciona la única persona cuando hay una
          // sola; con 2+ personas, respeta la que muestra el chip del stage.
          const people = rosterByCategory(song, category);
          if (personId && people.length > 1) selectPerson(personId);
        },
        pauseAutoscroll: () => {
          stageAutoscrollApi?.pauseAutoscroll();
          sectionPlayerApi?.pause();
        },
        onExit: resyncLayersFromStore,
      });
    }
  });

  // Title → links page
  container.querySelector('#song-title-link')?.addEventListener('click', () => {
    navigate(`/song/${songId}/links`);
  });

  // Album / lista navigation
  if (hasNav) {
    const listSuffix = listId ? `?lista=${listId}` : '';
    container.querySelector('#nav-prev')?.addEventListener('click', () => {
      if (adjacent.prev) {
        navigate(`/song/${adjacent.prev.item_id ?? adjacent.prev.id}${listSuffix}`);
      }
    });
    container.querySelector('#nav-next')?.addEventListener('click', () => {
      if (adjacent.next) {
        navigate(`/song/${adjacent.next.item_id ?? adjacent.next.id}${listSuffix}`);
      }
    });
  }

  // ── OptionsSheet (T4): menú de opciones unificado, todas las resoluciones ──
  container.querySelector('#open-options-sheet')?.addEventListener('click', () => {
    const syncTonoBubble = () => {
      const label = buildTransposeBubbleLabel(
        song.key,
        transposeSemitones,
        useFlats,
        getChordNotation(),
      );
      const el = document.querySelector('#osheet-tono');
      if (el) {
        el.textContent = label;
        el.setAttribute('aria-label', `Tono: ${label}. Toca para restablecer al original.`);
      }
    };
    openOptionsSheet({
      showTono: hasChords,
      tonoLabel: buildTransposeBubbleLabel(
        song.key,
        transposeSemitones,
        useFlats,
        getChordNotation(),
      ),
      useFlats,
      notation: getChordNotation(),
      fontLabel: fontSize.toFixed(2),
      autoscrollLabel: document.querySelector('#autoscroll-speed-label')?.textContent || '',
      onTranspose: (dir) => {
        transposeSemitones = normalizeSemitones(transposeSemitones + dir);
        refreshTransposeUI();
        syncTonoBubble();
        reRenderLyrics();
      },
      onResetTranspose: () => {
        if (transposeSemitones === 0) return;
        transposeSemitones = 0;
        refreshTransposeUI();
        syncTonoBubble();
        reRenderLyrics();
      },
      onToggleAccidental: () => {
        useFlats = !useFlats;
        refreshTransposeUI();
        syncTonoBubble();
        const accidentalBtn = document.querySelector('.osheet__accidental');
        if (accidentalBtn) accidentalBtn.textContent = useFlats ? '♭' : '♯';
        reRenderLyrics();
      },
      onNotationChange: (value) => {
        setChordNotation(value);
        refreshTransposeUI();
        syncTonoBubble();
        reRenderLyrics();
      },
      onFont: (dir) => {
        fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + dir * FONT_STEP));
        applyFontSize(fontSize);
        saveFontSize(fontSize);
        const of = document.querySelector('#osheet-font');
        if (of) of.textContent = fontSize.toFixed(2);
      },
      onAutoscroll: (dir) => {
        const btn = document.querySelector(dir === 1 ? '#autoscroll-faster' : '#autoscroll-slower');
        btn?.click();
        return document.querySelector('#autoscroll-speed-label')?.textContent || '';
      },
    });
  });

  // ── Feature 1: Autoscroll FAB ──
  stageAutoscrollApi = setupAutoscroll(container, song.id);

  // ── F5: Audio por sección — lazy, no bloquea el render principal. Se
  // monta solo si hay tracks; import dinámico para no engordar el bundle
  // de canciones sin audio (la mayoría, mientras se sube). ──
  if (songId) {
    let destroyed = false;
    // onRouteChange (no 'hashchange'): navigate(path, {replace:true}) usa
    // history.replaceState y NO dispara 'hashchange' (ver router.js), pero sí
    // pasa por resolve() — logout (AuthButton) y redirects de guardedRoute
    // dejaban el SectionPlayer vivo (audio sonando) tras salir de la canción.
    const destroySectionPlayer = () => {
      destroyed = true;
      sectionPlayerApi?.destroy();
      sectionPlayerApi = null;
      // Task 4: retira la clase de apilado del FAB de autoscroll junto con el
      // widget — inofensivo si nunca llegó a montarse (tracks vacíos).
      document.body.classList.remove('section-player-open');
      unsubscribeRouteChange();
    };
    const unsubscribeRouteChange = onRouteChange(destroySectionPlayer);
    (async () => {
      const { fetchSectionAudio } = await import('../lib/sectionAudioApi.js');
      const tracks = await fetchSectionAudio(songId);
      if (destroyed || tracks.length === 0) return;
      const { createSectionPlayer } = await import('./SectionPlayer.js');
      const sv = container.querySelector('.song-view');
      if (destroyed || !sv) return;
      sectionPlayerApi = createSectionPlayer({
        song,
        tracks,
        onSectionFocus: highlightPlayingSection,
        refetch: () => fetchSectionAudio(songId),
      });
      sv.appendChild(sectionPlayerApi.el);
      document.body.classList.add('section-player-open');
      sectionsWithAudio = new Set(tracks.map((t) => t.sectionIndex));
      reRenderLyrics();
    })();
  }

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
 * Nota objetivo de la voz activa en formato científico crudo ("F#3"), ya
 * transpuesta pero SIN pasar por `displayNote` — la usa el afinador flotante,
 * que necesita el formato parseable por `noteToMidi`, no el de presentación.
 * @param {object} song @param {string} category
 * @param {{ transposeSemitones?: number, useFlats?: boolean }} [opts]
 * @returns {string|null}
 */
function heroChipTargetNote(song, category, opts = {}) {
  const { transposeSemitones = 0, useFlats = false } = opts;
  const voice = rosterByCategory(song, category)[0];
  if (!voice) return null;
  const raw = firstNoteForVoice(song, voice.id);
  if (!raw) return null;
  return transposeSemitones ? transposeNote(raw, transposeSemitones, useFlats) : raw;
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
          <span class="voice-panel__label" id="voice-panel-label">${icon('mic', { size: 13 })} Voz</span>
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
 * @param {{ viewMode?: 'lyrics'|'chords'|'tono'|'mixed', transposeSemitones?: number,
 *           useFlats?: boolean, activeVoiceId?: string|null,
 *           activeCategory?: string|null,
 *           chordsVoiceId?: string|null,
 *           chordsCategory?: string|null,
 *           notation?: 'anglo'|'latin',
 *           sectionsWithAudio?: Set<number>|null }} [opts]
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
    notation = 'anglo',
    sectionsWithAudio = null,
  } = opts;
  // 'mixed' (T3, toolbar de capas): capas Acordes+Tono encendidas a la vez —
  // no exclusivo con 'chords'. Reusa el mismo riel de 3 pistas de la vista
  // combinada (Acordes + Voz), con o sin voz elegida en el panel.
  const showChords = viewMode === 'chords' || viewMode === 'mixed';
  const showMixed = viewMode === 'mixed';
  const colorClass = activeCategory ? `voice-text--${activeCategory}` : '';
  const mixColorClass = chordsCategory ? `voice-text--${chordsCategory}` : '';

  return (sections || [])
    .map(
      (section, sectionIndex) => `
    <div class="lyrics__section lyrics__section--${normalizeSectionType(section.type)}" data-section-index="${sectionIndex}"${
      typeof section.speedPreset === 'number' ? ` data-speed-preset="${section.speedPreset}"` : ''
    }>
      <div class="lyrics__section-label">
        ${
          sectionsWithAudio?.has(sectionIndex)
            ? `<button class="lyrics__section-play" type="button" data-section-audio="${sectionIndex}" aria-label="Reproducir sección">${icon('play', { size: 12 })}</button>`
            : ''
        }
        <span class="lyrics__section-label-text">${escapeHtml(section.label)}</span>
      </div>
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
            const inner = buildTonoLineHTML(line, activeVoiceId, colorClass, { notation });
            return `<p class="lyrics__line lyrics__line--tono">${inner}</p>`;
          }

          // ── Combinada (Acordes + Voz, o capa Acordes+Tono ambas on): 3 rieles
          //    estrictos. Sin voz elegida los rieles de nota quedan vacíos. ──
          if ((showChords && chordsVoiceId) || showMixed) {
            if (text.trim() === '') return `<p class="lyrics__line">&nbsp;</p>`;
            const inner = buildMixedLineHTML(
              line,
              line.chords || [],
              chordsVoiceId,
              mixColorClass,
              {
                transposeSemitones,
                useFlats,
                notation,
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
            const inner = buildChordsLineHTML(text, line.chords, {
              transposeSemitones,
              useFlats,
              notation,
            });
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

const PLAY_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>`;
const PAUSE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`;

/**
 * Monta el FAB de autoscroll clásico y su motor rAF de scroll continuo.
 * @param {HTMLElement} _container
 * @param {string} songId
 * @returns {{ pauseAutoscroll: () => void }} API mínima para consumidores
 *   externos (ImmersiveView la usa para detener el motor al entrar al escenario).
 */
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

  return { pauseAutoscroll: stopScroll };
}
