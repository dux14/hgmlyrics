import { describe, it, expect } from 'vitest';
import { splitColumns } from '../../scripts/acordes/lib/columns.mjs';

describe('splitColumns', () => {
  it('separa items por umbral x (default 290)', () => {
    const items = [
      { str: 'izq', x: 100, y: 700, width: 20 },
      { str: 'der', x: 300, y: 700, width: 20 },
      { str: 'borde', x: 289, y: 690, width: 20 },
    ];
    const { left, right } = splitColumns(items);
    expect(left.map((i) => i.str)).toEqual(['izq', 'borde']);
    expect(right.map((i) => i.str)).toEqual(['der']);
  });

  it('respeta umbral custom', () => {
    const items = [{ str: 'a', x: 150, y: 1, width: 1 }];
    expect(splitColumns(items, 100).right.map((i) => i.str)).toEqual(['a']);
  });
});
