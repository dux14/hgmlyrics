import { navigate } from '../router.js';
import { renderLogoutButton } from './AdminGate.js';
import { getState } from '../lib/store.js';

export function renderAdminDashboard(container) {
  container.innerHTML = `
    <div class="admin-dashboard fade-in" style="max-width: 600px; margin: 2rem auto; padding: 2rem; background: var(--color-surface); border-radius: var(--border-radius-lg); box-shadow: 0 4px 12px var(--color-shadow);">
      <h1 class="editor__title" style="text-align: center; margin-bottom: 2rem;">Panel de Administración</h1>
      
      <div style="display: grid; gap: 1rem;">
        <button class="btn btn--primary" id="btn-create" style="padding: 1.5rem; font-size: 1.2rem;">
          ✨ Crear nueva canción
        </button>
        <button class="btn btn--secondary" id="btn-edit" style="padding: 1.5rem; font-size: 1.2rem;">
          ✏️ Modificar canción existente
        </button>
      </div>
    </div>
  `;

  renderLogoutButton(container.querySelector('.admin-dashboard'));

  container.querySelector('#btn-create').addEventListener('click', () => {
    navigate('/admin/create');
  });

  container.querySelector('#btn-edit').addEventListener('click', () => {
    navigate('/admin/edit');
  });
}

export function renderAdminEditList(container) {
  const { songs } = getState();

  container.innerHTML = `
    <div class="admin-edit-list fade-in" style="max-width: 800px; margin: 2rem auto; padding: 2rem; background: var(--color-surface); border-radius: var(--border-radius-lg); box-shadow: 0 4px 12px var(--color-shadow);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <h1 class="editor__title" style="margin: 0;">Modificar Canción</h1>
        <button class="btn btn--secondary" id="btn-back" style="padding: 0.5rem 1rem;">← Volver</button>
      </div>
      
      <div class="form-group">
        <input type="search" id="admin-search" class="form-group__input" placeholder="Buscar por título, álbum o artista..." autocomplete="off" />
      </div>

      <div id="admin-song-list" style="margin-top: 2rem; display: flex; flex-direction: column; gap: 0.5rem; max-height: 500px; overflow-y: auto;">
        <!-- List will be populated here -->
      </div>
    </div>
  `;

  renderLogoutButton(container.querySelector('.admin-edit-list'));

  container.querySelector('#btn-back').addEventListener('click', () => {
    navigate('/admin');
  });

  const searchInput = container.querySelector('#admin-search');
  const listContainer = container.querySelector('#admin-song-list');

  function renderList(query = '') {
    const q = query.toLowerCase().trim();
    const filtered = songs.filter(s => 
      s.title.toLowerCase().includes(q) || 
      (s.album && s.album.toLowerCase().includes(q)) ||
      (s.artist && s.artist.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      listContainer.innerHTML = '<p style="text-align:center; color: var(--color-text-secondary); padding: 2rem 0;">No se encontraron canciones.</p>';
      return;
    }

    listContainer.innerHTML = filtered.map(s => `
      <div class="admin-song-item" data-id="${s.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius-md); cursor: pointer; transition: border-color var(--transition-fast);">
        <div>
          <div style="font-weight: 600; font-size: 1rem;">${escapeHtmlLocal(s.title)}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 0.25rem;">${escapeHtmlLocal(s.album || 'Sin álbum')} · ${s.year || ''}</div>
        </div>
        <button class="btn btn--primary" style="padding: 0.5rem 1rem;">Editar</button>
      </div>
    `).join('');

    listContainer.querySelectorAll('.admin-song-item').forEach(item => {
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

function escapeHtmlLocal(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
