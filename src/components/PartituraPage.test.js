import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/pitchApi.js', () => ({
  listJobs: vi.fn(),
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  readAudioDuration: vi.fn(),
  estimateJob: vi.fn(),
  approveJob: vi.fn(),
  cancelJob: vi.fn(),
  getJob: vi.fn(),
}));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));

import { renderPartituraPage } from './PartituraPage.js';
import * as pitchApi from '../lib/pitchApi.js';

async function selectFile(container, name = 'a.mp3', type = 'audio/mpeg') {
  const input = container.querySelector('input[type="file"]');
  const file = new File(['audio'], name, { type });
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  // handleFile encadena varios await (createJob → uploadInput → readAudioDuration →
  // estimateJob): flush de microtasks hasta que se asiente el repintado.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PartituraPage — estado idle', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    pitchApi.listJobs.mockReset();
    pitchApi.listJobs.mockResolvedValue({ jobs: [], quota: { used: 0, limit: 2 } });
    pitchApi.createJob.mockReset();
    pitchApi.uploadInput.mockReset();
    pitchApi.readAudioDuration.mockReset();
    pitchApi.estimateJob.mockReset();
    pitchApi.approveJob.mockReset();
    pitchApi.cancelJob.mockReset();
  });

  it('llama listJobs y pinta el input de archivo + 2 perfiles', async () => {
    await renderPartituraPage(container);
    expect(pitchApi.listJobs).toHaveBeenCalled();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-profile]').length).toBe(2);
  });

  it('archivo .txt en change muestra error de formato no soportado', async () => {
    await renderPartituraPage(container);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['hola'], 'notas.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(container.textContent).toMatch(/no soportado|formato/i);
  });
});

describe('PartituraPage — subida y cost gate', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    pitchApi.listJobs.mockReset();
    pitchApi.listJobs.mockResolvedValue({ jobs: [], quota: { used: 0, limit: 2 } });
    pitchApi.createJob.mockReset();
    pitchApi.uploadInput.mockReset();
    pitchApi.readAudioDuration.mockReset();
    pitchApi.estimateJob.mockReset();
    pitchApi.approveJob.mockReset();
    pitchApi.cancelJob.mockReset();
    pitchApi.getJob.mockReset();
  });

  it('sube el audio, estima el costo con la duracion leida y pinta el cost gate', async () => {
    pitchApi.createJob.mockResolvedValue({ job: { id: 'j1' }, upload: { path: 'p', token: 't' } });
    pitchApi.uploadInput.mockResolvedValue(undefined);
    pitchApi.readAudioDuration.mockResolvedValue(180);
    pitchApi.estimateJob.mockResolvedValue({ estimate: { lo: 0, hi: 0.15, breakdown: [] } });

    await renderPartituraPage(container);
    await selectFile(container);

    expect(pitchApi.estimateJob).toHaveBeenCalledWith('j1', 180);
    expect(container.querySelector('[data-action=approve]')).toBeTruthy();
    expect(container.textContent).toMatch(/0[.,]15/);
  });

  it('createJob 403 muestra mensaje de beta cerrada', async () => {
    const err = new Error('Forbidden');
    err.status = 403;
    pitchApi.createJob.mockRejectedValue(err);

    await renderPartituraPage(container);
    await selectFile(container);

    expect(container.textContent).toMatch(/beta/i);
  });

  it('createJob 429 muestra mensaje de limite de jobs', async () => {
    const err = new Error('Too Many Requests');
    err.status = 429;
    pitchApi.createJob.mockRejectedValue(err);

    await renderPartituraPage(container);
    await selectFile(container);

    expect(container.textContent).toMatch(/l[íi]mite|cuota/i);
  });
});

describe('PartituraPage — poll de progreso', () => {
  let container;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    pitchApi.listJobs.mockReset();
    pitchApi.listJobs.mockResolvedValue({ jobs: [], quota: { used: 0, limit: 2 } });
    pitchApi.createJob.mockReset();
    pitchApi.uploadInput.mockReset();
    pitchApi.readAudioDuration.mockReset();
    pitchApi.estimateJob.mockReset();
    pitchApi.approveJob.mockReset();
    pitchApi.cancelJob.mockReset();
    pitchApi.getJob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hace poll con setInterval hasta status terminal y pinta el resultado', async () => {
    pitchApi.createJob.mockResolvedValue({ job: { id: 'j1' }, upload: { path: 'p', token: 't' } });
    pitchApi.uploadInput.mockResolvedValue(undefined);
    pitchApi.readAudioDuration.mockResolvedValue(180);
    pitchApi.estimateJob.mockResolvedValue({ estimate: { lo: 0, hi: 0.15, breakdown: [] } });
    pitchApi.approveJob.mockResolvedValue(undefined);

    const donePhases = {
      separation: { status: 'done' },
      f0: { status: 'done' },
      notes: { status: 'done' },
      lyrics: { status: 'done' },
      fusion: { status: 'done' },
      render: { status: 'done' },
    };
    pitchApi.getJob
      .mockResolvedValueOnce({
        status: 'running',
        phases: { separation: { status: 'done' } },
        artifacts: [],
      })
      .mockResolvedValueOnce({
        status: 'succeeded',
        phases: donePhases,
        artifacts: [{ kind: 'analysis', url: 'https://x/analysis.json' }],
      });

    await renderPartituraPage(container);

    const input = container.querySelector('input[type="file"]');
    const file = new File(['audio'], 'a.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    container.querySelector('[data-action="approve"]').dispatchEvent(new Event('click'));
    // El tick() inmediato de startPolling resuelve por microtasks (no requiere
    // avanzar el reloj): un advance de 0ms drena esa cadena y deja ver el 1er getJob.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(container.textContent).toMatch(/1\s*\/\s*6|17%/);

    await vi.advanceTimersByTimeAsync(3000);

    await vi.advanceTimersByTimeAsync(3000);
    expect(container.textContent).toMatch(/descargar|lead|analysis/i);
  });
});
