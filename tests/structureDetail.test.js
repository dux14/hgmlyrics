// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

let isAdminMock = vi.fn(() => false);
vi.mock('../src/lib/authStore.js', () => ({
  isAdmin: (...args) => isAdminMock(...args),
}));

const patchStructure = vi.fn();
vi.mock('../src/lib/pipelineApi.js', () => ({
  patchStructure: (...args) => patchStructure(...args),
}));

const showToast = vi.fn();
vi.mock('../src/lib/toast.js', () => ({ showToast: (...args) => showToast(...args) }));

import { createStructureDetail } from '../src/components/pipeline/StructureDetail.js';

const SONG_ID = 'song-1';

function buildRun(segments) {
  return { structure: segments ? { segments } : null };
}

describe('StructureDetail (Task 16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminMock = vi.fn(() => false);
    patchStructure.mockResolvedValue({ segments: [] });
  });

  it('sin segmentos: muestra un estado vacío claro', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun(null));
    expect(detail.el.textContent).toContain('Aún no hay secciones detectadas');
  });

  it('pinta un segmento por rango con label y mm:ss', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 75000 }]));

    const seg = detail.el.querySelector('.struct-seg');
    expect(seg).toBeTruthy();
    expect(seg.textContent).toContain('Verso');
    expect(seg.textContent).toContain('00:00');
    expect(seg.textContent).toContain('01:15');
  });

  it('usa el color de --color-section-verse para labels sin identidad propia (ej. instrumental)', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'instrumental', startMs: 0, endMs: 1000 }]));

    const seg = detail.el.querySelector('.struct-seg');
    expect(seg.getAttribute('style')).toContain('--color-section-verse');
  });

  it('sin admin: no muestra editor (select ni botones de nudge)', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));

    expect(detail.el.querySelector('.struct-edit__label')).toBeFalsy();
    expect(detail.el.querySelector('[data-nudge]')).toBeFalsy();
  });

  it('admin: muestra select con las 8 etiquetas de SongFormer y cambiarlo llama al PATCH', async () => {
    isAdminMock = vi.fn(() => true);
    patchStructure.mockResolvedValue({
      segments: [{ label: 'coro', startMs: 0, endMs: 1000 }],
    });
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));

    const select = detail.el.querySelector('.struct-edit__label');
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual([
      'intro', 'verso', 'coro', 'puente', 'instrumental', 'outro', 'silencio', 'pre-coro',
    ]);

    select.value = 'coro';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(patchStructure).toHaveBeenCalledWith(SONG_ID, { segmentIndex: 0, label: 'coro' });
  });

  it('admin: nudge de borde +1s llama al PATCH con el endMs ajustado', async () => {
    isAdminMock = vi.fn(() => true);
    patchStructure.mockResolvedValue({
      segments: [{ label: 'verso', startMs: 0, endMs: 2000 }],
    });
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));

    const btn = detail.el.querySelector('[data-nudge="end:inc"]');
    expect(btn).toBeTruthy();
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(patchStructure).toHaveBeenCalledWith(SONG_ID, { segmentIndex: 0, endMs: 2000 });
  });

  it('PATCH con error: muestra toast y no rompe (segmentos previos siguen pintados)', async () => {
    isAdminMock = vi.fn(() => true);
    patchStructure.mockRejectedValue(new Error('no se pudo'));
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));

    const btn = detail.el.querySelector('[data-nudge="end:inc"]');
    btn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(showToast).toHaveBeenCalled();
    expect(detail.el.querySelector('.struct-seg')).toBeTruthy();
  });

  it('onChanged: se invoca tras un PATCH exitoso', async () => {
    isAdminMock = vi.fn(() => true);
    patchStructure.mockResolvedValue({ segments: [{ label: 'coro', startMs: 0, endMs: 1000 }] });
    const onChanged = vi.fn();
    const detail = createStructureDetail({ songId: SONG_ID, onChanged });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));

    detail.el.querySelector('[data-nudge="end:inc"]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onChanged).toHaveBeenCalled();
  });

  it('destroy(): vacía el nodo y no rompe si update se llama después', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 1000 }]));
    detail.destroy();
    expect(detail.el.innerHTML).toBe('');
  });
});
