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
  setListItems,
  inviteMember,
  removeMember,
  setActiveContext,
  searchUsers,
} from '../lib/lists.js';
import { getSongById } from '../lib/store.js';
import { searchAll } from '../lib/search.js';
import { getAcceptedFriends } from '../lib/friends.js';
import { isAdmin } from '../lib/authStore.js';
import {
  filterFriends,
  diffMembers,
  resolveExpiresAt,
  formatExpiry,
  isUrgent,
  reorder,
} from '../lib/listDraft.js';
import { songRowCompact } from './songRow.js';
import { weeklyWordSearchRow } from '../lib/searchRow.js';
import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';
import { updateSidebarContent } from './Sidebar.js';
import { escapeHtml } from '../lib/escape.js';
import { voiceoverCoverHtml } from '../lib/voiceoverCover.js';

/* global CSS */

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

function renderEditor(container, listData, opts = {}) {
  const parentCtx = opts.parent || null; // { id, name, expires_at, songs[] }
  const maxExpiresAt = parentCtx?.expires_at || null;
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
    // order: array de { item_type, item_id } para listas polimórficas.
    // Si la API ya devuelve items tipados (campo items), los usamos; si no,
    // construimos desde songs (retrocompat).
    order:
      listData.items ??
      (listData.songs || []).map((s) => ({
        item_type: 'song',
        item_id: s.song_id ?? s.id ?? s,
      })),
    invitees: (listData.members || []).map((m) => ({
      id: m.user_id ?? m.id,
      username: m.username ?? m.user_id ?? m.id,
      displayName: m.displayName || m.username || m.user_id || m.id,
      avatarUrl: m.avatarUrl || '',
    })),
    days: null,
    dateValue: '', // 'YYYY-MM-DDTHH:mm' (datetime-local)
  };

  // Sub-lista nueva: hereda miembros del evento y topa la caducidad al padre.
  if (isNew && parentCtx) {
    draft.invitees = (listData.members || []).map((m) => ({
      id: m.user_id ?? m.id,
      username: m.username ?? m.user_id ?? m.id,
      displayName: m.displayName || m.username || m.user_id || m.id,
      avatarUrl: m.avatarUrl || '',
    }));
  }

  const pad = (n) => String(n).padStart(2, '0');
  if (isNew) {
    const def = new Date(Date.now() + 7 * 86400000);
    def.setHours(23, 59, 0, 0);
    draft.dateValue = `${def.getFullYear()}-${pad(def.getMonth() + 1)}-${pad(def.getDate())}T${pad(def.getHours())}:${pad(def.getMinutes())}`;
  } else if (listData.expires_at) {
    const d = new Date(listData.expires_at);
    draft.dateValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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
    backBtn.style.visibility = 'visible';
    backBtn.textContent = state.step === 0 ? 'Cancelar' : '← Atrás';
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
      resolveExpiresAt({
        days: draft.days,
        dateValue: draft.dateValue,
        current: draft.expiresAt,
        maxExpiresAt,
      });
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

  function renderStep0(el) {
    const lifeChip = expiresPreview();
    el.innerHTML = `
      <input class="list-detail__title-input" type="text" id="list-detail-name"
        value="${escapeHtml(draft.name)}" maxlength="80" placeholder="Nombre de la lista" aria-label="Nombre de la lista" />
      <label class="list-wizard__label" for="list-detail-datetime">Caduca el</label>
      <input class="list-wizard__datetime" type="datetime-local" id="list-detail-datetime"
        value="${escapeHtml(draft.dateValue)}"
        ${
          maxExpiresAt
            ? `max="${(() => {
                const d = new Date(maxExpiresAt);
                const p = (x) => String(x).padStart(2, '0');
                return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
              })()}"`
            : ''
        } />
      <div class="list-wizard__life-row">
        <span>vida de la lista</span>
        <span class="lists__expiry-chip ${lifeChip.urgent ? 'lists__expiry-chip--urgent' : ''}" id="list-detail-lifechip">${escapeHtml(lifeChip.text)}</span>
      </div>
      <div class="list-wizard__life"><i id="list-detail-lifebar" style="width:${lifeChip.pct}%"></i></div>
      ${isNew ? '' : `<button class="btn btn--secondary list-wizard__delete" id="list-detail-delete" type="button">${icon('trash', { size: 14 })} Borrar lista</button>`}
    `;
    el.querySelector('#list-detail-name').addEventListener('input', (e) => {
      draft.name = e.target.value;
    });
    const dt = el.querySelector('#list-detail-datetime');
    dt.addEventListener('input', () => {
      draft.dateValue = dt.value;
      draft.days = null;
      updateLife(el);
    });
    el.querySelector('#list-detail-delete')?.addEventListener('click', onDelete);
  }

  function expiresPreview() {
    let iso;
    try {
      iso = resolveExpiresAt({
        days: draft.days,
        dateValue: draft.dateValue,
        current: draft.expiresAt,
      });
    } catch {
      return { text: 'fecha inválida', urgent: true, pct: 0 };
    }
    const days = Math.max(0, Math.round((new Date(iso) - Date.now()) / 86400000));
    const pct = Math.min(100, Math.round((days / 30) * 100));
    return { text: formatExpiry(iso) || 'caduca hoy', urgent: isUrgent(iso), pct };
  }

  function updateLife(el) {
    const p = expiresPreview();
    const chip = el.querySelector('#list-detail-lifechip');
    const bar = el.querySelector('#list-detail-lifebar');
    if (chip) {
      chip.textContent = p.text;
      chip.classList.toggle('lists__expiry-chip--urgent', p.urgent);
    }
    if (bar) bar.style.width = `${p.pct}%`;
  }

  async function onDelete() {
    if (!confirm('¿Borrar esta lista? Esta acción no se puede deshacer.')) return;
    try {
      await deleteList(listData.id);
      updateSidebarContent();
      navigate('/');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }
  function renderStep1(el) {
    el.innerHTML = `
      ${
        parentCtx?.songs?.length
          ? `<button class="btn btn--secondary list-detail__from-setlist" id="list-detail-from-setlist" type="button">Tomar del setlist (${parentCtx.songs.length})</button>`
          : ''
      }
      <div class="list-detail__search-wrap">
        <input class="list-detail__search-input" type="search" id="list-detail-search" placeholder="Buscar y agregar canciones…" autocomplete="off" />
        <div class="list-detail__search-results" id="list-detail-results" style="display:none"></div>
      </div>
      <div class="list-detail__songs" id="list-detail-songs"></div>
    `;
    const songsEl = el.querySelector('#list-detail-songs');
    const searchInput = el.querySelector('#list-detail-search');
    const resultsEl = el.querySelector('#list-detail-results');
    let searchTimer = null;

    el.querySelector('#list-detail-from-setlist')?.addEventListener('click', () => {
      const existingIds = new Set(draft.order.map((it) => it.item_id));
      for (const sid of parentCtx.songs) {
        if (!existingIds.has(sid)) draft.order.push({ item_type: 'song', item_id: sid });
      }
      renderSongs();
    });

    // Helper: obtiene el item_id de una entrada del draft (typed object)
    function itemId(it) {
      return it.item_id ?? it;
    }

    // Cache de voces en off (id → item). Se siembra con la metadata que la API
    // adjunta a cada voz ya guardada (item.word) para que las filas del borrador
    // muestren título/referencia y no el UUID; las búsquedas de esta sesión la
    // van completando.
    const wwCache = {};
    (listData.items || []).forEach((it) => {
      if (it.item_type === 'weekly_word' && it.word) {
        wwCache[String(it.item_id)] = it.word;
      }
    });

    /** Devuelve HTML de fila para un item del draft (canción o voz en off). */
    function draftItemRow(it, idx) {
      const id = itemId(it);
      const removeBtn = `<button class="list-detail__row-btn list-detail__row-btn--danger" data-action="remove" title="Quitar">${icon('close', { size: 14 })}</button>`;
      if (it.item_type === 'weekly_word') {
        const ww = wwCache[id];
        const label = ww ? ww.title || ww.gospel_ref : id;
        const sub = ww ? ww.liturgical_title || ww.gospel_ref || '' : '';
        return `<div class="song-row-compact" data-song-id="${escapeHtml(id)}">
          <span class="song-row-compact__grip"><i></i><i></i><i></i></span>
          <span class="song-row-compact__index">${idx + 1}</span>
          ${voiceoverCoverHtml(ww?.liturgical_color, { size: 44, radius: 6 })}
          <div class="song-row-compact__info">
            <span class="song-row-compact__title">${escapeHtml(label)}</span>
            <span class="song-row-compact__album">${escapeHtml(sub)}</span>
          </div>
          <span class="voice-badge voice-badge--voz">Voz en off</span>
          <div class="song-row-compact__actions">${removeBtn}</div>
        </div>`;
      }
      return songRowCompact(songForRender(id), {
        index: idx + 1,
        dragHandle: true,
        actions: removeBtn,
      });
    }

    function renderSongs(enteringId = null) {
      if (draft.order.length === 0) {
        songsEl.innerHTML = `<div class="list-detail__empty-state">${icon('list', { size: 32 })}<p>Busca arriba para agregar canciones.</p></div>`;
        return;
      }
      songsEl.innerHTML = draft.order.map((it, idx) => draftItemRow(it, idx)).join('');
      if (enteringId) {
        const escaped =
          typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(enteringId)
            : enteringId.replace(/[^\w-]/g, '\\$&');
        const enteringEl = songsEl.querySelector(`[data-song-id="${escaped}"]`);
        if (enteringEl) {
          enteringEl.classList.add('is-entering');
          // La animación list-row-in usa fill-mode: both; si la clase queda puesta,
          // la animación retiene transform:none y, por prioridad de cascada, anula el
          // transform inline del drag (FLIP), bloqueando el reacomodo de esa fila.
          // La quitamos al terminar para liberar el transform inline.
          enteringEl.addEventListener(
            'animationend',
            () => enteringEl.classList.remove('is-entering'),
            {
              once: true,
            },
          );
        }
      }
      bindRows();
    }

    function bindRows() {
      songsEl.querySelectorAll('.song-row-compact').forEach((row) => {
        const songId = row.dataset.songId;
        row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
          draft.order = draft.order.filter((it) => itemId(it) !== songId);
          renderSongs();
        });
        setupDragHandle(row, songsEl, renderSongs);
      });
    }

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (!q) {
        resultsEl.style.display = 'none';
        resultsEl.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(() => {
        const existingIds = new Set(draft.order.map((it) => itemId(it)));
        const hits = searchAll(q, 8).filter(
          ({ type, item }) => !existingIds.has(type === 'song' ? item.id : String(item.id)),
        );
        if (!hits.length) {
          resultsEl.style.display = 'none';
          return;
        }
        resultsEl.innerHTML = hits
          .map(({ type, item }) => {
            if (type === 'song') return songRowCompact(item, {});
            // weekly_word row — mismo markup que el buscador del header.
            return weeklyWordSearchRow(item);
          })
          .join('');
        resultsEl.style.display = 'block';
        // Song click handlers
        resultsEl.querySelectorAll('.song-row-compact').forEach((item) => {
          item.addEventListener('click', () => {
            const sid = item.dataset.songId;
            if (!existingIds.has(sid)) {
              draft.order.push({ item_type: 'song', item_id: sid });
              renderSongs(sid);
            }
            searchInput.value = '';
            resultsEl.style.display = 'none';
            resultsEl.innerHTML = '';
          });
        });
        // Weekly word click handlers
        resultsEl.querySelectorAll('[data-voz-id]').forEach((item) => {
          item.addEventListener('click', () => {
            const wwId = item.dataset.vozId;
            const wwItem = hits.find(
              ({ type, item: i }) => type === 'weekly_word' && String(i.id) === wwId,
            )?.item;
            if (!existingIds.has(wwId)) {
              if (wwItem) wwCache[wwId] = wwItem;
              draft.order.push({ item_type: 'weekly_word', item_id: wwId });
              renderSongs(wwId);
            }
            searchInput.value = '';
            resultsEl.style.display = 'none';
            resultsEl.innerHTML = '';
          });
        });
      }, 200);
    });

    renderSongs();
  }

  // Drag & drop por Pointer Events (táctil + mouse). Reordena draft.order.
  // La fila agarrada se levanta y sigue al dedo (translate en vivo, solo GPU); las
  // demás se deslizan para abrir hueco mediante transforms (técnica FLIP, sin tocar
  // el DOM hasta soltar). Respeta prefers-reduced-motion.
  const DRAG_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'; // ease-out fuerte (Emil)
  function setupDragHandle(row, listEl, rerender) {
    const handle = row.querySelector('.song-row-compact__grip');
    if (!handle) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (listEl.querySelector('.is-dragging')) return; // un solo arrastre a la vez (multi-touch)
      const rows = [...listEl.querySelectorAll('.song-row-compact')];
      const fromIdx = rows.indexOf(row);
      if (fromIdx === -1) return;
      const rects = rows.map((r) => r.getBoundingClientRect());
      // Paso vertical entre filas (alto + gap); uniforme en esta lista.
      const step = rows.length > 1 ? rects[1].top - rects[0].top : rects[0].height + 8;
      const startY = e.clientY;
      let toIdx = fromIdx;

      row.classList.add('is-dragging');
      handle.setPointerCapture(e.pointerId);
      if (!reduce) {
        row.style.transition = 'none';
        row.style.zIndex = '5';
        rows.forEach((r, i) => {
          if (i === fromIdx) return;
          r.style.transition = `transform 180ms ${DRAG_EASE}`;
          r.style.willChange = 'transform';
        });
      }

      function shiftOthers() {
        rows.forEach((r, i) => {
          if (i === fromIdx) return;
          let dy = 0;
          if (toIdx > fromIdx && i > fromIdx && i <= toIdx) dy = -step;
          else if (toIdx < fromIdx && i >= toIdx && i < fromIdx) dy = step;
          r.style.transform = dy ? `translateY(${dy}px)` : '';
        });
      }

      function onMove(ev) {
        const delta = ev.clientY - startY;
        if (reduce) {
          // Sin animación: solo recalcula el destino por punto medio.
          toIdx = rects.findIndex((b) => ev.clientY < b.top + b.height / 2);
          if (toIdx === -1) toIdx = rows.length - 1;
          return;
        }
        row.style.transform = `translateY(${delta}px) scale(1.03)`;
        const next = Math.min(rows.length - 1, Math.max(0, fromIdx + Math.round(delta / step)));
        if (next !== toIdx) {
          toIdx = next;
          shiftOthers();
        }
      }

      function teardown() {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onCancel);
      }
      function commitAndRerender() {
        if (toIdx !== fromIdx) {
          draft.order = reorder(draft.order, fromIdx, toIdx);
        }
        rerender(); // reconstruye el DOM en el orden final (resetea transforms)
      }
      function onCancel() {
        teardown();
        row.classList.remove('is-dragging');
        rerender();
      }
      function onUp() {
        teardown();
        if (reduce) {
          row.classList.remove('is-dragging');
          commitAndRerender();
          return;
        }
        // Asentamiento: la fila cae a su slot final y, al terminar, se reconstruye.
        const settled = `translateY(${(toIdx - fromIdx) * step}px) scale(1)`;
        row.style.transition = `transform 160ms ${DRAG_EASE}`;
        // Forzar reflow para que la transición tome el valor previo del move.
        void row.offsetWidth;
        row.style.transform = settled;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          row.removeEventListener('transitionend', finish);
          row.classList.remove('is-dragging');
          commitAndRerender();
        };
        row.addEventListener('transitionend', finish);
        setTimeout(finish, 220); // red de seguridad si no dispara transitionend
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    });
    // Accesibilidad: reordenar con teclado desde el asa.
    handle.setAttribute('role', 'button');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('aria-label', 'Reordenar (flechas arriba/abajo)');
    handle.addEventListener('keydown', (ev) => {
      const rows = [...listEl.querySelectorAll('.song-row-compact')];
      const i = rows.indexOf(row);
      if (ev.key === 'ArrowUp' && i > 0) {
        draft.order = reorder(draft.order, i, i - 1);
        rerender();
        listEl.querySelectorAll('.song-row-compact__grip')[i - 1]?.focus();
      }
      if (ev.key === 'ArrowDown' && i < rows.length - 1) {
        draft.order = reorder(draft.order, i, i + 1);
        rerender();
        listEl.querySelectorAll('.song-row-compact__grip')[i + 1]?.focus();
      }
    });
  }

  function renderStep2(el) {
    const admin = isAdmin();
    el.innerHTML = `
      <input class="list-detail__search-input" type="search" id="list-detail-friend-search"
        placeholder="${admin ? 'Buscar entre todos los usuarios…' : 'Buscar entre tus amigos…'}" autocomplete="off" />
      ${admin ? `<p class="list-detail__admin-hint">${icon('users', { size: 13 })} Modo admin · puedes invitar a cualquier usuario</p>` : ''}
      <div class="list-detail__friend-results" id="list-detail-friend-results"></div>
      <div class="list-detail__invitees" id="list-detail-invitees"></div>
    `;
    const inviteesEl = el.querySelector('#list-detail-invitees');
    const friendSearch = el.querySelector('#list-detail-friend-search');
    const friendResultsEl = el.querySelector('#list-detail-friend-results');
    let searchTimer = null;
    let searchSeq = 0; // descarta respuestas server fuera de orden

    function renderInvitees() {
      if (draft.invitees.length === 0) {
        inviteesEl.innerHTML = `<p class="list-detail__empty">Sin invitados.</p>`;
        return;
      }
      inviteesEl.innerHTML = draft.invitees
        .map(
          (f) => `
        <div class="list-detail__invitee-row" data-id="${escapeHtml(f.id)}">
          <img class="list-detail__invitee-avatar" src="${escapeHtml(f.avatarUrl || '')}" alt="" width="40" height="40" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'" />
          <span class="list-detail__invitee-name">${escapeHtml(f.displayName || f.username)}</span>
          <button class="list-detail__row-btn list-detail__row-btn--danger" data-action="uninvite" title="Quitar">${icon('close', { size: 14 })}</button>
        </div>`,
        )
        .join('');
      inviteesEl.querySelectorAll('[data-action="uninvite"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.closest('[data-id]')?.dataset.id;
          draft.invitees = draft.invitees.filter((f) => f.id !== id);
          renderInvitees();
          onSearch();
        });
      });
    }

    // Pinta una lista de candidatos (amigos o usuarios) con botón Invitar.
    function paintResults(matches) {
      friendResultsEl.innerHTML = matches
        .map(
          (f) => `
        <div class="list-detail__friend-result" data-id="${escapeHtml(f.id)}">
          <img class="list-detail__friend-result-avatar" src="${escapeHtml(f.avatarUrl || '')}" alt="" width="40" height="40" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'" />
          <div class="list-detail__friend-result-info">
            <span class="list-detail__friend-result-name">${escapeHtml(f.displayName || f.username)}</span>
            <span class="list-detail__friend-result-handle">@${escapeHtml(f.username)}</span>
          </div>
          <button class="btn btn--secondary" data-action="invite">${icon('plus', { size: 14 })} Invitar</button>
        </div>`,
        )
        .join('');
      friendResultsEl.querySelectorAll('[data-action="invite"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.closest('[data-id]')?.dataset.id;
          const person = matches.find((f) => f.id === id);
          if (person && !draft.invitees.some((f) => f.id === id)) {
            draft.invitees.push(person);
            renderInvitees();
            onSearch();
          }
        });
      });
    }

    // Admin: busca en todo el servidor (debounced). No-admin: filtra amigos en local.
    function onSearch() {
      const q = friendSearch.value.trim();
      clearTimeout(searchTimer);
      if (!q) {
        searchSeq++;
        friendResultsEl.innerHTML = '';
        return;
      }
      const excluded = new Set(draft.invitees.map((f) => f.id));
      if (admin) {
        const seq = ++searchSeq;
        searchTimer = setTimeout(async () => {
          const results = await searchUsers(q);
          if (seq !== searchSeq) return; // llegó una respuesta vieja
          const matches = results.filter((u) => !excluded.has(u.id));
          friendResultsEl.innerHTML = matches.length
            ? ''
            : `<p class="list-detail__empty">Sin usuarios que coincidan.</p>`;
          if (matches.length) paintResults(matches);
        }, 220);
        return;
      }
      if (friendsCache.length === 0) {
        friendResultsEl.innerHTML = `<p class="list-detail__empty">No tienes amigos. <a href="#/amigos">Agregar amigos</a></p>`;
        return;
      }
      const matches = filterFriends(friendsCache, q, excluded);
      friendResultsEl.innerHTML = matches.length
        ? ''
        : `<p class="list-detail__empty">No tienes amigos que coincidan.</p>`;
      if (matches.length) paintResults(matches);
    }

    friendSearch.addEventListener('input', onSearch);
    renderInvitees();
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
        maxExpiresAt,
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
        const created = await createList(name, expiresAt, parentCtx?.id || null);
        listId = created.id;
        await setListItems(listId, draft.order);
        for (const username of draft.invitees.map((f) => f.username)) {
          await inviteMember(listId, username);
        }
      } else {
        if (name !== listData.name || expiresAt !== listData.expires_at) {
          await updateList(listId, { name, expires_at: expiresAt });
        }
        await setListItems(listId, draft.order);
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

  getAcceptedFriends()
    .then((friends) => {
      friendsCache = friends;
    })
    .catch(() => {});
  renderStep();
}

/* ── Solo lectura (vista) ───────────────────────────────────────── */

function renderReadonly(container, listData, { isOwner } = {}) {
  const songs = listData.songs || [];
  const orderedSongIds = songs.map((s) => s.song_id ?? s.id ?? s);
  // Items tipados (canciones + voces en off) en orden. Retrocompat: si la API
  // no trae items, se reconstruye desde songs.
  const orderedItems =
    listData.items ?? orderedSongIds.map((sid) => ({ item_type: 'song', item_id: sid }));
  const children = listData.children || [];
  const parent = listData.parent || null;
  const showSeg = !parent && (children.length > 0 || isOwner);

  const songsPaneHtml =
    orderedItems.length === 0
      ? `<div class="list-detail__empty-state">${icon('list', { size: 32 })}<p>Esta lista no tiene canciones aún.</p></div>`
      : orderedItems
          .map((it, idx) => {
            if (it.item_type === 'weekly_word') {
              const w = it.word || {};
              const label = w.title || w.gospel_ref || it.item_id;
              const sub = w.liturgical_title || w.gospel_ref || '';
              return `<div class="song-row-compact song-row-compact--clickable list-detail__voz-row" data-voz-id="${escapeHtml(String(it.item_id))}">
                <span class="song-row-compact__index">${idx + 1}</span>
                ${voiceoverCoverHtml(w.liturgical_color, { size: 44, radius: 6 })}
                <div class="song-row-compact__info">
                  <span class="song-row-compact__title">${escapeHtml(label)}</span>
                  <span class="song-row-compact__album">${escapeHtml(sub)}</span>
                </div>
                <span class="voice-badge voice-badge--voz">Voz en off</span>
              </div>`;
            }
            const row = songRowCompact(songForRender(it.item_id), { index: idx + 1 });
            return row.replace(
              'class="song-row-compact"',
              'class="song-row-compact song-row-compact--clickable"',
            );
          })
          .join('');

  const childrenPaneHtml = `
    ${
      children.length === 0
        ? `<p class="list-detail__empty">Aún no hay ensayos.</p>`
        : children
            .map(
              (c) => `
        <div class="list-detail__child" data-child-id="${escapeHtml(c.id)}">
          <span class="list-detail__child-name">${escapeHtml(c.name)}</span>
          <span class="list-detail__child-meta">${Number(c.song_count) || 0} temas · ${escapeHtml(formatExpiry(c.expires_at))}</span>
          <span class="list-detail__child-chevron">${icon('chevron-right', { size: 16 })}</span>
        </div>`,
            )
            .join('')
    }
    ${isOwner ? `<button class="btn btn--secondary list-detail__add-child" id="list-detail-add-child" type="button">${icon('plus', { size: 14 })} Ensayo</button>` : ''}
  `;

  container.innerHTML = `
    <div class="list-detail__container">
      ${parent ? `<button class="list-detail__crumb" id="list-detail-crumb" type="button">${icon('chevron-left', { size: 14 })} ${escapeHtml(parent.name)}</button>` : ''}
      <div class="list-detail__header">
        <h1 class="list-detail__title">${escapeHtml(listData.name)}</h1>
        ${expiryChipHtml(listData.expires_at)}
        ${
          isOwner
            ? `<button class="btn btn--secondary list-detail__edit-btn" id="list-detail-edit">${icon('pencil', { size: 14 })} Editar</button>`
            : ''
        }
      </div>
      ${
        showSeg
          ? `<div class="list-detail__seg" role="tablist">
               <button class="list-detail__seg-tab is-active" data-pane="songs" role="tab" type="button">Setlist · ${orderedItems.length}</button>
               <button class="list-detail__seg-tab" data-pane="children" role="tab" type="button">Ensayos · ${children.length}</button>
             </div>`
          : ''
      }
      <div class="list-detail__songs" data-pane-body="songs">${songsPaneHtml}</div>
      ${showSeg ? `<div class="list-detail__children" data-pane-body="children" hidden>${childrenPaneHtml}</div>` : ''}
    </div>
  `;

  container.querySelector('#list-detail-edit')?.addEventListener('click', () => {
    renderEditor(
      container,
      listData,
      listData.parent
        ? {
            parent: {
              id: listData.parent.id,
              name: listData.parent.name,
              expires_at: listData.parent.expires_at,
            },
          }
        : {},
    );
  });

  container.querySelector('#list-detail-crumb')?.addEventListener('click', () => {
    navigate(`/lista/${parent.id}`);
  });

  const tabs = container.querySelectorAll('.list-detail__seg-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      const target = tab.dataset.pane;
      container.querySelectorAll('[data-pane-body]').forEach((body) => {
        body.hidden = body.dataset.paneBody !== target;
      });
    });
  });

  container.querySelectorAll('.list-detail__child').forEach((row) => {
    row.addEventListener('click', () => navigate(`/lista/${row.dataset.childId}`));
  });

  container.querySelector('#list-detail-add-child')?.addEventListener('click', () => {
    renderEditor(
      container,
      {
        id: null,
        name: '',
        expires_at: null,
        songs: [],
        members: listData.members || [],
        role: 'owner',
      },
      {
        parent: {
          id: listData.id,
          name: listData.name,
          expires_at: listData.expires_at,
          songs: orderedSongIds,
        },
      },
    );
  });

  container.querySelectorAll('.song-row-compact--clickable').forEach((row) => {
    row.addEventListener('click', () => {
      const songId = row.dataset.songId;
      if (!songId) return; // fila de voz en off → la maneja su propio handler
      setActiveContext({ listId: listData.id, name: listData.name, orderedItems });
      navigate(`/song/${songId}?lista=${listData.id}`);
    });
  });

  container.querySelectorAll('.list-detail__voz-row').forEach((row) => {
    row.addEventListener('click', () => {
      setActiveContext({ listId: listData.id, name: listData.name, orderedItems });
      navigate(`/voz/${row.dataset.vozId}`);
    });
  });
}

/* ── Test helper ────────────────────────────────────────────────── */
export const __renderEditorForTest = renderEditor;
