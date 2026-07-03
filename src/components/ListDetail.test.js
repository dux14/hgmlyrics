import { describe, it, expect } from 'vitest';
import { __renderEditorForTest } from './ListDetail.js';

it('el stepper muestra progreso segmentado y la palabra del paso', () => {
  const el = document.createElement('div');
  __renderEditorForTest(el, { id: null, name: '', expires_at: null, songs: [], members: [], role: 'owner' });
  const rail = el.querySelector('.list-wizard__rail');
  expect(rail.querySelectorAll('.list-wizard__seg').length).toBe(3);
  expect(rail.querySelectorAll('.list-wizard__seg.is-on').length).toBe(1); // paso 0 activo
  expect(el.querySelector('.list-wizard__step-word').textContent).toMatch(/Cuándo/);
});
