/**
 * PartituraPage.js — Partitura vocal (BETA): sube un audio y lo convertimos en
 * partitura letra↔nota por sílaba. Estados: idle → uploading → processing → done | failed.
 * Espeja el patrón de StudioPage.js (root repintado por estado).
 */
import '../styles/partitura.css';
import { icon } from '../lib/icons.js';
import * as pitchApi from '../lib/pitchApi.js';
import { skelBlock, skelLine } from '../lib/skeleton.js';

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

// Guarda de navegación del polling del job activo. Placeholder no-op: Task 6
// la completa con el polling real (mismo patrón que StudioPage#stopPolling).
function stopPolling() {
  // TODO Task 6: detener polling/canal Realtime del job activo.
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

  // Referencia forward a Task 6: al salir de #/partitura hay que cortar el polling
  // del job activo. stopPolling es no-op hasta que Task 6 lo implemente.
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

// eslint-disable-next-line no-unused-vars -- placeholder: Task 5 completa la subida real.
async function handleFile(body, file, profile, quota) {
  body.setAttribute('aria-busy', 'true');
  // TODO Task 5: createJob + uploadInput + (estimate/approve según profile).
}
