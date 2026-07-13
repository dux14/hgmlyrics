/**
 * SectionPlayer.js — Audio por sección en SongView: un manager compartido
 * (createSectionAudioManager) + un acordeón colapsado por sección
 * (createSectionAccordion), estilo del player inmersivo.
 *
 * Cada fila de song_section_audio es un mp3 POR SECCIÓN (no un archivo
 * continuo): un solo <audio preload="none"> cambia de src al cruzar de
 * sección. Reusa fmtTime de StudioPlayer.js (no monta StudioPlayer entero —
 * su UI es de pistas del Estudio, no de secciones).
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

const SCOPE_ORDER = [null, ...Object.keys(VOICE_SCOPE_LABELS)];

function scopeRank(scope) {
  const idx = SCOPE_ORDER.indexOf(scope);
  return idx === -1 ? SCOPE_ORDER.length : idx;
}

/**
 * Gestor de audio compartido, sin DOM: un solo <audio> interno que las
 * distintas UIs de sección (acordeón, full view) consumen por API en vez de
 * cada una crear/mutar su propio elemento.
 * @param {{
 *   tracks: Array<{id:string, sectionIndex:number, voiceScope:string|null, label:string|null, durationSec:number|null, url:string}>,
 *   refetch?: () => Promise<Array>,
 * }} opts
 */
export function createSectionAudioManager({ tracks: initialTracks, refetch }) {
  let tracks = initialTracks;
  let currentTrack = null;
  let destroyed = false;
  const retriedIds = new Set();
  const timeCallbacks = new Set();
  const endedCallbacks = new Set();

  const audio = document.createElement('audio');
  audio.preload = 'none';
  // crossOrigin antes del src: sin esto la respuesta cors del SW (song-audio-v2)
  // llega opaca al <audio> y la reproducción falla con MEDIA_ELEMENT_ERROR (4).
  audio.crossOrigin = 'anonymous';

  function warnPlayRejected(e) {
    console.warn('No se pudo iniciar la reproducción de la sección', e);
  }

  function emitTime() {
    timeCallbacks.forEach((cb) => cb(audio.currentTime));
  }

  function emitEnded() {
    endedCallbacks.forEach((cb) => cb());
  }

  async function handleAudioError() {
    if (destroyed) return;
    const track = currentTrack;
    if (!track) return;
    const notifyFail = async () => {
      const { showToast } = await import('../lib/toast.js');
      if (destroyed) return;
      showToast('No se pudo reproducir el audio de esta sección', { type: 'error' });
    };
    if (!refetch || retriedIds.has(track.id)) {
      // Sin refetch disponible o ya se reintentó: avisar en vez de fallar mudo.
      await notifyFail();
      return;
    }
    retriedIds.add(track.id);
    try {
      const fresh = await refetch();
      if (destroyed) return;
      if (!Array.isArray(fresh) || fresh.length === 0) {
        await notifyFail();
        return;
      }
      tracks = fresh;
      const refreshed = tracks.find((t) => t.id === track.id);
      if (!refreshed) {
        await notifyFail();
        return;
      }
      const sanitized = safeUrl(refreshed.url);
      if (!sanitized) {
        await notifyFail();
        return;
      }
      currentTrack = refreshed;
      audio.src = sanitized;
      audio.play().catch(warnPlayRejected);
    } catch {
      // Re-fetch también falló (sin red o backend caído).
      if (destroyed) return;
      await notifyFail();
    }
  }

  audio.addEventListener('timeupdate', emitTime);
  audio.addEventListener('loadedmetadata', emitTime);
  audio.addEventListener('ended', emitEnded);
  audio.addEventListener('error', handleAudioError);

  function load(track, { preload = 'metadata' } = {}) {
    if (currentTrack && currentTrack.id === track.id) return;
    const sanitized = safeUrl(track.url);
    if (!sanitized) return;
    audio.preload = preload;
    audio.src = sanitized;
    currentTrack = track;
  }

  return {
    audio,
    tracksFor(sectionIndex) {
      return tracks
        .filter((t) => t.sectionIndex === sectionIndex)
        .slice()
        .sort((a, b) => scopeRank(a.voiceScope) - scopeRank(b.voiceScope));
    },
    /** Track realmente cargado en el <audio> compartido ahora mismo (o null). Fuente
     * de verdad para que los consumidores (acordeón) sepan qué suena de verdad, en
     * vez de fiarse de su propio estado local que puede desincronizarse. */
    getCurrentTrack() {
      return currentTrack;
    },
    load,
    play(track) {
      load(track);
      audio.play().catch(warnPlayRejected);
    },
    pause() {
      audio.pause();
    },
    seek(seconds) {
      audio.currentTime = seconds;
    },
    onTime(cb) {
      timeCallbacks.add(cb);
      return () => timeCallbacks.delete(cb);
    },
    onEnded(cb) {
      endedCallbacks.add(cb);
      return () => endedCallbacks.delete(cb);
    },
    destroy() {
      destroyed = true;
      audio.pause();
      audio.removeEventListener('timeupdate', emitTime);
      audio.removeEventListener('loadedmetadata', emitTime);
      audio.removeEventListener('ended', emitEnded);
      audio.removeEventListener('error', handleAudioError);
      audio.removeAttribute('src');
      audio.load?.();
      timeCallbacks.clear();
      endedCallbacks.clear();
      currentTrack = null;
    },
  };
}

/**
 * Panel colapsable de audio de UNA sección, estilo del player inmersivo
 * (#imm-player en ImmersiveView/immersive.css): play circular + scrubber +
 * tiempos, con chips de voz si la sección tiene más de un scope. Consume un
 * `createSectionAudioManager` compartido (no crea su propio <audio>) — varias
 * instancias en la misma vista comparten un solo elemento de audio real.
 * @param {{
 *   manager: ReturnType<typeof createSectionAudioManager>,
 *   sectionIndex: number,
 *   tracks: Array<{id:string, sectionIndex:number, voiceScope:string|null, label:string|null, durationSec:number|null, url:string}>,
 *   initialTrackId?: string|null,
 * }} opts
 * @returns {{ el: HTMLElement, sectionIndex: number, getActiveTrackId: () => string|null, load: () => void, destroy: () => void }}
 */
export function createSectionAccordion({ manager, sectionIndex, tracks: sectionTracks, initialTrackId = null }) {
  const scopes = [...new Set(sectionTracks.map((t) => t.voiceScope))];
  // El track activo al crear el panel se elige en este orden: (1) lo que
  // REALMENTE suena/está cargado en el manager si pertenece a esta sección
  // (fuente de verdad — un rebuild de wireSectionPlayButtons no debe
  // "perder" lo que está sonando), (2) el que el llamador pide preservar
  // (scope elegido antes de un rebuild sin estar sonando), (3) el default
  // (mezcla u orden de scope).
  const currentManagerTrack = manager.getCurrentTrack();
  const playingHere =
    currentManagerTrack && sectionTracks.some((t) => t.id === currentManagerTrack.id)
      ? sectionTracks.find((t) => t.id === currentManagerTrack.id)
      : null;
  const preservedTrack = initialTrackId ? sectionTracks.find((t) => t.id === initialTrackId) : null;
  let activeTrack = playingHere || preservedTrack || sectionTracks[0] || null;
  let loaded = false;

  const root = document.createElement('div');
  root.className = 'section-audio';
  root.hidden = true;

  const chipsHtml =
    scopes.length > 1
      ? `<div class="section-audio__chips">${scopes
          .map((s) => {
            const value = s === null ? '' : escapeHtml(s);
            const active = s === activeTrack?.voiceScope;
            return `<button class="section-audio__chip${active ? ' section-audio__chip--active' : ''}" type="button" data-scope="${value}" aria-pressed="${active}">${escapeHtml(scopeLabel(s))}</button>`;
          })
          .join('')}</div>`
      : '';

  root.innerHTML = `
    ${chipsHtml}
    <div class="section-audio__player">
      <button class="section-audio__play" type="button" aria-label="Reproducir">${icon('play', { size: 16 })}</button>
      <span class="section-audio__time">0:00</span>
      <input class="section-audio__scrubber" type="range" min="0" max="100" value="0" step="0.1" aria-label="Progreso de la pista" />
      <span class="section-audio__time">0:00</span>
    </div>
  `;

  const playBtn = root.querySelector('.section-audio__play');
  const scrubberEl = root.querySelector('.section-audio__scrubber');
  const [elapsedEl, totalEl] = root.querySelectorAll('.section-audio__time');

  // Deriva del manager (fuente de verdad), no de un flag local — evita que el
  // panel "mienta" sobre qué suena si activeTrack se desincroniza del audio
  // real (cambio de chip, rebuild tras reRenderLyrics).
  function isCurrent() {
    const current = manager.getCurrentTrack();
    return !!current && !!activeTrack && current.id === activeTrack.id;
  }

  function paint() {
    const current = isCurrent();
    const duration = activeTrack?.durationSec || (current ? manager.audio.duration : 0) || 0;
    const elapsed = current ? manager.audio.currentTime || 0 : 0;
    elapsedEl.textContent = fmtTime(elapsed);
    totalEl.textContent = fmtTime(duration);
    scrubberEl.max = String(duration || 0);
    scrubberEl.value = String(elapsed);
    const playing = current && !manager.audio.paused;
    playBtn.innerHTML = icon(playing ? 'pause' : 'play', { size: 16 });
    playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  }

  function selectScope(scope) {
    const track = sectionTracks.find((t) => t.voiceScope === scope);
    if (!track || track === activeTrack) return;
    // El track saliente puede estar sonando de fondo: pausarlo evita dejarlo
    // audible sin ningún control visible una vez el panel muestra otro chip.
    if (isCurrent() && !manager.audio.paused) manager.pause();
    activeTrack = track;
    loaded = false;
    root.querySelectorAll('[data-scope]').forEach((btn) => {
      const active = (btn.dataset.scope || null) === scope;
      btn.classList.toggle('section-audio__chip--active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    paint();
  }

  root.querySelectorAll('[data-scope]').forEach((btn) => {
    btn.addEventListener('click', () => selectScope(btn.dataset.scope || null));
  });

  playBtn.addEventListener('click', () => {
    if (!activeTrack) return;
    if (isCurrent() && !manager.audio.paused) {
      manager.pause();
    } else {
      manager.play(activeTrack);
      loaded = true;
    }
  });

  scrubberEl.addEventListener('input', () => {
    if (!isCurrent()) return;
    manager.seek(Number(scrubberEl.value));
  });

  const offTime = manager.onTime(paint);
  const offEnded = manager.onEnded(paint);
  manager.audio.addEventListener('play', paint);
  manager.audio.addEventListener('pause', paint);

  paint();

  return {
    el: root,
    sectionIndex,
    /** id del track activo del panel — para preservarlo a través de un rebuild. */
    getActiveTrackId() {
      return activeTrack?.id ?? null;
    },
    /** Carga metadata (duración) sin reproducir — llamar al expandir el panel. */
    load() {
      if (loaded || !activeTrack) return;
      loaded = true;
      manager.load(activeTrack, { preload: 'metadata' });
    },
    destroy() {
      offTime();
      offEnded();
      manager.audio.removeEventListener('play', paint);
      manager.audio.removeEventListener('pause', paint);
      root.remove();
    },
  };
}
