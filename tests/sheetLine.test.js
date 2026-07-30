import { describe, it, expect } from 'vitest';
import { SheetLine } from '../src/components/pipeline/lyrics/SheetLine.js';

const handlers = {
  runAction: async () => {},
  persistText: async () => {},
  isBusy: () => false,
};

/** Completa el resto del contrato con valores neutros. */
function mk(text, extra = {}) {
  return {
    line: { text, confidence: null, words: [], vocalization: false, ...extra },
    sIdx: 0,
    lIdx: 0,
    afterWords: [],
    suggestion: null,
    isDudoso: false,
    canMoveUp: true,
    canMoveDown: true,
    handlers,
  };
}

describe('SheetLine — reposo', () => {
  it('pinta el texto y lo escapa', () => {
    const node = SheetLine(mk('a <b> c'));
    const textEl = node.querySelector('.sheet-line__text');
    expect(textEl.textContent).toBe('a <b> c');
    expect(textEl.querySelector('b')).toBeNull();
  });

  it('texto vacío: clase --empty, «Sin texto» y conf--none', () => {
    const node = SheetLine(mk(''));
    expect(node.classList.contains('sheet-line--empty')).toBe(true);
    expect(node.querySelector('.sheet-line__text').textContent).toBe('Sin texto');
    const conf = node.querySelector('.sheet-line__conf');
    expect(conf).not.toBeNull();
    expect(conf.classList.contains('sheet-line__conf--none')).toBe(true);
  });

  it('vocalización: clase --vocalization y ninguna .sheet-line__conf', () => {
    const node = SheetLine(mk('la la la', { vocalization: true }));
    expect(node.classList.contains('sheet-line--vocalization')).toBe(true);
    expect(node.querySelector('.sheet-line__conf')).toBeNull();
  });

  it('update({ line }) cambia el texto pintado sin recrear el nodo', () => {
    const opts = mk('texto original');
    const node = SheetLine(opts);
    node.update({ line: { ...opts.line, text: 'texto nuevo' } });
    expect(node.querySelector('.sheet-line__text').textContent).toBe('texto nuevo');
  });

  it('con confidence: 0.42 no pinta el porcentaje en ninguna parte', () => {
    const node = SheetLine(mk('texto', { confidence: 0.42, words: [{ text: 'texto' }] }));
    expect(node.textContent).not.toContain('42');
  });
});
