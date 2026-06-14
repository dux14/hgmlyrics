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
 * Helper puro: devuelve el tiempo a aplicar al commit (pointerup).
 * Si scrubbing es true retorna previewTime; si no, retorna audioTime.
 * Normaliza no-finitos a 0.
 * @param {{ scrubbing: boolean, previewTime: number, audioTime: number }} state
 * @returns {number}
 */
export function commitPreview({ scrubbing, previewTime, audioTime }) {
  const t = scrubbing ? previewTime : audioTime;
  return Number.isFinite(t) && t >= 0 ? t : 0;
}

/**
 * Helper puro: devuelve el tiempo de audio real al cancelar un scrub.
 * Siempre ignora previewTime y devuelve audioTime, normalizado a 0 si no finito.
 * @param {{ audioTime: number }} state
 * @returns {number}
 */
export function cancelPreview({ audioTime }) {
  return Number.isFinite(audioTime) && audioTime >= 0 ? audioTime : 0;
}

/**
 * Crea un reproductor propio para una pista.
 * Layout Dirección A — Apilado claro:
 *   Mobile (<640px): dos renglones: [play][label][tiempo][descarga] + [scrubber full-width]
 *   Desktop (≥640px): una fila: [label][play][scrubber flex:1][tiempo][descarga]
 * Scrub diferido (commit-on-release): audio.currentTime solo se escribe en pointerup.
 * @param {{label:string, url:string}} opts
 * @returns {{ el: HTMLElement, audio: HTMLAudioElement }}
 */
export function createStudioPlayer({ label, url }) {
  const root = document.createElement('div');
  root.className = 'studio-player';
  root.innerHTML = `
    <div class="studio-player__row1">
      <button class="studio-player__play" type="button" aria-label="Reproducir ${label}">${icon('play', { size: 16 })}</button>
      <span class="studio-player__label">${label}</span>
      <span class="studio-player__time" aria-hidden="true">0:00 / 0:00</span>
      <a class="btn studio-player__dl" href="${url}" download aria-label="Descargar ${label}">${icon('download', { size: 16 })}</a>
    </div>
    <div class="studio-player__row2">
      <div class="studio-player__bar" role="slider" tabindex="0"
           aria-label="Buscar en ${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="studio-player__fill"></div>
        <div class="studio-player__thumb"></div>
        <div class="studio-player__preview-bubble" aria-hidden="true" hidden>0:00.00</div>
        <div class="studio-player__mag" hidden aria-hidden="true">
          <div class="studio-player__mag-label">Lupa · ±${MAG_WINDOW_S} s</div>
          <div class="studio-player__mag-track"><span class="studio-player__mag-needle"></span></div>
          <div class="studio-player__mag-time">0:00.00</div>
        </div>
      </div>
    </div>
    <audio preload="none" src="${url}"></audio>
  `;

  const audio = root.querySelector('audio');
  const playBtn = root.querySelector('.studio-player__play');
  const bar = root.querySelector('.studio-player__bar');
  const fill = root.querySelector('.studio-player__fill');
  const thumb = root.querySelector('.studio-player__thumb');
  const timeEl = root.querySelector('.studio-player__time');
  const previewBubble = root.querySelector('.studio-player__preview-bubble');
  const mag = root.querySelector('.studio-player__mag');
  const magTrack = root.querySelector('.studio-player__mag-track');
  const needle = root.querySelector('.studio-player__mag-needle');
  const magTime = root.querySelector('.studio-player__mag-time');

  const dur = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

  // --- Scrub state ---
  let scrubbing = false;
  let previewTime = 0; // visual preview; NOT written to audio until pointerup

  const paintAt = (time) => {
    const pos = timeToPos(time, dur());
    fill.style.width = `${pos * 100}%`;
    thumb.style.left = `${pos * 100}%`;
    const thumbPct = pos * 100;
    previewBubble.style.left = `${thumbPct}%`;
  };

  const paint = () => {
    if (scrubbing) return; // durante scrub, el visual lo controla pointermove
    paintAt(audio.currentTime);
    const total = Number.isFinite(audio.duration) ? fmtTime(audio.duration) : '0:00';
    timeEl.textContent = `${fmtTime(audio.currentTime)} / ${total}`;
    bar.setAttribute(
      'aria-valuenow',
      String(Math.round(timeToPos(audio.currentTime, dur()) * 100)),
    );
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
      // Teclas: seek inmediato (no es arrastre)
      audio.currentTime = clamp(audio.currentTime + 1, 0, d);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      audio.currentTime = clamp(audio.currentTime - 1, 0, d);
    }
  });

  // --- Puntero: tap/arrastre = scrub diferido; long-press = lupa ---
  let pressTimer = null;
  let magOpen = false;
  let magRange = null;

  const ratioOf = (el, clientX) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  };

  const openMag = () => {
    // La lupa se ancla al previewTime (no al audio en vivo)
    magRange = magnifyRange(previewTime, dur());
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

  /** Aplica el preview visual sin tocar audio.currentTime. */
  const applyPreviewVisual = (time) => {
    previewTime = clamp(time, 0, dur() || 0);
    paintAt(previewTime);
    previewBubble.textContent = fmtTimeCs(previewTime);
    // Actualizar el tiempo en timeEl durante scrub para que sea informativo
    const total = Number.isFinite(audio.duration) ? fmtTime(audio.duration) : '0:00';
    timeEl.textContent = `${fmtTime(previewTime)} / ${total}`;
    bar.setAttribute('aria-valuenow', String(Math.round(timeToPos(previewTime, dur()) * 100)));
  };

  /** Entra en modo scrubbing: muestra thumb escalado y burbuja de preview. */
  const enterScrub = (ratio) => {
    scrubbing = true;
    previewTime = posToTime(ratio, dur());
    thumb.classList.add('studio-player__thumb--grabbing');
    previewBubble.hidden = false;
    applyPreviewVisual(previewTime);
  };

  /** Confirma el scrub: escribe audio.currentTime SOLO aquí (commit-on-release). */
  const commitScrub = () => {
    if (!scrubbing) return;
    // --- ÚNICO LUGAR donde audio.currentTime se escribe desde el scrubber ---
    const t = commitPreview({ scrubbing: true, previewTime, audioTime: audio.currentTime });
    audio.currentTime = t;
    // Si estaba reproduciendo, continuar desde la nueva posición
    // (el audio mantiene su estado play/pause; el seek lo reanuda solo)
    exitScrub();
  };

  /** Sale del modo scrubbing sin commit (cancel o fin de lupa). */
  const exitScrub = () => {
    scrubbing = false;
    thumb.classList.remove('studio-player__thumb--grabbing');
    previewBubble.hidden = true;
    paint(); // repinta con la posición real del audio
  };

  bar.addEventListener('pointerdown', (e) => {
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture not supported — no-op
    }
    const ratio = ratioOf(bar, e.clientX);
    enterScrub(ratio);
    // Long-press → lupa; se ancla al previewTime actual
    pressTimer = setTimeout(openMag, LONGPRESS_MS);
  });

  bar.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    if (magOpen && magRange) {
      const ratio = ratioOf(magTrack, e.clientX);
      const t = magnifyPosToTime(ratio, magRange);
      needle.style.left = `${ratio * 100}%`;
      magTime.textContent = fmtTimeCs(t);
      // La lupa actualiza previewTime con precisión de centésimas — sin tocar audio
      applyPreviewVisual(t);
    } else {
      // Arrastre grueso: solo actualiza el visual (previewTime), NO audio.currentTime
      applyPreviewVisual(posToTime(ratioOf(bar, e.clientX), dur()));
    }
  });

  bar.addEventListener('pointerup', (e) => {
    clearPress();
    if (magOpen) {
      closeMag();
    }
    // Commit: escribe audio.currentTime = previewTime (única vez desde el scrubber)
    commitScrub();
    try {
      bar.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture not supported — no-op
    }
  });

  bar.addEventListener('pointercancel', () => {
    clearPress();
    closeMag();
    // Cancel: descarta previewTime, vuelve a la posición real sin commit
    scrubbing = false;
    thumb.classList.remove('studio-player__thumb--grabbing');
    previewBubble.hidden = true;
    // Restaura visual a la posición real del audio (sin tocar audio.currentTime)
    const t = cancelPreview({ audioTime: audio.currentTime });
    paintAt(t);
    const total = Number.isFinite(audio.duration) ? fmtTime(audio.duration) : '0:00';
    timeEl.textContent = `${fmtTime(audio.currentTime)} / ${total}`;
    bar.setAttribute(
      'aria-valuenow',
      String(Math.round(timeToPos(audio.currentTime, dur()) * 100)),
    );
  });

  return { el: root, audio };
}
