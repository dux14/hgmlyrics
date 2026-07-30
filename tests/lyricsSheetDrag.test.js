import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SheetDrag } from '../src/components/pipeline/lyrics/SheetDrag.js';

// jsdom no implementa PointerEvent: se emula con MouseEvent + pointerId.
function pointer(type, { clientY = 0, target } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  (target ?? document).dispatchEvent(ev);
  return ev;
}

function sheet() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="sheet-section">
      <div class="sheet-section__body">
        <div class="sheet-line"><button class="sheet-line__grip"></button></div>
        <div class="sheet-line"><button class="sheet-line__grip"></button></div>
      </div>
    </div>`;
  document.body.appendChild(root);
  // jsdom no hace layout: setPointerCapture no existe en los elementos.
  root.querySelectorAll('.sheet-line__grip').forEach((g) => {
    g.setPointerCapture = () => {};
    g.releasePointerCapture = () => {};
  });
  return root;
}

const RECTS = [
  {
    sIdx: 0,
    isBand: false,
    top: 0,
    bottom: 80,
    lines: [
      { lIdx: 0, mid: 20 },
      { lIdx: 1, mid: 60 },
    ],
  },
];

describe('SheetDrag', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('el drop en otro hueco despacha el payload convertido', () => {
    const root = sheet();
    const moveLine = vi.fn().mockResolvedValue(undefined);
    SheetDrag({
      root,
      handlers: { isBusy: () => false, moveLine },
      measure: () => RECTS,
      scroller: root,
    });

    const grip = root.querySelectorAll('.sheet-line__grip')[0];
    pointer('pointerdown', { clientY: 20, target: grip });
    pointer('pointermove', { clientY: 75, target: grip });
    pointer('pointerup', { clientY: 75, target: grip });

    expect(moveLine).toHaveBeenCalledWith({
      type: 'moveLine',
      fromSection: 0,
      fromLine: 0,
      toSection: 0,
      toLine: 1,
    });
  });

  it('soltar en el mismo lugar no despacha nada', () => {
    const root = sheet();
    const moveLine = vi.fn();
    SheetDrag({
      root,
      handlers: { isBusy: () => false, moveLine },
      measure: () => RECTS,
      scroller: root,
    });

    const grip = root.querySelectorAll('.sheet-line__grip')[0];
    pointer('pointerdown', { clientY: 20, target: grip });
    pointer('pointermove', { clientY: 15, target: grip });
    pointer('pointerup', { clientY: 15, target: grip });

    expect(moveLine).not.toHaveBeenCalled();
  });

  it('Escape cancela sin despachar y limpia el clon', () => {
    const root = sheet();
    const moveLine = vi.fn();
    SheetDrag({
      root,
      handlers: { isBusy: () => false, moveLine },
      measure: () => RECTS,
      scroller: root,
    });

    const grip = root.querySelectorAll('.sheet-line__grip')[0];
    pointer('pointerdown', { clientY: 20, target: grip });
    pointer('pointermove', { clientY: 75, target: grip });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(moveLine).not.toHaveBeenCalled();
    expect(document.querySelector('.sheet-line--ghost')).toBeNull();
    expect(root.querySelector('.sheet-line--dragging')).toBeNull();
  });

  it('pointercancel cancela sin despachar', () => {
    const root = sheet();
    const moveLine = vi.fn();
    SheetDrag({
      root,
      handlers: { isBusy: () => false, moveLine },
      measure: () => RECTS,
      scroller: root,
    });

    const grip = root.querySelectorAll('.sheet-line__grip')[0];
    pointer('pointerdown', { clientY: 20, target: grip });
    pointer('pointermove', { clientY: 75, target: grip });
    pointer('pointercancel', { clientY: 75, target: grip });

    expect(moveLine).not.toHaveBeenCalled();
  });

  it('con la hoja ocupada el gesto no arranca', () => {
    const root = sheet();
    const moveLine = vi.fn();
    SheetDrag({
      root,
      handlers: { isBusy: () => true, moveLine },
      measure: () => RECTS,
      scroller: root,
    });

    const grip = root.querySelectorAll('.sheet-line__grip')[0];
    pointer('pointerdown', { clientY: 20, target: grip });
    pointer('pointermove', { clientY: 75, target: grip });
    pointer('pointerup', { clientY: 75, target: grip });

    expect(moveLine).not.toHaveBeenCalled();
    expect(root.querySelector('.sheet-line--dragging')).toBeNull();
  });
});
