import { describe, it, expect } from 'vitest';
import { parseLineChords, parseImportText } from '../src/lib/importParse.js';

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
});

describe('parseImportText', () => {
  it('detecta secciones y líneas con acordes', () => {
    const blocks = parseImportText('[Coro]\n[Am]Hola');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('chorus');
    expect(blocks[0].lines[0].text).toBe('Hola');
    expect(blocks[0].lines[0].chords).toEqual([{ ch: 'Am', pos: 0 }]);
  });
});
