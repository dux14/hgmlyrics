import { navigate } from '../router.js';
import { getState } from '../lib/store.js';
import { icon } from '../lib/icons.js';
import { getSession, isAdmin } from '../lib/authStore.js';
import { mountAdminWorldPanel } from './AdminWorldPanel.js';
import { escapeHtml as escapeHtmlLocal } from '../lib/escape.js';

export function renderAdminDashboard(container) {
  container.innerHTML = `
    <div class="admin-dashboard fade-in" style="max-width: 600px; margin: 2rem auto; padding: 2rem; background: var(--color-surface); border-radius: var(--border-radius-lg); box-shadow: 0 4px 12px var(--color-shadow);">
      <h1 class="editor__title" style="text-align: center; margin-bottom: 2rem;">Panel de Administración</h1>

      <div style="display: grid; gap: 1rem;">
        <button class="btn btn--primary" id="btn-create" style="padding: 1.5rem; font-size: 1.2rem;">
          ${icon('plus', { size: 20 })} Crear nueva canción
        </button>
        <button class="btn btn--secondary" id="btn-edit" style="padding: 1.5rem; font-size: 1.2rem;">
          ${icon('pencil', { size: 20 })} Modificar canción existente
        </button>
      </div>

      <section class="ff-section" id="ff-section">
        <h2 class="ff-section__title">${icon('flag', { size: 18 })} Feature Flags</h2>
        <div id="ff-list" class="ff-list"></div>
      </section>

      <div id="wm-panel-mount"></div>
    </div>
  `;

  container.querySelector('#btn-create').addEventListener('click', () => {
    navigate('/admin/create');
  });

  container.querySelector('#btn-edit').addEventListener('click', () => {
    navigate('/admin/edit');
  });

  wireFeatureFlags(container);
  loadFlags(container);

  // Panel de mundos: solo visible para admins (doble chequeo UX; el server
  // también aplica requireAdmin en todos los endpoints de world-map).
  if (isAdmin()) {
    const wmMount = container.querySelector('#wm-panel-mount');
    if (wmMount) mountAdminWorldPanel(wmMount);
  }
}

function authHeader() {
  const session = getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}

async function loadFlags(root) {
  const listEl = root.querySelector('#ff-list');
  if (!listEl) return;
  try {
    const res = await fetch('/api/admin/feature-flags', { headers: authHeader() });
    if (!res.ok) {
      listEl.textContent = 'No se pudieron cargar los flags.';
      return;
    }
    const { flags } = await res.json();
    listEl.innerHTML = flags
      .map(
        (f) => `
      <div class="ff-item" data-flag="${escapeHtmlLocal(f.key)}">
        <div class="ff-item__head"><strong>${escapeHtmlLocal(f.key)}</strong><span>${escapeHtmlLocal(f.description ?? '')}</span></div>
        <ul class="ff-item__users">
          ${f.users
            .map(
              (u) =>
                `<li>${escapeHtmlLocal(u.email ?? u.username)}
                   <button class="btn btn--secondary btn--sm ff-remove" data-email="${escapeHtmlLocal(u.email ?? '')}" data-username="${escapeHtmlLocal(u.username ?? '')}">Quitar</button>
                 </li>`,
            )
            .join('')}
        </ul>
        <div class="ff-item__add">
          <input class="ff-input" type="text" placeholder="email o usuario" />
          <button class="btn btn--primary btn--sm ff-add">Agregar</button>
        </div>
      </div>`,
      )
      .join('');
  } catch (e) {
    console.warn('loadFlags failed', e);
    listEl.textContent = 'No se pudieron cargar los flags.';
  }
}

function wireFeatureFlags(root) {
  const listEl = root.querySelector('#ff-list');
  if (!listEl) return;

  listEl.addEventListener('click', async (e) => {
    const addBtn = e.target.closest('.ff-add');
    const removeBtn = e.target.closest('.ff-remove');
    const item = e.target.closest('.ff-item');
    if (!item) return;
    const flagKey = item.dataset.flag;

    if (addBtn) {
      const input = item.querySelector('.ff-input');
      const value = (input?.value ?? '').trim();
      if (!value) return;
      const body = value.includes('@') ? { flagKey, email: value } : { flagKey, username: value };
      try {
        await fetch('/api/admin/feature-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify(body),
        });
        await loadFlags(root);
      } catch (err) {
        console.warn('add flag assignment failed', err);
      }
      return;
    }

    if (removeBtn) {
      const email = removeBtn.dataset.email || null;
      const username = removeBtn.dataset.username || null;
      try {
        await fetch('/api/admin/feature-flags', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ flagKey, email, username }),
        });
        await loadFlags(root);
      } catch (err) {
        console.warn('remove flag assignment failed', err);
      }
    }
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
      listContainer.innerHTML =
        '<p style="text-align:center; color: var(--color-text-secondary); padding: 2rem 0;">No se encontraron canciones.</p>';
      return;
    }

    listContainer.innerHTML = filtered
      .map(
        (s) => `
      <div class="admin-song-item" data-id="${s.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius-md); cursor: pointer; transition: border-color var(--transition-fast);">
        <div>
          <div style="font-weight: 600; font-size: 1rem;">${escapeHtmlLocal(s.title)}</div>
          <div style="font-size: 0.8rem; color: var(--color-text-secondary); margin-top: 0.25rem;">${escapeHtmlLocal(s.album || 'Sin álbum')} · ${s.year || ''}</div>
        </div>
        <button class="btn btn--primary" style="padding: 0.5rem 1rem;">Editar</button>
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
