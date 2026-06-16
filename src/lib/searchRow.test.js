import { describe, it, expect } from 'vitest';
import { weeklyWordSearchRow } from './searchRow.js';

describe('weeklyWordSearchRow', () => {
  const item = {
    id: 'w1',
    gospel_ref: 'Mc 4, 26-34',
    liturgical_title: 'XI Ordinario',
    liturgical_color: 'green',
  };

  it('no contiene el emoji paloma', () => {
    expect(weeklyWordSearchRow(item)).not.toContain('🕊');
  });

  it('renderiza la mini-portada generativa (gradiente + svg)', () => {
    const html = weeklyWordSearchRow(item);
    expect(html).toContain('voz-cover');
    expect(html).toContain('<svg');
  });
});
