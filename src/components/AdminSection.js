import { navigate } from '../router.js';
import { icon } from '../lib/icons.js';

/**
 * Cabecera estándar para sub-páginas de admin: botón volver (a /admin por
 * defecto) + título. Devuelve el nodo `.admin-section__body` para que el
 * caller monte su contenido ahí.
 */
export function renderAdminSection(
  container,
  { title, iconName, onBack = () => navigate('/admin') },
) {
  container.innerHTML = `
    <div class="admin-section fade-in">
      <div class="admin-section__header">
        <button class="btn btn--back" id="btn-admin-section-back">
          ${icon('arrow-left', { size: 18 })} Volver
        </button>
        <h1 class="editor__title admin-section__title">
          ${iconName ? icon(iconName, { size: 20 }) : ''} ${title}
        </h1>
      </div>
      <div class="admin-section__body"></div>
    </div>
  `;

  container.querySelector('#btn-admin-section-back').addEventListener('click', onBack);

  return container.querySelector('.admin-section__body');
}
