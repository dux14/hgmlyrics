import { describe, it, expect, vi } from 'vitest';
import { SheetLine } from '../src/components/pipeline/lyrics/SheetLine.js';

function mkHandlers(overrides = {}) {
  return {
    runAction: vi.fn(async () => {}),
    persistText: vi.fn(async () => {}),
    isBusy: () => false,
    ...overrides,
  };
}

const handlers = mkHandlers();

/** Completa el resto del contrato con valores neutros. */
function mk(text, extra = {}, rowOverrides = {}) {
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
    ...rowOverrides,
  };
}

/** Caret en jsdom: setear la posición y despachar `keyup` — el listener de
 * SheetLine escucha keyup/click/select para refrescar el rótulo de Unir. */
function setCaret(textarea, pos) {
  textarea.selectionStart = pos;
  textarea.selectionEnd = pos;
  textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
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

describe('SheetLine — edición', () => {
  it('abrir con click pinta textarea y barra de acciones', () => {
    const node = SheetLine(mk('un renglón'));
    node.querySelector('.sheet-line__text').click();

    const textarea = node.querySelector('.sheet-line__edit-input');
    expect(textarea).not.toBeNull();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('un renglón');
    expect(node.querySelector('.sheet-line__toolbar')).not.toBeNull();
  });

  it('el blur llama persistText con el texto nuevo', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'texto editado';
    textarea.dispatchEvent(new Event('blur'));
    await Promise.resolve();

    expect(hs.persistText).toHaveBeenCalledWith(0, 0, 'texto editado');
  });

  it("el blur con texto vacío también llama persistText con ''", async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = '';
    textarea.dispatchEvent(new Event('blur'));
    await Promise.resolve();

    expect(hs.persistText).toHaveBeenCalledWith(0, 0, '');
  });

  it('Escape descarta lo escrito y cierra sin persistir', () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'texto descartado';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(hs.persistText).not.toHaveBeenCalled();
    expect(node.querySelector('.sheet-line__edit-input')).toBeNull();
    expect(node.querySelector('.sheet-line__text').textContent).toBe('texto viejo');
  });

  it('Cmd/Ctrl+Enter guarda y cierra', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'texto guardado';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();

    expect(hs.persistText).toHaveBeenCalledWith(0, 0, 'texto guardado');
    expect(node.querySelector('.sheet-line__edit-input')).toBeNull();
  });

  it('el rótulo de Unir cambia según selectionStart', () => {
    const node = SheetLine(mk('una linea larga'));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    const mergeBtn = node.querySelector('[data-action="merge"]');

    setCaret(textarea, 0);
    expect(mergeBtn.textContent).toBe('Unir arriba');

    setCaret(textarea, 5);
    expect(mergeBtn.textContent).toBe('Unir abajo');
  });

  it('Backspace en 0 manda mergeLines con el de arriba', () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('segundo renglón', {}, { lIdx: 1, handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    setCaret(textarea, 0);
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );

    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'mergeLines', section: 0, line: 0 },
      { rowEl: node },
    );
  });

  it('Enter manda la acción de partir con el caret', () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('primera segunda', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    setCaret(textarea, 8);
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'setLineText', section: 0, line: 0, text: 'primera \nsegunda' },
      { rowEl: node },
    );
  });

  it('con isBusy() en true el click no abre nada', () => {
    const hs = mkHandlers({ isBusy: () => true });
    const node = SheetLine(mk('un renglón', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();

    expect(node.querySelector('.sheet-line__edit-input')).toBeNull();
  });

  it('las tijeras de corte sugerido solo existen en edición; tocarlas mueve el caret sin disparar acción', () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('una linea larga', {}, { afterWords: [1], handlers: hs }));
    expect(node.querySelector('.sheet-line__scissor')).toBeNull();

    node.querySelector('.sheet-line__text').click();
    const scissor = node.querySelector('.sheet-line__scissor');
    expect(scissor).not.toBeNull();

    const textarea = node.querySelector('.sheet-line__edit-input');
    scissor.click();

    expect(textarea.selectionStart).toBe('una'.length + 1 + 'linea'.length);
    expect(hs.runAction).not.toHaveBeenCalled();
  });
});
