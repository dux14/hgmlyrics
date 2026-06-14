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
const dismissSearchHandler = null;

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
  const state = { step: 0 };
  const STEPS = [
    {
      n: '01',
      title: '¿Cuándo desaparece?',
      sub: 'Las listas son efímeras. Ponle nombre y elige cuándo caduca.',
    },
    { n: '02', title: '¿Qué suena?', sub: 'Busca y arrastra para ordenar las canciones.' },
    { n: '03', title: '¿Con quién?', sub: 'Invita amigos a tu lista efímera (opcional).' },
  ];

  container.innerHTML = `
    <div class="list-detail__container list-wizard">
      <div class="list-wizard__rail" id="list-wizard-rail"></div>
      <div class="list-wizard__panel">
        <div class="list-wizard__head">
          <h2 class="list-wizard__title" id="list-wizard-title"></h2>
          <p class="list-wizard__sub" id="list-wizard-sub"></p>
        </div>
        <div class="list-wizard__body" id="list-wizard-body"></div>
        <p class="list-detail__error" id="list-detail-error" aria-live="polite"></p>
        <div class="list-wizard__foot">
          <button class="btn btn--secondary" id="list-wizard-back" type="button">← Atrás</button>
          <button class="btn btn--primary" id="list-wizard-next" type="button">Siguiente →</button>
        </div>
      </div>
    </div>
  `;

  const railEl = container.querySelector('#list-wizard-rail');
  const titleEl = container.querySelector('#list-wizard-title');
  const subEl = container.querySelector('#list-wizard-sub');
  const bodyEl = container.querySelector('#list-wizard-body');
  const errorEl = container.querySelector('#list-detail-error');
  const backBtn = container.querySelector('#list-wizard-back');
  const nextBtn = container.querySelector('#list-wizard-next');

  function renderRail() {
    railEl.innerHTML = STEPS.map((s, i) => {
      const cls =
        i === state.step ? 'list-wizard__num--act' : i < state.step ? 'list-wizard__num--done' : '';
      return `<div class="list-wizard__num ${cls}">${s.n}</div>`;
    }).join('');
  }

  function renderStep() {
    errorEl.textContent = '';
    renderRail();
    titleEl.textContent = STEPS[state.step].title;
    subEl.textContent = STEPS[state.step].sub;
    backBtn.style.visibility = state.step === 0 ? 'hidden' : 'visible';
    if (state.step === 0) backBtn.textContent = 'Cancelar';
    else backBtn.textContent = '← Atrás';
    nextBtn.innerHTML =
      state.step === STEPS.length - 1
        ? `${icon('check-circle', { size: 16 })} ${isNew ? 'Crear lista' : 'Guardar cambios'}`
        : 'Siguiente →';
    if (state.step === 0) renderStep0(bodyEl);
    else if (state.step === 1) renderStep1(bodyEl);
    else renderStep2(bodyEl);
  }

  function validateStep0() {
    if (!draft.name.trim()) {
      errorEl.textContent = 'El nombre no puede estar vacío.';
      return false;
    }
    try {
      resolveExpiresAt({ days: draft.days, dateValue: draft.dateValue, current: draft.expiresAt });
    } catch (err) {
      errorEl.textContent = err.message;
      return false;
    }
    return true;
  }

  backBtn.addEventListener('click', () => {
    if (state.step === 0) {
      navigate('/');
      return;
    }
    state.step -= 1;
    renderStep();
  });

  nextBtn.addEventListener('click', async () => {
    if (state.step === 0 && !validateStep0()) return;
    if (state.step < STEPS.length - 1) {
      state.step += 1;
      renderStep();
      return;
    }
    await commit();
  });

  // Placeholders rellenados en Tasks 5-7:
  function renderStep0(el) {
    el.innerHTML = `<input class="list-detail__title-input" id="list-detail-name" value="${escapeHtml(draft.name)}" maxlength="80" placeholder="Nombre de la lista" />`;
    el.querySelector('#list-detail-name').addEventListener('input', (e) => {
      draft.name = e.target.value;
    });
  }
  function renderStep1(el) {
    el.innerHTML = `<input class="list-detail__search-input" type="search" id="list-detail-search" placeholder="Buscar y agregar canciones…" autocomplete="off" />`;
  }
  function renderStep2(el) {
    el.innerHTML = `<input class="list-detail__search-input" type="search" id="list-detail-friend-search" placeholder="Buscar entre tus amigos…" autocomplete="off" />`;
  }

  async function commit() {
    errorEl.textContent = '';
    const name = draft.name.trim();
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
    nextBtn.disabled = true;
    const original = nextBtn.innerHTML;
    nextBtn.textContent = 'Guardando…';
    try {
      let listId = listData.id;
      if (isNew) {
        const created = await createList(name, expiresAt);
        listId = created.id;
        await setListSongs(listId, draft.order);
        for (const username of draft.invitees.map((f) => f.username))
          {await inviteMember(listId, username);}
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
      errorEl.textContent = err.message;
      nextBtn.disabled = false;
      nextBtn.innerHTML = original;
    }
  }

  getAcceptedFriends().then((friends) => {
    friendsCache = friends;
  });
  renderStep();
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
