/**
 * StudioPage.js — Estudio de pistas (BETA): sube un audio, sepáralo en stems
 * y divide la pista vocal (líder/coros + segmentos por cantante).
 * Estados: idle → uploading → processing → done | failed.
 */
import { icon } from '../lib/icons.js';
import { SECTION_KEYS, sectionLabel } from '../lib/studioSections.js';
import {
  createJob,
  uploadInput,
  startJob,
  getJob,
  listJobs,
  readAudioDuration,
  watchJobRealtime,
  updateJobTitle,
} from '../lib/stemsApi.js';
import { getSession } from '../lib/authStore.js';
import { downloadAllZip, buildTrackList, songBaseName, downloadSectionZip } from '../lib/studioZip.js';
import { getDriveToken } from '../lib/driveAuth.js';
import { uploadTracksToDrive } from '../lib/driveUpload.js';
import { createActionButton } from '../lib/studioActionButton.js';
import { isMp3File, deriveTitleFromFilename } from '../lib/studioFile.js';
export { isMp3File };
import { createStudioPlayer } from './StudioPlayer.js';
import { renderTimeline, markActive } from './StudioSectionTimeline.js';
import { renderSectionCard } from './StudioSectionCard.js';
import { escapeHtml as escHtml, safeUrl } from '../lib/escape.js';

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
      : `Te quedan <strong>${Number(quota.limit) - Number(quota.used)} de ${Number(quota.limit)}</strong> canciones hoy. Los resultados expiran a las 48 h.`;
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
  drop.addEventListener('dragenter', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragover');
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragover');
  });
  drop.addEventListener('dragleave', (e) => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-dragover');
  });
  const rejectNonMp3 = () => {
    renderIdle(body, quota);
    body.insertAdjacentHTML(
      'afterbegin',
      `<p class="studio__error">Solo aceptamos archivos MP3.</p>`,
    );
  };
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
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
  renderReviewPanel(body, file, quota);
}

function renderReviewPanel(body, file, quota) {
  const defaultTitle = deriveTitleFromFilename(file.name);
  const sectionRows = SECTION_KEYS.map(
    (key) => `
      <label class="studio-review__section">
        <input type="checkbox" class="studio-review__section-check" data-section="${key}" checked />
        <span class="studio-review__section-label">${escHtml(sectionLabel(key))}</span>
      </label>`,
  ).join('');

  body.innerHTML = `
    <div class="studio-review">
      <p class="studio-review__filename">${icon('audio-lines', { size: 16 })} <span>${escHtml(file.name)}</span></p>
      <label class="studio-review__field">
        <span class="studio-review__field-label">Título</span>
        <input type="text" class="studio-review__title-input" maxlength="120" value="${escHtml(defaultTitle)}" />
      </label>
      <fieldset class="studio-review__sections">
        <legend class="studio-review__legend">Qué procesar</legend>
        ${sectionRows}
      </fieldset>
      <div class="studio-review__actions">
        <button type="button" class="btn studio-review__cancel">Cancelar</button>
        <button type="button" class="btn btn--primary studio-review__submit">
          ${icon('play', { size: 16 })} <span class="studio-review__submit-label"></span>
        </button>
      </div>
    </div>
  `;

  const submit = body.querySelector('.studio-review__submit');
  const submitLabel = body.querySelector('.studio-review__submit-label');
  const titleInput = body.querySelector('.studio-review__title-input');
  const checks = [...body.querySelectorAll('.studio-review__section-check')];

  const selected = () => checks.filter((c) => c.checked).map((c) => c.dataset.section);
  const syncSubmit = () => {
    const n = selected().length;
    submit.disabled = n === 0;
    submitLabel.textContent =
      n === 0 ? 'Elige una sección' : `Procesar ${n} ${n === 1 ? 'sección' : 'secciones'}`;
  };
  checks.forEach((c) => c.addEventListener('change', syncSubmit));
  syncSubmit();

  body.querySelector('.studio-review__cancel').addEventListener('click', () =>
    renderIdle(body, quota),
  );
  submit.addEventListener('click', () => {
    const sections = selected();
    if (sections.length === 0) return;
    const title = titleInput.value.trim() || deriveTitleFromFilename(file.name);
    void startUpload(body, file, title, sections, quota);
  });
}

async function startUpload(body, file, title, enabledSections, quota) {
  body.innerHTML = `<p aria-busy="true">Subiendo <strong>${escHtml(file.name)}</strong>…</p>`;
  try {
    const { job, upload } = await createJob(file, title);
    await uploadInput(upload, file);
    await startJob(job.id, enabledSections);
    watchJob(body, job.id, quota, file.name);
  } catch (e) {
    body.innerHTML = `
      <p class="studio__error">${escHtml(e.message)}</p>
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

  // --- Cablear "Procesar ahora" (reanudar sección skipped) ---
  body.querySelectorAll('.studio-section-card__resume').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Iniciando…';
      try {
        const s = getSession();
        const headers = s ? { Authorization: `Bearer ${s.access_token}` } : {};
        const res = await fetch(
          `/api/stems/jobs/${job.id}/retry?section=${encodeURIComponent(section)}`,
          { method: 'POST', headers },
        );
        if (!res.ok) {
          const b2 = await res.json().catch(() => ({}));
          throw new Error(b2.error ?? `Error ${res.status}`);
        }
        watchJob(body, job.id, quota, job.input_meta?.title ?? job.input_meta?.filename);
      } catch (e) {
        btn.textContent = original;
        btn.disabled = false;
        let errEl = btn.parentElement.querySelector('.studio__error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'studio__error';
          btn.parentElement.appendChild(errEl);
        }
        errEl.textContent = e.message || 'No se pudo iniciar.';
      }
    });
  });

  // --- Cablear "Descargar sección (ZIP)" ---
  body.querySelectorAll('.studio-section-card__dl').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Empaquetando…';
      try {
        await downloadSectionZip(job, ALL_LABELS, section);
        btn.textContent = original;
      } catch (e) {
        let errEl = btn.parentElement.querySelector('.studio__error');
        if (!errEl) {
          errEl = document.createElement('p');
          errEl.className = 'studio__error';
          btn.parentElement.appendChild(errEl);
        }
        errEl.textContent = e.message || 'No pudimos generar el ZIP de la sección.';
        btn.textContent = original;
      } finally {
        btn.disabled = false;
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

  const displayName = job.input_meta?.title || filename;
  if (displayName) {
    const filenameEl = document.createElement('p');
    filenameEl.className = 'studio__filename';
    filenameEl.title = displayName;
    filenameEl.innerHTML = `${icon('audio-lines', { size: 16 })} `;
    const span = document.createElement('span');
    span.textContent = displayName;
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
      <p class="studio__error">${escHtml(job.error ?? 'El procesamiento falló.')}</p>
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

  // Título editable (input_meta.title con fallback al filename sin extensión)
  const displayTitle =
    job.input_meta?.title || (job.input_meta?.filename ?? '').replace(/\.[^/.]+$/, '') || 'Audio';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'studio__title-row';
  const titleText = document.createElement('span');
  titleText.className = 'studio__title-text';
  titleText.textContent = displayTitle;
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'studio__title-edit';
  editBtn.setAttribute('aria-label', 'Editar título');
  editBtn.innerHTML = icon('pencil', { size: 14 });
  titleWrap.appendChild(titleText);
  titleWrap.appendChild(editBtn);
  frag.appendChild(titleWrap);

  editBtn.addEventListener('click', () => {
    titleWrap.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'studio__title-input';
    input.maxLength = 120;
    input.value = titleText.textContent;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn studio__title-save';
    save.textContent = 'Guardar';
    titleWrap.appendChild(input);
    titleWrap.appendChild(save);
    input.focus();
    const commit = async () => {
      const next = input.value.trim();
      if (!next) { renderJob(body, job, quota); return; }
      save.disabled = true;
      try {
        const { job: updated } = await updateJobTitle(job.id, next);
        renderJob(body, updated, quota);
      } catch {
        renderJob(body, job, quota);
      }
    };
    save.addEventListener('click', () => void commit());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void commit();
      if (e.key === 'Escape') renderJob(body, job, quota);
    });
  });

  // Acciones ZIP + Drive — solo cuando todas las secciones activas (no skipped) están done.
  const activeSections = SECTION_KEYS.map((k) => sections[k]).filter((s) => s && s.status !== 'skipped');
  const allActiveDone = activeSections.length > 0 && activeSections.every((s) => s.status === 'done');
  if (allActiveDone) {
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
  }

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

  // --- Drive (archivos sueltos) ---
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
        ctrl.busy('Subiendo a Drive…');
        const tracks = buildTrackList(job, ALL_LABELS);
        const base = songBaseName(job);
        const { uploaded, failed, folderUrl } = await uploadTracksToDrive(
          getDriveToken,
          tracks,
          base,
          (p) => ctrl.progress(p),
        );

        if (uploaded.length === 0) {
          throw new Error(failed[0]?.message || 'No pudimos subir las pistas.');
        }

        ctrl.done('Guardado');
        const total = uploaded.length + failed.length;
        const label =
          failed.length === 0 ? 'Guardado en Drive' : `Subimos ${uploaded.length} de ${total}`;
        const link = document.createElement('p');
        link.className = 'studio__drive-link';
        link.innerHTML = `${label} · <a href="${safeUrl(folderUrl)}" target="_blank" rel="noopener">abrir carpeta</a>`;
        actionsEl.insertAdjacentElement('afterend', link);

        if (failed.length > 0) {
          const err = document.createElement('p');
          err.className = 'studio__error';
          err.textContent = `No subimos: ${failed.map((f) => f.name).join(', ')}.`;
          link.insertAdjacentElement('afterend', err);
        }
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
