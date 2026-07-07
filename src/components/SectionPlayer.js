/**
 * SectionPlayer.js — Mini-reproductor de audio por sección en SongView.
 *
 * Cada fila de song_section_audio es un mp3 POR SECCIÓN (no un archivo
 * continuo): un solo <audio preload="none"> cambia de src al cruzar de
 * sección; el "tiempo total" mostrado es la suma de duraciones. Reusa
 * fmtTime de StudioPlayer.js (no monta StudioPlayer entero — su UI es de
 * pistas del Estudio, no de secciones).
 */
import { icon } from '../lib/icons.js';
import { safeUrl, escapeHtml } from '../lib/escape.js';
import { fmtTime } from './StudioPlayer.js';

const VOICE_SCOPE_LABELS = {
  soprano: 'Soprano',
  contralto: 'Contralto',
  tenor: 'Tenor',
  bass: 'Bajo',
  lead: 'Lead',
  backing: 'Coros',
};

function scopeLabel(scope) {
  return scope ? VOICE_SCOPE_LABELS[scope] || scope : 'Mezcla';
}

/**
 * @param {{
 *   song: object,
 *   tracks: Array<{id:string, sectionIndex:number, voiceScope:string|null, label:string|null, durationSec:number|null, url:string}>,
 *   onSectionFocus?: (sectionIndex: number|null) => void,
 *   refetch?: () => Promise<Array>,
 * }} opts
 * @returns {{ el: HTMLElement, destroy: () => void, pause: () => void }}
 */
export function createSectionPlayer({ song, tracks: initialTracks, onSectionFocus, refetch }) {
  let tracks = initialTracks;
  const scopes = [...new Set(tracks.map((t) => t.voiceScope))];
  // Mezcla (voiceScope null) es el default; si no hay mezcla, el primer scope presente.
  let activeScope = scopes.includes(null) ? null : scopes[0];
  let activeTracks = [];
  let currentIndex = -1;
  let looping = false;
  const retriedIds = new Set();

  const root = document.createElement('div');
  root.className = 'section-player';
  root.innerHTML = `
    <div class="section-player__scopes"></div>
    <div class="section-player__row">
      <button class="section-player__play" type="button" aria-label="Reproducir sección">${icon('play', { size: 18 })}</button>
      <div class="section-player__scrubber" role="group" aria-label="Secciones de ${escapeHtml(song?.title || 'la canción')}"></div>
      <span class="section-player__time" aria-hidden="true">0:00 / 0:00</span>
      <button class="section-player__loop" type="button" aria-pressed="false" aria-label="Repetir sección">${icon('rotate-ccw', { size: 16 })}</button>
    </div>
  `;

  const audio = document.createElement('audio');
  audio.preload = 'none';
  root.appendChild(audio);

  const scopesEl = root.querySelector('.section-player__scopes');
  const playBtn = root.querySelector('.section-player__play');
  const scrubberEl = root.querySelector('.section-player__scrubber');
  const timeEl = root.querySelector('.section-player__time');
  const loopBtn = root.querySelector('.section-player__loop');

  const totalDuration = () => activeTracks.reduce((sum, t) => sum + (t.durationSec || 0), 0);
  const elapsedBefore = (idx) => activeTracks.slice(0, idx).reduce((sum, t) => sum + (t.durationSec || 0), 0);

  function computeActiveTracks() {
    return tracks
      .filter((t) => t.voiceScope === activeScope)
      .slice()
      .sort((a, b) => a.sectionIndex - b.sectionIndex);
  }

  function renderScopeChips() {
    if (scopes.length <= 1) {
      scopesEl.innerHTML = '';
      scopesEl.hidden = true;
      return;
    }
    scopesEl.hidden = false;
    scopesEl.innerHTML = scopes
      .map((s) => {
        const value = s === null ? '' : escapeHtml(s);
        const active = s === activeScope;
        return `<button class="section-player__chip${active ? ' section-player__chip--active' : ''}" data-scope="${value}" aria-pressed="${active}">${escapeHtml(scopeLabel(s))}</button>`;
      })
      .join('');
    scopesEl.querySelectorAll('[data-scope]').forEach((btn) => {
      btn.addEventListener('click', () => selectScope(btn.dataset.scope || null));
    });
  }

  function renderSegments() {
    const total = totalDuration();
    const n = activeTracks.length;
    scrubberEl.innerHTML = activeTracks
      .map((t, i) => {
        const pct = total > 0 ? (t.durationSec / total) * 100 : 100 / n;
        const label = t.label || `Sección ${t.sectionIndex + 1}`;
        return `<button class="section-player__segment${i === currentIndex ? ' section-player__segment--playing' : ''}" data-index="${i}" style="width:${pct}%" aria-label="${escapeHtml(label)}"></button>`;
      })
      .join('');
    scrubberEl.querySelectorAll('[data-index]').forEach((btn) => {
      btn.addEventListener('click', () => jumpTo(Number(btn.dataset.index)));
    });
  }

  function setPlayIcon() {
    playBtn.innerHTML = icon(audio.paused ? 'play' : 'pause', { size: 18 });
    playBtn.setAttribute('aria-label', audio.paused ? 'Reproducir sección' : 'Pausar sección');
  }

  function paintTime() {
    const total = totalDuration();
    const elapsed = currentIndex >= 0 ? elapsedBefore(currentIndex) + (audio.currentTime || 0) : 0;
    timeEl.textContent = `${fmtTime(elapsed)} / ${fmtTime(total)}`;
  }

  function loadTrack(idx, { autoplay = false } = {}) {
    const track = activeTracks[idx];
    if (!track) return;
    currentIndex = idx;
    audio.src = safeUrl(track.url);
    renderSegments();
    paintTime();
    onSectionFocus?.(track.sectionIndex);
    if (autoplay) void audio.play();
  }

  async function handleAudioError() {
    const track = activeTracks[currentIndex];
    if (!track || !refetch || retriedIds.has(track.id)) return;
    retriedIds.add(track.id);
    try {
      const fresh = await refetch();
      if (!Array.isArray(fresh) || fresh.length === 0) return;
      tracks = fresh;
      activeTracks = computeActiveTracks();
      const refreshed = activeTracks.find((t) => t.id === track.id);
      if (!refreshed) return;
      currentIndex = activeTracks.indexOf(refreshed);
      audio.src = safeUrl(refreshed.url);
      renderSegments();
      void audio.play();
    } catch {
      // Re-fetch también falló: se queda sin reproducir esa sección.
    }
  }

  function jumpTo(idx) {
    loadTrack(idx, { autoplay: true });
  }

  function selectScope(scope) {
    if (scope === activeScope) return;
    audio.pause();
    audio.removeAttribute('src');
    activeScope = scope;
    currentIndex = -1;
    activeTracks = computeActiveTracks();
    renderScopeChips();
    renderSegments();
    paintTime();
    onSectionFocus?.(null);
  }

  audio.addEventListener('timeupdate', paintTime);
  audio.addEventListener('loadedmetadata', paintTime);
  audio.addEventListener('play', setPlayIcon);
  audio.addEventListener('pause', setPlayIcon);
  audio.addEventListener('error', handleAudioError);
  audio.addEventListener('ended', () => {
    if (looping) {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (currentIndex + 1 < activeTracks.length) {
      loadTrack(currentIndex + 1, { autoplay: true });
    } else {
      onSectionFocus?.(null);
      setPlayIcon();
    }
  });

  playBtn.addEventListener('click', () => {
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (currentIndex === -1) {
      loadTrack(0, { autoplay: true });
    } else {
      void audio.play();
    }
  });

  loopBtn.addEventListener('click', () => {
    looping = !looping;
    loopBtn.classList.toggle('section-player__loop--active', looping);
    loopBtn.setAttribute('aria-pressed', String(looping));
    loopBtn.setAttribute('aria-label', looping ? 'Repetir sección (activo)' : 'Repetir sección');
  });

  activeTracks = computeActiveTracks();
  renderScopeChips();
  renderSegments();
  paintTime();

  return {
    el: root,
    pause() {
      audio.pause();
    },
    /** Reproduce la sección `sectionIndex` (tap en su etiqueta en la letra). No-op si no tiene audio en el scope activo. */
    playSection(sectionIndex) {
      const idx = activeTracks.findIndex((t) => t.sectionIndex === sectionIndex);
      if (idx !== -1) jumpTo(idx);
    },
    destroy() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load?.();
      root.remove();
    },
  };
}
