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
import { safeUrl, escapeHtml } from '../../lib/escape.js';
import { fmtTime, clamp, timeToPos, posToTime } from '../StudioPlayer.js';
import { isTrackAudible, nowSoundLabel, loopSeekTarget } from '../../lib/studioPractice.js';
import { createBeatClock } from '../../lib/beatClock.js';
import { createMetronomeClick } from '../../lib/metronomeClick.js';
import '../../styles/pipeline.css';

const LONG_PRESS_MS = 500;

/** Crea un nodo DOM con clase e innerHTML dados (helper de composicion). */
const buildEl = (tag, className, html = '') => {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
};

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
 * @param {{ tracks: Array<{kind:string, url:string, label?:string, durationSec?:number}>, structure?: {segments: Array<{label:string, startMs:number, endMs:number}>}|null, beats?: number[]|null, bpm?: number|null, timeSignature?: string, beatAnchor?: number }} opts
 * @returns {{ el: HTMLElement, els: { transport: HTMLElement, practice: HTMLElement, sections: HTMLElement, nowSound: HTMLElement, mixer: HTMLElement, audios: HTMLElement }, destroy: () => void, onTime: (cb: (sec:number)=>void) => (() => void), seek: (time:number) => void, pause: () => void }}
 */
export function createMultiTrackPlayer({
  tracks,
  structure,
  beats = null,
  bpm = null,
  timeSignature = '4/4',
  beatAnchor = 1,
}) {
  const ac = new AbortController();
  const root = buildEl('div', 'mtp');

  // Transporte maestro: play, barra de progreso, tiempo.
  const transport = buildEl(
    'div',
    'mtp__transport',
    `
    <button type="button" class="mtp__play" aria-label="Reproducir">${icon('play', { size: 18 })}</button>
    <div class="mtp__bar" role="slider" tabindex="0"
         aria-label="Buscar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="mtp__fill"></div>
      <div class="mtp__thumb"></div>
    </div>
    <span class="mtp__time" aria-hidden="true">0:00 / 0:00</span>
  `,
  );

  // Tira de práctica: loop de sección, velocidad y metrónomo (opcional, solo
  // con `beats`). Siempre visible — la velocidad se renderiza sin condición.
  const metroHtml =
    Array.isArray(beats) && beats.length
      ? `<button type="button" class="mtp__metro" aria-pressed="false">${icon('timer', { size: 16 })}<span>${bpm ? `${Math.round(bpm)} BPM · ${timeSignature}` : 'Metrónomo'}</span></button>`
      : '';
  const practice = buildEl(
    'div',
    'mtp__practice',
    `
    <button type="button" class="mtp__loop" aria-pressed="false">${icon('rotate-ccw', { size: 16 })}<span>Loop de sección</span></button>
    <div class="mtp__rates" role="group" aria-label="Velocidad">
      <button type="button" data-rate="1" class="is-active" aria-pressed="true">1×</button>
      <button type="button" data-rate="0.75" aria-pressed="false">0.75×</button>
      <button type="button" data-rate="0.5" aria-pressed="false">0.5×</button>
    </div>
    ${metroHtml}
  `,
  );

  // Chips de navegación por sección (estructura detectada por SongFormer,
  // Task 8). Sin `structure.segments` (o vacío) el contenedor queda vacío —
  // no se inventa contenido de relleno, mismo criterio que el encabezado de
  // grupo.
  const segments = Array.isArray(structure?.segments) ? structure.segments : [];
  const sections = buildEl(
    'div',
    'mtp__sections',
    segments
      .map(
        (seg, i) =>
          `<button type="button" class="mtp__section-chip" data-idx="${i}">${escapeHtml(seg.label ?? '')}</button>`,
      )
      .join(''),
  );
  // Sin segments, oculto (no dejo un hijo flex vacío consumiendo gap).
  sections.hidden = segments.length === 0;

  // Línea viva "qué estoy oyendo" (modelo C).
  const nowSoundEl = buildEl('div', 'mtp__nowsound');

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
      <div class="mtp__row is-on" data-idx="${i}">
        <button type="button" class="mtp__row-toggle" data-idx="${i}" aria-pressed="true" aria-label="Activar ${label}">
          <span class="mtp__row-dot" aria-hidden="true"></span>
          <span class="mtp__row-label">${label}</span>
        </button>
        <button type="button" class="mtp__row-btn mtp__row-btn--solo" data-idx="${i}" aria-pressed="false" aria-label="Aislar ${label}">${icon('circle-dot', { size: 16 })}</button>
      </div>`;
    })
    .join('');

  // Mixer: chip "Todo" (restaura la mezcla completa) + filas por pista.
  const mixer = buildEl(
    'div',
    'mtp__mixer',
    `<button type="button" class="mtp__all">Todo</button><div class="mtp__tracks">${rowsHtml}</div>`,
  );

  // Un <audio> por pista, montado oculto (hidden) — no visible pero
  // presente en el DOM para que el navegador gestione su ciclo de vida.
  const audiosEl = buildEl('div', 'mtp__audios');
  audiosEl.hidden = true;

  root.append(transport, practice, sections, nowSoundEl, mixer, audiosEl);

  const playBtn = transport.querySelector('.mtp__play');
  const bar = transport.querySelector('.mtp__bar');
  const fill = transport.querySelector('.mtp__fill');
  const thumb = transport.querySelector('.mtp__thumb');
  const timeEl = transport.querySelector('.mtp__time');
  const chipEls = Array.from(sections.querySelectorAll('.mtp__section-chip'));
  const loopBtn = practice.querySelector('.mtp__loop');
  // Sin structure.segments no hay chip activo posible -> el loop nunca
  // haría nada; se oculta (solo el botón, no toda la tira: velocidad y
  // metrónomo siguen útiles sin estructura).
  loopBtn.hidden = segments.length === 0;
  const rateBtns = Array.from(practice.querySelectorAll('.mtp__rates button'));
  const rowEls = Array.from(mixer.querySelectorAll('.mtp__row'));
  const toggleBtns = Array.from(mixer.querySelectorAll('.mtp__row-toggle'));
  const soloBtns = Array.from(mixer.querySelectorAll('.mtp__row-btn--solo'));
  const allBtn = mixer.querySelector('.mtp__all');

  const audios = tracks.map((t) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.src = safeUrl(t.url) || '';
    audiosEl.appendChild(audio);
    return audio;
  });

  // --- Estado del mixer (modelo C: aditivo + aislar) ---
  const disabled = new Set(); // pistas apagadas por el usuario (fila entera)
  const soloed = new Set(); // pistas aisladas (boton solo, circle-dot)

  /** Recalcula audio.muted de todas las pistas segun disabled + soloed. */
  const applyAudibility = () => {
    audios.forEach((audio, i) => {
      audio.muted = !isTrackAudible({ i, disabled, soloed });
    });
    rowEls.forEach((row, i) => {
      const on = isTrackAudible({ i, disabled, soloed });
      row.classList.toggle('is-on', on);
      row.classList.toggle('is-solo', soloed.has(i));
      toggleBtns[i].setAttribute('aria-pressed', String(!disabled.has(i)));
      soloBtns[i].setAttribute('aria-pressed', String(soloed.has(i)));
    });
    nowSoundEl.textContent = nowSoundLabel(tracks, disabled, soloed);
  };
  applyAudibility();

  // El click nativo SIEMPRE se dispara tras un pointerdown→pointerup en el
  // mismo target, sin importar cuánto se sostuvo — así que un long-press que
  // ya togglea `soloed` deja un click sintético pisándole el estado (ver
  // review CRITICAL). `longPressFired` consume ese click sintético una vez.
  let longPressFired = false;

  const onToggleClick = (e) => {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    const i = Number(e.currentTarget.dataset.idx);
    if (disabled.has(i)) disabled.delete(i);
    else disabled.add(i);
    applyAudibility();
  };
  const onSoloClick = (e) => {
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    const i = Number(e.currentTarget.dataset.idx);
    if (soloed.has(i)) soloed.delete(i);
    else soloed.add(i);
    applyAudibility();
  };
  toggleBtns.forEach((btn) => btn.addEventListener('click', onToggleClick, { signal: ac.signal }));
  soloBtns.forEach((btn) => btn.addEventListener('click', onSoloClick, { signal: ac.signal }));
  allBtn.addEventListener(
    'click',
    () => {
      disabled.clear();
      soloed.clear();
      applyAudibility();
    },
    { signal: ac.signal },
  );

  // Long-press en la fila (touch/mouse, 500ms) también aísla la pista —
  // atajo para no tener que apuntar al botón de solo en pantallas chicas.
  // Se cancela con pointerup/pointerleave/pointercancel (gesto reinterpretado
  // como scroll) para no disparar de más.
  const rowLongPressCancels = [];
  rowEls.forEach((row, i) => {
    let timer = null;
    const cancel = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    row.addEventListener(
      'pointerdown',
      () => {
        cancel();
        longPressFired = false;
        timer = setTimeout(() => {
          timer = null;
          longPressFired = true;
          if (soloed.has(i)) soloed.delete(i);
          else soloed.add(i);
          applyAudibility();
        }, LONG_PRESS_MS);
      },
      { signal: ac.signal },
    );
    row.addEventListener('pointerup', cancel, { signal: ac.signal });
    row.addEventListener('pointerleave', cancel, { signal: ac.signal });
    row.addEventListener('pointercancel', cancel, { signal: ac.signal });
    rowLongPressCancels.push(cancel);
  });

  // --- Tira de práctica: velocidad ---
  // El reloj maestro (tick) lee currentTime real de la pista, así que
  // syncStep sigue funcionando a cualquier rate — no requiere tocarlo.
  const setRate = (rate) => {
    audios.forEach((audio) => {
      audio.preservesPitch = true;
      audio.playbackRate = rate;
    });
    rateBtns.forEach((b) => {
      const active = Number(b.dataset.rate) === rate;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };
  rateBtns.forEach((btn) => {
    btn.addEventListener('click', () => setRate(Number(btn.dataset.rate)), { signal: ac.signal });
  });

  // --- Tira de práctica: loop de sección ---
  // El candidato de loop es siempre el chip de sección ACTIVO (activeChipIdx,
  // actualizado en updateActiveChip); togglear el loop lo fija/libera.
  let activeChipIdx = null;
  let loopSegIdx = null;
  const paintLoopChips = () => {
    chipEls.forEach((chip, i) => chip.classList.toggle('is-loop', i === loopSegIdx));
  };
  loopBtn.addEventListener(
    'click',
    () => {
      loopSegIdx = loopSegIdx === null ? activeChipIdx : null;
      loopBtn.setAttribute('aria-pressed', String(loopSegIdx !== null));
      loopBtn.classList.toggle('is-active', loopSegIdx !== null);
      paintLoopChips();
    },
    { signal: ac.signal },
  );

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

  // Resalta el chip de sección cuyo rango [startMs, endMs) (convertido a
  // segundos) contiene el tiempo maestro actual. `segments` está en ms;
  // el reloj del player está en segundos — la conversión es la misma que
  // en el seek de un chip (startMs/1000).
  const updateActiveChip = (sec) => {
    activeChipIdx = null;
    chipEls.forEach((btn, i) => {
      const seg = segments[i];
      const start = (seg?.startMs ?? 0) / 1000;
      const end = seg?.endMs !== null && seg?.endMs !== undefined ? seg.endMs / 1000 : Infinity;
      const active = sec >= start && sec < end;
      btn.classList.toggle('is-active', active);
      if (active) activeChipIdx = i;
    });
  };

  const tick = () => {
    const master = masterAudio();
    const masterTime = master ? master.currentTime : 0;
    syncStep(audios, masterTime);
    if (!scrubbing) paintAt(masterTime);
    notifyTime(masterTime);
    updateActiveChip(masterTime);
    // Loop de sección: si el master pasó el final del segmento fijado,
    // vuelve a su inicio (todas las pistas, vía seekAll).
    const loopTarget = loopSeekTarget(
      masterTime,
      loopSegIdx !== null ? segments[loopSegIdx] : null,
    );
    if (loopTarget !== null) seekAll(loopTarget);
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
    { signal: ac.signal },
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
    { signal: ac.signal },
  );

  bar.addEventListener(
    'pointermove',
    (e) => {
      if (!scrubbing) return;
      applyPreviewVisual(posToTime(ratioOf(e.clientX), masterDuration()));
    },
    { signal: ac.signal },
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
    { signal: ac.signal },
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
    { signal: ac.signal },
  );

  const onLoadedMetadata = () => {
    if (!playing && !scrubbing) paintAt(masterAudio() ? masterAudio().currentTime : 0);
  };
  audios.forEach((audio) =>
    audio.addEventListener('loadedmetadata', onLoadedMetadata, { signal: ac.signal }),
  );

  paintAt(0);
  updateActiveChip(0);

  // --- Tira de práctica: metrónomo (opcional, solo con `beats`) ---
  // AudioContext lazy dentro de metronomeClick — se crea recién al primer
  // unmute (gesto de usuario, iOS Safari), nunca al montar el player.
  let metronome = null;
  if (Array.isArray(beats) && beats.length) {
    const clock = createBeatClock({ beatsMs: beats, timeSignature, beatAnchor });
    metronome = createMetronomeClick({
      clock,
      getTimeMs: () => (masterAudio()?.currentTime ?? 0) * 1000,
    });
    const metroBtn = practice.querySelector('.mtp__metro');
    metroBtn.addEventListener(
      'click',
      () => {
        const on = metroBtn.getAttribute('aria-pressed') !== 'true';
        metroBtn.setAttribute('aria-pressed', String(on));
        metroBtn.classList.toggle('is-active', on);
        metronome.setMuted(!on);
      },
      { signal: ac.signal },
    );
  }

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    metronome?.stop();
    timeListeners.clear();
    rowLongPressCancels.forEach((cancel) => cancel());
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
    updateActiveChip(sec);
  };

  // Click en un chip de sección: seek al inicio del segmento. `startMs` está
  // en milisegundos, `seek()` espera segundos — la división es el punto de
  // correctness crítico (ver test "nunca en milisegundos").
  chipEls.forEach((btn, i) => {
    btn.addEventListener(
      'click',
      () => {
        const seg = segments[i];
        if (seg) seek((seg.startMs ?? 0) / 1000);
      },
      { signal: ac.signal },
    );
  });

  return {
    el: root,
    els: { transport, practice, sections, nowSound: nowSoundEl, mixer, audios: audiosEl },
    destroy,
    onTime,
    seek,
    pause: pauseAll,
  };
}
