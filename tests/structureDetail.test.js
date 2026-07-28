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

  it('pinta un segmento por rango con label y m:ss', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 75000 }]));

    const row = detail.el.querySelector('.struct-row');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Verso');
    expect(row.textContent).toContain('0:00');
    expect(row.textContent).toContain('1:15');
  });

  it('usa el token neutro directo (--color-section-neutral) para labels sin identidad propia (ej. instrumental)', () => {
    const detail = createStructureDetail({ songId: SONG_ID });
    detail.update(buildRun([{ label: 'instrumental', startMs: 0, endMs: 1000 }]));

    const row = detail.el.querySelector('.struct-row');
    expect(row.getAttribute('style')).toContain('--color-section-neutral');
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
      'intro',
      'verso',
      'coro',
      'puente',
      'instrumental',
      'outro',
      'silencio',
      'pre-coro',
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
    expect(detail.el.querySelector('.struct-row')).toBeTruthy();
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

    // El guard `destroyed` debe cortar el render: un update() tardío (ej.
    // una promesa de refresh en vuelo tras el teardown) no debe repintar el
    // nodo ya vaciado.
    detail.update(buildRun([{ label: 'coro', startMs: 0, endMs: 1000 }]));
    expect(detail.el.innerHTML).toBe('');
  });
});

describe('A1: ribbon + filas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdminMock = vi.fn(() => false);
    patchStructure.mockResolvedValue({ segments: [] });
  });

  it('no-admin: ve ribbon sin texto y filas con label + rango', () => {
    const detail = createStructureDetail({ songId: SONG_ID, onChanged: () => {} });
    detail.update(
      buildRun([
        { label: 'verso', startMs: 0, endMs: 30000 },
        { label: 'coro', startMs: 30000, endMs: 60000 },
      ]),
    );

    const bars = detail.el.querySelectorAll('.structure-detail__ribbon .struct-bar');
    expect(bars.length).toBe(2);
    bars.forEach((b) => expect(b.textContent.trim()).toBe(''));

    const rows = detail.el.querySelectorAll('.struct-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.struct-row__label').textContent).toMatch(/verso/i);
    expect(rows[0].querySelector('.struct-row__range').textContent).toBe('0:00–0:30');
    expect(detail.el.querySelector('.struct-edit__label')).toBeNull();
    expect(detail.el.querySelector('[data-nudge]')).toBeNull();
  });

  it('admin: cada fila trae select de tipo y nudge ±1s (contrato de delegación intacto)', () => {
    isAdminMock = vi.fn(() => true);
    const detail = createStructureDetail({ songId: SONG_ID, onChanged: () => {} });
    detail.update(buildRun([{ label: 'verso', startMs: 0, endMs: 30000 }]));

    const row = detail.el.querySelector('.struct-row');
    expect(row.dataset.segIndex).toBe('0');
    expect(row.querySelector('.struct-edit__label')).not.toBeNull();
    expect(row.querySelectorAll('[data-nudge]').length).toBe(4);
  });
});
