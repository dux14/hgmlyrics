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
  VOICE_TYPES,
  getVoiceColor,
  getVoiceBgColor,
  buildHighlightedHTML,
} from '../lib/voiceSystem.js';

const FONT_SIZE_KEY = 'hkn-lyrics-font-size';
const FONT_STEP = 0.125; // rem
const FONT_MIN = 0.875;
const FONT_MAX = 2.5;

// Autoscroll config
const AUTOSCROLL_SPEED_KEY = 'hkn-autoscroll-speed';
const AUTOSCROLL_SPEED_MIN = 0.3;
const AUTOSCROLL_SPEED_MAX = 8.0;
const AUTOSCROLL_SPEED_STEP = 0.3;
const AUTOSCROLL_SPEED_DEFAULT = 1.0;
const AUTOSCROLL_BASE_PX_PER_FRAME = 0.6;

// F6: Transposition
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NORMALIZE = { Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B' };

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
  return song.sections.some((s) => s.lines.some((l) => l.chords && l.chords.length > 0));
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
 * Detect which voices are used in the song
 */
function detectUsedVoices(sections) {
  const used = new Set();
  for (const section of sections) {
    if (section.voices) section.voices.forEach((v) => used.add(v));
    for (const line of section.lines) {
      if (line.voices) line.voices.forEach((v) => used.add(v));
      if (line.voiceRanges) {
        line.voiceRanges.forEach((r) => {
          if (r.voices) r.voices.forEach((v) => used.add(v));
        });
      }
    }
  }
  return used;
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
          <div class="empty-state__icon">⏳</div>
          <h2 class="empty-state__title">Cargando...</h2>
        </div>
      `;
      const detail = await fetchSongDetail(songId);
      if (detail) song = detail;
    }
  }

  if (!song) {
    container.innerHTML = `
      <div class="empty-state fade-in">
        <div class="empty-state__icon">😕</div>
        <h2 class="empty-state__title">Canción no encontrada</h2>
        <p class="empty-state__text">La canción que buscas no existe o fue eliminada.</p>
        <button class="btn btn--primary" style="margin-top: 1rem;" id="go-home-btn">Volver al inicio</button>
      </div>
    `;
    container.querySelector('#go-home-btn')?.addEventListener('click', () => navigate('/'));
    return;
  }

  let fontSize = getFontSize();
  let activeVoice = 'all';
  let showChords = false;
  let transposeSemitones = 0;
  let useFlats = false;

  const voiceBadgeClass = getVoiceBadgeClass(song.voiceType);
  const voiceLabel = getVoiceTypeLabel(song.voiceType);

  const coverUrl = song.coverImage
    ? song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
      ? song.coverImage
      : `/covers/${song.coverImage}`
    : '';

  const adjacent = isPreview
    ? { prev: null, next: null, currentIndex: 0, total: 0 }
    : getAdjacentSongs(songId);
  const hasNav = !isPreview && (adjacent.prev || adjacent.next);
  const hasChords = songHasChords(song);
  const usedVoices = detectUsedVoices(song.sections || []);

  // Build voice filter chips — only show voices that exist in the song
  const voiceChipsHtml = VOICE_TYPES.filter((v) => usedVoices.has(v.id))
    .map(
      (v) => `
      <button class="voice-filter__chip" data-voice="${v.id}">
        <span class="voice-filter__dot" style="background: var(${v.cssColor})"></span>
        <span class="voice-filter__label-text">${v.label}</span>
      </button>
    `,
    )
    .join('');

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
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%231a1a1a%22 width=%221%22 height=%221%22/><text x=%22.5%22 y=%22.6%22 text-anchor=%22middle%22 font-size=%22.3%22>🎵</text></svg>'"
        />
        `
            : ''
        }
        <div class="song-view__meta">
          <h1 class="song-view__title">${escapeHtml(song.title || 'Sin título')}</h1>
          <p class="song-view__album">${escapeHtml(song.artist || '')} — ${escapeHtml(song.album || '')}</p>
          <p class="song-view__year">${song.year || ''} · ${song.genre || ''}</p>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
            <span class="voice-badge ${voiceBadgeClass}">${voiceLabel}</span>
            <div class="voice-bar" style="width: 80px;">
              <div class="voice-bar__male" style="width: ${song.voicePercent?.male ?? 50}%"></div>
              <div class="voice-bar__female" style="width: ${100 - (song.voicePercent?.male ?? 50)}%"></div>
            </div>
            <span style="font-size: 0.75rem; color: var(--color-text-secondary);">
              H ${song.voicePercent?.male ?? 0}% / M ${100 - (song.voicePercent?.male ?? 0)}%
            </span>
          </div>
        </div>
      </div>

      ${
        !isPreview
          ? `
      <!-- Controls row -->
      <div class="song-view__controls" style="display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; margin-bottom: var(--space-md);">
        <!-- Font Controls -->
        <div class="font-controls" style="margin-bottom: 0;">
          <button class="font-controls__btn" id="font-decrease" aria-label="Reducir tamaño de letra">A−</button>
          <span class="font-controls__label" id="font-size-label">${fontSize.toFixed(2)}</span>
          <button class="font-controls__btn" id="font-increase" aria-label="Aumentar tamaño de letra">A+</button>
        </div>

        ${
          hasChords
            ? `
        <!-- Chord Toggle -->
        <div class="chord-toggle" id="chord-toggle" style="margin-bottom: 0;">
          <button class="chord-toggle__btn chord-toggle__btn--active" data-mode="lyrics">Letra</button>
          <button class="chord-toggle__btn" data-mode="chords">Acordes</button>
        </div>
        `
            : ''
        }

        ${
          song.cejilla && song.cejilla > 0
            ? `
        <div class="cejilla-badge" title="Colocar cejilla en el traste ${song.cejilla}">
          <span class="cejilla-badge__icon">🎸</span>
          <span class="cejilla-badge__text">Cejilla: ${song.cejilla}</span>
        </div>
        `
            : ''
        }
      </div>

      ${
        hasChords
          ? `
      <!-- Transpose Controls — hidden until chords mode -->
      <div class="transpose-controls" id="transpose-controls" style="display: none;">
        <span class="transpose-label">🧪 Transposición (Beta)</span>
        <button class="transpose-btn" id="transpose-down">−½</button>
        <span class="transpose-value" id="transpose-value">0</span>
        <button class="transpose-btn" id="transpose-up">+½</button>
        <span class="filter-separator"></span>
        <button class="transpose-notation-toggle" id="notation-toggle">♯ / ♭</button>
      </div>
      `
          : ''
      }

      <!-- Voice Part Filter — show only if there are voice-assigned lines -->
      ${
        usedVoices.size > 0
          ? `
      <div class="voice-filter" id="voice-part-filter">
        <button class="voice-filter__chip voice-filter__chip--active" data-voice="all">
          <span class="voice-filter__label-text">Todos</span>
        </button>
        ${voiceChipsHtml}
      </div>
      `
          : ''
      }
      `
          : `
      ${
        hasChords
          ? `
      <!-- Chord Toggle (Preview mode) -->
      <div style="margin-bottom: var(--space-md);">
        <div class="chord-toggle" id="chord-toggle" style="margin-bottom: 0;">
          <button class="chord-toggle__btn chord-toggle__btn--active" data-mode="lyrics">Letra</button>
          <button class="chord-toggle__btn" data-mode="chords">Acordes</button>
        </div>
      </div>
      `
          : ''
      }
      `
      }

      <!-- Lyrics -->
      <div class="lyrics" id="lyrics-content">
        ${renderSections(song.sections || [], activeVoice, showChords, transposeSemitones, useFlats)}
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
        <span class="song-nav__info">${adjacent.currentIndex + 1} / ${adjacent.total}</span>
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
      lyricsEl.innerHTML = renderSections(
        song.sections || [],
        activeVoice,
        showChords,
        transposeSemitones,
        useFlats,
      );
      if (!isPreview) applyFontSize(fontSize);
    }
  }

  if (!isPreview) applyFontSize(fontSize);

  // Chord toggle — works in both normal and preview mode
  if (hasChords) {
    container.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showChords = btn.dataset.mode === 'chords';
        container
          .querySelectorAll('.chord-toggle__btn')
          .forEach((c) => c.classList.toggle('chord-toggle__btn--active', c === btn));
        const transposeEl = container.querySelector('#transpose-controls');
        if (transposeEl) transposeEl.style.display = showChords ? 'flex' : 'none';
        reRenderLyrics();
      });
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

  // Breadcrumb
  container.querySelector('#breadcrumb-album')?.addEventListener('click', (e) => {
    e.preventDefault();
    filterByAlbum(song.albumSlug);
    navigate('/');
  });

  // Voice part filter
  container.querySelectorAll('.voice-filter__chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeVoice = btn.dataset.voice;
      container.querySelectorAll('.voice-filter__chip').forEach((c) => {
        const isActive = c === btn;
        c.classList.toggle('voice-filter__chip--active', isActive);
        // Apply voice-specific color to the active chip
        if (isActive && btn.dataset.voice !== 'all') {
          const voiceData = VOICE_TYPES.find((v) => v.id === btn.dataset.voice);
          if (voiceData) {
            c.style.background = getVoiceBgColor(voiceData.id);
            c.style.color = getVoiceColor(voiceData.id);
            c.style.borderColor = getVoiceColor(voiceData.id);
          }
        } else {
          c.style.background = '';
          c.style.color = '';
          c.style.borderColor = '';
        }
      });
      reRenderLyrics();
    });
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

  // Album navigation
  if (hasNav) {
    container.querySelector('#nav-prev')?.addEventListener('click', () => {
      if (adjacent.prev) navigate(`/song/${adjacent.prev.id}`);
    });
    container.querySelector('#nav-next')?.addEventListener('click', () => {
      if (adjacent.next) navigate(`/song/${adjacent.next.id}`);
    });
  }

  // ── Feature 1: Autoscroll FAB ──
  setupAutoscroll(container);
}

/**
 * Render lyrics sections with voice filter, highlighting, and optional chords
 */
function renderSections(
  sections,
  activeVoice = 'all',
  showChords = false,
  transposeSemitones = 0,
  useFlats = false,
) {
  return sections
    .map(
      (section) => `
    <div class="lyrics__section lyrics__section--${section.type}">
      <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
      ${section.lines
        .map((line) => {
          const text = line.text || '';

          // ── Annotation / Timing guide detection ──
          if (line.annotation || isTimingGuide(text)) {
            const guide = parseTimingGuide(text);
            const guideContent = guide.count
              ? `<span class="timing-guide__count">${guide.count}</span><span class="timing-guide__unit">${guide.unit}</span>${guide.extra ? `<span class="timing-guide__extra">${escapeHtml(guide.extra)}</span>` : ''}`
              : `<span class="timing-guide__extra">${escapeHtml(guide.extra)}</span>`;
            return `<div class="timing-guide">${guideContent}</div>`;
          }

          // ── Empty lines ──
          if (text.trim() === '') {
            return showChords ? '' : `<p class="lyrics__line">&nbsp;</p>`;
          }

          const voices = line.voices || [];
          const isForAll = voices.length === 0;
          const matchesFilter = activeVoice === 'all' || isForAll || voices.includes(activeVoice);

          // Check word-level ranges for filter match too
          const hasMatchingRange = line.voiceRanges?.some((r) => r.voices?.includes(activeVoice));
          const effectiveMatch = matchesFilter || hasMatchingRange;

          // Determine color strategy
          let lineColor = '';
          let lineHighlightBg = '';

          if (effectiveMatch && activeVoice !== 'all') {
            lineHighlightBg = isForAll ? '' : getVoiceBgColor(activeVoice);
          }

          if (line.color) {
            lineColor = line.color;
          } else if (voices.length === 1) {
            lineColor = getVoiceColor(voices[0]);
          } else if (voices.length > 1) {
            lineColor = getVoiceColor(voices[0]);
          }

          const dimmedClass = effectiveMatch ? '' : 'lyrics__line--dimmed';
          const highlightClass =
            effectiveMatch && activeVoice !== 'all' && !isForAll ? 'lyrics__line--highlighted' : '';

          // ── Chord rendering: Inline Anchored (Propuesta A+B) ──
          if (showChords && line.chords?.length > 0) {
            const inlineHtml = buildInlineChordHTML(
              text,
              line.chords,
              transposeSemitones,
              useFlats,
            );
            const styleAttrs = [];
            if (lineHighlightBg) styleAttrs.push(`background: ${lineHighlightBg}`);
            const styleStr = styleAttrs.length > 0 ? ` style="${styleAttrs.join('; ')}"` : '';
            return `
            <div class="chord-line ${dimmedClass} ${highlightClass}"${styleStr}>
              ${inlineHtml}
            </div>`;
          }

          // ── Regular lyrics line (no chords) ──
          let lineContent;
          if (line.voiceRanges && line.voiceRanges.length > 0) {
            lineContent = buildHighlightedHTML(text, line.voiceRanges, voices);
          } else {
            lineContent = escapeHtml(text);
          }

          const styleAttrs = [];
          if (lineColor && !(line.voiceRanges?.length > 0)) styleAttrs.push(`color: ${lineColor}`);
          if (lineHighlightBg) styleAttrs.push(`background: ${lineHighlightBg}`);
          const styleStr = styleAttrs.length > 0 ? ` style="${styleAttrs.join('; ')}"` : '';

          // In chord mode, render lines without chords more subtly
          if (showChords) {
            return `<p class="lyrics__line lyrics__line--no-chord ${dimmedClass} ${highlightClass}"${styleStr}>${lineContent}</p>`;
          }

          return `<p class="lyrics__line ${dimmedClass} ${highlightClass}"${styleStr}>${lineContent}</p>`;
        })
        .join('')}
    </div>
  `,
    )
    .join('');
}

/**
 * Build inline chord HTML — each chord is anchored to its text segment
 * Creates chord-lyric pairs that are immune to font-size changes
 */
function buildInlineChordHTML(text, chords, transposeSemitones = 0, useFlats = false) {
  const sorted = [...chords].sort((a, b) => (a.pos || 0) - (b.pos || 0));
  const segments = [];
  let lastPos = 0;

  for (const { ch, pos } of sorted) {
    const chordPos = Math.min(pos || 0, text.length);
    const transposed =
      transposeSemitones !== 0 ? transposeChord(ch, transposeSemitones, useFlats) : ch;

    // Text before this chord (no chord above it)
    if (chordPos > lastPos) {
      const beforeText = text.slice(lastPos, chordPos);
      segments.push({ chord: null, text: beforeText });
    }

    // This chord's segment — find the end (next chord pos or end of text)
    const nextIdx = sorted.findIndex((c) => (c.pos || 0) > chordPos);
    const nextChordPos = nextIdx !== -1 ? sorted[nextIdx].pos || text.length : text.length;
    const segmentText = text.slice(chordPos, nextChordPos);
    segments.push({ chord: transposed, text: segmentText });
    lastPos = nextChordPos;
  }

  // Remaining text after last chord
  if (lastPos < text.length) {
    segments.push({ chord: null, text: text.slice(lastPos) });
  }

  return segments
    .map((seg) => {
      if (seg.chord) {
        return `<span class="chord-pair">
        <span class="chord-badge">${escapeHtml(seg.chord)}</span>
        <span class="chord-text">${escapeHtml(seg.text)}</span>
      </span>`;
      }
      return `<span class="chord-pair chord-pair--empty">
      <span class="chord-badge">&nbsp;</span>
      <span class="chord-text">${escapeHtml(seg.text)}</span>
    </span>`;
    })
    .join('');
}

/**
 * Transpose a chord by semitones
 */
function transposeChord(chord, semitones, useFlats) {
  return chord.replace(/^([A-G][#b]?)/, (_, root) => {
    const normalized = NORMALIZE[root] || root;
    const idx = NOTES_SHARP.indexOf(normalized);
    if (idx === -1) return root;
    const newIdx = (((idx + semitones) % 12) + 12) % 12;
    return useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
  });
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

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ─── Feature 1: Autoscroll ─── */

function getAutoscrollSpeed() {
  try {
    const stored = localStorage.getItem(AUTOSCROLL_SPEED_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= AUTOSCROLL_SPEED_MIN && val <= AUTOSCROLL_SPEED_MAX) return val;
    }
  } catch (_e) {
    /* ignore */
  }
  return AUTOSCROLL_SPEED_DEFAULT;
}

function saveAutoscrollSpeed(speed) {
  try {
    localStorage.setItem(AUTOSCROLL_SPEED_KEY, speed.toString());
  } catch (_e) {
    /* ignore */
  }
}

function setupAutoscroll(_container) {
  let scrollSpeed = getAutoscrollSpeed();
  let isScrolling = false;
  let rafId = null;
  let ignoreScrollUntil = 0; // Debounce: ignore scroll events briefly after starting

  // Inject FAB
  const fab = document.createElement('div');
  fab.className = 'autoscroll-fab';
  fab.innerHTML = `
    <button class="autoscroll-fab__btn autoscroll-fab__btn--main" id="autoscroll-toggle" aria-label="Autoscroll play/pause" title="Autoscroll">
      <span class="autoscroll-fab__icon" id="autoscroll-icon">▶</span>
    </button>
    <div class="autoscroll-fab__controls" id="autoscroll-controls">
      <button class="autoscroll-fab__btn autoscroll-fab__btn--speed" id="autoscroll-slower" aria-label="Más lento" title="Más lento">−</button>
      <span class="autoscroll-fab__speed" id="autoscroll-speed-label">${scrollSpeed.toFixed(1)}x</span>
      <button class="autoscroll-fab__btn autoscroll-fab__btn--speed" id="autoscroll-faster" aria-label="Más rápido" title="Más rápido">+</button>
    </div>
  `;
  document.body.appendChild(fab);

  const toggleBtn = fab.querySelector('#autoscroll-toggle');
  const iconEl = fab.querySelector('#autoscroll-icon');
  const controlsEl = fab.querySelector('#autoscroll-controls');
  const speedLabel = fab.querySelector('#autoscroll-speed-label');

  function updateSpeedLabel() {
    speedLabel.textContent = `${scrollSpeed.toFixed(1)}x`;
  }

  function startScroll() {
    isScrolling = true;
    // Ignore touch/wheel events for 500ms after starting to prevent false-positive pause
    ignoreScrollUntil = Date.now() + 500;
    iconEl.textContent = '⏸';
    toggleBtn.classList.add('autoscroll-fab__btn--active');
    controlsEl.classList.add('autoscroll-fab__controls--visible');

    // Disable CSS smooth scroll — Safari iOS ignores programmatic scroll when it’s active
    document.documentElement.style.scrollBehavior = 'auto';

    let lastTime = performance.now();
    let accumulated = 0; // Sub-pixel accumulator (Safari truncates fractional scrollTop)

    function step(now) {
      if (!isScrolling) return;
      const delta = now - lastTime;
      lastTime = now;
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
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    iconEl.textContent = '▶';
    toggleBtn.classList.remove('autoscroll-fab__btn--active');
    // Restore CSS smooth scroll
    document.documentElement.style.scrollBehavior = '';
  }

  // Toggle play/pause
  toggleBtn.addEventListener('click', () => {
    if (isScrolling) {
      stopScroll();
    } else {
      startScroll();
    }
  });

  // Speed controls
  fab.querySelector('#autoscroll-slower').addEventListener('click', (e) => {
    e.stopPropagation();
    scrollSpeed = Math.max(AUTOSCROLL_SPEED_MIN, scrollSpeed - AUTOSCROLL_SPEED_STEP);
    scrollSpeed = Math.round(scrollSpeed * 10) / 10;
    saveAutoscrollSpeed(scrollSpeed);
    updateSpeedLabel();
  });

  fab.querySelector('#autoscroll-faster').addEventListener('click', (e) => {
    e.stopPropagation();
    scrollSpeed = Math.min(AUTOSCROLL_SPEED_MAX, scrollSpeed + AUTOSCROLL_SPEED_STEP);
    scrollSpeed = Math.round(scrollSpeed * 10) / 10;
    saveAutoscrollSpeed(scrollSpeed);
    updateSpeedLabel();
  });

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
    fab.remove();
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
    window.removeEventListener('hashchange', cleanup);
  }
  window.addEventListener('hashchange', cleanup);
}
