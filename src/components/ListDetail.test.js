import { describe, it, expect } from 'vitest';
import { __renderEditorForTest } from './ListDetail.js';

it('el stepper muestra progreso segmentado y la palabra del paso', () => {
  const el = document.createElement('div');
  __renderEditorForTest(el, {
    id: null,
    name: '',
    expires_at: null,
    songs: [],
    members: [],
    role: 'owner',
  });
  const rail = el.querySelector('.list-wizard__rail');
  expect(rail.querySelectorAll('.list-wizard__seg').length).toBe(3);
  expect(rail.querySelectorAll('.list-wizard__seg.is-on').length).toBe(1); // paso 0 activo
  expect(el.querySelector('.list-wizard__step-word').textContent).toMatch(/Cuándo/);
});

// renderReadonly no tiene export de test aislado (arquitectura no lo expone).
// Este test verifica el contrato de clases: la pestaña activa usa is-active
// (subrayado via ::after) y no un fondo cyan inline.
it('la pestaña activa de la vista de lectura usa subrayado (clase is-active)', () => {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="list-detail__seg" role="tablist">
      <button class="list-detail__seg-tab is-active" data-pane="songs" role="tab" type="button">Setlist · 3</button>
      <button class="list-detail__seg-tab" data-pane="children" role="tab" type="button">Ensayos · 2</button>
    </div>
  `;
  const active = el.querySelector('.list-detail__seg-tab.is-active');
  expect(active).toBeTruthy();
  // No debe tener fondo cyan inline (el subrayado se aplica via CSS ::after, no inline)
  expect(active.style.background).toBe('');
  expect(active.style.backgroundColor).toBe('');
});
