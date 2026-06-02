/**
 * RecommenderPage.js — Página placeholder "Recomendador" (BETA, en construcción).
 * Sin lógica de recomendación todavía.
 */
import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';

/**
 * Render the recommender placeholder page.
 * @param {HTMLElement} container
 */
export function renderRecommenderPage(container) {
  container.innerHTML = `
    <div class="empty-state fade-in">
      <div class="empty-state__icon">${icon('sparkles', { size: 48 })}</div>
      <h2 class="empty-state__title">Recomendador <span class="badge--beta">BETA</span></h2>
      <p class="empty-state__text">
        Estamos construyendo esto. Pronto te sugeriremos canciones según lo que
        cantás y tus favoritos.
      </p>
      <button class="btn btn--primary" style="margin-top: 1rem;" id="recommender-home">Volver al inicio</button>
    </div>
  `;
  container.querySelector('#recommender-home')?.addEventListener('click', () => navigate('/'));
}
