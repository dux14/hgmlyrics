import { describe, it, expect, vi } from 'vitest';
import { SheetSection } from '../src/components/pipeline/lyrics/SheetSection.js';

function mkHandlers(overrides = {}) {
  return {
    runAction: vi.fn(async () => {}),
    persistText: vi.fn(async () => {}),
    isBusy: () => false,
    ...overrides,
  };
}

function mkSection(extra = {}) {
  return {
    type: 'verse',
    label: null,
    startMs: 0,
    endMs: 1000,
    lines: [
      { text: 'primer renglón', confidence: 0.9, words: [{ text: 'primer' }], vocalization: false },
      {
        text: 'segundo renglón',
        confidence: 0.9,
        words: [{ text: 'segundo' }],
        vocalization: false,
      },
    ],
    ...extra,
  };
}

function mk(opts = {}) {
  return {
    section: mkSection(),
    sIdx: 0,
    isLast: false,
    byLine: new Map(),
    textByLine: new Map(),
    dudosoThreshold: 0.5,
    handlers: mkHandlers(),
    ...opts,
  };
}

describe('SheetSection — encabezado', () => {
  it('el chip lista los 7 tipos y marca el actual', () => {
    const node = SheetSection(mk({ section: mkSection({ type: 'chorus' }) }));
    const select = node.querySelector('.sheet-section__type');
    expect(select).not.toBeNull();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options).toHaveLength(7);
    expect(select.value).toBe('chorus');
  });

  it('cambiar el chip manda setSectionType', () => {
    const hs = mkHandlers();
    const node = SheetSection(mk({ handlers: hs, sIdx: 2 }));
    const select = node.querySelector('.sheet-section__type');
    select.value = 'bridge';
    select.dispatchEvent(new Event('change'));

    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'setSectionType', section: 2, sectionType: 'bridge' },
      expect.anything(),
    );
  });

  it('el nombre manda renameSection y null cuando queda vacío', () => {
    const hs = mkHandlers();
    const node = SheetSection(
      mk({ handlers: hs, sIdx: 1, section: mkSection({ label: 'Puente 1' }) }),
    );
    const nameInput = node.querySelector('.sheet-section__name');
    expect(nameInput.value).toBe('Puente 1');

    nameInput.value = 'Nuevo nombre';
    nameInput.dispatchEvent(new Event('blur'));
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'renameSection', section: 1, label: 'Nuevo nombre' },
      expect.anything(),
    );

    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('blur'));
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'renameSection', section: 1, label: null },
      expect.anything(),
    );
  });

  it('el menú manda duplicateSection, mergeSections y deleteSection', () => {
    const hs = mkHandlers();
    const node = SheetSection(mk({ handlers: hs, sIdx: 3, isLast: false }));

    node.querySelector('[data-action="duplicate"]').click();
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'duplicateSection', section: 3 },
      expect.anything(),
    );

    node.querySelector('[data-action="merge"]').click();
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'mergeSections', section: 3 },
      expect.anything(),
    );

    node.querySelector('[data-action="delete"]').click();
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'deleteSection', section: 3 },
      expect.anything(),
    );
  });

  it('la última sección no ofrece unir con la siguiente', () => {
    const node = SheetSection(mk({ isLast: true }));
    expect(node.querySelector('[data-action="merge"]')).toBeNull();
  });
});

describe('SheetSection — cuerpo', () => {
  it('una sección vacía pinta encabezado completo y ofrece insertar el primer renglón', () => {
    const hs = mkHandlers();
    const node = SheetSection(mk({ handlers: hs, section: mkSection({ lines: [] }) }));

    expect(node.querySelector('.sheet-section__type')).not.toBeNull();
    expect(node.querySelectorAll('.sheet-line')).toHaveLength(0);
    const insertBtn = node.querySelector('.sheet-section__insert-first');
    expect(insertBtn).not.toBeNull();

    insertBtn.click();
    expect(hs.runAction).toHaveBeenCalledWith(
      { type: 'insertLine', section: 0, at: 0 },
      expect.anything(),
    );
  });

  it('update con una sección de más renglones agrega nodos sin recrear los que no cambiaron', () => {
    const node = SheetSection(mk());
    const firstLineBefore = node.querySelectorAll('.sheet-line')[0];

    const grown = mkSection({
      lines: [
        ...mkSection().lines,
        {
          text: 'tercer renglón',
          confidence: 0.9,
          words: [{ text: 'tercer' }],
          vocalization: false,
        },
      ],
    });
    node.update({
      section: grown,
      sIdx: 0,
      isLast: false,
      byLine: new Map(),
      textByLine: new Map(),
    });

    const linesAfter = node.querySelectorAll('.sheet-line');
    expect(linesAfter).toHaveLength(3);
    expect(linesAfter[0]).toBe(firstLineBefore);
    expect(linesAfter[2].querySelector('.sheet-line__text').textContent).toBe('tercer renglón');
  });

  it('focusLine(1) abre en edición el segundo renglón', () => {
    const node = SheetSection(mk());
    node.focusLine(1);

    const lines = node.querySelectorAll('.sheet-line');
    expect(lines[1].querySelector('.sheet-line__edit-input')).not.toBeNull();
    expect(lines[0].querySelector('.sheet-line__edit-input')).toBeNull();
  });
});
