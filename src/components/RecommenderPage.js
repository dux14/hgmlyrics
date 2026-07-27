/**
 * RecommenderPage.js — Página "Recomendador" (en construcción).
 * Estado vacío deliberado: orbe ambiente SVG, promesa.
 * Sin lógica de recomendación todavía.
 */
import { icon } from '../lib/icons.js';
import { navigate } from '../router.js';
import '../styles/recommender.css';

/**
 * Render the recommender page with ambient empty state.
 * @param {HTMLElement} container
 */
export function renderRecommenderPage(container) {
  container.innerHTML = `
    <div class="recommender-page fade-in">
      <div class="recommender-page__orb">${icon('sparkles', { size: 34 })}</div>
      <h2 class="recommender-page__title">
        Recomendador
      </h2>
      <p class="recommender-page__text">
        Estamos construyendo esto. Pronto te sugeriremos canciones según lo que
        cantas y tus favoritos.
      </p>
      <button class="btn btn--back recommender-page__cta" id="recommender-home">
        ${icon('arrow-left', { size: 16 })}
        Volver a herramientas
      </button>
    </div>
  `;
  container
    .querySelector('#recommender-home')
    ?.addEventListener('click', () => navigate('/herramientas'));
}
