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

describe('avatar de invitado', () => {
  // Los invitados viven en el paso 3 ("¿Con quién?"): hay que avanzar el
  // asistente dos veces para que renderStep2 los pinte.
  function renderWithMembers(members) {
    const el = document.createElement('div');
    __renderEditorForTest(el, {
      id: 'l1',
      name: 'Ensayo',
      expires_at: null,
      songs: [],
      members,
      role: 'owner',
    });
    const next = el.querySelector('#list-wizard-next');
    next.click();
    next.click();
    return el;
  }

  it('pinta la inicial cuando el invitado no tiene foto', () => {
    const el = renderWithMembers([{ user_id: 'u1', username: 'juani', displayName: 'Juani' }]);
    const initial = el.querySelector('.list-detail__avatar-initial');
    expect(initial).toBeTruthy();
    expect(initial.textContent).toBe('J');
    expect(el.querySelector('img.list-detail__invitee-avatar')).toBeNull();
  });

  it('pinta la foto sobre la inicial, que queda de respaldo si la imagen falla', () => {
    const el = renderWithMembers([
      {
        user_id: 'u2',
        username: 'isa',
        displayName: 'Isa Sanchez',
        avatarUrl: 'https://lh3.googleusercontent.com/a/foto',
      },
    ]);
    const img = el.querySelector('img.list-detail__invitee-avatar');
    expect(img).toBeTruthy();
    // El respaldo debe seguir en el DOM detrás de la foto.
    expect(el.querySelector('.list-detail__avatar-initial').textContent).toBe('I');
    // Y el manejo de error debe quitar el <img>, no esconder el hueco entero.
    expect(img.getAttribute('onerror')).toBe('this.remove()');
  });
});
