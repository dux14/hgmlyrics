/**
 * ToolsHub.js — Hub de Herramientas.
 *
 * 3 tiles tappables → Afinador · Recomendador · Estudio.
 * Iconos via helper icon() — sin emojis.
 */

import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';

const TOOLS = [
  {
    id: 'afinador',
    label: 'Afinador',
    path: '/afinador',
    iconKey: 'audio-lines',
    beta: false,
  },
  {
    id: 'recomendador',
    label: 'Recomendador',
    path: '/recomendador',
    iconKey: 'sparkles',
    beta: true,
  },
  {
    id: 'estudio',
    label: 'Estudio',
    path: '/estudio',
    iconKey: 'layers',
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

  const grid = document.createElement('div');
  grid.className = 'tools-hub__grid';

  for (const tool of TOOLS) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tools-hub__tile';
    tile.dataset.tool = tool.id;

    const betaBadge = tool.beta ? ' <span class="badge--beta">BETA</span>' : '';

    tile.innerHTML = `
      <span class="tools-hub__tile-icon">${icon(tool.iconKey, { size: 28 })}</span>
      <span class="tools-hub__tile-label">${tool.label}${betaBadge}</span>
    `;

    tile.addEventListener('click', () => navigate(tool.path));
    grid.appendChild(tile);
  }

  section.appendChild(grid);
  container.appendChild(section);
}
