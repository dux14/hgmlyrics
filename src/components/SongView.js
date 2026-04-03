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

// F6: Transposition
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NORMALIZE = { 'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B' };

function getFontSize() {
  try {
    const stored = localStorage.getItem(FONT_SIZE_KEY);
    if (stored) {
      const val = Number.parseFloat(stored);
      if (val >= FONT_MIN && val <= FONT_MAX) return val;
    }
  } catch (_e) { /* ignore */ }
  return 1.25;
}

function saveFontSize(size) {
  try { localStorage.setItem(FONT_SIZE_KEY, size.toString()); }
  catch (_e) { /* ignore */ }
}

function songHasChords(song) {
  if (!song.sections) return false;
  return song.sections.some(s => s.lines.some(l => l.chords && l.chords.length > 0));
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
    if (section.voices) section.voices.forEach(v => used.add(v));
    for (const line of section.lines) {
      if (line.voices) line.voices.forEach(v => used.add(v));
      if (line.voiceRanges) {
        line.voiceRanges.forEach(r => {
          if (r.voices) r.voices.forEach(v => used.add(v));
        });
      }
    }
  }
  return used;
}

/**
 * Render the song view
 */
export async function renderSongView(container, songId) {
  let song = getSongById(songId);

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

  const coverUrl = song.coverImage.startsWith('/') || song.coverImage.startsWith('http')
    ? song.coverImage
    : `/covers/${song.coverImage}`;

  const adjacent = getAdjacentSongs(songId);
  const hasNav = adjacent.prev || adjacent.next;
  const hasChords = songHasChords(song);
  const usedVoices = detectUsedVoices(song.sections);

  // Build voice filter chips — only show voices that exist in the song
  const voiceChipsHtml = VOICE_TYPES
    .filter(v => usedVoices.has(v.id))
    .map(v => `
      <button class="voice-filter__chip" data-voice="${v.id}">
        <span class="voice-filter__dot" style="background: var(${v.cssColor})"></span>
        <span class="voice-filter__label-text">${v.label}</span>
      </button>
    `).join('');

  container.innerHTML = `
    <div class="song-view fade-in">
      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="#/" id="breadcrumb-home">Inicio</a>
        <span class="breadcrumb__separator">›</span>
        <a href="#/" data-album="${song.albumSlug}" id="breadcrumb-album">${escapeHtml(song.album)}</a>
        <span class="breadcrumb__separator">›</span>
        <span class="breadcrumb__current">${escapeHtml(song.title)}</span>
      </nav>

      <!-- Song Header -->
      <div class="song-view__header">
        <img
          class="song-view__cover"
          src="${coverUrl}"
          alt="Portada de ${escapeHtml(song.album)}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%231a1a1a%22 width=%221%22 height=%221%22/><text x=%22.5%22 y=%22.6%22 text-anchor=%22middle%22 font-size=%22.3%22>🎵</text></svg>'"
        />
        <div class="song-view__meta">
          <h1 class="song-view__title">${escapeHtml(song.title)}</h1>
          <p class="song-view__album">${escapeHtml(song.artist)} — ${escapeHtml(song.album)}</p>
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

      <!-- Controls row -->
      <div class="song-view__controls" style="display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; margin-bottom: var(--space-md);">
        <!-- Font Controls -->
        <div class="font-controls" style="margin-bottom: 0;">
          <button class="font-controls__btn" id="font-decrease" aria-label="Reducir tamaño de letra">A−</button>
          <span class="font-controls__label" id="font-size-label">${fontSize.toFixed(2)}</span>
          <button class="font-controls__btn" id="font-increase" aria-label="Aumentar tamaño de letra">A+</button>
        </div>

        ${hasChords ? `
        <!-- Chord Toggle -->
        <div class="chord-toggle" id="chord-toggle" style="margin-bottom: 0;">
          <button class="chord-toggle__btn chord-toggle__btn--active" data-mode="lyrics">Letra</button>
          <button class="chord-toggle__btn" data-mode="chords">Acordes</button>
        </div>
        ` : ''}
      </div>

      ${hasChords ? `
      <!-- Transpose Controls — hidden until chords mode -->
      <div class="transpose-controls" id="transpose-controls" style="display: none;">
        <span class="transpose-label">🧪 Transposición (Beta)</span>
        <button class="transpose-btn" id="transpose-down">−½</button>
        <span class="transpose-value" id="transpose-value">0</span>
        <button class="transpose-btn" id="transpose-up">+½</button>
        <span class="filter-separator"></span>
        <button class="transpose-notation-toggle" id="notation-toggle">♯ / ♭</button>
      </div>
      ` : ''}

      <!-- Voice Part Filter — show only if there are voice-assigned lines -->
      ${usedVoices.size > 0 ? `
      <div class="voice-filter" id="voice-part-filter">
        <button class="voice-filter__chip voice-filter__chip--active" data-voice="all">
          <span class="voice-filter__label-text">Todos</span>
        </button>
        ${voiceChipsHtml}
      </div>
      ` : ''}

      <!-- Lyrics -->
      <div class="lyrics" id="lyrics-content">
        ${renderSections(song.sections, activeVoice, showChords, transposeSemitones, useFlats)}
      </div>

      ${hasNav ? `
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
      ` : ''}
    </div>
  `;

  // Helper to re-render lyrics
  function reRenderLyrics() {
    const lyricsEl = container.querySelector('#lyrics-content');
    if (lyricsEl) {
      lyricsEl.innerHTML = renderSections(song.sections, activeVoice, showChords, transposeSemitones, useFlats);
      applyFontSize(fontSize);
    }
  }

  applyFontSize(fontSize);

  // Font controls
  container.querySelector('#font-decrease').addEventListener('click', () => {
    fontSize = Math.max(FONT_MIN, fontSize - FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  container.querySelector('#font-increase').addEventListener('click', () => {
    fontSize = Math.min(FONT_MAX, fontSize + FONT_STEP);
    applyFontSize(fontSize);
    saveFontSize(fontSize);
    container.querySelector('#font-size-label').textContent = fontSize.toFixed(2);
  });

  // Breadcrumb
  container.querySelector('#breadcrumb-album').addEventListener('click', (e) => {
    e.preventDefault();
    filterByAlbum(song.albumSlug);
    navigate('/');
  });

  // Voice part filter
  container.querySelectorAll('.voice-filter__chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeVoice = btn.dataset.voice;
      container.querySelectorAll('.voice-filter__chip').forEach(c => {
        const isActive = c === btn;
        c.classList.toggle('voice-filter__chip--active', isActive);
        // Apply voice-specific color to the active chip
        if (isActive && btn.dataset.voice !== 'all') {
          const voiceData = VOICE_TYPES.find(v => v.id === btn.dataset.voice);
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

  // Chord toggle
  if (hasChords) {
    container.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        showChords = btn.dataset.mode === 'chords';
        container.querySelectorAll('.chord-toggle__btn').forEach(c =>
          c.classList.toggle('chord-toggle__btn--active', c === btn));
        const transposeEl = container.querySelector('#transpose-controls');
        if (transposeEl) transposeEl.style.display = showChords ? 'flex' : 'none';
        reRenderLyrics();
      });
    });

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
}

/**
 * Render lyrics sections with voice filter, highlighting, and optional chords
 */
function renderSections(sections, activeVoice = 'all', showChords = false, transposeSemitones = 0, useFlats = false) {
  return sections.map(section => `
    <div class="lyrics__section lyrics__section--${section.type}">
      <div class="lyrics__section-label">${escapeHtml(section.label)}</div>
      ${section.lines.map(line => {
        const voices = line.voices || [];
        const isForAll = voices.length === 0;
        const matchesFilter = activeVoice === 'all' || isForAll || voices.includes(activeVoice);

        // Check word-level ranges for filter match too
        const hasMatchingRange = line.voiceRanges?.some(r =>
          r.voices?.includes(activeVoice)
        );
        const effectiveMatch = matchesFilter || hasMatchingRange;

        // Determine color strategy
        let lineColor = '';
        let lineHighlightBg = '';

        if (effectiveMatch && activeVoice !== 'all') {
          lineHighlightBg = isForAll ? '' : getVoiceBgColor(activeVoice);
        }

        if (line.color) {
          // Legacy color support
          lineColor = line.color;
        } else if (voices.length === 1) {
          lineColor = getVoiceColor(voices[0]);
        } else if (voices.length > 1) {
          // Multi-voice: use first voice color
          lineColor = getVoiceColor(voices[0]);
        }

        const dimmedClass = effectiveMatch ? '' : 'lyrics__line--dimmed';
        const highlightClass = (effectiveMatch && activeVoice !== 'all' && !isForAll) ? 'lyrics__line--highlighted' : '';

        // Build line content — with word-level highlighting if present
        let lineContent;
        if (line.voiceRanges && line.voiceRanges.length > 0) {
          lineContent = buildHighlightedHTML(line.text, line.voiceRanges, voices);
        } else {
          lineContent = line.text.trim() === '' ? '&nbsp;' : escapeHtml(line.text);
        }

        const styleAttrs = [];
        if (lineColor && !(line.voiceRanges?.length > 0)) styleAttrs.push(`color: ${lineColor}`);
        if (lineHighlightBg) styleAttrs.push(`background: ${lineHighlightBg}`);
        const styleStr = styleAttrs.length > 0 ? ` style="${styleAttrs.join('; ')}"` : '';

        // Chord rendering
        if (showChords && line.chords?.length > 0) {
          const chordLine = buildChordPositionString(line.text, line.chords, transposeSemitones, useFlats);
          return `
            <div class="lyrics__chord-line ${dimmedClass} ${highlightClass}">
              <pre class="lyrics__chords">${escapeHtml(chordLine)}</pre>
              <p class="lyrics__line"${styleStr}>${lineContent}</p>
            </div>`;
        }

        return `<p class="lyrics__line ${dimmedClass} ${highlightClass}"${styleStr}>${lineContent}</p>`;
      }).join('')}
    </div>
  `).join('');
}

/**
 * Build chord position string
 */
function buildChordPositionString(text, chords, transposeSemitones = 0, useFlats = false) {
  const sorted = [...chords].sort((a, b) => a.pos - b.pos);
  let result = '';
  for (const { ch, pos } of sorted) {
    const transposed = transposeSemitones !== 0 ? transposeChord(ch, transposeSemitones, useFlats) : ch;
    while (result.length < pos) result += ' ';
    result += transposed;
  }
  return result;
}

/**
 * Transpose a chord by semitones
 */
function transposeChord(chord, semitones, useFlats) {
  return chord.replace(/^([A-G][#b]?)/, (_, root) => {
    const normalized = NORMALIZE[root] || root;
    const idx = NOTES_SHARP.indexOf(normalized);
    if (idx === -1) return root;
    const newIdx = ((idx + semitones) % 12 + 12) % 12;
    return useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
  });
}

/**
 * Apply font size to lyrics lines
 */
function applyFontSize(size) {
  const lyricsEl = document.querySelector('#lyrics-content');
  if (lyricsEl) {
    lyricsEl.querySelectorAll('.lyrics__line').forEach((line) => {
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
