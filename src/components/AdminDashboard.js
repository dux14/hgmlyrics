import { navigate } from '../router.js';
import { getState } from '../lib/store.js';
import { icon } from '../lib/icons.js';
import { escapeHtml as escapeHtmlLocal } from '../lib/escape.js';
import '../styles/admin-dashboard.css';
import '../styles/editor.css'; // B4 (perf): .form-group/.editor__* — movido desde app.css

const HUB_CARDS = [
  {
    id: 'create',
    path: '/admin/create',
    iconName: 'plus',
    title: 'Crear canción',
    desc: 'Agregar una canción nueva a la wiki.',
  },
  {
    id: 'edit',
    path: '/admin/edit',
    iconName: 'pencil',
    title: 'Modificar canción',
    desc: 'Buscar y editar una canción existente.',
  },
  {
    id: 'voz',
    path: '/admin/voz/nueva',
    iconName: 'gospel',
    title: 'Voces en off',
    desc: 'Publicar una nueva voz en off.',
  },
  {
    id: 'mundo',
    path: '/admin/mundo',
    iconName: 'globe',
    title: 'Mundo Virtual',
    desc: 'Administrar mapas y tilesets del mundo.',
  },
];

export function renderAdminDashboard(container) {
  container.innerHTML = `
    <div class="admin-dashboard fade-in">
      <h1 class="editor__title admin-dashboard__title">Panel de administración</h1>

      <div class="admin-hub">
        ${HUB_CARDS.map(
          (card) => `
          <button class="admin-hub__card" id="admin-hub-${card.id}">
            ${icon(card.iconName, { size: 24 })}
            <span class="admin-hub__card-text">
              <span class="admin-hub__card-title">${card.title}</span>
              <span class="admin-hub__card-desc">${card.desc}</span>
            </span>
          </button>`,
        ).join('')}
      </div>
    </div>
  `;

  HUB_CARDS.forEach((card) => {
    container.querySelector(`#admin-hub-${card.id}`).addEventListener('click', () => {
      navigate(card.path);
    });
  });
}

export function renderAdminEditList(container) {
  const { songs } = getState();

  container.innerHTML = `
    <div class="admin-edit-list fade-in">
      <div class="admin-header-row">
        <button class="btn btn--back" id="btn-back">
          ${icon('arrow-left', { size: 18 })} Volver
        </button>
        <h1 class="editor__title">Modificar canción</h1>
      </div>

      <div class="form-group">
        <input type="search" id="admin-search" class="form-group__input" placeholder="Buscar por titulo, album o artista..." autocomplete="off" />
      </div>

      <div id="admin-song-list" class="admin-song-list">
        <!-- La lista se puebla dinamicamente -->
      </div>
    </div>
  `;

  container.querySelector('#btn-back').addEventListener('click', () => {
    navigate('/admin');
  });

  const searchInput = container.querySelector('#admin-search');
  const listContainer = container.querySelector('#admin-song-list');

  function renderList(query = '') {
    const q = query.toLowerCase().trim();
    const filtered = songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.album && s.album.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)),
    );

    if (filtered.length === 0) {
      listContainer.innerHTML = '<p class="admin-empty">No se encontraron canciones.</p>';
      return;
    }

    listContainer.innerHTML = filtered
      .map(
        (s) => `
      <div class="admin-song-item" data-id="${s.id}">
        <div>
          <div class="admin-song-item__title">${escapeHtmlLocal(s.title)}</div>
          <div class="admin-song-item__meta">${escapeHtmlLocal(s.album || 'Sin album')} · ${s.year || ''}</div>
        </div>
        <button class="btn btn--primary admin-edit-btn">Editar</button>
      </div>
    `,
      )
      .join('');

    listContainer.querySelectorAll('.admin-song-item').forEach((item) => {
      item.addEventListener('click', () => {
        navigate('/admin/edit/' + item.dataset.id);
      });
    });
  }

  // Initial render
  renderList();

  // Search event
  searchInput.addEventListener('input', (e) => {
    renderList(e.target.value);
  });
}
