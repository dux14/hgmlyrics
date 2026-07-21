/**
 * MultiTrackPlayer.js — Reproductor multipista sincronizado (D4b).
 * Suena varias pistas (stems) a la vez con transporte maestro, mute y solo
 * por pista. Componente autonomo, lo compone D4d (detalle de stems).
 *
 * Sincronía: un audio de referencia (la primera pista) actúa de reloj
 * maestro; en cada frame (rAF) las demás se realinean si se desvían más de
 * DRIFT_THRESHOLD_S (syncStep, pura y testeable sin rAF real).
 */
import { icon } from '../../lib/icons.js';
import { safeUrl } from '../../lib/escape.js';
import { fmtTime, clamp, timeToPos, posToTime } from '../StudioPlayer.js';
import '../../styles/pipeline.css';

const DRIFT_THRESHOLD_S = 0.04;

/**
 * Corrige el drift entre pistas: si el currentTime de una pista se desvía
 * de masterTime más del umbral, la realinea a masterTime.
 * @param {HTMLAudioElement[]} audios
 * @param {number} masterTime
 * @param {number} [threshold]
 * @returns {number} cantidad de pistas corregidas en este paso
 */
export function syncStep(audios, masterTime, threshold = DRIFT_THRESHOLD_S) {
  let corrected = 0;
  for (const audio of audios) {
    if (!audio) continue;
    if (Math.abs(audio.currentTime - masterTime) > threshold) {
      audio.currentTime = masterTime;
      corrected += 1;
    }
  }
  return corrected;
}

/**
 * Crea un reproductor multipista.
 * @param {{ tracks: Array<{kind:string, url:string, label?:string, durationSec?:number}> }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createMultiTrackPlayer({ tracks }) {
  const ac = new AbortController();
  const root = document.createElement('div');
  root.className = 'mtp';

  // Encabezado de grupo sutil: se inserta antes de la fila cuando `group`
  // cambia respecto de la fila anterior. Sin `group` en los tracks, no
  // aparece ninguno (lista plana, comportamiento previo intacto).
  let lastGroup = undefined;
  const rowsHtml = tracks
    .map((t, i) => {
      const label = t.label || t.kind || `Pista ${i + 1}`;
      const groupHtml =
        t.group && t.group !== lastGroup
          ? `<div class="mtp__group">${t.group === 'voces' ? 'VOCES' : 'INSTRUMENTOS'}</div>`
          : '';
      lastGroup = t.group ?? lastGroup;
      return `
      ${groupHtml}
      <div class="mtp__row" data-idx="${i}">
        <span class="mtp__row-label">${label}</span>
        <div class="mtp__row-actions">
          <button type="button" class="mtp__row-btn mtp__row-btn--mute" data-idx="${i}" aria-label="Silenciar ${label}" aria-pressed="false">M</button>
          <button type="button" class="mtp__row-btn mtp__row-btn--solo" data-idx="${i}" aria-label="Solo ${label}" aria-pressed="false">S</button>
        </div>
      </div>`;
    })
    .join('');

  root.innerHTML = `
    <div class="mtp__transport">
      <button type="button" class="mtp__play" aria-label="Reproducir">${icon('play', { size: 18 })}</button>
      <div class="mtp__bar" role="slider" tabindex="0"
           aria-label="Buscar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="mtp__fill"></div>
        <div class="mtp__thumb"></div>
      </div>
      <span class="mtp__time" aria-hidden="true">0:00 / 0:00</span>
    </div>
    <div class="mtp__tracks">${rowsHtml}</div>
    <div class="mtp__audios" hidden></div>
  `;

  const playBtn = root.querySelector('.mtp__play');
  const bar = root.querySelector('.mtp__bar');
  const fill = root.querySelector('.mtp__fill');
  const thumb = root.querySelector('.mtp__thumb');
  const timeEl = root.querySelector('.mtp__time');
  const muteBtns = Array.from(root.querySelectorAll('.mtp__row-btn--mute'));
  const soloBtns = Array.from(root.querySelectorAll('.mtp__row-btn--solo'));

  // Un <audio> por pista, montado oculto (hidden) — no visible pero
  // presente en el DOM para que el navegador gestione su ciclo de vida.
  const audiosContainer = root.querySelector('.mtp__audios');
  const audios = tracks.map((t) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.src = safeUrl(t.url) || '';
    audiosContainer.appendChild(audio);
    return audio;
  });

  // --- Estado mute/solo ---
  const manualMuted = new Set(); // mute explicito por el usuario (boton M)
  const soloed = new Set(); // pistas en solo (boton S)

  const anySolo = () => soloed.size > 0;

  /** Recalcula audio.muted de todas las pistas segun mute manual + solo. */
  const applyAudibility = () => {
    audios.forEach((audio, i) => {
      const audible = anySolo() ? soloed.has(i) : !manualMuted.has(i);
      audio.muted = !audible;
    });
    muteBtns.forEach((btn, i) => {
      const active = manualMuted.has(i);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    soloBtns.forEach((btn, i) => {
      const active = soloed.has(i);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  };
  applyAudibility();

  const onMuteClick = (e) => {
    const i = Number(e.currentTarget.dataset.idx);
    if (manualMuted.has(i)) manualMuted.delete(i);
    else manualMuted.add(i);
    applyAudibility();
  };
  const onSoloClick = (e) => {
    const i = Number(e.currentTarget.dataset.idx);
    if (soloed.has(i)) soloed.delete(i);
    else soloed.add(i);
    applyAudibility();
  };
  muteBtns.forEach((btn) => btn.addEventListener('click', onMuteClick, { signal: ac.signal }));
  soloBtns.forEach((btn) => btn.addEventListener('click', onSoloClick, { signal: ac.signal }));

  // --- Duracion / tiempo maestro ---
  const durationOf = (i) => {
    const audio = audios[i];
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return tracks[i]?.durationSec || 0;
  };
  const masterDuration = () => Math.max(0, ...audios.map((_, i) => durationOf(i)));
  const masterAudio = () => audios[0];

  // --- Pintado del transporte ---
  let scrubbing = false;
  let previewTime = 0;

  const paintAt = (time) => {
    const dur = masterDuration();
    const pos = timeToPos(time, dur);
    fill.style.width = `${pos * 100}%`;
    thumb.style.left = `${pos * 100}%`;
    timeEl.textContent = `${fmtTime(time)} / ${fmtTime(dur)}`;
    bar.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
  };

  const setPlayIcon = (playing) => {
    playBtn.innerHTML = icon(playing ? 'pause' : 'play', { size: 18 });
    playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  };

  // --- Loop de sincronía (rAF) ---
  let rafId = null;
  let playing = false;

  // Callbacks de tiempo maestro (en segundos), para que quien componga este
  // player (p. ej. ToneLyrics) resalte la sílaba activa sin re-implementar
  // el loop de rAF.
  const timeListeners = new Set();
  const onTime = (cb) => {
    timeListeners.add(cb);
    return () => timeListeners.delete(cb);
  };

  /** Notifica a los listeners de tiempo (onTime) con `sec` en segundos. */
  const notifyTime = (sec) => {
    timeListeners.forEach((cb) => cb(sec));
  };

  const tick = () => {
    const master = masterAudio();
    const masterTime = master ? master.currentTime : 0;
    syncStep(audios, masterTime);
    if (!scrubbing) paintAt(masterTime);
    notifyTime(masterTime);
    if (master && master.ended) {
      pauseAll();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (rafId === null) rafId = requestAnimationFrame(tick);
  };
  const stopLoop = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  };

  const playAll = () => {
    playing = true;
    setPlayIcon(true);
    // Reproduce SIEMPRE todas las pistas, muteadas o no: la audibilidad es
    // responsabilidad exclusiva de audio.muted (applyAudibility). Si la
    // maestra no reproduce, su currentTime queda en 0 y syncStep arrastra
    // a 0 a las demás; y des-mutear en pleno playback debe sonar al
    // instante, no requerir un nuevo play().
    audios.forEach((audio) => {
      audio.play().catch((e) => console.warn('MultiTrackPlayer play() rechazado', e));
    });
    startLoop();
  };

  const pauseAll = () => {
    playing = false;
    setPlayIcon(false);
    audios.forEach((audio) => audio.pause());
    stopLoop();
  };

  playBtn.addEventListener(
    'click',
    () => {
      if (playing) pauseAll();
      else playAll();
    },
    { signal: ac.signal }
  );

  // --- Scrubber maestro: commit-on-release, igual patron que StudioPlayer ---
  const ratioOf = (clientX) => {
    const rect = bar.getBoundingClientRect();
    return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
  };

  const applyPreviewVisual = (time) => {
    previewTime = clamp(time, 0, masterDuration());
    paintAt(previewTime);
  };

  const seekAll = (time) => {
    audios.forEach((audio) => {
      audio.currentTime = time;
    });
  };

  bar.addEventListener(
    'pointerdown',
    (e) => {
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        // pointer capture no soportado — no-op
      }
      scrubbing = true;
      applyPreviewVisual(posToTime(ratioOf(e.clientX), masterDuration()));
    },
    { signal: ac.signal }
  );

  bar.addEventListener(
    'pointermove',
    (e) => {
      if (!scrubbing) return;
      applyPreviewVisual(posToTime(ratioOf(e.clientX), masterDuration()));
    },
    { signal: ac.signal }
  );

  const commitScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    seekAll(previewTime);
    paintAt(previewTime);
    if (e) {
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture no soportado — no-op
      }
    }
  };
  bar.addEventListener('pointerup', commitScrub, { signal: ac.signal });
  bar.addEventListener(
    'pointercancel',
    () => {
      scrubbing = false;
      paintAt(masterAudio() ? masterAudio().currentTime : 0);
    },
    { signal: ac.signal }
  );

  bar.addEventListener(
    'keydown',
    (e) => {
      const dur = masterDuration();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (playing) pauseAll();
        else playAll();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekAll(clamp((masterAudio()?.currentTime || 0) + 1, 0, dur));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekAll(clamp((masterAudio()?.currentTime || 0) - 1, 0, dur));
      }
    },
    { signal: ac.signal }
  );

  const onLoadedMetadata = () => {
    if (!playing && !scrubbing) paintAt(masterAudio() ? masterAudio().currentTime : 0);
  };
  audios.forEach((audio) =>
    audio.addEventListener('loadedmetadata', onLoadedMetadata, { signal: ac.signal })
  );

  paintAt(0);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    timeListeners.clear();
    ac.abort();
    audios.forEach((audio) => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    });
  };

  // Seek programático (segundos): usado por quien compone este player para
  // saltar a un punto de la letra (p. ej. tap en línea de ToneLyrics).
  const seek = (time) => {
    seekAll(clamp(time, 0, masterDuration()));
    const sec = masterAudio() ? masterAudio().currentTime : 0;
    paintAt(sec);
    notifyTime(sec);
  };

  return { el: root, destroy, onTime, seek };
}
