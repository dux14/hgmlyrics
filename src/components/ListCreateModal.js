/**
 * ListCreateModal.js — Modal para crear una lista efímera.
 *
 * Uso: openListCreateModal((list) => { ... })
 */

import '../styles/lists.css';
import { createList } from '../lib/lists.js';
import { icon } from '../lib/icons.js';

/**
 * Abre el modal de creación de lista.
 * @param {function} onCreated - callback que recibe la lista creada
 */
export function openListCreateModal(onCreated) {
  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'lists__modal-overlay';

  overlay.innerHTML = `
    <div class="lists__modal-card" role="dialog" aria-modal="true" aria-labelledby="list-modal-title">
      <div class="lists__modal-header">
        <h2 class="lists__modal-title" id="list-modal-title">Nueva lista</h2>
        <button class="lists__modal-close" id="list-modal-close" aria-label="Cerrar">
          ${icon('close', { size: 18 })}
        </button>
      </div>

      <div class="lists__modal-field">
        <label class="lists__modal-label" for="list-modal-name">Nombre</label>
        <input
          class="lists__modal-input"
          type="text"
          id="list-modal-name"
          placeholder="Ej. Ensayo del viernes"
          maxlength="80"
          autocomplete="off"
        />
      </div>

      <div class="lists__modal-field">
        <span class="lists__modal-label">Caducidad</span>
        <div class="lists__presets">
          <button class="lists__preset-btn lists__preset-btn--active" data-days="1">1 día</button>
          <button class="lists__preset-btn" data-days="7">7 días</button>
          <button class="lists__preset-btn" data-days="30">30 días</button>
        </div>
        <input
          class="lists__modal-input"
          type="date"
          id="list-modal-date"
          style="margin-top: var(--space-xs)"
        />
      </div>

      <p class="lists__modal-error" id="list-modal-error" aria-live="polite"></p>

      <button class="btn btn--primary" id="list-modal-submit">Crear lista</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('#list-modal-name');
  const dateInput = overlay.querySelector('#list-modal-date');
  const errorEl = overlay.querySelector('#list-modal-error');
  const submitBtn = overlay.querySelector('#list-modal-submit');
  const presetBtns = overlay.querySelectorAll('.lists__preset-btn');

  // Preset activo por defecto: 1 día
  let activeDays = 1;
  dateInput.value = '';

  function isoFromDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  }

  // Selección de preset
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetBtns.forEach((b) => b.classList.remove('lists__preset-btn--active'));
      btn.classList.add('lists__preset-btn--active');
      activeDays = Number(btn.dataset.days);
      // Limpiar fecha manual al elegir un preset
      dateInput.value = '';
    });
  });

  // Si el usuario elige fecha exacta, deseleccionar preset
  dateInput.addEventListener('input', () => {
    if (dateInput.value) {
      presetBtns.forEach((b) => b.classList.remove('lists__preset-btn--active'));
      activeDays = null;
    }
  });

  function close() {
    overlay.remove();
  }

  overlay.querySelector('#list-modal-close').addEventListener('click', close);

  // Cerrar al clic en el overlay (fuera de la tarjeta)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  submitBtn.addEventListener('click', async () => {
    errorEl.textContent = '';

    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'El nombre no puede estar vacío.';
      nameInput.focus();
      return;
    }

    let expiresAt;
    if (dateInput.value) {
      const chosen = new Date(dateInput.value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (chosen <= today) {
        errorEl.textContent = 'La fecha debe ser futura.';
        dateInput.focus();
        return;
      }
      // Fin del día elegido
      chosen.setHours(23, 59, 59, 999);
      expiresAt = chosen.toISOString();
    } else {
      expiresAt = isoFromDays(activeDays ?? 1);
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creando…';

    try {
      const list = await createList(name, expiresAt);
      close();
      onCreated(list);
    } catch (err) {
      errorEl.textContent = err.message || 'Error al crear la lista.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear lista';
    }
  });

  // Foco inicial
  nameInput.focus();
}
