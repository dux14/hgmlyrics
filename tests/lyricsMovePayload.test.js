import { describe, expect, it } from 'vitest';
import { moveLinePayload } from '../src/components/pipeline/lyrics/movePayload.js';

describe('moveLinePayload', () => {
  it('mover hacia abajo en la misma sección descuenta el renglón removido', () => {
    // Sección [a,b,c]: arrastrar 'a' al hueco visual 3 (el final) da toLine 2,
    // porque el backend inserta DESPUÉS de haber quitado 'a'.
    expect(moveLinePayload({ fromSection: 0, fromLine: 0, toSection: 0, toLine: 3 })).toEqual({
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 0,
      toLine: 2,
    });
  });

  it('mover hacia arriba en la misma sección no descuenta nada', () => {
    expect(moveLinePayload({ fromSection: 0, fromLine: 2, toSection: 0, toLine: 0 })).toEqual({
      type: 'moveLine',
      fromSection: 0,
      fromLine: 2,
      toSection: 0,
      toLine: 0,
    });
  });

  it('los dos huecos que dejan el renglón donde está son no-op', () => {
    expect(moveLinePayload({ fromSection: 0, fromLine: 1, toSection: 0, toLine: 1 })).toBeNull();
    expect(moveLinePayload({ fromSection: 0, fromLine: 1, toSection: 0, toLine: 2 })).toBeNull();
  });

  it('cruzar de sección no ajusta el índice', () => {
    expect(moveLinePayload({ fromSection: 0, fromLine: 0, toSection: 1, toLine: 0 })).toEqual({
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 1,
      toLine: 0,
    });
    expect(moveLinePayload({ fromSection: 1, fromLine: 0, toSection: 0, toLine: 2 })).toEqual({
      type: 'moveLine',
      fromSection: 1,
      fromLine: 0,
      toSection: 0,
      toLine: 2,
    });
  });

  it('un destino nulo o incompleto no produce payload', () => {
    expect(moveLinePayload(null)).toBeNull();
    expect(moveLinePayload({ fromSection: 0, fromLine: 0, toSection: null, toLine: 0 })).toBeNull();
  });
});
