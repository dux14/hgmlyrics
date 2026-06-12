/**
 * StudioPlayer.js — Reproductor propio del Estudio con scrubber de precisión.
 * Las funciones de tiempo/scrubber/lupa son puras y testeables; el factory
 * createStudioPlayer cablea un <audio> y no se testea en jsdom.
 */
import { icon } from '../lib/icons.js';

const MAG_WINDOW_S = 3; // lupa ±3 s
const LONGPRESS_MS = 400;

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Tiempo en formato m:ss.cs (centésimas). */
export function fmtTimeCs(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Tiempo en formato m:ss (sin centésimas, para el display principal). */
export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** ratio 0..1 → segundos, acotado a [0,duration]. */
export function posToTime(ratio, duration) {
  if (!(duration > 0)) return 0;
  return clamp(ratio, 0, 1) * duration;
}

/** segundos → ratio 0..1, acotado. */
export function timeToPos(time, duration) {
  if (!(duration > 0)) return 0;
  return clamp(time / duration, 0, 1);
}

/** Rango [start,end] de la lupa: ±windowS alrededor de time, acotado. */
export function magnifyRange(time, duration, windowS = MAG_WINDOW_S) {
  if (!(duration > 0)) return { start: 0, end: 0 };
  return { start: clamp(time - windowS, 0, duration), end: clamp(time + windowS, 0, duration) };
}

/** ratio 0..1 dentro de la lupa → segundos del rango. */
export function magnifyPosToTime(ratio, range) {
  return range.start + clamp(ratio, 0, 1) * (range.end - range.start);
}

/**
 * Crea un reproductor propio para una pista.
 * @param {{label:string, url:string}} opts
 * @returns {{ el: HTMLElement, audio: HTMLAudioElement }}
 */
export function createStudioPlayer({ label, url }) {
  const root = document.createElement('div');
  root.className = 'studio-player';
  root.innerHTML = `
    <span class="studio-player__label">${label}</span>
    <button class="studio-player__play" type="button" aria-label="Reproducir ${label}">${icon('play', { size: 16 })}</button>
    <div class="studio-player__bar" role="slider" tabindex="0"
         aria-label="Buscar en ${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="studio-player__fill"></div>
      <div class="studio-player__thumb"></div>
      <div class="studio-player__mag" hidden aria-hidden="true">
        <div class="studio-player__mag-label">Lupa · ±${MAG_WINDOW_S} s</div>
        <div class="studio-player__mag-track"><span class="studio-player__mag-needle"></span></div>
        <div class="studio-player__mag-time">0:00.00</div>
      </div>
    </div>
    <span class="studio-player__time" aria-hidden="true">0:00 / 0:00</span>
    <audio preload="none" src="${url}"></audio>
    <a class="btn studio-player__dl" href="${url}" download aria-label="Descargar ${label}">${icon('download', { size: 16 })}</a>
  `;

  const audio = root.querySelector('audio');
  const playBtn = root.querySelector('.studio-player__play');
  const bar = root.querySelector('.studio-player__bar');
  const fill = root.querySelector('.studio-player__fill');
  const thumb = root.querySelector('.studio-player__thumb');
  const timeEl = root.querySelector('.studio-player__time');
  const mag = root.querySelector('.studio-player__mag');
  const magTrack = root.querySelector('.studio-player__mag-track');
  const needle = root.querySelector('.studio-player__mag-needle');
  const magTime = root.querySelector('.studio-player__mag-time');

  const dur = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

  const paint = () => {
    const pos = timeToPos(audio.currentTime, dur());
    fill.style.width = `${pos * 100}%`;
    thumb.style.left = `${pos * 100}%`;
    const total = Number.isFinite(audio.duration) ? fmtTime(audio.duration) : '0:00';
    timeEl.textContent = `${fmtTime(audio.currentTime)} / ${total}`;
    bar.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
  };
  const setPlayIcon = () => {
    playBtn.innerHTML = icon(audio.paused ? 'play' : 'pause', { size: 16 });
    playBtn.setAttribute('aria-label', `${audio.paused ? 'Reproducir' : 'Pausar'} ${label}`);
  };

  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('play', setPlayIcon);
  audio.addEventListener('pause', setPlayIcon);
  audio.addEventListener('ended', setPlayIcon);
  playBtn.addEventListener('click', () => {
    if (audio.paused) void audio.play();
    else audio.pause();
  });

  bar.addEventListener('keydown', (e) => {
    const d = dur();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (audio.paused) void audio.play();
      else audio.pause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      audio.currentTime = clamp(audio.currentTime + 1, 0, d);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      audio.currentTime = clamp(audio.currentTime - 1, 0, d);
    }
  });

  // Puntero: tap corto = seek; mantener oprimido = lupa de precisión.
  let pressTimer = null;
  let magOpen = false;
  let magRange = null;

  const ratioOf = (el, clientX) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  };
  const openMag = () => {
    magRange = magnifyRange(audio.currentTime, dur());
    magOpen = true;
    mag.hidden = false;
  };
  const closeMag = () => {
    magOpen = false;
    magRange = null;
    mag.hidden = true;
  };
  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  bar.addEventListener('pointerdown', (e) => {
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture not supported — no-op
    }
    pressTimer = setTimeout(openMag, LONGPRESS_MS);
  });
  bar.addEventListener('pointermove', (e) => {
    if (magOpen && magRange) {
      const ratio = ratioOf(magTrack, e.clientX);
      const t = magnifyPosToTime(ratio, magRange);
      audio.currentTime = t;
      needle.style.left = `${ratio * 100}%`;
      magTime.textContent = fmtTimeCs(t);
    } else if (pressTimer !== null) {
      // Arrastre grueso antes de abrir la lupa.
      audio.currentTime = posToTime(ratioOf(bar, e.clientX), dur());
    }
  });
  bar.addEventListener('pointerup', (e) => {
    clearPress();
    if (magOpen) {
      closeMag();
    } else {
      audio.currentTime = posToTime(ratioOf(bar, e.clientX), dur());
    }
    try {
      bar.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture not supported — no-op
    }
  });
  bar.addEventListener('pointercancel', () => {
    clearPress();
    closeMag();
  });

  return { el: root, audio };
}
