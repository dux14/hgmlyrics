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

  it('renderiza el separador Reflexión con icono SVG (F2c: icono lucide, no ✦)', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    const sepEl = container.querySelector('.voz__reflection-sep');
    expect(sepEl).toBeTruthy();
    // F2c: el separador contiene el texto "Reflexión" y un SVG lucide (no el carácter ✦)
    expect(sepEl.textContent).toContain('Reflexión');
    expect(sepEl.querySelector('svg')).toBeTruthy();
  });

  it('la reflexión tiene clase voz__prose (F2c: white-space via CSS, no inline)', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    const reflectionEl = container.querySelector('.voz__reflection');
    expect(reflectionEl).toBeTruthy();
    // F2c: white-space: pre-wrap vive en .voz__prose; el elemento tiene ambas clases
    expect(reflectionEl.classList.contains('voz__prose')).toBe(true);
  });

  it('el separador Reflexión usa --color-action via CSS (F2c: sin inline color)', async () => {
    await renderWeeklyWordView(container, SAMPLE_WORD);
    const sepEl = container.querySelector('.voz__reflection-sep');
    expect(sepEl).toBeTruthy();
    // F2c: color gestionado por CSS (.voz__reflection-sep { color: var(--color-action) }),
    // no por inline style — el inline color debe estar vacío
    expect(sepEl.style.color).toBe('');
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
