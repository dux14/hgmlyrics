import { describe, it, expect } from 'vitest';
import { groupLines } from '../../scripts/acordes/lib/lines.mjs';

describe('groupLines', () => {
  it('agrupa por y (con tolerancia) y ordena de arriba a abajo', () => {
    const items = [
      { str: 'de', x: 130, y: 500, width: 20 },
      { str: 'Sal ', x: 100, y: 500.5, width: 30 },
      { str: 'Am', x: 100, y: 514, width: 18 },
    ];
    const lines = groupLines(items, 3);
    // y mayor primero (PDF: y crece hacia arriba)
    expect(lines.map((l) => l.text)).toEqual(['Am', 'Sal de']);
  });

  it('ordena items dentro de la línea por x', () => {
    const items = [
      { str: 'b', x: 50, y: 10, width: 5 },
      { str: 'a', x: 10, y: 10, width: 5 },
    ];
    expect(groupLines(items).text ?? groupLines(items)[0].text).toBe('ab');
  });
});
