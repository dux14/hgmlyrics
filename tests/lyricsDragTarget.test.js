import { describe, expect, it } from 'vitest';
import { dropTargetAt } from '../src/components/pipeline/lyrics/dragTarget.js';

// Dos secciones de dos renglones de 40px, separadas por un hueco de 20px.
function rects() {
  return [
    {
      sIdx: 0,
      isBand: false,
      top: 0,
      bottom: 80,
      lines: [
        { lIdx: 0, mid: 20 },
        { lIdx: 1, mid: 60 },
      ],
    },
    {
      sIdx: 1,
      isBand: false,
      top: 100,
      bottom: 180,
      lines: [
        { lIdx: 0, mid: 120 },
        { lIdx: 1, mid: 160 },
      ],
    },
  ];
}

describe('dropTargetAt', () => {
  it('por encima del mid del primer renglón cae en el hueco 0', () => {
    expect(dropTargetAt(rects(), 10)).toEqual({ toSection: 0, toLine: 0 });
  });

  it('por debajo del mid cae en el hueco siguiente', () => {
    expect(dropTargetAt(rects(), 30)).toEqual({ toSection: 0, toLine: 1 });
  });

  it('por debajo del último mid de la sección cae en el hueco final', () => {
    expect(dropTargetAt(rects(), 75)).toEqual({ toSection: 0, toLine: 2 });
  });

  it('en el hueco entre secciones toma la más cercana por el borde que toca', () => {
    expect(dropTargetAt(rects(), 85)).toEqual({ toSection: 0, toLine: 2 });
    expect(dropTargetAt(rects(), 97)).toEqual({ toSection: 1, toLine: 0 });
  });

  it('por encima de la primera y por debajo de la última se clampea', () => {
    expect(dropTargetAt(rects(), -50)).toEqual({ toSection: 0, toLine: 0 });
    expect(dropTargetAt(rects(), 900)).toEqual({ toSection: 1, toLine: 2 });
  });

  it('una banda instrumental es un destino único', () => {
    const band = [{ sIdx: 0, isBand: true, top: 0, bottom: 60, lines: [] }];
    expect(dropTargetAt(band, 10)).toEqual({ toSection: 0, toLine: 0 });
    expect(dropTargetAt(band, 55)).toEqual({ toSection: 0, toLine: 0 });
  });

  it('una sección sin renglones que no es banda acepta el hueco 0', () => {
    const empty = [{ sIdx: 0, isBand: false, top: 0, bottom: 40, lines: [] }];
    expect(dropTargetAt(empty, 20)).toEqual({ toSection: 0, toLine: 0 });
  });

  it('sin secciones no hay destino', () => {
    expect(dropTargetAt([], 10)).toBeNull();
  });
});
