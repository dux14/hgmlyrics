/**
 * ToolsHub.js — Hub de Herramientas.
 *
 * 3 tiles tappables → Afinador · Recomendador · Separador rápido / Partitura rápida.
 * Iconos via helper icon() — sin emojis.
 */

import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';
import '../styles/tools-hub.css';

const TOOLS = [
  {
    id: 'afinador',
    label: 'Afinador vocal',
    desc: 'Detecta tu tono en tiempo real',
    path: '/afinador',
    iconKey: 'audio-lines',
    tone: 'teal',
    beta: true,
    anim: 'eq',
  },
  {
    id: 'recomendador',
    label: 'Recomendador',
    desc: 'Canciones según tu voz y gusto',
    path: '/recomendador',
    iconKey: 'sparkles',
    tone: 'violet',
    beta: true,
    anim: 'sparkle',
  },
  {
    id: 'estudio',
    label: 'Separador rápido',
    desc: 'Sin canción · se borra a las 48 horas',
    path: '/estudio',
    iconKey: 'layers',
    tone: 'amber',
    beta: true,
    anim: 'layers',
  },
  {
    id: 'partitura',
    label: 'Partitura rápida',
    desc: 'Sin canción · se borra a las 48 horas',
    path: '/partitura',
    iconKey: 'music',
    tone: 'rose',
    beta: true,
    anim: 'notes',
  },
];

/** Genera el markup de animación idle según el tipo de motivo. */
function animMarkup(anim) {
  if (anim === 'eq') {
    return '<span class="tools-hub__anim-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
  }
  if (anim === 'sparkle') {
    return '<span class="tools-hub__anim-sparkle" aria-hidden="true"><span></span><span></span><span></span><span></span></span>';
  }
  if (anim === 'layers') {
    return '<span class="tools-hub__anim-layers" aria-hidden="true"><i></i><i></i><i></i></span>';
  }
  if (anim === 'notes') {
    return (
      '<span class="tools-hub__anim-notes" aria-hidden="true">' +
      '<i class="tools-hub__staff"></i><i class="tools-hub__staff"></i><i class="tools-hub__staff"></i>' +
      '<span class="tools-hub__note-runner"><span class="tools-hub__note-dot"></span></span>' +
      '</span>'
    );
  }
  return '';
}

/**
 * Renderiza el hub de Herramientas en `container`.
 *
 * @param {HTMLElement} container
 */
export function renderToolsHub(container) {
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'tools-hub';

  const heading = document.createElement('h2');
  heading.className = 'tools-hub__title';
  heading.textContent = 'Herramientas';
  section.appendChild(heading);

  const sub = document.createElement('p');
  sub.className = 'tools-hub__sub';
  sub.textContent = 'Tu kit para cantar mejor';
  section.appendChild(sub);

  const grid = document.createElement('div');
  grid.className = 'tools-hub__grid';

  for (const tool of TOOLS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tools-hub__tile';
    tile.dataset.tool = tool.id;

    const betaBadge = tool.beta ? ' <span class="badge--beta">BETA</span>' : '';

    tile.innerHTML = `
      <span class="tools-hub__tile-icon tools-hub__tile-icon--${tool.tone}">
        ${animMarkup(tool.anim)}${icon(tool.iconKey, { size: 22 })}
      </span>
      <span class="tools-hub__tile-body">
        <span class="tools-hub__tile-label">${tool.label}${betaBadge}</span>
        <span class="tools-hub__tile-desc">${tool.desc}</span>
      </span>
      <span class="tools-hub__tile-arrow">${icon('chevron-right', { size: 16 })}</span>
    `;

    tile.addEventListener('click', () => navigate(tool.path));
    grid.appendChild(tile);
  }

  section.appendChild(grid);
  container.appendChild(section);
}
