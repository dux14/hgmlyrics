import { describe, it, expect } from 'vitest';
import { renderSectionCard } from './StudioSectionCard.js';

describe('StudioSectionCard — skipped', () => {
  it('renderiza chip "No procesada" y botón "Procesar ahora" con data-section', () => {
    const card = renderSectionCard({ key: 'gender', section: { status: 'skipped' } });
    const chip = card.querySelector('.studio-section-card__chip');
    expect(chip.textContent).toBe('No procesada');
    const btn = card.querySelector('.studio-section-card__resume');
    expect(btn).not.toBeNull();
    expect(btn.dataset.section).toBe('gender');
    expect(btn.textContent).toContain('Procesar ahora');
    expect(card.textContent).not.toContain('Disponible pronto');
  });
});

describe('StudioSectionCard — done con descarga por sección', () => {
  it('voiceInstrumental done muestra botón "Descargar sección (ZIP)"', () => {
    const card = renderSectionCard({
      key: 'voiceInstrumental',
      section: { status: 'done' },
      stems: { vocals: 'https://s/v', instrumental: 'https://s/i' },
    });
    const dl = card.querySelector('.studio-section-card__dl');
    expect(dl).not.toBeNull();
    expect(dl.dataset.section).toBe('voiceInstrumental');
    expect(dl.textContent).toContain('Descargar sección');
  });

  it('structure done NO muestra botón de descarga (no genera audio)', () => {
    const card = renderSectionCard({
      key: 'structure',
      section: { status: 'done', segments: [{ start: 0, end: 5, label: 'intro' }] },
    });
    expect(card.querySelector('.studio-section-card__dl')).toBeNull();
  });
});
