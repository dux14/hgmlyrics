/**
 * ListDetail.js — Vista de detalle/editor de una lista efímera.
 *
 * Uso: renderListDetail(container, listId)
 * - role === 'owner': editor completo (nombre, canciones, miembros, fecha, borrar)
 * - role === 'member': solo lectura (tap canción → navega con contexto de lista)
 */

import '../styles/lists.css';
import {
  getList,
  updateList,
  deleteList,
  setListSongs,
  inviteMember,
  removeMember,
  setActiveContext,
} from '../lib/lists.js';
import { getSongById } from '../lib/store.js';
import { searchSongs } from '../lib/search.js';
import { getAcceptedFriends } from '../lib/friends.js';

// Listener global para cerrar los resultados de búsqueda al clicar fuera.
// Se guarda a nivel de módulo y se reemplaza en cada render del editor, así
// nunca se acumula más de uno (evita fugas al navegar entre listas).
let dismissSearchHandler = null;
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { updateSidebarContent } from './Sidebar.js';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/**
 * Formatea la fecha de caducidad en texto legible.
 * @param {string} expiresAt - ISO date string
 * @returns {string}
 */
function formatExpiry(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.ceil((new Date(expiresAt) - Date.now()) / 86400000);
  if (diff <= 0) return 'caducada';
  if (diff === 1) return 'caduca hoy';
  return `caduca en ${diff}d`;
}

/**
 * Renderiza el detalle de una lista efímera.
 * @param {HTMLElement} container
 * @param {string} id - listId
 */
export async function renderListDetail(container, id) {
  container.innerHTML = `
    <div class="list-detail__container">
      <div class="empty-state fade-in">
        <div class="empty-state__icon">${icon('list', { size: 40 })}</div>
        <h2 class="empty-state__title">Cargando lista…</h2>
      </div>
    </div>
  `;

  let listData;
  try {
    listData = await getList(id);
  } catch (err) {
    container.innerHTML = `
      <div class="list-detail__container">
        <div class="empty-state fade-in">
          <div class="empty-state__icon">${icon('frown', { size: 40 })}</div>
          <h2 class="empty-state__title">Lista no encontrada</h2>
          <p class="empty-state__text">${escapeHtml(err.message)}</p>
          <button class="btn btn--secondary" id="list-detail-back">Volver</button>
        </div>
      </div>
    `;
    container.querySelector('#list-detail-back')?.addEventListener('click', () => navigate('/'));
    return;
  }

  const isOwner = listData.role === 'owner';

  if (isOwner) {
    renderEditor(container, listData);
  } else {
    renderReadonly(container, listData);
  }
}

/* ── Editor (owner) ────────────────────────────────────────────── */

function renderEditor(container, listData) {
  let order = (listData.songs || []).map((s) => s.song_id ?? s.id ?? s);
  const members = listData.members || [];

  function songInfo(songId) {
    const s = getSongById(songId);
    return s ? { title: s.title, album: s.album } : { title: songId, album: '' };
  }

  function songRowHtml(songId, idx) {
    const { title, album } = songInfo(songId);
    return `
      <div class="list-detail__song-row" data-song-id="${escapeHtml(songId)}" data-idx="${idx}">
        <span class="list-detail__song-name">${escapeHtml(title)}</span>
        <span class="list-detail__song-sub">${escapeHtml(album)}</span>
        <button class="list-detail__row-btn" data-action="up" title="Subir" ${idx === 0 ? 'disabled' : ''}>${icon('chevron-up', { size: 14 })}</button>
        <button class="list-detail__row-btn" data-action="down" title="Bajar" ${idx === order.length - 1 ? 'disabled' : ''}>${icon('chevron-down', { size: 14 })}</button>
        <button class="list-detail__row-btn list-detail__row-btn--danger" data-action="remove" title="Quitar">${icon('close', { size: 14 })}</button>
      </div>
    `;
  }

  function memberRowHtml(member) {
    return `
      <div class="list-detail__member-row" data-member-id="${escapeHtml(member.user_id ?? member.id)}">
        <span class="list-detail__member-name">${escapeHtml(member.username ?? member.user_id ?? member.id)}</span>
        <button class="list-detail__row-btn list-detail__row-btn--danger" data-action="remove-member" title="Quitar miembro">${icon('close', { size: 14 })}</button>
      </div>
    `;
  }

  const expiryText = formatExpiry(listData.expires_at);
  const isUrgent =
    listData.expires_at && Math.ceil((new Date(listData.expires_at) - Date.now()) / 86400000) <= 1;

  container.innerHTML = `
    <div class="list-detail__container">
      <div class="list-detail__header">
        <div style="flex:1;min-width:0">
          <input
            class="list-detail__title-input"
            type="text"
            id="list-detail-name"
            value="${escapeHtml(listData.name)}"
            maxlength="80"
            aria-label="Nombre de la lista"
          />
          ${expiryText ? `<span class="lists__expiry-chip ${isUrgent ? 'lists__expiry-chip--urgent' : ''}">${escapeHtml(expiryText)}</span>` : ''}
        </div>
        <div class="list-detail__header-actions">
          <button class="btn btn--primary" id="list-detail-save">
            ${icon('check-circle', { size: 16 })} Guardar
          </button>
          <button class="list-detail__icon-btn list-detail__icon-btn--danger" id="list-detail-delete" title="Borrar lista">
            ${icon('trash', { size: 18 })}
          </button>
        </div>
      </div>

      <!-- Buscador de canciones -->
      <div>
        <p class="list-detail__section-title">${icon('list', { size: 14 })} Canciones</p>
        <div class="list-detail__search-wrap" style="margin-top: var(--space-xs)">
          <input
            class="list-detail__search-input"
            type="search"
            id="list-detail-search"
            placeholder="Buscar y agregar canciones…"
            autocomplete="off"
          />
          <div class="list-detail__search-results" id="list-detail-results" style="display:none"></div>
        </div>
      </div>

      <!-- Lista de canciones -->
      <div class="list-detail__songs" id="list-detail-songs">
        ${order.length === 0 ? `<p class="list-detail__empty">Sin canciones aún.</p>` : order.map(songRowHtml).join('')}
      </div>

      <!-- Invitados -->
      <div>
        <p class="list-detail__section-title">${icon('users', { size: 14 })} Invitados</p>
        <div class="list-detail__invite-row" style="margin-top: var(--space-xs)">
          <input
            class="list-detail__search-input"
            type="text"
            id="list-detail-invite-input"
            placeholder="Nombre de usuario"
            autocomplete="off"
            style="flex:1"
          />
          <button class="btn btn--secondary" id="list-detail-invite-btn">
            ${icon('plus', { size: 14 })} Invitar
          </button>
        </div>
        <p class="list-detail__error" id="list-detail-invite-error" aria-live="polite"></p>
        <div class="list-detail__friend-suggestions" id="list-detail-friends"></div>
        <div class="list-detail__members" id="list-detail-members">
          ${members.length === 0 ? `<p class="list-detail__empty">Sin invitados.</p>` : members.map(memberRowHtml).join('')}
        </div>
      </div>

      <p class="list-detail__error" id="list-detail-error" aria-live="polite"></p>
    </div>
  `;

  const errorEl = container.querySelector('#list-detail-error');
  const id = listData.id;
  let persistTimer = null;

  function persistSongs() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      setListSongs(id, order).catch((err) => {
        if (errorEl) errorEl.textContent = err.message;
      });
    }, 400);
  }

  function rerenderSongs() {
    const songsEl = container.querySelector('#list-detail-songs');
    if (!songsEl) return;
    songsEl.innerHTML =
      order.length === 0
        ? `<p class="list-detail__empty">Sin canciones aún.</p>`
        : order.map(songRowHtml).join('');
    bindSongRowEvents();
    persistSongs();
  }

  function bindSongRowEvents() {
    container.querySelectorAll('.list-detail__song-row').forEach((row) => {
      const idx = Number(row.dataset.idx);
      const songId = row.dataset.songId;

      row.querySelector('[data-action="up"]')?.addEventListener('click', () => {
        if (idx === 0) return;
        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
        rerenderSongs();
      });

      row.querySelector('[data-action="down"]')?.addEventListener('click', () => {
        if (idx === order.length - 1) return;
        [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
        rerenderSongs();
      });

      row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        order = order.filter((sid) => sid !== songId);
        rerenderSongs();
      });
    });
  }

  bindSongRowEvents();

  // Guardar nombre al salir del campo
  container.querySelector('#list-detail-name')?.addEventListener('blur', (e) => {
    const newName = e.target.value.trim();
    if (newName && newName !== listData.name) {
      updateList(id, { name: newName }).catch((err) => {
        if (errorEl) errorEl.textContent = err.message;
      });
    }
  });

  // Borrar lista
  container.querySelector('#list-detail-delete')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta lista? Esta acción no se puede deshacer.')) return;
    try {
      await deleteList(id);
      navigate('/');
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });

  // Buscador de canciones
  const searchInput = container.querySelector('#list-detail-search');
  const resultsEl = container.querySelector('#list-detail-results');
  let searchTimer = null;

  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) {
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(() => {
      const hits = searchSongs(q, 8);
      if (!hits.length) {
        resultsEl.style.display = 'none';
        return;
      }
      resultsEl.innerHTML = hits
        .map(
          (s) => `
          <div class="list-detail__search-result" data-song-id="${escapeHtml(s.id)}">
            <span>${escapeHtml(s.title)}</span>
            <span class="list-detail__search-result-sub">${escapeHtml(s.album || '')}</span>
          </div>
        `,
        )
        .join('');
      resultsEl.style.display = 'block';

      resultsEl.querySelectorAll('.list-detail__search-result').forEach((item) => {
        item.addEventListener('click', () => {
          const sid = item.dataset.songId;
          if (!order.includes(sid)) {
            order.push(sid);
            rerenderSongs();
          }
          searchInput.value = '';
          resultsEl.style.display = 'none';
        });
      });
    }, 200);
  });

  // Cerrar resultados al hacer clic fuera. Reemplaza cualquier listener previo
  // para que no se acumulen al re-renderizar o navegar entre listas.
  if (dismissSearchHandler) document.removeEventListener('click', dismissSearchHandler);
  dismissSearchHandler = (e) => {
    if (!container.querySelector('.list-detail__search-wrap')?.contains(e.target)) {
      if (resultsEl) resultsEl.style.display = 'none';
    }
  };
  document.addEventListener('click', dismissSearchHandler);

  // Invitar miembro
  const inviteInput = container.querySelector('#list-detail-invite-input');
  const inviteError = container.querySelector('#list-detail-invite-error');

  container.querySelector('#list-detail-invite-btn')?.addEventListener('click', async () => {
    const username = inviteInput.value.trim();
    inviteError.textContent = '';
    if (!username) {
      inviteError.textContent = 'Ingresa un nombre de usuario.';
      return;
    }
    try {
      await inviteMember(id, username);
      const updated = await getList(id);
      const membersEl = container.querySelector('#list-detail-members');
      const newMembers = updated.members || [];
      membersEl.innerHTML =
        newMembers.length === 0
          ? `<p class="list-detail__empty">Sin invitados.</p>`
          : newMembers.map(memberRowHtml).join('');
      bindMemberEvents();
      renderFriendSuggestions();
      inviteInput.value = '';
    } catch (err) {
      inviteError.textContent = err.message;
    }
  });

  function bindMemberEvents() {
    container.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('[data-member-id]');
        const userId = row?.dataset.memberId;
        if (!userId) return;
        try {
          await removeMember(id, userId);
          row.remove();
        } catch (err) {
          if (inviteError) inviteError.textContent = err.message;
        }
      });
    });
  }

  bindMemberEvents();

  // Preview clicable de amigos
  const friendsEl = container.querySelector('#list-detail-friends');

  function currentMemberIds() {
    return new Set(
      [...container.querySelectorAll('#list-detail-members [data-member-id]')].map(
        (el) => el.dataset.memberId,
      ),
    );
  }

  async function inviteFriend(friend) {
    inviteError.textContent = '';
    try {
      await inviteMember(id, friend.username);
      const updated = await getList(id);
      const membersEl = container.querySelector('#list-detail-members');
      const newMembers = updated.members || [];
      membersEl.innerHTML =
        newMembers.length === 0
          ? `<p class="list-detail__empty">Sin invitados.</p>`
          : newMembers.map(memberRowHtml).join('');
      bindMemberEvents();
      renderFriendSuggestions();
    } catch (err) {
      inviteError.textContent = err.message;
    }
  }

  let friendsCache = [];
  function renderFriendSuggestions() {
    if (!friendsEl) return;
    const memberIds = currentMemberIds();
    const available = friendsCache.filter((f) => !memberIds.has(f.id));
    if (available.length === 0) {
      friendsEl.innerHTML = '';
      return;
    }
    friendsEl.innerHTML = available
      .map(
        (f) => `
        <button class="list-detail__friend-chip" data-friend-id="${escapeHtml(f.id)}" data-friend-username="${escapeHtml(f.username)}">
          <img class="list-detail__friend-avatar" src="${escapeHtml(f.avatarUrl || '')}" alt="" onerror="this.style.display='none'" />
          <span>${escapeHtml(f.displayName || f.username)}</span>
        </button>
      `,
      )
      .join('');
    friendsEl.querySelectorAll('.list-detail__friend-chip').forEach((chip) => {
      chip.addEventListener('click', () =>
        inviteFriend({ id: chip.dataset.friendId, username: chip.dataset.friendUsername }),
      );
    });
  }

  getAcceptedFriends().then((friends) => {
    if (!friendsEl?.isConnected) return;
    friendsCache = friends;
    renderFriendSuggestions();
  });

  // Guardar y volver
  const saveBtn = container.querySelector('#list-detail-save');
  saveBtn?.addEventListener('click', async () => {
    clearTimeout(persistTimer);
    saveBtn.disabled = true;
    const original = saveBtn.innerHTML;
    saveBtn.textContent = 'Guardando…';
    try {
      const nameInput = container.querySelector('#list-detail-name');
      const newName = nameInput?.value.trim();
      if (newName && newName !== listData.name) {
        await updateList(id, { name: newName });
      }
      await setListSongs(id, order);
      saveBtn.textContent = 'Guardado ✓';
      updateSidebarContent();
      navigate('/');
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
      saveBtn.disabled = false;
      saveBtn.innerHTML = original;
    }
  });
}

/* ── Solo lectura (member) ──────────────────────────────────────── */

function renderReadonly(container, listData) {
  const songs = listData.songs || [];
  const orderedSongIds = songs.map((s) => s.song_id ?? s.id ?? s);
  const expiryText = formatExpiry(listData.expires_at);
  const isUrgent =
    listData.expires_at && Math.ceil((new Date(listData.expires_at) - Date.now()) / 86400000) <= 1;

  function songRowHtml(songId) {
    const s = getSongById(songId);
    const title = s ? s.title : songId;
    const album = s ? s.album : '';
    return `
      <div class="list-detail__song-row list-detail__song-row--readonly" data-song-id="${escapeHtml(songId)}">
        <span class="list-detail__song-name">${escapeHtml(title)}</span>
        <span class="list-detail__song-sub">${escapeHtml(album)}</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="list-detail__container">
      <div class="list-detail__header">
        <h1 class="list-detail__title">${escapeHtml(listData.name)}</h1>
        ${expiryText ? `<span class="lists__expiry-chip ${isUrgent ? 'lists__expiry-chip--urgent' : ''}">${escapeHtml(expiryText)}</span>` : ''}
      </div>

      <div class="list-detail__songs">
        ${orderedSongIds.length === 0 ? `<p class="list-detail__empty">Esta lista no tiene canciones aún.</p>` : orderedSongIds.map(songRowHtml).join('')}
      </div>
    </div>
  `;

  // Tap en canción → establece contexto y navega
  container.querySelectorAll('.list-detail__song-row--readonly').forEach((row) => {
    row.addEventListener('click', () => {
      const songId = row.dataset.songId;
      setActiveContext({ listId: listData.id, name: listData.name, orderedSongIds });
      navigate(`/song/${songId}?lista=${listData.id}`);
    });
  });
}
