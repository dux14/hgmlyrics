import { describe, it, expect } from 'vitest';
import { insertInlineChords, emitDraftText } from '../../scripts/acordes/lib/draft.mjs';
import { parseImportText } from '../../src/lib/importParse.js';

describe('insertInlineChords', () => {
  it('inserta acordes inlineables y reporta los que no', () => {
    const { line, skipped } = insertInlineChords('Sal de ti', [
      { pos: 0, ch: 'Am' },
      { pos: 7, ch: 'Dm7b5' }, // no inlineable
    ]);
    expect(line).toBe('[Am]Sal de Dm7b5?'.replace('Dm7b5?', 'ti')); // 'Am' insertado, Dm7b5 omitido
    expect(line).toBe('[Am]Sal de ti');
    expect(skipped).toEqual([{ pos: 7, ch: 'Dm7b5' }]);
  });
});

describe('emitDraftText round-trip', () => {
  it('el borrador re-importado reproduce texto + acordes inlineables', () => {
    const song = {
      sections: [
        {
          type: 'chorus',
          lines: [
            {
              text: 'Sal de ti',
              chords: [
                { pos: 0, ch: 'Am' },
                { pos: 7, ch: 'E' },
              ],
            },
          ],
        },
        { type: 'verse', lines: [{ text: 'segundo verso', chords: [] }] },
      ],
    };
    const { text } = emitDraftText(song);
    const blocks = parseImportText(text);
    expect(blocks[0].type).toBe('chorus');
    expect(blocks[0].lines[0].text).toBe('Sal de ti');
    expect(blocks[0].lines[0].chords).toEqual([
      { ch: 'Am', pos: 0 },
      { ch: 'E', pos: 7 },
    ]);
    expect(blocks[1].type).toBe('verse');
    expect(blocks[1].lines[0].text).toBe('segundo verso');
  });
});
