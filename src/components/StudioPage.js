/**
 * StudioPage.js — Estudio de pistas (BETA): sube un audio, sepáralo en stems
 * y divide la pista vocal (líder/coros + segmentos por cantante).
 * Estados: idle → uploading → processing → done | failed.
 */
import { icon } from '../lib/icons.js';
import { mergeSegments, segmentToPct, voiceColorVar } from '../lib/studioSegments.js';
import {
  createJob,
  uploadInput,
  startJob,
  getJob,
  listJobs,
  readAudioDuration,
  watchJobRealtime,
} from '../lib/stemsApi.js';
import { downloadAllZip, buildZipBlob } from '../lib/studioZip.js';
import { getDriveToken } from '../lib/driveAuth.js';
import { uploadZipToDrive } from '../lib/driveUpload.js';
import {
  createStudioPlayer,
  clamp,
  magnifyRange,
  magnifyPosToTime,
  fmtTimeCs,
} from './StudioPlayer.js';

const MAX_DURATION_S = 10.5 * 60;
let pollTimer = null;
let jobChannel = null; // { leave } del Realtime del job activo
const SAFETY_POLL_MS = 30000; // red de seguridad + reconciliación server-side
const NO_PUSH_POLL_MS = 10000; // si el canal no conecta, refrescar más seguido
let hashChangeHandler = null;

// Teardown completo: detiene el timer Y desregistra la guarda de navegación.
// Se usa al desmontar la página o al navegar fuera de #/estudio.
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (jobChannel) {
    jobChannel.leave();
    jobChannel = null;
  }
  if (hashChangeHandler) {
    window.removeEventListener('hashchange', hashChangeHandler);
    hashChangeHandler = null;
  }
}

// Registra (una sola vez) la guarda que corta el polling cuando el usuario sale
// de #/estudio. Idempotente: si ya hay guarda, no añade otra.
function startHashGuard() {
  if (hashChangeHandler) return;
  hashChangeHandler = () => {
    if (!window.location.hash.startsWith('#/estudio')) {
      stopPolling();
    }
  };
  window.addEventListener('hashchange', hashChangeHandler);
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function escHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function hoursLeft(expiresAt) {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600e3));
}

const STEM_LABELS = {
  vocals: 'Voz',
  drums: 'Batería',
  bass: 'Bajo',
  guitar: 'Guitarra',
  piano: 'Piano',
  other: 'Otros',
};

const VOICE_LABELS = { lead: 'Voz líder', backing: 'Coros' };
const ALL_LABELS = { ...STEM_LABELS, ...VOICE_LABELS };

function voicesCopy(voices) {
  const has = [];
  if (voices.lead) has.push('voz líder');
  if (voices.backing) has.push('coros');
  if (has.length === 0) return '';
  return `Separamos ${has.join(' y ')} de la mezcla; los segmentos alternados se reproducen sobre la pista de voz.`;
}

export function renderStudioPage(container) {
  stopPolling();
  // Guarda de navegación robusta (no {once:true}, que se consumiría al re-renderizar
  // desde el mismo hash). Persiste mientras estemos en #/estudio.
  startHashGuard();
  container.innerHTML = `
    <div class="studio fade-in">
      <h1 class="studio__title">
        ${icon('layers', { size: 28 })} Estudio <span class="badge--beta">BETA</span>
      </h1>
      <div id="studio-body" aria-live="polite"></div>
    </div>
  `;
  const body = container.querySelector('#studio-body');
  void loadInitial(body);
}

async function loadInitial(body) {
  body.innerHTML = `<p class="empty-state__text">Cargando…</p>`;
  try {
    const { jobs, quota } = await listJobs();
    // Solo vigilamos jobs realmente en proceso. Un created/uploaded al cargar la página
    // es una subida abandonada (el upload en memoria se perdió): no lo seguimos para no
    // dejar un spinner eterno; el backend lo reclama en la próxima subida.
    const active = jobs.find((j) => ['separating_stems', 'separating_voices'].includes(j.status));
    const recent = jobs.find((j) => ['done', 'failed'].includes(j.status));
    if (active) return watchJob(body, active.id, quota, active.input_meta?.filename);
    if (recent) return showJob(body, recent.id, quota);
    renderIdle(body, quota);
  } catch {
    body.innerHTML = `<p class="empty-state__text">No pudimos cargar el Estudio. Intenta de nuevo.</p>`;
  }
}

function renderIdle(body, quota) {
  const left = quota.limit - quota.used;
  body.innerHTML = `
    <p class="studio__desc">Sube una canción y te la devolvemos separada en pistas (voz, batería,
    bajo, guitarra, piano y otros) más la voz dividida en <strong>líder/coros</strong> y segmentos
    por cantante.</p>
    <div class="studio-dropzone" role="button" tabindex="0" aria-label="Subir archivo de audio">
      ${icon('upload', { size: 32 })}
      <p class="studio-dropzone__hint"><strong>Arrastra tu audio aquí</strong> o toca para elegir</p>
      <p class="empty-state__text studio-dropzone__sub">MP3, WAV, M4A · máx 25 MB / 10 min</p>
    </div>
    <p class="empty-state__text studio__quota">
      Te quedan <strong>${left} de ${quota.limit}</strong> canciones hoy.
      Los resultados expiran a las 48 h.
    </p>
    <input type="file" id="studio-file" accept="audio/*" hidden />
  `;
  const drop = body.querySelector('.studio-dropzone');
  const input = body.querySelector('#studio-file');
  const pick = () => input.click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') pick();
  });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(body, file, quota);
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) void handleFile(body, input.files[0], quota);
  });
}

async function handleFile(body, file, quota) {
  const duration = await readAudioDuration(file);
  if (duration > MAX_DURATION_S) {
    renderIdle(body, quota);
    body.insertAdjacentHTML(
      'afterbegin',
      `<p class="studio__error">El audio dura más de 10 minutos.</p>`,
    );
    return;
  }
  body.innerHTML = `<p aria-busy="true">Subiendo <strong>${file.name}</strong>…</p>`;
  try {
    const { job, upload } = await createJob(file);
    await uploadInput(upload, file);
    await startJob(job.id);
    watchJob(body, job.id, quota, file.name);
  } catch (e) {
    body.innerHTML = `
      <p class="studio__error">${e.message}</p>
      <button class="btn btn--primary" id="studio-retry">Volver a intentar</button>
    `;
    body.querySelector('#studio-retry').addEventListener('click', () => renderIdle(body, quota));
  }
}

function watchJob(body, jobId, quota, filename) {
  // Teardown previo del timer/canal (sin tocar la guarda de navegación).
  if (pollTimer) clearInterval(pollTimer);
  if (jobChannel) {
    jobChannel.leave();
    jobChannel = null;
  }
  startHashGuard();

  const finishIfDone = (job) => {
    if (job.status === 'done' || job.status === 'failed') {
      stopPolling();
      renderJob(body, job, quota);
      return true;
    }
    return false;
  };

  const refresh = async () => {
    try {
      const { job } = await getJob(jobId);
      if (finishIfDone(job)) return;
      renderProcessing(body, job, job.input_meta?.filename ?? filename);
    } catch {
      /* el siguiente tick reintenta */
    }
  };

  // Push: en cada cambio de estado refrescamos vía la API saneada.
  let pushAlive = false;
  jobChannel = watchJobRealtime({
    jobId,
    onStatus: () => void refresh(),
    onSubscribed: () => {
      pushAlive = true;
    },
  });

  // Render inicial + poll de seguridad (también dispara la reconciliación).
  void refresh();
  pollTimer = setInterval(refresh, SAFETY_POLL_MS);

  // Si el push no conectó en ~6s, refrescar más seguido (modo sin push).
  // Capturamos la referencia del interval activo: si para entonces stopPolling
  // o una nueva llamada a watchJob lo reemplazaron, este timeout no debe tocar
  // el poll vigente (evita resucitar un poll fantasma de un job anterior).
  const safetyTimer = pollTimer;
  setTimeout(() => {
    if (!pushAlive && pollTimer === safetyTimer) {
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, NO_PUSH_POLL_MS);
    }
  }, 6000);
}

async function showJob(body, jobId, quota) {
  try {
    const { job } = await getJob(jobId);
    renderJob(body, job, quota);
  } catch {
    renderIdle(body, quota);
  }
}

function renderProcessing(body, job, filename) {
  const status = job.status;
  const stagesDone = status === 'separating_voices';
  const stage = (iconName, label, state) => {
    const mark =
      state === 'done'
        ? icon('check-circle', { size: 18 })
        : `<span class="studio-stage__dot studio-stage__dot--${state}"></span>`;
    return `
      <div class="studio-stage studio-stage--${state}" aria-label="${label}: ${state === 'done' ? 'completado' : state === 'active' ? 'en curso' : 'en espera'}">
        ${mark}
        ${icon(iconName, { size: 18 })}
        <span class="studio-stage__label">${label}</span>
        <span class="studio-stage__eta">~2 min</span>
      </div>`;
  };
  body.innerHTML = `
    ${filename ? `<p class="studio__filename" title="${escHtml(filename)}">${icon('audio-lines', { size: 16 })} <span>${escHtml(filename)}</span></p>` : ''}
    <div class="studio-loader">
      <div class="studio-eq" aria-hidden="true">
        ${Array.from({ length: 7 }, (_, i) => `<span class="studio-eq__bar" style="--i:${i}"></span>`).join('')}
      </div>
      <div class="studio-stages">
        ${stage('layers', 'Separando pistas', stagesDone ? 'done' : 'active')}
        ${stage('audio-lines', 'Separando voces', stagesDone ? 'active' : 'wait')}
      </div>
      <p class="empty-state__text">Puedes salir de esta página; el proceso sigue solo.</p>
    </div>
  `;
}

function renderJob(body, job, quota) {
  if (job.status === 'failed') {
    body.innerHTML = `
      <p class="studio__error">${job.error ?? 'El procesamiento falló.'}</p>
      <button class="btn btn--primary" id="studio-retry">Procesar otra canción</button>
    `;
    body.querySelector('#studio-retry').addEventListener('click', () => renderIdle(body, quota));
    return;
  }

  const stems = job.stems ?? {};
  const voices = job.voices ?? {};
  const playerRow = (label, url) =>
    `<div class="studio-player-mount" data-label="${escHtml(label)}" data-url="${escHtml(url)}"></div>`;

  const segments = Array.isArray(voices.segments) ? voices.segments : [];
  body.innerHTML = `
    <p class="empty-state__text studio__expiry">Disponible por <strong>${hoursLeft(job.expires_at)} h</strong> más.</p>
    ${job.input_meta?.filename ? `<p class="studio__filename" title="${escHtml(job.input_meta.filename)}">${icon('audio-lines', { size: 16 })} <span>${escHtml(job.input_meta.filename)}</span></p>` : ''}
    <div class="studio-actions">
      <button class="btn btn--primary studio-actions__zip" id="studio-zip">
        ${icon('download', { size: 16 })} Descargar todo (ZIP)
      </button>
      <button class="btn studio-actions__drive" id="studio-drive">
        ${icon('upload', { size: 16 })} Guardar en Drive
      </button>
    </div>
    <h2 class="studio__section-title">Pistas</h2>
    ${Object.entries(STEM_LABELS)
      .filter(([k]) => stems[k])
      .map(([k, label]) => playerRow(label, stems[k]))
      .join('')}
    ${
      voices.lead || voices.backing || segments.length > 0
        ? `<h2 class="studio__section-title">Voces</h2>`
        : ''
    }
    ${voices.lead || voices.backing ? `<p class="empty-state__text">${voicesCopy(voices)}</p>` : ''}
    ${voices.lead ? playerRow('Voz líder', voices.lead) : ''}
    ${voices.backing ? playerRow('Coros', voices.backing) : ''}
    ${
      segments.length > 0
        ? (() => {
            const merged = mergeSegments(segments);
            const order = [...new Set(merged.map((s) => s.voice))];
            const fallbackDur = merged.reduce((m, s) => Math.max(m, s.end), 0);
            const blocks = merged
              .map((s) => {
                const { left, width } = segmentToPct(s, fallbackDur);
                const color = voiceColorVar(s.voice, order);
                return `<button class="studio-tl__block" data-start="${s.start}"
                          style="left:${left}%;width:${width}%;background:${color}"
                          aria-label="${s.voice}, ${fmtTime(s.start)} a ${fmtTime(s.end)}"></button>`;
              })
              .join('');
            const legend = order
              .map(
                (v) =>
                  `<span class="studio-tl__legend-item"><span class="studio-tl__swatch" style="background:${voiceColorVar(v, order)}"></span>${v}</span>`,
              )
              .join('');
            return `
              <h3 class="studio__section-title studio__section-title--sm">Segmentos por cantante</h3>
              <audio id="studio-vocal-seg" preload="metadata" src="${stems.vocals ?? voices.lead}"></audio>
              <div class="studio-tl__legend">${legend}</div>
              <div class="studio-tl" id="studio-tl" data-dur="${fallbackDur}">
                <div class="studio-tl__track" id="studio-tl-track">
                  ${blocks}
                  <div class="studio-tl__playhead" id="studio-tl-playhead" style="left:0%"></div>
                  <div class="studio-tl__mag" id="studio-tl-mag" hidden aria-hidden="true">
                    <span class="studio-tl__mag-needle"></span>
                    <span class="studio-tl__mag-time">0:00.00</span>
                  </div>
                </div>
              </div>
              <div class="studio-transport">
                <button class="btn studio-transport__btn" id="studio-tl-play" aria-label="Reproducir">${icon('play', { size: 18 })}</button>
                <button class="btn studio-transport__btn" id="studio-tl-restart" aria-label="Reiniciar">${icon('rotate-ccw', { size: 18 })}</button>
                <span class="studio-transport__time"><span id="studio-tl-cur">0:00</span> / <span id="studio-tl-dur">${fmtTime(fallbackDur)}</span></span>
              </div>`;
          })()
        : ''
    }
    <button class="btn btn--primary studio__new-btn" id="studio-new">Procesar otra canción</button>
  `;

  // Player de timeline: play/pausa, seek por click en pista o en bloque, playhead
  const segAudio = body.querySelector('#studio-vocal-seg');
  if (segAudio) {
    const playBtn = body.querySelector('#studio-tl-play');
    const restartBtn = body.querySelector('#studio-tl-restart');
    const playhead = body.querySelector('#studio-tl-playhead');
    const track = body.querySelector('#studio-tl-track');
    const curEl = body.querySelector('#studio-tl-cur');
    const durEl = body.querySelector('#studio-tl-dur');
    const tl = body.querySelector('#studio-tl');

    const dur = () =>
      Number.isFinite(segAudio.duration) ? segAudio.duration : Number(tl.dataset.dur) || 0;

    segAudio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(segAudio.duration)) durEl.textContent = fmtTime(segAudio.duration);
    });
    segAudio.addEventListener('timeupdate', () => {
      const d = dur();
      if (d > 0) playhead.style.left = `${Math.min(100, (segAudio.currentTime / d) * 100)}%`;
      curEl.textContent = fmtTime(segAudio.currentTime);
    });
    const setPlayIcon = () => {
      playBtn.innerHTML = icon(segAudio.paused ? 'play' : 'pause', { size: 18 });
      playBtn.setAttribute('aria-label', segAudio.paused ? 'Reproducir' : 'Pausar');
    };
    segAudio.addEventListener('play', setPlayIcon);
    segAudio.addEventListener('pause', setPlayIcon);

    playBtn.addEventListener('click', () => {
      if (segAudio.paused) void segAudio.play();
      else segAudio.pause();
    });
    restartBtn.addEventListener('click', () => {
      segAudio.currentTime = 0;
    });
    let tlJustMagnified = false;
    track.addEventListener('click', (e) => {
      if (e.target.classList.contains('studio-tl__block')) return;
      if (tlJustMagnified) {
        // Tras usar la lupa, el navegador emite un click sintético: no lo
        // dejamos pisar la posición precisa que el usuario acaba de elegir.
        tlJustMagnified = false;
        return;
      }
      const rect = track.getBoundingClientRect();
      const d = dur();
      if (d > 0) segAudio.currentTime = ((e.clientX - rect.left) / rect.width) * d;
    });
    const tlMag = body.querySelector('#studio-tl-mag');
    const tlNeedle = tlMag?.querySelector('.studio-tl__mag-needle');
    const tlMagTime = tlMag?.querySelector('.studio-tl__mag-time');
    let tlPress = null;
    let tlMagOpen = false;
    let tlRange = null;
    const tlRatio = (clientX) => {
      const rect = track.getBoundingClientRect();
      return rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('studio-tl__block')) return;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* no soportado */
      }
      tlPress = setTimeout(() => {
        tlRange = magnifyRange(segAudio.currentTime, dur());
        tlMagOpen = true;
        if (tlMag) tlMag.hidden = false;
      }, 400);
    });
    track.addEventListener('pointermove', (e) => {
      if (tlMagOpen && tlRange) {
        const r = tlRatio(e.clientX);
        const t = magnifyPosToTime(r, tlRange);
        segAudio.currentTime = t;
        if (tlNeedle) tlNeedle.style.left = `${r * 100}%`;
        if (tlMagTime) tlMagTime.textContent = fmtTimeCs(t);
      }
    });
    const tlEnd = () => {
      if (tlPress) {
        clearTimeout(tlPress);
        tlPress = null;
      }
      if (tlMagOpen) {
        tlMagOpen = false;
        tlRange = null;
        tlJustMagnified = true;
        if (tlMag) tlMag.hidden = true;
      }
    };
    track.addEventListener('pointerup', tlEnd);
    track.addEventListener('pointercancel', tlEnd);
    body.querySelectorAll('.studio-tl__block').forEach((b) => {
      b.addEventListener('click', () => {
        segAudio.currentTime = Number(b.dataset.start);
        void segAudio.play();
      });
    });
  }
  const zipBtn = body.querySelector('#studio-zip');
  if (zipBtn) {
    zipBtn.addEventListener('click', async () => {
      const original = zipBtn.innerHTML;
      zipBtn.disabled = true;
      zipBtn.textContent = 'Empaquetando…';
      try {
        await downloadAllZip(job, ALL_LABELS);
        zipBtn.innerHTML = original;
      } catch (e) {
        zipBtn.innerHTML = original;
        const actions = zipBtn.closest('.studio-actions');
        if (actions.nextElementSibling?.classList.contains('studio__error')) {
          actions.nextElementSibling.remove();
        }
        const err = document.createElement('p');
        err.className = 'studio__error';
        err.textContent = e.message || 'No pudimos generar el ZIP.';
        actions.insertAdjacentElement('afterend', err);
      } finally {
        zipBtn.disabled = false;
      }
    });
  }
  const driveBtn = body.querySelector('#studio-drive');
  if (driveBtn) {
    driveBtn.addEventListener('click', async () => {
      const original = driveBtn.innerHTML;
      const actions = driveBtn.closest('.studio-actions');
      const clearMsgs = () => {
        actions.parentElement
          .querySelectorAll('.studio__error, .studio__drive-link')
          .forEach((n) => n.remove());
      };
      driveBtn.disabled = true;
      clearMsgs();
      try {
        driveBtn.textContent = 'Autorizando…';
        let token = await getDriveToken();
        driveBtn.textContent = 'Empaquetando…';
        const { blob, base } = await buildZipBlob(job, ALL_LABELS);
        driveBtn.textContent = 'Subiendo a Drive…';
        let result;
        try {
          result = await uploadZipToDrive(token, blob, base);
        } catch (e) {
          if (e.status === 401) {
            token = await getDriveToken();
            result = await uploadZipToDrive(token, blob, base);
          } else {
            throw e;
          }
        }
        driveBtn.innerHTML = `${icon('check-circle', { size: 16 })} Guardado`;
        const link = document.createElement('p');
        link.className = 'studio__drive-link';
        link.innerHTML = `Guardado en Drive · <a href="${escHtml(result.folderUrl)}" target="_blank" rel="noopener">abrir carpeta</a>`;
        actions.insertAdjacentElement('afterend', link);
      } catch (e) {
        driveBtn.innerHTML = original;
        const err = document.createElement('p');
        err.className = 'studio__error';
        err.textContent = e.message || 'No pudimos guardar en Drive.';
        actions.insertAdjacentElement('afterend', err);
      } finally {
        driveBtn.disabled = false;
      }
    });
  }
  body.querySelectorAll('.studio-player-mount').forEach((mount) => {
    const { el } = createStudioPlayer({ label: mount.dataset.label, url: mount.dataset.url });
    mount.replaceWith(el);
  });
  body.querySelector('#studio-new').addEventListener('click', () => renderIdle(body, quota));
}
