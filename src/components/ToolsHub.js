/**
 * ToolsHub.js — Hub de Herramientas.
 *
 * 3 tiles tappables → Afinador · Recomendador · Estudio.
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
    beta: false,
  },
  {
    id: 'recomendador',
    label: 'Recomendador',
    desc: 'Canciones según tu voz y gusto',
    path: '/recomendador',
    iconKey: 'sparkles',
    tone: 'violet',
    beta: true,
  },
  {
    id: 'estudio',
    label: 'Estudio de pistas',
    desc: 'Separa voces y descarga stems',
    path: '/estudio',
    iconKey: 'layers',
    tone: 'amber',
    beta: true,
  },
];

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
      <span class="tools-hub__tile-icon tools-hub__tile-icon--${tool.tone}">${icon(tool.iconKey, { size: 22 })}</span>
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
