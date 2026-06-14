/**
 * FriendsPanel.js — /amigos page with tabs: friends / incoming / outgoing + search.
 */
import { getSession } from '../lib/authStore.js';

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

function buildFriendItem(item, viewerId, kind) {
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

  const actions =
    kind === 'incoming'
      ? `
      <button class="auth-btn" data-act="accept" data-id="${other.id}" style="padding:4px 12px;">Aceptar</button>
      <button class="auth-btn" data-act="reject" data-id="${other.id}" style="padding:4px 12px;">Rechazar</button>
    `
      : kind === 'outgoing'
        ? `<button class="auth-btn" data-act="cancel" data-id="${other.id}" style="padding:4px 12px;">Cancelar</button>`
        : `<button class="auth-btn" data-act="unfriend" data-id="${other.id}" style="padding:4px 12px;">Quitar</button>`;

  return `
    <li class="friend-item">
      <img class="profile-avatar" style="width:40px;height:40px;" src="${other.avatarUrl || ''}" alt="" width="40" height="40" loading="lazy" decoding="async" />
      <div>
        <a href="#/u/${other.username}" style="color:inherit;text-decoration:none;font-weight:600;">${other.displayName || other.username}</a>
        <div style="font-size:0.8em;color:var(--color-text-secondary);">@${other.username}</div>
      </div>
      <div class="friend-item__actions">${actions}</div>
    </li>
  `;
}

/**
 * Render the friends panel.
 * @param {HTMLElement} container
 */
export async function renderFriendsPanel(container) {
  container.innerHTML = `
    <div class="friends-page fade-in">
      <h1>Amigos</h1>

      <div class="profile-field">
        <input type="search" class="auth-input" id="friends-search" placeholder="Buscar usuarios..." />
        <ul id="search-results" class="friends-list"></ul>
      </div>

      <div class="friends-tabs" role="tablist">
        <button class="friends-tab friends-tab--active" data-tab="accepted">Amigos</button>
        <button class="friends-tab" data-tab="incoming">Recibidas</button>
        <button class="friends-tab" data-tab="outgoing">Enviadas</button>
      </div>

      <ul class="friends-list" id="friends-list"><li>Cargando...</li></ul>
    </div>
  `;

  const viewerId = getSession()?.user?.id;
  let activeTab = 'accepted';
  let listCache = await fetchList();

  function renderList() {
    const listEl = container.querySelector('#friends-list');
    const items =
      activeTab === 'accepted'
        ? listCache.accepted
        : activeTab === 'incoming'
          ? listCache.pendingIncoming
          : listCache.pendingOutgoing;
    if (items.length === 0) {
      listEl.innerHTML = '<li style="color:var(--color-text-secondary);">Nada por aquí.</li>';
      return;
    }
    listEl.innerHTML = items.map((it) => buildFriendItem(it, viewerId, activeTab)).join('');
    listEl.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const act = b.dataset.act;
        if (act === 'accept') await respondRequest(id, 'accept');
        if (act === 'reject') await removeFriendship(id);
        if (act === 'cancel') await removeFriendship(id);
        if (act === 'unfriend') await removeFriendship(id);
        listCache = await fetchList();
        renderList();
      });
    });
  }

  container.querySelectorAll('.friends-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      container
        .querySelectorAll('.friends-tab')
        .forEach((b) => b.classList.remove('friends-tab--active'));
      btn.classList.add('friends-tab--active');
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
        searchResults.innerHTML =
          '<li style="color:var(--color-text-secondary);">Sin resultados.</li>';
        return;
      }
      searchResults.innerHTML = results
        .map(
          (u) => `
        <li class="friend-item">
          <img class="profile-avatar" style="width:40px;height:40px;" src="${u.avatarUrl || ''}" alt="" />
          <div>
            <a href="#/u/${u.username}" style="color:inherit;text-decoration:none;font-weight:600;">${u.displayName || u.username}</a>
            <div style="font-size:0.8em;color:var(--color-text-secondary);">@${u.username}</div>
          </div>
          <div class="friend-item__actions">
            <button class="auth-btn" data-username="${u.username}" style="padding:4px 12px;">Agregar</button>
          </div>
        </li>
      `,
        )
        .join('');
      searchResults.querySelectorAll('button[data-username]').forEach((b) => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          b.textContent = '...';
          const r = await sendRequest(b.dataset.username);
          if (r.ok) {
            b.textContent = 'Enviada';
            listCache = await fetchList();
          } else if (r.status === 409) {
            b.textContent = 'Ya existe';
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
