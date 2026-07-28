// src/lib/voiceoverHero.test.js
import { describe, it, expect } from 'vitest';
import { voiceoverHero } from './voiceoverHero.js';

describe('voiceoverHero', () => {
  it('word completo: bigTitle limpio, pillLabel del color, metaLine fecha · cita', () => {
    const result = voiceoverHero({
      liturgical_title: '14. Domingo XI del Tiempo Ordinario, verde',
      gospel_ref: 'Lc 9, 18-24',
      sunday_date: '2026-06-21',
      liturgical_color: 'green',
    });
    expect(result.bigTitle).toBe('Domingo XI del Tiempo Ordinario');
    expect(result.pillLabel).toBe('Tiempo Ordinario');
    expect(result.metaLine).toBe('21 de junio de 2026 · Lc 9, 18-24');
  });

  it('sin liturgical_title: bigTitle cae a gospel_ref', () => {
    const result = voiceoverHero({
      gospel_ref: 'Lc 9, 18-24',
      sunday_date: '2026-06-21',
      liturgical_color: 'green',
    });
    expect(result.bigTitle).toBe('Lc 9, 18-24');
  });

  it('sin liturgical_title ni gospel_ref: bigTitle vacio', () => {
    const result = voiceoverHero({
      sunday_date: '2026-06-21',
      liturgical_color: 'green',
    });
    expect(result.bigTitle).toBe('');
  });

  it('sin liturgical_color: pillLabel vacio', () => {
    const result = voiceoverHero({
      liturgical_title: 'Domingo de Ramos',
      gospel_ref: 'Mt 26, 14-27',
      sunday_date: '2026-06-21',
    });
    expect(result.pillLabel).toBe('');
  });

  it('color desconocido: pillLabel vacio (fallback)', () => {
    const result = voiceoverHero({
      liturgical_title: 'Domingo de Ramos',
      liturgical_color: 'rosa',
    });
    expect(result.pillLabel).toBe('');
  });

  it('sunday_date como timestamp completo se formatea correctamente', () => {
    const result = voiceoverHero({
      gospel_ref: 'Lc 9, 18-24',
      sunday_date: '2026-06-21T00:00:00.000Z',
      liturgical_color: 'green',
    });
    expect(result.metaLine).toBe('21 de junio de 2026 · Lc 9, 18-24');
  });

  it('sunday_date null: metaLine sin fecha, solo cita', () => {
    const result = voiceoverHero({
      gospel_ref: 'Lc 9, 18-24',
      sunday_date: null,
      liturgical_color: 'green',
    });
    expect(result.metaLine).toBe('Lc 9, 18-24');
  });

  it('sin fecha ni cita: metaLine vacio', () => {
    const result = voiceoverHero({
      liturgical_title: 'Domingo de Ramos',
      liturgical_color: 'green',
    });
    expect(result.metaLine).toBe('');
  });

  it.each([
    ['green', 'Tiempo Ordinario'],
    ['purple', 'Adviento / Cuaresma'],
    ['white', 'Pascua / Fiestas'],
    ['red', 'Pentecostés / Mártires'],
  ])('color %s produce pillLabel "%s"', (color, label) => {
    const result = voiceoverHero({ liturgical_color: color });
    expect(result.pillLabel).toBe(label);
  });
});
