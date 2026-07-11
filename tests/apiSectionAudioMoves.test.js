import { describe, it, expect, vi } from 'vitest';
import {
  validateSectionAudioMoves,
  applySectionAudioMoves,
} from '../api/_lib/sectionAudioMoves.js';

describe('validateSectionAudioMoves', () => {
  it('acepta moves válidos', () => {
    expect(
      validateSectionAudioMoves(
        [
          { from: 0, to: 1 },
          { from: 1, to: 0 },
        ],
        2,
      ),
    ).toBeNull();
  });

  it('acepta array vacío', () => {
    expect(validateSectionAudioMoves([], 3)).toBeNull();
  });

  it('rechaza si no es un array', () => {
    expect(validateSectionAudioMoves(null, 3)).toMatch(/array/);
  });

  it('rechaza from/to no enteros', () => {
    expect(validateSectionAudioMoves([{ from: 0.5, to: 1 }], 3)).toMatch(/enteros/);
  });

  it('rechaza from negativo', () => {
    expect(validateSectionAudioMoves([{ from: -1, to: 0 }], 3)).toMatch(/negativos/);
  });

  it('rechaza to negativo', () => {
    expect(validateSectionAudioMoves([{ from: 0, to: -1 }], 3)).toMatch(/negativos/);
  });

  // `from` referencia el layout VIEJO: no se acota contra sectionCount (el
  // nuevo layout). Borrar una sección no-final produce moves con `from` >=
  // sectionCount y deben seguir siendo válidos (ver bug crítico reproducido:
  // 3 secciones, se borra la del medio -> {from:2,to:1} con sectionCount=2).
  it('acepta from fuera del rango del layout nuevo (borrar sección no-final)', () => {
    expect(validateSectionAudioMoves([{ from: 2, to: 1 }], 2)).toBeNull();
  });

  it('rechaza to fuera de rango', () => {
    expect(validateSectionAudioMoves([{ from: 0, to: 2 }], 2)).toMatch(/rango/);
  });

  it('rechaza from duplicado', () => {
    expect(
      validateSectionAudioMoves(
        [
          { from: 0, to: 1 },
          { from: 0, to: 2 },
        ],
        3,
      ),
    ).toMatch(/from duplicado/);
  });

  it('rechaza to duplicado', () => {
    expect(
      validateSectionAudioMoves(
        [
          { from: 0, to: 2 },
          { from: 1, to: 2 },
        ],
        3,
      ),
    ).toMatch(/to duplicado/);
  });
});

describe('applySectionAudioMoves', () => {
  function makeFakeTx() {
    const calls = [];
    const tx = vi.fn((strings, ...values) => {
      calls.push({ text: strings.join('?'), values });
      return Promise.resolve({ count: 1 });
    });
    tx.calls = calls;
    return tx;
  }

  it('fase 1: manda cada from a un índice temporal negativo (-1-to)', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', [
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);

    // Fase 1 son las primeras N llamadas (una por move), fase 2 es la última.
    const phase1 = tx.calls.slice(0, 2);
    expect(phase1[0].text).toMatch(/UPDATE song_section_audio SET section_index/);
    expect(phase1[0].values).toEqual([-2, 'song-1', 0]); // to=1 -> -1-1=-2, songId, from=0
    expect(phase1[1].values).toEqual([-1, 'song-1', 1]); // to=0 -> -1-0=-1, songId, from=1
  });

  it('fase 2: des-negativiza todo lo que quedó negativo para ese song_id', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', [{ from: 0, to: 1 }]);

    const phase2 = tx.calls[tx.calls.length - 1];
    expect(phase2.text).toMatch(/section_index = -1 - section_index/);
    expect(phase2.values).toEqual(['song-1']);
  });

  it('sin moves: no ejecuta ninguna query', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', []);
    expect(tx.calls).toHaveLength(1); // solo la fase 2 (des-negativiza, no-op si nada quedó negativo)
  });
});
