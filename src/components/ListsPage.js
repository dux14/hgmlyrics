// src/components/ListsPage.js
// Pantalla propia de Listas — reutiliza el render de la sección Listas de Home.
import '../styles/lists.css';
import { navigate } from '../router.js';
import { renderListsBody } from './Home.js';
import { listMyLists } from '../lib/lists.js';
import { cached } from '../lib/prefetch.js';
import { skelRowList } from '../lib/skeleton.js';
import { todayLocal } from '../lib/listUrgency.js';

/**
 * Renderiza la pantalla de listas del usuario.
 * @param {HTMLElement} container
 * @param {{ today?: string }} [opts]
 */
export async function renderListsPage(container, { today = todayLocal() } = {}) {
  container.innerHTML = `
    <div class="lists-page fade-in">
      <div class="home__hd">
        <h2 class="home__hd-title">Listas</h2>
      </div>
      <div id="lists-page-body" aria-busy="true">${skelRowList({ rows: 5 })}</div>
    </div>
  `;
  const body = container.querySelector('#lists-page-body');
  let lists;
  try {
    const res = await cached('lists', listMyLists);
    lists = res.data ?? [];
  } catch {
    lists = [];
  }
  body.removeAttribute('aria-busy');
  body.innerHTML = renderListsBody(lists, today);
  body
    .querySelectorAll('[data-list-id]')
    .forEach((el) => el.addEventListener('click', () => navigate(`/lista/${el.dataset.listId}`)));
  body
    .querySelector('[data-create-list]')
    ?.addEventListener('click', () => navigate('/lista/nueva'));
}
