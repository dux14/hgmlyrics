import { describe, it, expect } from 'vitest';
import { parseLineChords, parseImportText, songToChordPro } from '../src/lib/importParse.js';

describe('parseLineChords', () => {
  it('extrae acordes inline y deja texto limpio', () => {
    expect(parseLineChords('[Am]Sal de [E]ti')).toEqual({
      text: 'Sal de ti',
      chords: [
        { ch: 'Am', pos: 0 },
        { ch: 'E', pos: 7 },
      ],
    });
  });

  it('acepta acordes extendidos (dolor documentado: Dm7b5 no hacia round-trip)', () => {
    expect(parseLineChords('[Dm7b5]Uno [Cmaj7]dos [Gsus4]tres [Cadd9]cuatro [Am/E]cinco')).toEqual(
      {
        text: 'Uno dos tres cuatro cinco',
        chords: [
          { ch: 'Dm7b5', pos: 0 },
          { ch: 'Cmaj7', pos: 4 },
          { ch: 'Gsus4', pos: 8 },
          { ch: 'Cadd9', pos: 13 },
          { ch: 'Am/E', pos: 20 },
        ],
      },
    );
  });
});

describe('parseImportText', () => {
  it('detecta secciones y líneas con acordes', () => {
    const blocks = parseImportText('[Coro]\n[Am]Hola');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('chorus');
    expect(blocks[0].lines[0].text).toBe('Hola');
    expect(blocks[0].lines[0].chords).toEqual([{ ch: 'Am', pos: 0 }]);
  });

  describe('directivas ChordPro', () => {
    it('extrae title/artist/key/capo (formas largas) sin crear líneas de letra', () => {
      const text = '{title: Grande y Fuerte}\n{artist: Hakuna}\n{key: Am}\n{capo: 2}\n[Verso 1]\nHola';
      const blocks = parseImportText(text);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].lines).toHaveLength(1);
      expect(blocks.meta).toEqual({
        title: 'Grande y Fuerte',
        artist: 'Hakuna',
        key: 'Am',
        capo: 2,
      });
    });

    it('acepta formas cortas t/st/k/capo', () => {
      const blocks = parseImportText('{t: Titulo}\n{st: Artista}\n{k: C}\nHola');
      expect(blocks.meta).toEqual({ title: 'Titulo', artist: 'Artista', key: 'C' });
    });

    it('comment se convierte en línea anotación', () => {
      const blocks = parseImportText('[Verso 1]\n{comment: instrumental}\nHola');
      expect(blocks[0].lines[0]).toMatchObject({ text: 'instrumental', annotation: true });
      expect(blocks[0].lines[1].text).toBe('Hola');
    });

    it('start_of_verse/end_of_verse delimitan una sección tipo verse', () => {
      const blocks = parseImportText('{start_of_verse}\nHola\n{end_of_verse}');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('verse');
      expect(blocks[0].lines[0].text).toBe('Hola');
    });

    it('soc/eoc delimitan una sección tipo chorus con label del argumento', () => {
      const blocks = parseImportText('{soc: Coro}\nCanta\n{eoc}');
      expect(blocks[0].type).toBe('chorus');
      expect(blocks[0].label).toBe('Coro');
    });

    it('sob/eob delimitan una sección tipo bridge', () => {
      const blocks = parseImportText('{sob}\nPuente\n{eob}');
      expect(blocks[0].type).toBe('bridge');
    });

    it('ignora directivas desconocidas', () => {
      const blocks = parseImportText('{unknown: x}\nHola');
      expect(blocks[0].lines[0].text).toBe('Hola');
    });
  });

  describe('acordes en línea aparte (formato dual)', () => {
    it('fusiona línea de acordes con la línea de letra siguiente por columna', () => {
      const blocks = parseImportText('[Verso 1]\nC       G       Am\nSal de aquí y ven');
      expect(blocks[0].lines).toHaveLength(1);
      expect(blocks[0].lines[0].text).toBe('Sal de aquí y ven');
      expect(blocks[0].lines[0].chords).toEqual([
        { ch: 'C', pos: 0 },
        { ch: 'G', pos: 8 },
        { ch: 'Am', pos: 16 },
      ]);
    });

    it('no fusiona si la línea no es mayormente acordes', () => {
      const blocks = parseImportText('[Verso 1]\nHola que tal como estas\nSegunda línea');
      expect(blocks[0].lines).toHaveLength(2);
      expect(blocks[0].lines[0].chords).toEqual([]);
    });
  });
});

describe('songToChordPro + round-trip', () => {
  it('exporta directivas de metadata y las re-importa', () => {
    const song = {
      title: 'Grande y Fuerte',
      artist: 'Hakuna',
      key: 'A minor',
      cejilla: 2,
      sections: [],
    };
    const text = songToChordPro(song);
    expect(text).toContain('{title: Grande y Fuerte}');
    expect(text).toContain('{artist: Hakuna}');
    expect(text).toContain('{key: Am}');
    expect(text).toContain('{capo: 2}');
    const reimported = parseImportText(text);
    expect(reimported.meta).toEqual({
      title: 'Grande y Fuerte',
      artist: 'Hakuna',
      key: 'Am',
      capo: 2,
    });
  });

  it('round-trip estable: import → export → import produce las mismas secciones', () => {
    const original = '[Verso 1]\n[Dm7b5]Uno [Cmaj7]dos\n\n[Coro]\nCanta [G/B]fuerte';
    const firstPass = parseImportText(original);
    const song = {
      title: 'T',
      artist: 'A',
      sections: firstPass.map((b) => ({
        type: b.type,
        label: b.label,
        lines: b.lines.map((l) => ({
          text: l.text,
          chords: l.chords,
          annotation: l.annotation,
        })),
      })),
    };
    const exported = songToChordPro(song);
    const secondPass = parseImportText(exported);
    const strip = (blocks) =>
      blocks.map((b) => ({
        type: b.type,
        lines: b.lines.map((l) => ({ text: l.text, chords: l.chords, annotation: l.annotation })),
      }));
    expect(strip(secondPass)).toEqual(strip(firstPass));
  });

  it('escapa corchetes literales de la letra al exportar', () => {
    const song = {
      title: 'T',
      sections: [
        {
          type: 'verse',
          label: 'Verso 1',
          lines: [{ text: 'grito [A] los cuatro vientos', chords: [] }],
        },
      ],
    };
    const exported = songToChordPro(song);
    expect(exported).toContain('grito \\[A\\] los cuatro vientos');
  });

  it('round-trip estable con corchetes literales en la letra (sin acorde fantasma)', () => {
    const song = {
      title: 'T',
      sections: [
        {
          type: 'verse',
          label: 'Verso 1',
          lines: [{ text: 'grito [A] los cuatro vientos', chords: [] }],
        },
      ],
    };
    const exported = songToChordPro(song);
    const reimported = parseImportText(exported);
    expect(reimported[0].lines[0].text).toBe('grito [A] los cuatro vientos');
    expect(reimported[0].lines[0].chords).toEqual([]);
  });

  it('corchete literal conviviendo con un acorde real en la misma línea', () => {
    const song = {
      title: 'T',
      sections: [
        {
          type: 'verse',
          label: 'Verso 1',
          lines: [{ text: 'grito [A] fuerte y claro', chords: [{ ch: 'Dm', pos: 0 }] }],
        },
      ],
    };
    const exported = songToChordPro(song);
    const reimported = parseImportText(exported);
    expect(reimported[0].lines[0].text).toBe('grito [A] fuerte y claro');
    expect(reimported[0].lines[0].chords).toEqual([{ ch: 'Dm', pos: 0 }]);
  });

  it('ChordPro externo normal (sin backslashes) sigue intacto', () => {
    const blocks = parseImportText('[Verso 1]\n[Am]Sal de [E]ti');
    expect(blocks[0].lines[0].text).toBe('Sal de ti');
    expect(blocks[0].lines[0].chords).toEqual([
      { ch: 'Am', pos: 0 },
      { ch: 'E', pos: 7 },
    ]);
  });
});
