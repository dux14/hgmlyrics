// src/components/songRow.js
/**
 * songRow.js — fila compacta de canción reutilizable (home + listas).
 * Devuelve HTML string; el binding de eventos lo hace el consumidor.
 */
import { COVER_PLACEHOLDER } from '../lib/icons.js';
import { escapeHtml } from '../lib/escape.js';

/** Resuelve la URL de portada (absoluta/http tal cual; nombre suelto → /covers/). */
export function resolveCoverUrl(song) {
  const c = song?.coverImage || '';
  return c.startsWith('/') || c.startsWith('http') ? c : `/covers/${c}`;
}

/** Clase + label del badge de voz. */
export function voiceBadge(song) {
  if (song?.voiceType === 'male') return { class: 'voice-badge--male', label: 'Masculina' };
  if (song?.voiceType === 'female') return { class: 'voice-badge--female', label: 'Femenina' };
  return { class: 'voice-badge--mixed', label: 'Mixta' };
}

/**
 * Fila compacta: [grip] [índice] portada · título · álbum · badge · [acciones].
 * @param {object} song - forma de /api/songs
 * @param {{index?:number, actions?:string, dragHandle?:boolean}} [opts]
 * @returns {string} HTML
 */
export function songRowCompact(song, { index, actions, dragHandle } = {}) {
  const cover = resolveCoverUrl(song);
  const vb = voiceBadge(song);
  const albumLine = [song.album, song.year].filter(Boolean).join(' · ');
  return `
    <div class="song-row-compact" data-song-id="${escapeHtml(song.id)}">
      ${dragHandle ? '<span class="song-row-compact__grip"><i></i><i></i><i></i></span>' : ''}
      ${index !== null && index !== undefined ? `<span class="song-row-compact__index">${index}</span>` : ''}
      <img class="song-row-compact__cover" src="${cover}" alt="" width="56" height="56" loading="lazy" decoding="async" onerror="this.src='${COVER_PLACEHOLDER}'" />
      <div class="song-row-compact__info">
        <span class="song-row-compact__title">${escapeHtml(song.title)}</span>
        <span class="song-row-compact__album">${escapeHtml(albumLine)}</span>
      </div>
      <span class="voice-badge ${vb.class}">${vb.label}</span>
      ${actions ? `<div class="song-row-compact__actions">${actions}</div>` : ''}
    </div>
  `;
}
