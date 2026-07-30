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

  it('vocalización: pinta la marca de micrófono', () => {
    const voc = SheetLine(mk('la la la', { vocalization: true }));
    expect(voc.querySelector('.sheet-line__mic')).not.toBeNull();

    const noVoc = SheetLine(mk('un renglón normal'));
    expect(noVoc.querySelector('.sheet-line__mic')).toBeNull();
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
    await vi.waitFor(() => expect(node.querySelector('.sheet-line__edit-input')).toBeNull());
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

  it('Backspace en 0 manda mergeLines con el de arriba', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('segundo renglón', {}, { lIdx: 1, handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    setCaret(textarea, 0);
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(hs.runAction).toHaveBeenCalledWith(
        { type: 'mergeLines', section: 0, line: 0 },
        { rowEl: node },
      ),
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

  it('blur seguido de una acción de estructura no compite: persistText corre antes que runAction', async () => {
    const calls = [];
    const hs = mkHandlers({
      persistText: vi.fn(async () => {
        calls.push('persistText');
      }),
      runAction: vi.fn(async () => {
        calls.push('runAction');
      }),
    });
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'texto sucio sin guardar';

    // En un navegador real el blur del textarea llega antes que el click del
    // botón de la barra (el foco se mueve primero). Se reproduce el mismo
    // orden acá: el blur no debe dejar la persistencia como no-op.
    textarea.dispatchEvent(new Event('blur'));
    node.querySelector('[data-action="delete"]').click();

    await vi.waitFor(() => expect(hs.runAction).toHaveBeenCalled());
    expect(calls).toEqual(['persistText', 'runAction']);
  });

  it('el botón Unir manda un índice válido: con canMoveUp=false y caret en 0 queda deshabilitado', () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('primer renglón', {}, { canMoveUp: false, handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    setCaret(textarea, 0);

    const mergeBtn = node.querySelector('[data-action="merge"]');
    expect(mergeBtn.disabled).toBe(true);

    mergeBtn.click();
    expect(hs.runAction).not.toHaveBeenCalled();
  });

  it('el botón Unir manda un índice válido: con canMoveUp=true y caret en 0 manda mergeLines con line: lIdx - 1', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('segundo renglón', {}, { lIdx: 1, canMoveUp: true, handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    setCaret(textarea, 0);

    const mergeBtn = node.querySelector('[data-action="merge"]');
    expect(mergeBtn.disabled).toBe(false);
    mergeBtn.click();

    await vi.waitFor(() =>
      expect(hs.runAction).toHaveBeenCalledWith(
        { type: 'mergeLines', section: 0, line: 0 },
        { rowEl: node },
      ),
    );
  });

  it('flushText() sigue rechazable/observable: si handlers.persistText rechaza no queda una promesa flotante sin capturar', async () => {
    const hs = mkHandlers({ persistText: vi.fn(async () => Promise.reject(new Error('boom'))) });
    const node = SheetLine(mk('texto viejo', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'texto nuevo';
    textarea.dispatchEvent(new Event('blur'));

    // Si esto no está bien manejado, vitest/node reporta un
    // unhandledRejection y el test process falla igual sin necesidad de
    // asserts adicionales — llegar hasta acá sin throw ya es la prueba.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hs.persistText).toHaveBeenCalled();
  });

  it('la barra de acciones ofrece Escuchar y salta a ese renglón', () => {
    const hs = mkHandlers({ listenFrom: vi.fn() });
    const node = SheetLine(mk('ahí', {}, { sIdx: 1, lIdx: 2, handlers: hs }));
    node.openEdit({});
    node.querySelector('[data-action="listen"]').click();
    expect(hs.listenFrom).toHaveBeenCalledWith(1, 2);
  });

  it('Escuchar no cierra la edición: se corrige mientras suena', () => {
    const hs = mkHandlers({ listenFrom: vi.fn() });
    const node = SheetLine(mk('ahí', {}, { handlers: hs }));
    node.openEdit({});
    node.querySelector('[data-action="listen"]').click();
    expect(node.querySelector('textarea')).not.toBeNull();
  });

  it('el renglón de tiempo estimado marca su barra de confianza', () => {
    const node = SheetLine(mk('a', {}, { interpolated: true }));
    expect(node.querySelector('.sheet-line__conf').className).toContain(
      'sheet-line__conf--estimated',
    );
  });

  it('setActive conmuta el resaltado sin volver a renderizar el renglón', () => {
    const node = SheetLine(mk('a'));
    const textNode = node.querySelector('.sheet-line__text');
    node.setActive(true);
    expect(node.classList.contains('is-sounding')).toBe(true);
    expect(node.querySelector('.sheet-line__text')).toBe(textNode);
    node.setActive(false);
    expect(node.classList.contains('is-sounding')).toBe(false);
  });

  // Auditoría de cobertura tests/lyricsReviewPanel.test.js (Task 5): casos
  // (f) y (h) del panel viejo no tenían equivalente unitario tras la
  // reescritura a SheetLine — el botón de vocalización y el de borrar del
  // toolbar de edición ya despachaban lo correcto, pero nada lo verificaba.
  it('(f) el botón Voc. del toolbar despacha toggleVocalization', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('un renglón', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    node.querySelector('[data-action="voc"]').click();

    await vi.waitFor(() =>
      expect(hs.runAction).toHaveBeenCalledWith(
        { type: 'toggleVocalization', section: 0, line: 0 },
        { rowEl: node },
      ),
    );
  });

  it('(h) el botón Borrar despacha deleteLine directo, sin pedir confirmación', async () => {
    const hs = mkHandlers();
    const node = SheetLine(mk('un renglón', {}, { handlers: hs }));
    node.querySelector('.sheet-line__text').click();
    node.querySelector('[data-action="delete"]').click();

    await vi.waitFor(() =>
      expect(hs.runAction).toHaveBeenCalledWith(
        { type: 'deleteLine', section: 0, line: 0 },
        { rowEl: node },
      ),
    );
  });

  // Auditoría de cobertura tests/lyricsReviewPanel.test.js (Task 5): el
  // panel viejo mostraba una propuesta de texto por renglón con un botón
  // para adoptarla — el contrato de SheetLine ya recibía `suggestion` pero
  // nunca la pintaba. La hoja S3a no la elimina por diseño (el spec no la
  // menciona), sigue el patrón de las tijeras: solo en edición.
  it('la propuesta de texto solo existe en edición, no en reposo', () => {
    const node = SheetLine(
      mk('texto viejo', {}, { suggestion: { section: 0, line: 0, text: 'texto propuesto' } }),
    );
    expect(node.querySelector('.sheet-line__suggest')).toBeNull();

    node.querySelector('.sheet-line__text').click();
    expect(node.querySelector('.sheet-line__suggest')).not.toBeNull();
    expect(node.querySelector('.sheet-line__suggest-text').textContent).toBe('texto propuesto');
  });

  it('si la propuesta coincide con el texto actual no se pinta', () => {
    const node = SheetLine(
      mk('mismo texto', {}, { suggestion: { section: 0, line: 0, text: 'mismo texto' } }),
    );
    node.querySelector('.sheet-line__text').click();
    expect(node.querySelector('.sheet-line__suggest')).toBeNull();
  });

  it('aceptar la propuesta despacha editLine con el texto propuesto y descarta el borrador sin guardar', async () => {
    const hs = mkHandlers();
    const node = SheetLine(
      mk(
        'texto viejo',
        {},
        { suggestion: { section: 0, line: 0, text: 'texto propuesto' }, handlers: hs },
      ),
    );
    node.querySelector('.sheet-line__text').click();
    const textarea = node.querySelector('.sheet-line__edit-input');
    textarea.value = 'algo que el admin tipeó sin guardar';

    node.querySelector('.sheet-line__suggest-accept').click();

    await vi.waitFor(() =>
      expect(hs.runAction).toHaveBeenCalledWith(
        { type: 'editLine', section: 0, line: 0, text: 'texto propuesto' },
        { rowEl: node },
      ),
    );
    expect(hs.persistText).not.toHaveBeenCalled();
  });
});
