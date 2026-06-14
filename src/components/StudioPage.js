/**
 * StudioPage.js — Estudio de pistas (BETA): sube un audio, sepáralo en stems
 * y divide la pista vocal (líder/coros + segmentos por cantante).
 * Estados: idle → uploading → processing → done | failed.
 */
import { icon } from '../lib/icons.js';
import { SECTION_KEYS } from '../lib/studioSections.js';
import {
  createJob,
  uploadInput,
  startJob,
  getJob,
  listJobs,
  readAudioDuration,
  watchJobRealtime,
} from '../lib/stemsApi.js';
import { getSession } from '../lib/authStore.js';
import { downloadAllZip, buildZipBlob } from '../lib/studioZip.js';
import { getDriveToken } from '../lib/driveAuth.js';
import { uploadZipToDrive } from '../lib/driveUpload.js';
import { createActionButton } from '../lib/studioActionButton.js';
import { isMp3File } from '../lib/studioFile.js';
export { isMp3File };
import { createStudioPlayer } from './StudioPlayer.js';
import { renderTimeline, markActive } from './StudioSectionTimeline.js';
import { renderSectionCard } from './StudioSectionCard.js';

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
  instrumental: 'Instrumental',
  drums: 'Batería',
  bass: 'Bajo',
  guitar: 'Guitarra',
  piano: 'Piano',
  other: 'Otros',
};

const VOICE_LABELS = { lead: 'Voz líder', backing: 'Coros' };
const ALL_LABELS = { ...STEM_LABELS, ...VOICE_LABELS };

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
    const active = jobs.find((j) => j.status === 'processing');
    const recent = jobs.find((j) => ['done', 'partial', 'failed'].includes(j.status));
    if (active) return watchJob(body, active.id, quota, active.input_meta?.filename);
    if (recent) return showJob(body, recent.id, quota);
    renderIdle(body, quota);
  } catch {
    body.innerHTML = `<p class="empty-state__text">No pudimos cargar el Estudio. Intenta de nuevo.</p>`;
  }
}

function renderIdle(body, quota) {
  const quotaText =
    quota.unlimited || quota.limit === null
      ? `Sin límite diario de canciones. Los resultados expiran a las 48 h.`
      : `Te quedan <strong>${quota.limit - quota.used} de ${quota.limit}</strong> canciones hoy. Los resultados expiran a las 48 h.`;
  body.innerHTML = `
    <p class="studio__desc">Sube una canción y te la devolvemos separada en pistas (voz, batería,
    bajo, guitarra, piano y otros) más la voz dividida en <strong>líder/coros</strong> y segmentos
    por cantante.</p>
    <div class="studio-dropzone" role="button" tabindex="0" aria-label="Subir archivo de audio">
      ${icon('upload', { size: 32 })}
      <p class="studio-dropzone__hint"><strong>Arrastra tu audio aquí</strong> o toca para elegir</p>
      <p class="empty-state__text studio-dropzone__sub">MP3 · máx 25 MB / 10 min</p>
    </div>
    <p class="empty-state__text studio__quota">
      ${quotaText}
    </p>
    <input type="file" id="studio-file" accept=".mp3,audio/mpeg" hidden />
  `;
  const drop = body.querySelector('.studio-dropzone');
  const input = body.querySelector('#studio-file');
  const pick = () => input.click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') pick();
  });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  const rejectNonMp3 = () => {
    renderIdle(body, quota);
    body.insertAdjacentHTML(
      'afterbegin',
      `<p class="studio__error">Solo aceptamos archivos MP3.</p>`,
    );
  };
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!isMp3File(file)) {
      rejectNonMp3();
      return;
    }
    void handleFile(body, file, quota);
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!isMp3File(file)) {
      rejectNonMp3();
      return;
    }
    void handleFile(body, file, quota);
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
    // `partial` (algunas secciones done, otras failed) también es terminal:
    // renderJob muestra las pistas listas + el botón Reintentar por sección fallida.
    if (job.status === 'done' || job.status === 'failed' || job.status === 'partial') {
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
      renderProcessing(body, job, job.input_meta?.filename ?? filename, quota);
    } catch {
      /* el siguiente tick reintenta */
    }
  };

  // Push: en cada cambio de estado refrescamos vía la API saneada.
  // No hacemos render optimista con datos parciales del push: el payload del canal
  // no trae stems/voices firmados, así que pintar desde él dejaría los players vacíos
  // (chip "Listo" sin contenido). Dejamos que refresh() — única fuente con URLs firmadas —
  // sea quien actualice la UI; el push solo sirve de señal para disparar ese GET.
  let pushAlive = false;
  jobChannel = watchJobRealtime({
    jobId,
    onStatus: () => {
      void refresh();
    },
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

/**
 * Monta la UI viva de las tarjetas ya renderizadas en `body`: players de audio,
 * timeline de structure (con seek + markActive) y botones de reintento por sección.
 * Compartido por `renderProcessing` (revelado progresivo) y `renderJob` (terminal),
 * así una sección que termina o falla mientras el job sigue 'processing' queda usable.
 */
function mountSectionUI(body, job, quota) {
  // --- Montar players ---
  let primaryAudio = null;
  body.querySelectorAll('.studio-player-mount').forEach((mount) => {
    const { el, audio } = createStudioPlayer({
      label: mount.dataset.label,
      url: mount.dataset.url,
    });
    if (mount.dataset.primary === '1' && !primaryAudio) {
      primaryAudio = audio;
    }
    mount.replaceWith(el);
  });

  // --- Cablear timeline de structure ---
  const sections = job.sections ?? {};
  const tlMount = body.querySelector('.studio-sectl-mount');
  if (tlMount) {
    const structureSection = sections.structure ?? {};
    const segments = Array.isArray(structureSection.segments) ? structureSection.segments : [];
    if (segments.length > 0) {
      const onSeek = primaryAudio
        ? (t) => {
            primaryAudio.currentTime = t;
            void primaryAudio.play();
          }
        : () => {};
      const tl = renderTimeline(segments, { onSeek });
      tlMount.replaceWith(tl);

      if (primaryAudio) {
        primaryAudio.addEventListener('timeupdate', () => {
          markActive(tl, primaryAudio.currentTime);
        });
      }
    }
  }

  // --- Cablear retry por sección ---
  body.querySelectorAll('.studio-section-card__retry').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Reintentando…';
      try {
        const s = getSession();
        const headers = s ? { Authorization: `Bearer ${s.access_token}` } : {};
        const res = await fetch(
          `/api/stems/jobs/${job.id}/retry?section=${encodeURIComponent(section)}`,
          {
            method: 'POST',
            headers,
          },
        );
        if (!res.ok) {
          const body2 = await res.json().catch(() => ({}));
          throw new Error(body2.error ?? `Error ${res.status}`);
        }
        // Re-arranca seguimiento
        watchJob(body, job.id, quota, job.input_meta?.filename);
      } catch (e) {
        btn.textContent = originalText;
        btn.disabled = false;
        // Mostrar error cerca del botón
        let errEl = btn.parentElement.querySelector('.studio__error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'studio__error';
          btn.parentElement.appendChild(errEl);
        }
        errEl.textContent = e.message || 'No se pudo reintentar.';
      }
    });
  });
}

/**
 * Renderiza las 4 tarjetas de sección con su estado actual.
 * Sirve tanto para 'processing' (estados parciales) como para 'done' (unificado con renderJob).
 */
function renderProcessing(body, job, filename, quota) {
  const sections = job.sections ?? {};
  const stems = job.stems ?? {};
  const voices = job.voices ?? {};
  const genderVoices = job.genderVoices ?? {};

  const frag = document.createDocumentFragment();

  if (filename) {
    const filenameEl = document.createElement('p');
    filenameEl.className = 'studio__filename';
    filenameEl.title = filename;
    filenameEl.innerHTML = `${icon('audio-lines', { size: 16 })} `;
    const span = document.createElement('span');
    span.textContent = filename;
    filenameEl.appendChild(span);
    frag.appendChild(filenameEl);
  }

  const cardsEl = document.createElement('div');
  cardsEl.className = 'studio-sections';
  cardsEl.setAttribute('aria-label', 'Estado del procesamiento');

  for (const key of SECTION_KEYS) {
    const section = sections[key] ?? { status: 'pending' };
    const card = renderSectionCard({ key, section, stems, voices, genderVoices });
    cardsEl.appendChild(card);
  }
  frag.appendChild(cardsEl);

  const hint = document.createElement('p');
  hint.className = 'empty-state__text';
  hint.textContent = 'Puedes salir de esta página; el proceso sigue solo.';
  frag.appendChild(hint);

  body.innerHTML = '';
  body.appendChild(frag);

  // Revelado progresivo: monta players/timeline/retry de las secciones ya terminadas o fallidas.
  mountSectionUI(body, job, quota);
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
  const genderVoices = job.genderVoices ?? {};
  const sections = job.sections ?? {};

  const frag = document.createDocumentFragment();

  // Expiración
  const expiry = document.createElement('p');
  expiry.className = 'empty-state__text studio__expiry';
  expiry.innerHTML = `Disponible por <strong>${hoursLeft(job.expires_at)} h</strong> más.`;
  frag.appendChild(expiry);

  // Nombre del archivo
  if (job.input_meta?.filename) {
    const filenameEl = document.createElement('p');
    filenameEl.className = 'studio__filename';
    filenameEl.title = job.input_meta.filename;
    filenameEl.innerHTML = `${icon('audio-lines', { size: 16 })} `;
    const span = document.createElement('span');
    span.textContent = job.input_meta.filename;
    filenameEl.appendChild(span);
    frag.appendChild(filenameEl);
  }

  // Acciones ZIP + Drive
  const actions = document.createElement('div');
  actions.className = 'studio-actions';
  actions.innerHTML = `
    <button class="btn btn--primary studio-actions__zip" id="studio-zip">
      ${icon('download', { size: 16 })} Descargar todo (ZIP)
    </button>
    <button class="btn studio-actions__drive" id="studio-drive">
      ${icon('upload', { size: 16 })} Guardar en Drive
    </button>
  `;
  frag.appendChild(actions);

  // 4 tarjetas de sección
  const cardsEl = document.createElement('div');
  cardsEl.className = 'studio-sections';

  for (const key of SECTION_KEYS) {
    const section = sections[key] ?? { status: 'done' };
    const card = renderSectionCard({ key, section, stems, voices, genderVoices });
    cardsEl.appendChild(card);
  }
  frag.appendChild(cardsEl);

  // Botón nueva canción
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'btn btn--primary studio__new-btn';
  newBtn.id = 'studio-new';
  newBtn.textContent = 'Procesar otra canción';
  frag.appendChild(newBtn);

  body.innerHTML = '';
  body.appendChild(frag);

  // Players + timeline de structure + retry por sección (compartido con renderProcessing).
  mountSectionUI(body, job, quota);

  // --- ZIP ---
  const zipBtn = body.querySelector('#studio-zip');
  if (zipBtn) {
    const ctrl = createActionButton(zipBtn, {
      idle: { icon: 'download', label: 'Descargar todo (ZIP)' },
    });
    const clearErr = () => {
      const actionsEl = zipBtn.closest('.studio-actions');
      if (actionsEl.nextElementSibling?.classList.contains('studio__error')) {
        actionsEl.nextElementSibling.remove();
      }
    };
    zipBtn.addEventListener('click', async () => {
      zipBtn.disabled = true;
      clearErr();
      ctrl.busy('Empaquetando');
      try {
        await downloadAllZip(job, ALL_LABELS, (k, n) => ctrl.progress(k / n));
        ctrl.done('Listo');
      } catch (e) {
        ctrl.error();
        const actionsEl = zipBtn.closest('.studio-actions');
        const err = document.createElement('p');
        err.className = 'studio__error';
        err.textContent = e.message || 'No pudimos generar el ZIP.';
        actionsEl.insertAdjacentElement('afterend', err);
      } finally {
        zipBtn.disabled = false;
      }
    });
  }

  // --- Drive ---
  const driveBtn = body.querySelector('#studio-drive');
  if (driveBtn) {
    const ctrl = createActionButton(driveBtn, {
      idle: { icon: 'upload', label: 'Guardar en Drive' },
    });
    const actionsEl = driveBtn.closest('.studio-actions');
    const clearMsgs = () => {
      actionsEl.parentElement
        .querySelectorAll('.studio__error, .studio__drive-link')
        .forEach((n) => n.remove());
    };
    driveBtn.addEventListener('click', async () => {
      driveBtn.disabled = true;
      clearMsgs();
      try {
        ctrl.busy('Autorizando…');
        let token = await getDriveToken();
        ctrl.busy('Empaquetando');
        const { blob, base } = await buildZipBlob(job, ALL_LABELS, (k, n) =>
          ctrl.progress((k / n) * 0.5),
        );
        ctrl.busy('Subiendo a Drive…');
        const onUp = (p) => ctrl.progress(0.5 + (p / 100) * 0.5);
        let result;
        try {
          result = await uploadZipToDrive(token, blob, base, onUp);
        } catch (e) {
          if (e.status === 401) {
            token = await getDriveToken();
            result = await uploadZipToDrive(token, blob, base, onUp);
          } else {
            throw e;
          }
        }
        ctrl.done('Guardado');
        const link = document.createElement('p');
        link.className = 'studio__drive-link';
        link.innerHTML = `Guardado en Drive · <a href="${escHtml(result.folderUrl)}" target="_blank" rel="noopener">abrir carpeta</a>`;
        actionsEl.insertAdjacentElement('afterend', link);
      } catch (e) {
        ctrl.error();
        const err = document.createElement('p');
        err.className = 'studio__error';
        err.textContent = e.message || 'No pudimos guardar en Drive.';
        actionsEl.insertAdjacentElement('afterend', err);
      } finally {
        driveBtn.disabled = false;
      }
    });
  }

  body.querySelector('#studio-new').addEventListener('click', () => renderIdle(body, quota));
}
