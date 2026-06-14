/**
 * ListDetail.js — Editor y vista de una lista efímera.
 *
 * renderListDetail(container, id, { mode }):
 *   - id null/'nueva' → lista nueva, modo 'edit'.
 *   - mode 'view' (default) → solo lectura (owner y member).
 *   - mode 'edit' (solo owner / lista nueva) → editor con borrador local.
 */

import '../styles/lists.css';
import {
  getList,
  createList,
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
import {
  filterFriends,
  diffMembers,
  resolveExpiresAt,
  formatExpiry,
  isUrgent,
} from '../lib/listDraft.js';
import { songRowCompact } from './songRow.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { updateSidebarContent } from './Sidebar.js';

/* global CSS */

// Listener global para cerrar el dropdown de búsqueda al clicar fuera.
let dismissSearchHandler = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function expiryChipHtml(expiresAt) {
  const text = formatExpiry(expiresAt);
  if (!text) return '';
  return `<span class="lists__expiry-chip ${isUrgent(expiresAt) ? 'lists__expiry-chip--urgent' : ''}">${escapeHtml(text)}</span>`;
}

/** Info de canción para render (degrada si fue borrada del catálogo). */
function songForRender(songId) {
  const s = getSongById(songId);
  return s || { id: songId, title: songId, album: '', voiceType: 'mixed', coverImage: '' };
}

/**
 * Punto de entrada. mode 'view' (default) o 'edit'.
 */
export async function renderListDetail(container, id, { mode = 'view' } = {}) {
  const isNew = !id || id === 'nueva';

  if (isNew) {
    renderEditor(container, {
      id: null,
      name: '',
      expires_at: null,
      songs: [],
      members: [],
      role: 'owner',
    });
    return;
  }

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
  if (mode === 'edit' && isOwner) {
    renderEditor(container, listData);
  } else {
    renderReadonly(container, listData, { isOwner });
  }
}

/* ── Editor (owner) ────────────────────────────────────────────── */

function renderEditor(container, listData) {
  const isNew = !listData.id;

  // Estado original (para el diff de miembros al guardar)
  const originalMembers = (listData.members || []).map((m) => ({
    user_id: m.user_id ?? m.id,
    username: m.username ?? m.user_id ?? m.id,
  }));

  // Borrador local
  const draft = {
    name: listData.name || '',
    expiresAt: listData.expires_at || null,
    order: (listData.songs || []).map((s) => s.song_id ?? s.id ?? s),
    invitees: (listData.members || []).map((m) => ({
      id: m.user_id ?? m.id,
      username: m.username ?? m.user_id ?? m.id,
      displayName: m.displayName || m.username || m.user_id || m.id,
      avatarUrl: m.avatarUrl || '',
    })),
    days: isNew ? 7 : null,
    dateValue: '',
  };

  let friendsCache = [];

  container.innerHTML = `
    <div class="list-detail__container">
      <div class="list-detail__section">
        <div class="list-detail__header">
          <div style="flex:1;min-width:0">
            <input
              class="list-detail__title-input"
              type="text"
              id="list-detail-name"
              value="${escapeHtml(draft.name)}"
              maxlength="80"
              placeholder="Nombre de la lista"
              aria-label="Nombre de la lista"
            />
          </div>
          <div class="list-detail__header-actions">
            ${
              isNew
                ? ''
                : `<button class="list-detail__icon-btn list-detail__icon-btn--danger" id="list-detail-delete" title="Borrar lista">${icon('trash', { size: 18 })}</button>`
            }
          </div>
        </div>
        <div class="list-detail__expiry">
          <div class="list-detail__segmented" id="list-detail-presets">
            <button class="list-detail__segmented-btn ${draft.days === 1 ? 'list-detail__segmented-btn--active' : ''}" data-days="1">1 día</button>
            <button class="list-detail__segmented-btn ${draft.days === 7 ? 'list-detail__segmented-btn--active' : ''}" data-days="7">7 días</button>
            <button class="list-detail__segmented-btn ${draft.days === 30 ? 'list-detail__segmented-btn--active' : ''}" data-days="30">30 días</button>
          </div>
          <button class="list-detail__expiry-toggle" id="list-detail-date-toggle" type="button">Fecha exacta</button>
          <input class="list-detail__date-input" type="date" id="list-detail-date" style="display:none" />
        </div>
      </div>

      <div class="list-detail__section">
        <h2 class="list-detail__section-heading">Canciones</h2>
        <div class="list-detail__search-wrap">
          <input
            class="list-detail__search-input"
            type="search"
            id="list-detail-search"
            placeholder="Buscar y agregar canciones…"
            autocomplete="off"
          />
          <div class="list-detail__search-results" id="list-detail-results" style="display:none"></div>
        </div>
        <div class="list-detail__songs" id="list-detail-songs"></div>
      </div>

      <div class="list-detail__section">
        <h2 class="list-detail__section-heading">Invitados</h2>
        <input
          class="list-detail__search-input"
          type="search"
          id="list-detail-friend-search"
          placeholder="Buscar entre tus amigos…"
          autocomplete="off"
        />
        <div class="list-detail__friend-results" id="list-detail-friend-results"></div>
        <div class="list-detail__invitees" id="list-detail-invitees"></div>
      </div>

      <div class="list-detail__section">
        <button class="btn btn--primary" id="list-detail-save">${icon('check-circle', { size: 16 })} Guardar</button>
        <p class="list-detail__error" id="list-detail-error" aria-live="polite"></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#list-detail-error');

  container.querySelector('#list-detail-name')?.addEventListener('input', (e) => {
    draft.name = e.target.value;
  });

  const presetsEl = container.querySelector('#list-detail-presets');
  const dateToggle = container.querySelector('#list-detail-date-toggle');
  const dateInput = container.querySelector('#list-detail-date');

  presetsEl?.querySelectorAll('.list-detail__segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      presetsEl
        .querySelectorAll('.list-detail__segmented-btn')
        .forEach((b) => b.classList.remove('list-detail__segmented-btn--active'));
      btn.classList.add('list-detail__segmented-btn--active');
      draft.days = Number(btn.dataset.days);
      draft.dateValue = '';
      dateInput.value = '';
    });
  });

  dateToggle?.addEventListener('click', () => {
    const showing = dateInput.style.display !== 'none';
    dateInput.style.display = showing ? 'none' : 'block';
    if (!showing) dateInput.focus();
  });

  dateInput?.addEventListener('input', () => {
    draft.dateValue = dateInput.value;
    if (dateInput.value) {
      draft.days = null;
      presetsEl
        .querySelectorAll('.list-detail__segmented-btn')
        .forEach((b) => b.classList.remove('list-detail__segmented-btn--active'));
    }
  });

  const songsEl = container.querySelector('#list-detail-songs');

  function rowActions(idx) {
    return `
      <button class="list-detail__row-btn" data-action="up" title="Subir" ${idx === 0 ? 'disabled' : ''}>${icon('chevron-up', { size: 14 })}</button>
      <button class="list-detail__row-btn" data-action="down" title="Bajar" ${idx === draft.order.length - 1 ? 'disabled' : ''}>${icon('chevron-down', { size: 14 })}</button>
      <button class="list-detail__row-btn list-detail__row-btn--danger" data-action="remove" title="Quitar">${icon('close', { size: 14 })}</button>
    `;
  }

  function renderSongs(enteringId = null) {
    if (draft.order.length === 0) {
      songsEl.innerHTML = `<p class="list-detail__empty">Busca arriba para agregar canciones.</p>`;
      return;
    }
    songsEl.innerHTML = draft.order
      .map((sid, idx) =>
        songRowCompact(songForRender(sid), { index: idx + 1, actions: rowActions(idx) }),
      )
      .join('');
    if (enteringId) {
      songsEl
        .querySelector(`[data-song-id="${CSS.escape(enteringId)}"]`)
        ?.classList.add('is-entering');
    }
    bindSongRows();
  }

  function bindSongRows() {
    songsEl.querySelectorAll('.song-row-compact').forEach((row, idx) => {
      const songId = row.dataset.songId;
      row.querySelector('[data-action="up"]')?.addEventListener('click', () => {
        if (idx === 0) return;
        [draft.order[idx - 1], draft.order[idx]] = [draft.order[idx], draft.order[idx - 1]];
        renderSongs();
      });
      row.querySelector('[data-action="down"]')?.addEventListener('click', () => {
        if (idx === draft.order.length - 1) return;
        [draft.order[idx], draft.order[idx + 1]] = [draft.order[idx + 1], draft.order[idx]];
        renderSongs();
      });
      row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        draft.order = draft.order.filter((sid) => sid !== songId);
        renderSongs();
      });
    });
  }

  renderSongs();

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
      const hits = searchSongs(q, 8).filter((s) => !draft.order.includes(s.id));
      if (!hits.length) {
        resultsEl.style.display = 'none';
        return;
      }
      resultsEl.innerHTML = hits.map((s) => songRowCompact(s, {})).join('');
      resultsEl.style.display = 'block';
      resultsEl.querySelectorAll('.song-row-compact').forEach((item) => {
        item.addEventListener('click', () => {
          const sid = item.dataset.songId;
          if (!draft.order.includes(sid)) {
            draft.order.push(sid);
            renderSongs(sid);
          }
          searchInput.value = '';
          resultsEl.style.display = 'none';
          resultsEl.innerHTML = '';
        });
      });
    }, 200);
  });

  if (dismissSearchHandler) document.removeEventListener('click', dismissSearchHandler);
  dismissSearchHandler = (e) => {
    if (!container.querySelector('.list-detail__search-wrap')?.contains(e.target)) {
      if (resultsEl) resultsEl.style.display = 'none';
    }
  };
  document.addEventListener('click', dismissSearchHandler);

  const inviteesEl = container.querySelector('#list-detail-invitees');
  const friendSearch = container.querySelector('#list-detail-friend-search');
  const friendResultsEl = container.querySelector('#list-detail-friend-results');

  function renderInvitees() {
    if (draft.invitees.length === 0) {
      inviteesEl.innerHTML = `<p class="list-detail__empty">Sin invitados.</p>`;
      return;
    }
    inviteesEl.innerHTML = draft.invitees
      .map(
        (f) => `
        <div class="list-detail__invitee-row" data-id="${escapeHtml(f.id)}">
          <img class="list-detail__invitee-avatar" src="${escapeHtml(f.avatarUrl || '')}" alt="" onerror="this.style.visibility='hidden'" />
          <span class="list-detail__invitee-name">${escapeHtml(f.displayName || f.username)}</span>
          <button class="list-detail__row-btn list-detail__row-btn--danger" data-action="uninvite" title="Quitar">${icon('close', { size: 14 })}</button>
        </div>
      `,
      )
      .join('');
    inviteesEl.querySelectorAll('[data-action="uninvite"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        draft.invitees = draft.invitees.filter((f) => f.id !== id);
        renderInvitees();
        renderFriendResults();
      });
    });
  }

  function renderFriendResults() {
    const q = friendSearch.value.trim();
    if (!q) {
      friendResultsEl.innerHTML = '';
      return;
    }
    if (friendsCache.length === 0) {
      friendResultsEl.innerHTML = `<p class="list-detail__empty">No tienes amigos. <a href="#/amigos">Agregar amigos</a></p>`;
      return;
    }
    const excluded = new Set(draft.invitees.map((f) => f.id));
    const matches = filterFriends(friendsCache, q, excluded);
    if (matches.length === 0) {
      friendResultsEl.innerHTML = `<p class="list-detail__empty">No tienes amigos que coincidan.</p>`;
      return;
    }
    friendResultsEl.innerHTML = matches
      .map(
        (f) => `
        <div class="list-detail__friend-result" data-id="${escapeHtml(f.id)}">
          <img class="list-detail__friend-result-avatar" src="${escapeHtml(f.avatarUrl || '')}" alt="" onerror="this.style.visibility='hidden'" />
          <div class="list-detail__friend-result-info">
            <span class="list-detail__friend-result-name">${escapeHtml(f.displayName || f.username)}</span>
            <span class="list-detail__friend-result-handle">@${escapeHtml(f.username)}</span>
          </div>
          <button class="btn btn--secondary" data-action="invite">${icon('plus', { size: 14 })} Invitar</button>
        </div>
      `,
      )
      .join('');
    friendResultsEl.querySelectorAll('[data-action="invite"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.closest('[data-id]')?.dataset.id;
        const friend = friendsCache.find((f) => f.id === id);
        if (friend && !draft.invitees.some((f) => f.id === id)) {
          draft.invitees.push(friend);
          renderInvitees();
          renderFriendResults();
        }
      });
    });
  }

  friendSearch?.addEventListener('input', renderFriendResults);
  renderInvitees();

  getAcceptedFriends().then((friends) => {
    if (!inviteesEl?.isConnected) return;
    friendsCache = friends;
    renderFriendResults();
  });

  container.querySelector('#list-detail-delete')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta lista? Esta acción no se puede deshacer.')) return;
    try {
      await deleteList(listData.id);
      updateSidebarContent();
      navigate('/');
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });

  const saveBtn = container.querySelector('#list-detail-save');
  saveBtn?.addEventListener('click', async () => {
    errorEl.textContent = '';
    const name = draft.name.trim();
    if (!name) {
      errorEl.textContent = 'El nombre no puede estar vacío.';
      return;
    }

    let expiresAt;
    try {
      expiresAt = resolveExpiresAt({
        days: draft.days,
        dateValue: draft.dateValue,
        current: draft.expiresAt,
      });
    } catch (err) {
      errorEl.textContent = err.message;
      return;
    }

    saveBtn.disabled = true;
    const original = saveBtn.innerHTML;
    saveBtn.textContent = 'Guardando…';

    try {
      let listId = listData.id;

      if (isNew) {
        const created = await createList(name, expiresAt);
        listId = created.id;
        await setListSongs(listId, draft.order);
        for (const username of draft.invitees.map((f) => f.username)) {
          await inviteMember(listId, username);
        }
      } else {
        if (name !== listData.name || expiresAt !== listData.expires_at) {
          await updateList(listId, { name, expires_at: expiresAt });
        }
        await setListSongs(listId, draft.order);
        const { toInvite, toRemove } = diffMembers(originalMembers, draft.invitees);
        for (const username of toInvite) await inviteMember(listId, username);
        for (const userId of toRemove) await removeMember(listId, userId);
      }

      updateSidebarContent();
      navigate(`/lista/${listId}`);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
      saveBtn.disabled = false;
      saveBtn.innerHTML = original;
    }
  });
}

/* ── Solo lectura (vista) ───────────────────────────────────────── */

function renderReadonly(container, listData, { isOwner } = {}) {
  const songs = listData.songs || [];
  const orderedSongIds = songs.map((s) => s.song_id ?? s.id ?? s);

  container.innerHTML = `
    <div class="list-detail__container">
      <div class="list-detail__header">
        <h1 class="list-detail__title">${escapeHtml(listData.name)}</h1>
        ${expiryChipHtml(listData.expires_at)}
        ${
          isOwner
            ? `<button class="btn btn--secondary list-detail__edit-btn" id="list-detail-edit">${icon('pencil', { size: 14 })} Editar</button>`
            : ''
        }
      </div>
      <div class="list-detail__songs">
        ${
          orderedSongIds.length === 0
            ? `<p class="list-detail__empty">Esta lista no tiene canciones aún.</p>`
            : orderedSongIds
                .map((sid, idx) => {
                  const row = songRowCompact(songForRender(sid), { index: idx + 1 });
                  return row.replace(
                    'class="song-row-compact"',
                    'class="song-row-compact song-row-compact--clickable"',
                  );
                })
                .join('')
        }
      </div>
    </div>
  `;

  container.querySelector('#list-detail-edit')?.addEventListener('click', () => {
    renderEditor(container, listData);
  });

  container.querySelectorAll('.song-row-compact--clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const songId = row.dataset.songId;
      setActiveContext({ listId: listData.id, name: listData.name, orderedSongIds });
      navigate(`/song/${songId}?lista=${listData.id}`);
    });
  });
}
