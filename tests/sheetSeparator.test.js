import { describe, it, expect, vi } from 'vitest';
import { SheetSeparator } from '../src/components/pipeline/lyrics/SheetSeparator.js';

function mkHandlers(overrides = {}) {
  return {
    runAction: vi.fn(async () => {}),
    persistText: vi.fn(async () => {}),
    isBusy: () => false,
    ...overrides,
  };
}

describe('SheetSeparator', () => {
  it('el + manda insertLine con at = afterLine + 1', () => {
    const handlers = mkHandlers();
    const node = SheetSeparator({ sIdx: 2, afterLine: 3, handlers });
    node.querySelector('.sheet-separator__add').click();

    expect(handlers.runAction).toHaveBeenCalledWith(
      { type: 'insertLine', section: 2, at: 4 },
      { rowEl: node },
    );
  });

  it('el rótulo de corte manda splitSection con afterLine', () => {
    const handlers = mkHandlers();
    const node = SheetSeparator({ sIdx: 1, afterLine: 0, handlers });
    node.querySelector('.sheet-separator__split').click();

    expect(handlers.runAction).toHaveBeenCalledWith(
      { type: 'splitSection', section: 1, afterLine: 0 },
      { rowEl: node },
    );
  });

  it('con isBusy() en true ambos controles quedan inertes', () => {
    const handlers = mkHandlers({ isBusy: () => true });
    const node = SheetSeparator({ sIdx: 0, afterLine: 0, handlers });
    node.querySelector('.sheet-separator__add').click();
    node.querySelector('.sheet-separator__split').click();

    expect(handlers.runAction).not.toHaveBeenCalled();
    expect(node.querySelector('.sheet-separator__add').disabled).toBe(true);
    expect(node.querySelector('.sheet-separator__split').disabled).toBe(true);
  });
});
