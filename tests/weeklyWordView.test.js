// tests/weeklyWordView.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../src/lib/authStore.js', () => ({ isAdmin: vi.fn(() => false) }));

import { renderWeeklyWordView } from '../src/components/WeeklyWordView.js';

const SAMPLE_WORD = {
  id: 'ww1',
  sunday_date: '2026-06-15',
  gospel_ref: 'Jn 14,6',
  liturgical_title: 'XI Domingo del Tiempo Ordinario',
  liturgical_color: 'green',
  voiceover_body: 'Yo soy el camino, la verdad y la vida.\n---\nReflexión propia sobre la verdad.',
  gospel_body: 'Yo soy el camino, la verdad y la vida.\nNadie llega al Padre sino por mí.',
  published: true,
};

describe('WeeklyWordView', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
  });

  it('renderiza el hero con gospel_ref y eyebrow (logo gospel, sin paloma)', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    expect(container.innerHTML).not.toContain('🕊');
    expect(container.innerHTML).toContain('Palabra de la semana');
    expect(container.innerHTML).toContain('<svg');
    expect(container.innerHTML).toContain('Jn 14,6');
  });

  it('renderiza el separador 6b ✦ Reflexión', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    expect(container.innerHTML).toContain('✦ Reflexión');
  });

  it('la reflexión usa white-space: pre-wrap', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    const reflectionEl = container.querySelector('.voz__reflection');
    expect(reflectionEl).toBeTruthy();
    expect(reflectionEl.style.whiteSpace).toMatch(/pre-wrap/);
  });

  it('el separador ✦ Reflexión tiene color según liturgical_color green', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    const sepEl = container.querySelector('.voz__reflection-sep');
    expect(sepEl).toBeTruthy();
    // El color accent de 'green' es #4caf82; jsdom lo normaliza a rgb()
    const colorVal = sepEl.style.color;
    expect(colorVal === '#4caf82' || colorVal === 'rgb(76, 175, 130)').toBe(true);
  });

  it('renderiza el bloque evangelio con gospel_body', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    expect(container.innerHTML).toContain('Fuente: Ordo');
    expect(container.innerHTML).toContain('Nadie llega al Padre sino por mí');
  });

  it('muestra botón Editar solo para admins', async () => {
    const { isAdmin } = await import('../src/lib/authStore.js');
    isAdmin.mockReturnValue(true);
    await renderWeeklyWordView(container, SAMPLE_WORD);
    expect(container.querySelector('[data-action="edit-voz"]')).toBeTruthy();
  });
});
