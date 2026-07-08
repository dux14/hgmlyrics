import { renderAdminSection } from './AdminSection.js';
import { renderAsyncRegion } from '../lib/renderAsync.js';
import { skelRowList } from '../lib/skeleton.js';
import { escapeHtml } from '../lib/escape.js';
import { icon } from '../lib/icons.js';
import { getSession } from '../lib/authStore.js';
import { showToast } from '../lib/toast.js';
import { confirmDialog } from './ConfirmDialog.js';

const KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;
const MAX_RESULTS = 8;

function authHeader() {
  const session = getSession();
  return { Authorization: `Bearer ${session?.access_token ?? ''}` };
}

async function api(method, body) {
  return fetch('/api/admin/feature-flags', {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
}

// Cache de perfiles por montaje del panel (evita refetch en cada re-render).
let _profilesCache = null;

/** Solo para tests: reinicia el cache de perfiles entre casos. */
export function __resetProfilesCache() {
  _profilesCache = null;
}

async function loadProfiles() {
  if (_profilesCache) return _profilesCache;
  try {
    const res = await fetch('/api/admin/profiles', { headers: authHeader() });
    if (!res.ok) return [];
    const { users } = await res.json();
    _profilesCache = users;
    return users;
  } catch {
    return [];
  }
}

function userLabel(u) {
  return u.displayName
    ? `${escapeHtml(u.displayName)} (@${escapeHtml(u.username)})`
    : `@${escapeHtml(u.username)}`;
}

function chipHtml(u) {
  const label = escapeHtml(u.username ? `@${u.username}` : u.email);
  return `
    <span class="ff-chip" data-email="${escapeHtml(u.email ?? '')}" data-username="${escapeHtml(u.username ?? '')}">
      ${label}
      <button type="button" class="ff-chip__remove" aria-label="Quitar">${icon('close', { size: 14 })}</button>
    </span>`;
}

function flagItemHtml(f) {
  const globalId = `ff-global-${f.key}`;
  const searchId = `ff-search-${f.key}`;
  return `
    <div class="ff-item" data-flag="${escapeHtml(f.key)}">
      <div class="ff-item__head">
        <div class="ff-item__title">
          <strong>${escapeHtml(f.key)}</strong>
          <span>${escapeHtml(f.description ?? '')}</span>
        </div>
        <div class="ff-switch">
          <input type="checkbox" class="ff-global" id="${globalId}" ${f.enabledGlobal ? 'checked' : ''} />
          <label for="${globalId}">Habilitar para todos</label>
        </div>
      </div>

      <div class="ff-chips">
        ${f.users.map(chipHtml).join('')}
      </div>

      <div class="ff-item__add">
        <label class="sr-only" for="${searchId}">Buscar usuario</label>
        <input type="search" class="ff-input ff-search" id="${searchId}" placeholder="Buscar usuario…" autocomplete="off" />
        <ul class="ff-results" aria-live="polite"></ul>
        <button type="button" class="btn btn--primary btn--sm ff-add-btn" disabled>Agregar (0)</button>
      </div>

      <button type="button" class="btn btn--secondary btn--danger btn--sm ff-delete-flag">
        ${icon('trash', { size: 16 })} Eliminar flag
      </button>
    </div>`;
}

function assignedKeysOf(f) {
  return new Set(f.users.map((u) => (u.username ?? u.email ?? '').toLowerCase()).filter(Boolean));
}

function matchesQuery(u, q) {
  return (
    (u.username ?? '').toLowerCase().includes(q) ||
    (u.displayName ?? '').toLowerCase().includes(q) ||
    (u.email ?? '').toLowerCase().includes(q)
  );
}

function renderResults(item, allUsers, flag, query) {
  const resultsEl = item.querySelector('.ff-results');
  const addBtn = item.querySelector('.ff-add-btn');
  const q = query.trim().toLowerCase();

  if (!q) {
    resultsEl.innerHTML = '';
    addBtn.disabled = true;
    addBtn.textContent = 'Agregar (0)';
    return;
  }

  const assigned = assignedKeysOf(flag);
  const available = allUsers
    .filter((u) => !assigned.has((u.username ?? u.email ?? '').toLowerCase()))
    .filter((u) => matchesQuery(u, q))
    .slice(0, MAX_RESULTS);

  resultsEl.innerHTML = available
    .map(
      (u) => `
      <li>
        <label>
          <input type="checkbox" data-username="${escapeHtml(u.username ?? '')}" data-email="${escapeHtml(u.email ?? '')}" />
          ${userLabel(u)}
        </label>
      </li>`,
    )
    .join('');

  updateAddCounter(item);
}

function updateAddCounter(item) {
  const addBtn = item.querySelector('.ff-add-btn');
  const checked = item.querySelectorAll('.ff-results input[type="checkbox"]:checked').length;
  addBtn.disabled = checked === 0;
  addBtn.textContent = `Agregar (${checked})`;
}

function setBusy(el, busy) {
  if (el) el.disabled = busy;
}

/** Sub-página admin: gestión de feature flags. */
export function renderAdminFlagsPage(container) {
  const body = renderAdminSection(container, {
    title: 'Feature Flags',
    iconName: 'flag',
  });
  body.innerHTML = `
    <div id="ff-list" class="ff-list"></div>
    <form class="ff-create-form" id="ff-create-form">
      <h2 class="ff-create-form__title">Nueva flag</h2>
      <div class="form-group">
        <input
          type="text"
          id="ff-new-key"
          class="ff-input"
          placeholder="clave_de_la_flag"
          pattern="^[a-z][a-z0-9_]{1,49}$"
          autocomplete="off"
        />
        <span class="ff-hint">minúsculas, números y guion bajo</span>
      </div>
      <div class="form-group">
        <input
          type="text"
          id="ff-new-desc"
          class="ff-input"
          placeholder="Descripción"
          autocomplete="off"
        />
      </div>
      <button type="submit" class="btn btn--primary">Crear</button>
    </form>
  `;

  const listEl = body.querySelector('#ff-list');
  let flagsState = [];
  let usersState = [];

  function load() {
    renderAsyncRegion(listEl, {
      skeleton: () => skelRowList({ rows: 3 }),
      fetcher: async () => {
        const [flagsRes, allUsers] = await Promise.all([
          fetch('/api/admin/feature-flags', { headers: authHeader() }),
          loadProfiles(),
        ]);
        if (!flagsRes.ok) throw new Error('No se pudieron cargar los flags.');
        const { flags } = await flagsRes.json();
        return { flags, allUsers };
      },
      render: ({ flags, allUsers }) => {
        flagsState = flags;
        usersState = allUsers;
        listEl.innerHTML = flags.map(flagItemHtml).join('');
      },
      empty: () => '<p class="ff-empty">No hay flags creadas todavía.</p>',
      onError: () =>
        '<p class="ff-error">No se pudieron cargar los flags. <button data-retry>Reintentar</button></p>',
    });
  }

  function flagByKey(key) {
    return flagsState.find((f) => f.key === key);
  }

  // Delegación de eventos: cambios de checkbox/switch.
  listEl.addEventListener('change', async (e) => {
    const item = e.target.closest('.ff-item');
    if (!item) return;
    const flagKey = item.dataset.flag;

    if (e.target.classList.contains('ff-global')) {
      const toggle = e.target;
      const enabled = toggle.checked;
      setBusy(toggle, true);
      const res = await api('POST', { action: 'toggle-global', key: flagKey, enabled });
      setBusy(toggle, false);
      if (!res.ok) {
        toggle.checked = !enabled;
        showToast('No se pudo actualizar el flag', { type: 'error' });
        return;
      }
      const flag = flagByKey(flagKey);
      if (flag) flag.enabledGlobal = enabled;
      showToast('Flag actualizado');
      return;
    }

    if (e.target.matches('.ff-results input[type="checkbox"]')) {
      updateAddCounter(item);
    }
  });

  // Buscador: filtra results client-side.
  listEl.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ff-search')) return;
    const item = e.target.closest('.ff-item');
    const flag = flagByKey(item.dataset.flag);
    if (!flag) return;
    renderResults(item, usersState, flag, e.target.value);
  });

  // Clicks: agregar, quitar chip, eliminar flag.
  listEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.ff-item');
    if (!item) return;
    const flagKey = item.dataset.flag;

    const addBtn = e.target.closest('.ff-add-btn');
    if (addBtn) {
      const checked = [...item.querySelectorAll('.ff-results input[type="checkbox"]:checked')];
      if (checked.length === 0) return;
      const users = checked.map((cb) => {
        const username = cb.dataset.username;
        const email = cb.dataset.email;
        return username ? { username } : { email };
      });
      setBusy(addBtn, true);
      const res = await api('POST', { action: 'assign', flagKey, users });
      setBusy(addBtn, false);
      if (!res.ok) {
        showToast('No se pudo asignar el flag', { type: 'error' });
        return;
      }
      showToast('Usuarios agregados');
      load();
      return;
    }

    const removeBtn = e.target.closest('.ff-chip__remove');
    if (removeBtn) {
      const chip = removeBtn.closest('.ff-chip');
      const username = chip.dataset.username || null;
      const email = chip.dataset.email || null;
      const userLabelText = username ? `@${username}` : email;
      const ok = await confirmDialog({
        title: 'Quitar acceso',
        body: `¿Quitar a ${userLabelText} de ${flagKey}?`,
      });
      if (!ok) return;
      setBusy(removeBtn, true);
      const res = await api('DELETE', { flagKey, email, username });
      setBusy(removeBtn, false);
      if (!res.ok) {
        showToast('No se pudo quitar el acceso', { type: 'error' });
        return;
      }
      showToast('Acceso quitado');
      load();
      return;
    }

    const deleteBtn = e.target.closest('.ff-delete-flag');
    if (deleteBtn) {
      const ok = await confirmDialog({
        title: 'Eliminar flag',
        body: `Se elimina ${flagKey} y todas sus asignaciones. Esta acción no se puede deshacer.`,
        danger: true,
      });
      if (!ok) return;
      setBusy(deleteBtn, true);
      const res = await api('DELETE', { action: 'flag', key: flagKey });
      setBusy(deleteBtn, false);
      if (!res.ok) {
        showToast('No se pudo eliminar el flag', { type: 'error' });
        return;
      }
      showToast('Flag eliminada');
      load();
    }
  });

  // Form crear flag.
  const createForm = body.querySelector('#ff-create-form');
  const keyInput = body.querySelector('#ff-new-key');
  const descInput = body.querySelector('#ff-new-desc');
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    const description = descInput.value.trim();
    if (!KEY_RE.test(key)) {
      showToast('Key inválida: usa minúsculas, números o "_"', { type: 'error' });
      return;
    }
    const submitBtn = createForm.querySelector('button[type="submit"]');
    setBusy(submitBtn, true);
    setBusy(keyInput, true);
    setBusy(descInput, true);
    const res = await api('POST', { action: 'create', key, description });
    setBusy(submitBtn, false);
    setBusy(keyInput, false);
    setBusy(descInput, false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      showToast(res.status === 409 ? 'La flag ya existe' : (error ?? 'No se pudo crear el flag'), {
        type: 'error',
      });
      return;
    }
    keyInput.value = '';
    descInput.value = '';
    showToast('Flag creada');
    load();
  });

  load();
}
