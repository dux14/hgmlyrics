/**
 * FriendsPanel.js — /amigos page: sections (solicitudes/amigos) + búsqueda inline.
 */
import '../styles/friends.css';
import { getSession } from '../lib/authStore.js';
import { emitPendingChanged } from '../lib/friends.js';
import { escapeHtml } from '../lib/escape.js';
import { isFounder, founderCrownHtml } from '../lib/founders.js';
import { icon } from '../lib/icons.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelRowList } from '../lib/skeleton.js';

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

/** Normaliza un item de friendship al "otro" usuario respecto al viewer. */
export function normalizeOther(item, viewerId) {
  const otherIsRequester = item.requesterId !== viewerId;
  return otherIsRequester
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
}

function avatarHtml(person) {
  const initial = (person.displayName || person.username || '?').trim().charAt(0).toUpperCase();
  const crown = isFounder(person.username) ? founderCrownHtml() : '';
  const inner = person.avatarUrl
    ? `<img class="friend-row__avatar" src="${escapeHtml(person.avatarUrl || '')}" alt="" width="46" height="46" loading="lazy" decoding="async" />`
    : `<span class="friend-row__avatar friend-row__avatar--initial">${initial}</span>`;
  return `<span class="avatar-wrap">${inner}${crown}</span>`;
}

function rowShell(person, actionsHtml) {
  return `
    <li class="friend-row" data-username="${escapeHtml(person.username)}">
      ${avatarHtml(person)}
      <a class="friend-row__id" href="#/u/${encodeURIComponent(person.username)}">
        <span class="friend-row__name">${escapeHtml(person.displayName || person.username)}</span>
        <span class="friend-row__user">@${escapeHtml(person.username)}</span>
      </a>
      <div class="friend-row__act">${actionsHtml}</div>
    </li>`;
}

const iconBtn = (act, id, cls, name, label) =>
  `<button class="friend-ib friend-ib--${cls}" data-act="${act}" data-id="${id}" title="${label}" aria-label="${label}">${icon(name, { size: 20 })}</button>`;

/** Fila de la lista por secciones. kind: 'friend' | 'incoming' | 'outgoing'. */
export function buildFriendRow(person, { kind }) {
  let actions;
  if (kind === 'incoming') {
    actions =
      iconBtn('accept', person.id, 'accept', 'check', 'Aceptar') +
      iconBtn('reject', person.id, 'reject', 'close', 'Rechazar');
  } else if (kind === 'outgoing') {
    actions = iconBtn('cancel', person.id, 'pending', 'clock', 'Cancelar solicitud');
  } else {
    actions = iconBtn('unfriend', person.id, 'friend', 'check', 'Amigos — quitar');
  }
  const html = rowShell(person, actions);
  return kind === 'outgoing'
    ? html.replace(`@${escapeHtml(person.username)}`, `@${escapeHtml(person.username)} · enviada`)
    : html;
}

function sectionHeader(title, extraClass = '') {
  return `<h2 class="friend-sec${extraClass ? ' ' + extraClass : ''}">${title}</h2>`;
}

/** Construye la vista por secciones (Solicitudes → Amigos) a partir del payload de /friends. */
export function buildSections(data, viewerId) {
  const accepted = data.accepted || [];
  const incoming = data.pendingIncoming || [];
  const outgoing = data.pendingOutgoing || [];

  if (accepted.length === 0 && incoming.length === 0 && outgoing.length === 0) {
    return `
      <li class="empty-state">
        <div class="empty-state__icon">${icon('user-plus', { size: 40 })}</div>
        <h2 class="empty-state__title">Sin amigos aún</h2>
        <p class="empty-state__text">Busca usuarios arriba para agregar a alguien.</p>
      </li>`;
  }

  let html = '';
  if (incoming.length || outgoing.length) {
    html += sectionHeader('Solicitudes');
    html += incoming.map((it) => buildFriendRow(normalizeOther(it, viewerId), { kind: 'incoming' })).join('');
    html += outgoing.map((it) => buildFriendRow(normalizeOther(it, viewerId), { kind: 'outgoing' })).join('');
  }
  if (accepted.length) {
    html += sectionHeader('Amigos', 'friend-sec--spaced');
    html += accepted.map((it) => buildFriendRow(normalizeOther(it, viewerId), { kind: 'friend' })).join('');
  }
  return html;
}

/** Fila de resultado de búsqueda; usa person.relation. */
export function buildSearchRow(person) {
  let actions;
  if (person.relation === 'none') {
    actions = `<button class="friend-pill friend-pill--add" data-act="add" data-username="${escapeHtml(person.username)}">Agregar</button>`;
  } else if (person.relation === 'pending_out') {
    actions = `<button class="friend-pill friend-pill--pending" data-act="cancel" data-id="${person.id}">Enviada</button>`;
  } else if (person.relation === 'pending_in') {
    actions = iconBtn('accept', person.id, 'accept', 'check', 'Aceptar solicitud');
  } else {
    actions = `<span class="friend-ib friend-ib--friend" title="Ya son amigos" aria-label="Ya son amigos">${icon('check', { size: 20 })}</span>`;
  }
  return rowShell(person, actions);
}

/**
 * Render the friends panel.
 * @param {HTMLElement} container
 */
export function renderFriendsPanel(container) {
  const viewerId = getSession()?.user?.id;
  // Cache inicial vacío; se rellena en el primer ciclo async vía renderAsyncRegion.
  let listCache = { accepted: [], pendingIncoming: [], pendingOutgoing: [] };
  let searching = false;

  async function reloadList() {
    const data = await fetchList();
    emitPendingChanged(Array.isArray(data.pendingIncoming) ? data.pendingIncoming.length : 0);
    return data;
  }

  container.innerHTML = `
    <div class="friends-page fade-in">
      <div class="friends-head">
        <h1 class="friends-title">Amigos</h1>
        <div class="friends-search">
          ${icon('search', { size: 18 })}
          <input type="search" id="friends-search" placeholder="Buscar usuarios" autocomplete="off" />
        </div>
      </div>
      <div class="friends-list__region" aria-busy="true">
        <ul class="friends-list" id="friends-list"></ul>
      </div>
    </div>`;

  // La región async es el <div> envolvente, no el <ul>: el skeleton es un <div>
  // y un <div> hijo directo de <ul> es HTML inválido (Chrome/Firefox lo promueven).
  const region = container.querySelector('.friends-list__region');

  // El skeleton (o un resultado de búsqueda previo) puede haber reemplazado el <ul>;
  // restablecerlo antes de pintar y devolver la referencia vigente.
  function ensureListEl() {
    let listEl = container.querySelector('#friends-list');
    if (!listEl) {
      region.innerHTML = '<ul class="friends-list" id="friends-list"></ul>';
      listEl = container.querySelector('#friends-list');
    }
    return listEl;
  }

  function renderSections() {
    const listEl = ensureListEl();
    listEl.innerHTML = buildSections(listCache, viewerId);
    listEl.querySelectorAll('.friend-row').forEach((li, i) => {
      li.style.animationDelay = `${Math.min(i * 40, 240)}ms`;
    });
    wireActions(listEl);
  }

  async function runSearch(q) {
    const results = await searchUsers(q);
    const listEl = ensureListEl();
    if (results.length === 0) {
      listEl.innerHTML = `
        <li class="empty-state" style="padding:var(--space-md) 0;">
          <div class="empty-state__icon">${icon('search', { size: 32 })}</div>
          <p class="empty-state__text">Sin resultados.</p>
        </li>`;
      return;
    }
    listEl.innerHTML = results.map((u) => buildSearchRow(u)).join('');
    wireActions(listEl);
  }

  async function doAction(act, id) {
    if (act === 'accept') await respondRequest(id, 'accept');
    else await removeFriendship(id); // reject | cancel | unfriend
    listCache = await reloadList();
    if (searching) {
      const q = searchInput.value.trim();
      if (q.length >= 2) await runSearch(q);
      else {
        searching = false;
        renderSections();
      }
    } else {
      renderSections();
    }
  }

  function wireActions(scope) {
    scope.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'unfriend' && b.dataset.confirm !== '1') {
          b.dataset.confirm = '1';
          b.classList.add('friend-ib--confirm');
          b.textContent = '¿Quitar?';
          b.setAttribute('aria-label', '¿Quitar amistad?');
          b.setAttribute('title', '¿Quitar amistad?');
          setTimeout(() => {
            if (b.dataset.confirm === '1') {
              b.dataset.confirm = '';
              b.classList.remove('friend-ib--confirm');
              b.innerHTML = icon('check', { size: 20 });
              b.setAttribute('aria-label', 'Amigos — quitar');
              b.setAttribute('title', 'Amigos — quitar');
            }
          }, 2600);
          return;
        }
        if (act === 'add') {
          await sendAdd(b);
          return;
        }
        await doAction(act, b.dataset.id);
      });
    });
  }

  async function sendAdd(b) {
    b.disabled = true;
    const prev = b.textContent;
    b.textContent = '...';
    const r = await sendRequest(b.dataset.username);
    if (r.ok) {
      b.textContent = 'Enviada';
      b.classList.remove('friend-pill--add');
      b.classList.add('friend-pill--pending');
      b.dataset.act = 'cancel';
      b.disabled = false;
      listCache = await reloadList();
    } else if (r.status === 409) {
      b.textContent = 'Ya existe';
    } else {
      b.textContent = prev;
      b.disabled = false;
    }
  }

  renderAsyncRegion(region, {
    skeleton: () => skelRowList({ rows: 5 }),
    fetcher: reloadList,
    render: (data) => {
      listCache = data;
      if (!searching) renderSections();
    },
    onError: () => `
      <div class="empty-state">
        <h2 class="empty-state__title">No se pudieron cargar los amigos</h2>
        <button class="btn btn--primary" data-retry>Reintentar</button>
      </div>`,
  });

  const searchInput = container.querySelector('#friends-search');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      searching = false;
      renderSections();
      return;
    }
    searching = true;
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
}
