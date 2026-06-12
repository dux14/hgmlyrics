/**
 * StudioSectionCard.js — Tarjeta acordeón para una sección del DAG del Estudio.
 * Presentacional: no cablea audio ni timeline. El montaje lo hace StudioPage.
 * Namespace CSS: .studio-section-card*
 */
import { icon } from '../lib/icons.js';
import { sectionLabel, sectionState } from '../lib/studioSections.js';

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

const SECTION_ICONS = {
  voiceInstrumental: 'music',
  structure: 'list',
  leadBacking: 'mic',
  gender: 'users',
};

/**
 * Tarjeta acordeón para una sección del Estudio.
 *
 * @param {{ key: string, section: object, stems?: object, voices?: object }} opts
 * @returns {HTMLElement}
 */
export function renderSectionCard({ key, section, stems = {}, voices = {} }) {
  const { status } = sectionState(section);
  const label = sectionLabel(key);

  const card = document.createElement('section');
  card.className = `studio-section-card studio-section-card--${key} studio-section-card--${status}`;

  // Por defecto: done expandida, failed expandida; el resto colapsado
  const collapsed = status !== 'done' && status !== 'failed';
  if (collapsed) card.classList.add('studio-section-card--collapsed');

  // --- Header ---
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'studio-section-card__header';
  header.setAttribute('aria-expanded', String(!collapsed));

  const iconName = SECTION_ICONS[key] ?? 'layers';
  const titleEl = document.createElement('span');
  titleEl.className = 'studio-section-card__title';
  titleEl.innerHTML = `${icon(iconName, { size: 16 })} `;
  const titleText = document.createTextNode(label);
  titleEl.appendChild(titleText);

  const chip = document.createElement('span');
  chip.className = `studio-section-card__chip studio-section-card__chip--${status}`;
  chip.textContent = chipText(status);

  header.appendChild(titleEl);
  header.appendChild(chip);
  card.appendChild(header);

  // --- Cuerpo ---
  const body = document.createElement('div');
  body.className = 'studio-section-card__body';
  buildBody(body, key, status, section, stems, voices);
  card.appendChild(body);

  // --- Acordeón toggle ---
  header.addEventListener('click', () => {
    const isCollapsed = card.classList.toggle('studio-section-card--collapsed');
    header.setAttribute('aria-expanded', String(!isCollapsed));
  });

  return card;
}

function chipText(status) {
  switch (status) {
    case 'pending':
      return 'En espera';
    case 'running':
      return 'Separando…';
    case 'done':
      return 'Listo';
    case 'failed':
      return 'Error';
    case 'skipped':
      return 'Beta · próximamente';
    default:
      return status;
  }
}

function buildBody(body, key, status, section, stems, voices) {
  if (status === 'pending') {
    const sk = document.createElement('div');
    sk.className = 'studio-section-card__skeleton';
    body.appendChild(sk);
    return;
  }

  if (status === 'running') {
    const eq = document.createElement('div');
    eq.className = 'studio-eq studio-section-card__eq';
    eq.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) {
      const bar = document.createElement('span');
      bar.className = 'studio-eq__bar';
      bar.style.setProperty('--i', String(i));
      eq.appendChild(bar);
    }
    body.appendChild(eq);
    return;
  }

  if (status === 'failed') {
    const msg = document.createElement('p');
    msg.className = 'studio__error studio-section-card__error-msg';
    msg.textContent = section.error ?? 'El procesamiento de esta sección falló.';
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn studio-section-card__retry';
    retryBtn.dataset.section = key;
    retryBtn.textContent = '⚠ Reintentar';
    body.appendChild(msg);
    body.appendChild(retryBtn);
    return;
  }

  if (status === 'skipped' || key === 'gender') {
    const lock = document.createElement('div');
    lock.className = 'studio-section-card__locked';
    lock.innerHTML = `${icon('lock', { size: 20 })} `;
    const lockText = document.createTextNode('Disponible pronto');
    lock.appendChild(lockText);
    body.appendChild(lock);
    return;
  }

  // status === 'done'
  if (key === 'voiceInstrumental') {
    buildVoiceInstrumentalBody(body, stems);
  } else if (key === 'structure') {
    buildStructureBody(body, section);
  } else if (key === 'leadBacking') {
    buildLeadBackingBody(body, voices);
  }
}

function buildVoiceInstrumentalBody(body, stems) {
  // Vocals e instrumental siempre visibles (si existen)
  const primary = ['vocals', 'instrumental'];
  const collapsible = ['drums', 'bass', 'guitar', 'piano', 'other'];

  let primaryMounted = false;

  for (const stemKey of primary) {
    if (!stems[stemKey]) continue;
    const mount = document.createElement('div');
    mount.className = 'studio-player-mount';
    mount.dataset.label = STEM_LABELS[stemKey];
    mount.dataset.url = stems[stemKey];
    if (!primaryMounted) {
      mount.dataset.primary = '1';
      primaryMounted = true;
    }
    body.appendChild(mount);
  }

  const collapsibleStems = collapsible.filter((k) => stems[k]);
  if (collapsibleStems.length > 0) {
    const details = document.createElement('details');
    details.className = 'studio-section-card__more';
    const summary = document.createElement('summary');
    summary.className = 'studio-section-card__more-summary';
    summary.textContent = 'Más pistas';
    details.appendChild(summary);

    for (const stemKey of collapsibleStems) {
      const mount = document.createElement('div');
      mount.className = 'studio-player-mount';
      mount.dataset.label = STEM_LABELS[stemKey];
      mount.dataset.url = stems[stemKey];
      details.appendChild(mount);
    }
    body.appendChild(details);
  }
}

function buildStructureBody(body, section) {
  const segments = section.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state__text';
    empty.textContent = 'Sin secciones detectadas';
    body.appendChild(empty);
    return;
  }
  const mount = document.createElement('div');
  mount.className = 'studio-sectl-mount';
  body.appendChild(mount);
}

function buildLeadBackingBody(body, voices) {
  let primaryMounted = false;
  for (const [voiceKey, label] of Object.entries(VOICE_LABELS)) {
    if (!voices[voiceKey]) continue;
    const mount = document.createElement('div');
    mount.className = 'studio-player-mount';
    mount.dataset.label = label;
    mount.dataset.url = voices[voiceKey];
    if (!primaryMounted) {
      mount.dataset.primary = '1';
      primaryMounted = true;
    }
    body.appendChild(mount);
  }
}
