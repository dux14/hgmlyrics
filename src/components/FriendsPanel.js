/**
 * FriendsPanel.js — /amigos page with tabs: friends / incoming / outgoing + search.
 */
import '../styles/friends.css';
import { getSession } from '../lib/authStore.js';
import { emitPendingChanged } from '../lib/friends.js';
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';
import { icon } from '../lib/icons.js';

let searchTimer = null;

async function api(path, opts = {}) {
  const token = getSession()?.access_token;
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

async function fetchList() {
  return (
    (await api('/api/social/friends')).data || {
      accepted: [],
      pendingIncoming: [],
      pendingOutgoing: [],
    }
  );
}

async function searchUsers(q) {
  const r = await api(`/api/social/search?q=${encodeURIComponent(q)}`);
  return r.data?.results || [];
}

async function sendRequest(username) {
  return api('/api/social/friends', { method: 'POST', body: JSON.stringify({ username }) });
}

async function respondRequest(requesterId, action) {
  return api('/api/social/friends', {
    method: 'PATCH',
    body: JSON.stringify({ requesterId, action }),
  });
}

async function removeFriendship(otherUserId) {
  return api('/api/social/friends', {
    method: 'DELETE',
    body: JSON.stringify({ otherUserId }),
  });
}

export function buildTabs(activeTab, incomingCount) {
  const tab = (key, label) => {
    const sel = activeTab === key;
    const count =
      key === 'incoming' && incomingCount > 0
        ? `<span class="seg-tab__count">${incomingCount}</span>`
        : '';
    return `<button class="seg-tab${sel ? ' seg-tab--active' : ''}" role="tab" aria-selected="${sel}" data-tab="${key}">${label}${count}</button>`;
  };
  return `
    <div class="seg-tabs" role="tablist">
      ${tab('accepted', 'Amigos')}
      ${tab('incoming', 'Recibidas')}
      ${tab('outgoing', 'Enviadas')}
    </div>
  `;
}

export function buildFriendItem(item, viewerId, kind) {
  const otherIsRequester = item.requesterId !== viewerId;
  const other = otherIsRequester
    ? {
        id: item.requesterId,
        username: item.requesterUsername,
        displayName: item.requesterDisplayName,
        avatarUrl: item.requesterAvatarUrl,
      }
    : {
        id: item.addresseeId,
        username: item.addresseeUsername,
        displayName: item.addresseeDisplayName,
        avatarUrl: item.addresseeAvatarUrl,
      };
  const initial = (other.displayName || other.username || '?').trim().charAt(0).toUpperCase();
  const crown = isFounder(other.username) ? founderCrownHtml() : '';
  const avatarInner = other.avatarUrl
    ? `<img class="friend-card__avatar" src="${escapeHtml(other.avatarUrl || '')}" alt="" width="44" height="44" loading="lazy" decoding="async" />`
    : `<span class="friend-card__avatar friend-card__avatar--initial">${initial}</span>`;
  const avatar = `<span class="avatar-wrap">${avatarInner}${crown}</span>`;
  const actions =
    kind === 'incoming'
      ? `<button class="pill pill--primary" data-act="accept" data-id="${other.id}">Aceptar</button>
         <button class="pill pill--ghost" data-act="reject" data-id="${other.id}">Rechazar</button>`
      : kind === 'outgoing'
        ? `<button class="pill pill--ghost" data-act="cancel" data-id="${other.id}">Cancelar</button>`
        : `<button class="pill pill--ghost" data-act="unfriend" data-id="${other.id}">Quitar</button>`;
  return `
    <li class="friend-card">
      ${avatar}
      <div class="friend-card__id">
        <a href="#/u/${encodeURIComponent(other.username)}" class="friend-card__name">${escapeHtml(other.displayName || other.username)}</a>
        <div class="profile-username">@${escapeHtml(other.username)}</div>
      </div>
      <div class="friend-card__actions">${actions}</div>
    </li>
  `;
}

/**
 * Render the friends panel.
 * @param {HTMLElement} container
 */
export async function renderFriendsPanel(container) {
  const viewerId = getSession()?.user?.id;
  let activeTab = 'accepted';

  async function reloadList() {
    const data = await fetchList();
    emitPendingChanged(Array.isArray(data.pendingIncoming) ? data.pendingIncoming.length : 0);
    return data;
  }

  let listCache = await reloadList();

  container.innerHTML = `
    <div class="friends-page fade-in">
      <h1>Amigos</h1>

      <div class="profile-field">
        <input type="search" class="auth-input" id="friends-search" placeholder="Buscar usuarios..." />
        <ul id="search-results" class="friends-list"></ul>
      </div>

      ${buildTabs(activeTab, listCache.pendingIncoming.length)}

      <ul class="friends-list" id="friends-list"><li>Cargando...</li></ul>
    </div>
  `;

  function renderList() {
    const listEl = container.querySelector('#friends-list');
    const items =
      activeTab === 'accepted'
        ? listCache.accepted
        : activeTab === 'incoming'
          ? listCache.pendingIncoming
          : listCache.pendingOutgoing;
    if (items.length === 0) {
      const emptyLabels = {
        accepted: ['Sin amigos aún', 'Busca usuarios arriba para agregar a alguien.'],
        incoming: ['Sin solicitudes recibidas', 'Cuando alguien te agregue, aparecera aqui.'],
        outgoing: ['Sin solicitudes enviadas', 'Agrega amigos usando el buscador.'],
      };
      const [title, text] = emptyLabels[activeTab] || ['Nada por aqui.', ''];
      listEl.innerHTML = `
        <li class="empty-state">
          <div class="empty-state__icon">${icon('user-plus', { size: 40 })}</div>
          <h2 class="empty-state__title">${title}</h2>
          ${text ? `<p class="empty-state__text">${text}</p>` : ''}
        </li>
      `;
      return;
    }
    listEl.innerHTML = items.map((it) => buildFriendItem(it, viewerId, activeTab)).join('');
    listEl.querySelectorAll('.friend-card').forEach((li, i) => {
      li.style.animationDelay = `${Math.min(i * 40, 240)}ms`;
    });
    listEl.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const act = b.dataset.act;
        if (act === 'accept') await respondRequest(id, 'accept');
        if (act === 'reject') await removeFriendship(id);
        if (act === 'cancel') await removeFriendship(id);
        if (act === 'unfriend') await removeFriendship(id);
        listCache = await reloadList();
        renderList();
      });
    });
  }

  container.querySelectorAll('.seg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.seg-tab').forEach((b) => {
        b.classList.remove('seg-tab--active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('seg-tab--active');
      btn.setAttribute('aria-selected', 'true');
      activeTab = btn.dataset.tab;
      renderList();
    });
  });

  const searchInput = container.querySelector('#friends-search');
  const searchResults = container.querySelector('#search-results');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      searchResults.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      const results = await searchUsers(q);
      if (results.length === 0) {
        searchResults.innerHTML = `
          <li class="empty-state" style="padding:var(--space-md) 0;">
            <div class="empty-state__icon">${icon('user-plus', { size: 32 })}</div>
            <p class="empty-state__text">Sin resultados.</p>
          </li>
        `;
        return;
      }
      searchResults.innerHTML = results
        .map(
          (u) => `
        <li class="friend-item">
          <span class="avatar-wrap">
            <img class="profile-avatar" src="${escapeHtml(u.avatarUrl || '')}" alt="" width="40" height="40" loading="lazy" decoding="async" />${isFounder(u.username) ? founderCrownHtml() : ''}
          </span>
          <div class="friend-item__name">
            <a href="#/u/${encodeURIComponent(u.username)}" class="friend-item__link">${escapeHtml(u.displayName || u.username)}</a>
            <div class="friend-item__user">@${escapeHtml(u.username)}</div>
          </div>
          <div class="friend-item__actions">
            <button class="friends-send-btn" data-username="${escapeHtml(u.username)}">Agregar</button>
          </div>
        </li>
      `,
        )
        .join('');
      searchResults.querySelectorAll('button[data-username]').forEach((b) => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          b.textContent = '...';
          b.classList.remove('friends-send-btn--sent', 'friends-send-btn--exists');
          const r = await sendRequest(b.dataset.username);
          if (r.ok) {
            b.textContent = 'Enviada';
            b.classList.add('friends-send-btn--sent');
            listCache = await reloadList();
          } else if (r.status === 409) {
            b.textContent = 'Ya existe';
            b.classList.add('friends-send-btn--exists');
          } else {
            b.textContent = 'Error';
            b.disabled = false;
          }
        });
      });
    }, 300);
  });

  renderList();
}
