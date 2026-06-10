/**
 * StudioPage.js — Estudio de pistas (BETA): sube un audio, sepáralo en stems
 * y divide la pista vocal (líder/coros + segmentos por cantante).
 * Estados: idle → uploading → processing → done | failed.
 */
import { icon } from '../lib/icons.js';
import {
  createJob,
  uploadInput,
  startJob,
  getJob,
  listJobs,
  readAudioDuration,
} from '../lib/stemsApi.js';

const POLL_MS = 5000;
const MAX_DURATION_S = 10.5 * 60;
let pollTimer = null;
let hashChangeHandler = null;

// Teardown completo: detiene el timer Y desregistra la guarda de navegación.
// Se usa al desmontar la página o al navegar fuera de #/estudio.
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
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

export function renderStudioPage(container) {
  stopPolling();
  // Guarda de navegación robusta (no {once:true}, que se consumiría al re-renderizar
  // desde el mismo hash). Persiste mientras estemos en #/estudio.
  startHashGuard();
  container.innerHTML = `
    <div class="studio fade-in">
      <h1 class="studio__title">
        ${icon('audio-lines', { size: 28 })} Estudio <span class="badge--beta">BETA</span>
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
    if (active) return watchJob(body, active.id, quota);
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
    watchJob(body, job.id, quota);
  } catch (e) {
    body.innerHTML = `
      <p class="studio__error">${e.message}</p>
      <button class="btn btn--primary" id="studio-retry">Volver a intentar</button>
    `;
    body.querySelector('#studio-retry').addEventListener('click', () => renderIdle(body, quota));
  }
}

function watchJob(body, jobId, quota) {
  // Reinicia SOLO el timer (no la guarda de navegación, que debe seguir viva
  // mientras hagamos polling). El teardown completo es responsabilidad de stopPolling().
  if (pollTimer) clearInterval(pollTimer);
  startHashGuard();
  const tick = async () => {
    try {
      const { job } = await getJob(jobId);
      if (job.status === 'done' || job.status === 'failed') {
        stopPolling();
        renderJob(body, job, quota);
        return;
      }
      renderProcessing(body, job);
    } catch {
      /* siguiente tick reintenta */
    }
  };
  void tick();
  pollTimer = setInterval(tick, POLL_MS);
}

async function showJob(body, jobId, quota) {
  try {
    const { job } = await getJob(jobId);
    renderJob(body, job, quota);
  } catch {
    renderIdle(body, quota);
  }
}

function renderProcessing(body, job) {
  const step1Done = job.status === 'separating_voices';
  body.innerHTML = `
    <div class="studio-steps">
      <p class="studio-steps__item">${step1Done ? '✅' : '⏳'} <strong>Separando pistas…</strong> ~2 min</p>
      <p class="studio-steps__item">${step1Done ? '⏳' : '○'} <strong>Separando voces…</strong> ~2 min</p>
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
  const playerRow = (label, url) => `
    <div class="studio-player-row">
      <span class="studio-player-row__label">${label}</span>
      <audio controls preload="none" src="${url}" class="studio-player-row__audio"></audio>
      <a class="btn studio-player-row__dl" href="${url}" download aria-label="Descargar ${label}">${icon('download', { size: 16 })}</a>
    </div>
  `;

  const segments = Array.isArray(voices.segments) ? voices.segments : [];
  body.innerHTML = `
    <p class="empty-state__text studio__expiry">Disponible por <strong>${hoursLeft(job.expires_at)} h</strong> más.</p>
    <h2 class="studio__section-title">Pistas</h2>
    ${Object.entries(STEM_LABELS)
      .filter(([k]) => stems[k])
      .map(([k, label]) => playerRow(label, stems[k]))
      .join('')}
    <h2 class="studio__section-title">Voces</h2>
    <p class="empty-state__text">Las secciones en armonía simultánea se entregan como líder/coros;
    los segmentos alternados se reproducen sobre la pista de voz.</p>
    ${voices.lead ? playerRow('Voz líder', voices.lead) : ''}
    ${voices.backing ? playerRow('Coros', voices.backing) : ''}
    ${
      segments.length > 0
        ? `<h3 class="studio__section-title studio__section-title--sm">Segmentos por cantante</h3>
           <audio id="studio-vocal-seg" preload="none" src="${stems.vocals ?? voices.lead}"></audio>
           <ul class="studio-segments">
             ${segments
               .map(
                 (s, i) => `<li class="studio-segments__item">
                   <button class="btn studio-seg" data-i="${i}" data-start="${s.start}" data-end="${s.end}">
                     ▶ ${s.voice}: ${fmtTime(s.start)}–${fmtTime(s.end)}
                   </button>
                 </li>`,
               )
               .join('')}
           </ul>`
        : ''
    }
    <button class="btn btn--primary studio__new-btn" id="studio-new">Procesar otra canción</button>
  `;

  // Player de segmentos virtuales: seek a start, pausa en end
  const segAudio = body.querySelector('#studio-vocal-seg');
  if (segAudio) {
    let endAt = null;
    segAudio.addEventListener('timeupdate', () => {
      if (endAt !== null && segAudio.currentTime >= endAt) {
        segAudio.pause();
        endAt = null;
      }
    });
    body.querySelectorAll('.studio-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        segAudio.currentTime = Number(btn.dataset.start);
        endAt = Number(btn.dataset.end);
        void segAudio.play();
      });
    });
  }
  body.querySelector('#studio-new').addEventListener('click', () => renderIdle(body, quota));
}
