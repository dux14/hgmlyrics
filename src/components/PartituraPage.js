/**
 * PartituraPage.js — Partitura vocal (BETA): sube un audio y lo convertimos en
 * partitura letra↔nota por sílaba. Estados: idle → uploading → processing → done | failed.
 * Espeja el patrón de StudioPage.js (root repintado por estado).
 */
import '../styles/partitura.css';
import { icon } from '../lib/icons.js';
import * as pitchApi from '../lib/pitchApi.js';
import { skelBlock, skelLine } from '../lib/skeleton.js';
import { PHASE_ORDER, phaseLabel, phaseProgress, isTerminalStatus } from '../lib/pitchProgress.js';
import { escapeHtml, safeUrl } from '../lib/escape.js';
import { createPoller } from '../lib/poller.js';

const POLL_MS = 3000;
let poller = null;

// Extensiones/MIME aceptados: mismo criterio doble que studioFile.js#isMp3File,
// ampliado a los formatos que soporta la Partitura (no solo MP3).
const ACCEPTED_MIME = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
]);
const ACCEPTED_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;

/**
 * Devuelve true si el archivo es un audio soportado por la Partitura.
 * Comprueba tanto el MIME type como la extensión (algunos navegadores móviles
 * reportan type vacío al seleccionar archivos).
 * @param {{ type: string, name: string }} file
 * @returns {boolean}
 */
export function isAcceptedAudio(file) {
  if (ACCEPTED_MIME.has(file.type)) return true;
  return ACCEPTED_EXT_RE.test(file.name);
}

// Formatea expires_at a fecha+hora legible en español neutro (Intl, sin libs de fechas).
function formatExpiry(iso) {
  try {
    return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return 'en 48 horas';
  }
}

// Guarda de navegación del polling del job activo (mismo patrón que StudioPage#stopPolling):
// registrada por renderPartituraPage vía hashchange {once:true} para no dejar timers huérfanos.
function stopPolling() {
  if (poller) poller.stop();
  poller = null;
}

export async function renderPartituraPage(container) {
  container.innerHTML = `
    <section class="partitura fade-in">
      <h1 class="partitura__title">
        ${icon('music', { size: 28 })} Partitura <span class="badge--beta">BETA</span>
      </h1>
      <p class="partitura__sub">Sube un audio y te devolvemos la letra con la nota de cada sílaba.</p>
      <div class="partitura__body" aria-busy="true" aria-live="polite">
        ${skelBlock({ h: 160 })}
        ${skelLine({ w: '60%' })}
      </div>
    </section>
  `;
  const body = container.querySelector('.partitura__body');

  // Al salir de #/partitura hay que cortar el polling del job activo para no
  // dejar timers huérfanos (mismo patrón que StudioPage).
  window.addEventListener('hashchange', stopPolling, { once: true });

  let quota = { used: 0, limit: 2 };
  try {
    const res = await pitchApi.listJobs();
    quota = res.quota ?? quota;
    // TODO Task 6: si hay un job activo (running/awaiting_approval), retomar esa
    // vista en vez de idle (ver res.jobs).
  } catch {
    // Cupo por defecto: no bloquea la subida si listJobs falla.
  }

  renderIdle(body, quota);
}

function renderIdle(body, quota) {
  body.setAttribute('aria-busy', 'false');
  const quotaHtml = quota.unlimited
    ? ''
    : `<p class="partitura__quota">${Number(quota.used)}/${Number(quota.limit)} hoy</p>`;
  body.innerHTML = `
    <div class="partitura__upload">
      <fieldset class="partitura__profiles">
        <label class="partitura__profile" data-profile="oss">
          <input type="radio" name="pitch-profile" value="oss" checked />
          <span class="partitura__profile-name">Gratis</span>
        </label>
        <label class="partitura__profile" data-profile="precision">
          <input type="radio" name="pitch-profile" value="precision" />
          <span class="partitura__profile-name">Costo estimado tras subir</span>
        </label>
      </fieldset>
      <label class="partitura__dropzone">
        ${icon('upload', { size: 28 })}
        <span class="partitura__dropzone-hint">Sube un audio (MP3, WAV, M4A, FLAC u OGG)</span>
        <input type="file" accept="audio/*" hidden />
      </label>
      <p class="partitura__error" hidden></p>
      ${quotaHtml}
    </div>
  `;

  const input = body.querySelector('input[type="file"]');
  const errorEl = body.querySelector('.partitura__error');

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!isAcceptedAudio(file)) {
      errorEl.textContent = 'Formato no soportado: sube MP3, WAV, M4A, FLAC u OGG.';
      errorEl.hidden = false;
      input.value = '';
      return;
    }
    errorEl.hidden = true;
    const checked = body.querySelector('input[name="pitch-profile"]:checked');
    const profile = checked?.value ?? 'oss';
    void handleFile(body, file, profile, quota);
  });
}

async function handleFile(body, file, profile, quota) {
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = `<p class="partitura__status">Subiendo audio…</p>`;
  try {
    const { job, upload } = await pitchApi.createJob(file, { title: null, profile });
    await pitchApi.uploadInput(upload, file);
    const durationSec = Math.round(await pitchApi.readAudioDuration(file));
    const { estimate } = await pitchApi.estimateJob(job.id, durationSec || 1);
    renderCostGate(body, job.id, estimate, quota);
  } catch (err) {
    renderUploadError(body, err, quota);
  }
}

function renderUploadError(body, err, quota) {
  body.setAttribute('aria-busy', 'false');
  const msg =
    err.status === 403
      ? 'Partitura vocal está en beta cerrada. Pide acceso a un admin.'
      : err.status === 429
        ? 'Llegaste al límite de jobs de hoy. Intenta mañana.'
        : (err.message ?? 'No se pudo procesar el audio. Intenta de nuevo.');
  body.innerHTML = `
    <p class="partitura__error" role="alert">${msg}</p>
    <button type="button" data-action="retry">Volver a intentar</button>
  `;
  body
    .querySelector('[data-action="retry"]')
    .addEventListener('click', () => renderIdle(body, quota));
}

function renderCostGate(body, jobId, estimate, quota) {
  body.setAttribute('aria-busy', 'false');
  const { lo, hi, breakdown } = estimate;
  const hasUnconfirmed = breakdown.some((item) => !item.confirmed);
  const items = breakdown
    .map((item) => {
      const label = item.label ?? item.phase ?? '';
      return `<li>${label}${item.confirmed ? '' : ' (*)'}</li>`;
    })
    .join('');
  const note = hasUnconfirmed
    ? '<p class="partitura__gate-note">(*) estimado, se confirma al terminar</p>'
    : '';
  body.innerHTML = `
    <div class="partitura__gate">
      <p class="partitura__gate-range">Costo estimado: $${lo} – $${hi}</p>
      <ul class="partitura__gate-breakdown">${items}</ul>
      ${note}
      <div class="partitura__gate-actions">
        <button type="button" data-action="approve">${icon('check', { size: 18 })} Aprobar</button>
        <button type="button" data-action="cancel">Cancelar</button>
      </div>
    </div>
  `;

  body.querySelector('[data-action="approve"]').addEventListener('click', async () => {
    body.setAttribute('aria-busy', 'true');
    try {
      await pitchApi.approveJob(jobId);
      startPolling(body, jobId, quota);
    } catch (err) {
      renderUploadError(body, err, quota);
    }
  });
  body.querySelector('[data-action="cancel"]').addEventListener('click', async () => {
    await pitchApi.cancelJob(jobId).catch(() => {});
    renderIdle(body, quota);
  });
}

// Poll de progreso: consulta getJob cada POLL_MS hasta que el status sea terminal.
function startPolling(body, jobId, quota) {
  stopPolling();
  const tick = async () => {
    let job;
    try {
      job = await pitchApi.getJob(jobId);
    } catch {
      // Red intermitente: reintenta en el próximo tick, no corta el poll.
      return;
    }
    if (isTerminalStatus(job.status)) {
      stopPolling();
      void renderResult(body, job, quota);
    } else {
      renderProcessing(body, job);
    }
  };
  poller = createPoller(tick, POLL_MS);
  poller.start({ immediate: true });
}

function renderProcessing(body, job) {
  body.setAttribute('aria-busy', 'false');
  const { done, total, pct } = phaseProgress(job.phases);
  const steps = PHASE_ORDER.map((key) => {
    const status = job.phases?.[key]?.status;
    const state = status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'pending';
    return `<li class="partitura__step partitura__step--${state}">${phaseLabel(key)}</li>`;
  }).join('');
  body.innerHTML = `
    <div class="partitura__processing">
      <p class="partitura__progress-label">${done}/${total} fases (${pct}%)</p>
      <div class="partitura__progress-bar"><div style="width:${pct}%"></div></div>
      <ol class="partitura__steps">${steps}</ol>
    </div>
  `;
}

// Reintenta el pipeline completo desde el visor de resultado (job failed/partial):
// reusa el job existente en vez de volver a idle, que forzaría re-subir el audio.
// Si el retry falla (ej. 409, el job ya cambió de estado) cae a renderIdle.
async function handleRetryClick(body, job, quota) {
  if (job.status !== 'failed' && job.status !== 'partial') {
    renderIdle(body, quota);
    return;
  }
  body.setAttribute('aria-busy', 'true');
  try {
    await pitchApi.retryJob(job.id);
    startPolling(body, job.id, quota);
  } catch {
    renderIdle(body, quota);
  }
}

// Visor de resultado: partitura letra↔nota por voz (analysis.json) + descargas
// agrupadas por kind del resto de artifacts. No asume qué artifacts trae el
// pipeline más allá de 'analysis' (score_svg/midi/musicxml son de M2, opcionales).
async function renderResult(body, job, quota) {
  body.setAttribute('aria-busy', 'false');
  if (job.status !== 'succeeded' && job.status !== 'partial') {
    body.innerHTML = `
      <p class="partitura__error" role="alert">No se pudo generar la partitura.</p>
      <button type="button" data-action="retry">Volver a intentar</button>
    `;
    body
      .querySelector('[data-action="retry"]')
      .addEventListener('click', () => handleRetryClick(body, job, quota));
    return;
  }

  const artifacts = job.artifacts ?? [];
  const analysisArt = artifacts.find((a) => a.kind === 'analysis');
  const others = artifacts.filter((a) => a.kind !== 'analysis' && a.url);

  if (!analysisArt?.url) {
    const msg =
      job.status === 'succeeded'
        ? 'Listo, pero sin artefactos aún.'
        : 'El proceso terminó parcialmente.';
    body.innerHTML = `<div class="partitura__result"><p class="partitura__status">${msg}</p></div>`;
    appendRestartButton(body, job, quota);
    return;
  }

  let analysis = null;
  try {
    analysis = await (await fetch(analysisArt.url)).json();
  } catch {
    analysis = null;
  }

  const voiceKeys = analysis?.voices_present ?? [];
  let voiceMode = voiceKeys[0] ?? 'all';

  const downloadsHtml = others.length
    ? `<ul class="partitura__downloads">${others
        .map(
          (a) =>
            `<li><a href="${safeUrl(a.url)}" download>${icon('download', { size: 14 })} ${escapeHtml(a.kind)}</a></li>`,
        )
        .join('')}</ul>`
    : '';

  const expiresHtml = job.expires_at
    ? `<p class="partitura__expires">${icon('clock', { size: 14 })} Este resultado se borra el ${formatExpiry(job.expires_at)}. Descarga lo que necesites antes.</p>`
    : '';

  body.innerHTML = `
    <div class="partitura__result">
      <div class="partitura__voices-container">${renderVoicesSection(analysis, voiceKeys, voiceMode)}</div>
      ${downloadsHtml}
      ${expiresHtml}
    </div>
  `;

  const voicesContainer = body.querySelector('.partitura__voices-container');
  voicesContainer?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-voice-mode]');
    if (!btn) return;
    voiceMode = btn.dataset.voiceMode;
    voicesContainer.innerHTML = renderVoicesSection(analysis, voiceKeys, voiceMode);
  });

  appendRestartButton(body, job, quota);
}

// Pinta una voz (lead/backing…) como hoja de karaoke: una línea por línea de
// letra, una columna por sílaba (texto arriba, nota debajo).
function renderVoice(voiceKey, voice) {
  if (!voice?.lines) return '';
  const lines = voice.lines
    .map((line) => {
      const syllables = (line.syllables ?? [])
        .map((s) => {
          const label = s.blank ? '' : s.ditto ? "''" : (s.note ?? '');
          return `<span class="partitura__syl"><span class="partitura__syl-text">${escapeHtml(s.text)}</span><span class="partitura__syl-note">${escapeHtml(label)}</span></span>`;
        })
        .join('');
      return `<p class="partitura__line">${syllables}</p>`;
    })
    .join('');
  return `<section class="partitura__voice"><h3>${escapeHtml(voiceKey)}</h3>${lines}</section>`;
}

// Selector de voces del visor: 'all' superpone todas las voces apiladas (como
// antes); una key de voiceKeys aisla solo esa voz (alternar, no superposición
// nota-sobre-nota). El selector solo aparece si hay 2+ voces.
function renderVoicesSection(analysis, voiceKeys, mode) {
  if (!analysis) {
    return `<p class="partitura__error" role="alert">No se pudo cargar la partitura.</p>`;
  }
  const keysToShow = mode === 'all' ? voiceKeys : [mode];
  const voicesHtml =
    keysToShow.map((key) => renderVoice(key, analysis.voices?.[key])).join('') ||
    `<p class="partitura__empty-voice">No hay datos de partitura para esta voz.</p>`;
  if (voiceKeys.length < 2) return voicesHtml;
  const tabs = ['all', ...voiceKeys]
    .map(
      (k) =>
        `<button type="button" role="tab" aria-selected="${k === mode}" class="partitura__voice-tab${k === mode ? ' is-active' : ''}" data-voice-mode="${escapeHtml(k)}">${k === 'all' ? 'Todas' : escapeHtml(k)}</button>`,
    )
    .join('');
  return `<div class="partitura__voice-tabs" role="tablist">${tabs}</div><div class="partitura__voices" role="tabpanel">${voicesHtml}</div>`;
}

// Botones tras el resultado: si el job quedó 'partial', ofrece reintentar el
// pipeline completo sobre el mismo job (además de procesar otro audio).
function appendRestartButton(body, job, quota) {
  if (job.status === 'partial') {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.dataset.action = 'retry';
    retryBtn.textContent = 'Volver a intentar';
    retryBtn.addEventListener('click', () => handleRetryClick(body, job, quota));
    body.appendChild(retryBtn);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.action = 'restart';
  btn.textContent = 'Procesar otro audio';
  btn.addEventListener('click', () => renderIdle(body, quota));
  body.appendChild(btn);
}
