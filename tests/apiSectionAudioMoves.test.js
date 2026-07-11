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

  // Cinturón adicional: `to` no puede invadir la zona reservada para el
  // offset temporal de applySectionAudioMoves (MOVE_OFFSET, ver ese módulo).
  // sectionCount gigante simula un body patológico donde solo el chequeo del
  // offset (no el de sectionCount) rechaza el move.
  it('rechaza to que invade la zona del offset temporal (>= 100000)', () => {
    expect(validateSectionAudioMoves([{ from: 0, to: 100_000 }], 200_000)).toMatch(/rango/);
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

  // El schema real tiene CHECK (section_index >= 0) (ver
  // supabase/migrations/20260707120000_song_section_audio.sql): un temporal
  // negativo violaría ese CHECK en cuanto tocara una fila real. Por eso la
  // fase temporal usa un offset POSITIVO (MOVE_OFFSET = 1_000_000) en vez de
  // -1-to.
  it('fase 1: manda cada from a un índice temporal MOVE_OFFSET+to (positivo)', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', [
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);

    // Fase 1 son las primeras N llamadas (una por move), fase 2 es la última.
    const phase1 = tx.calls.slice(0, 2);
    expect(phase1[0].text).toMatch(/UPDATE song_section_audio SET section_index/);
    expect(phase1[0].values).toEqual([1_000_001, 'song-1', 0]); // to=1 -> 1e6+1, songId, from=0
    expect(phase1[1].values).toEqual([1_000_000, 'song-1', 1]); // to=0 -> 1e6+0, songId, from=1
  });

  it('fase 2: resta el offset de todo lo que quedó por encima, para ese song_id', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', [{ from: 0, to: 1 }]);

    const phase2 = tx.calls[tx.calls.length - 1];
    expect(phase2.text).toMatch(/section_index = section_index - .*section_index >= /s);
    expect(phase2.values).toEqual([1_000_000, 'song-1', 1_000_000]);
  });

  it('sin moves: no ejecuta ninguna query', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', []);
    expect(tx.calls).toHaveLength(1); // solo la fase 2 (resta offset, no-op si nada quedó por encima)
  });

  // Proxy unitario del CHECK (section_index >= 0) del schema real: ningún
  // valor asignado a section_index por applySectionAudioMoves puede ser
  // negativo, sin importar cuántos/cuáles sean los moves. Protege contra una
  // regresión que reintroduzca el diseño con offset negativo (-1-to).
  it('ningún valor asignado a section_index es negativo (protege el CHECK >= 0 del schema)', async () => {
    const tx = makeFakeTx();
    await applySectionAudioMoves(tx, 'song-1', [
      { from: 0, to: 2 },
      { from: 1, to: 0 },
      { from: 2, to: 1 },
    ]);

    // El primer valor de cada UPDATE (fase 1 y fase 2) es el que se asigna a
    // section_index — nunca debe ser negativo.
    for (const call of tx.calls) {
      expect(call.values[0]).toBeGreaterThanOrEqual(0);
    }
  });
});
