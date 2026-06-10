import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/stemsApi.js', () => ({
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  startJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  readAudioDuration: vi.fn().mockResolvedValue(180),
}));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => ({ access_token: 'tok' }),
}));

const stemsApi = await import('../src/lib/stemsApi.js');
const { renderStudioPage } = await import('../src/components/StudioPage.js');

describe('renderStudioPage', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    vi.clearAllMocks();
  });

  it('estado idle: dropzone + límites + cuota', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 1, limit: 3 } });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());
    expect(container.textContent).toContain('Estudio');
    expect(container.querySelector('.badge--beta')).not.toBeNull();
    expect(container.textContent).toContain('25 MB');
    expect(container.textContent).toContain('2 de 3'); // cuota restante hoy
  });

  it('retoma un job en proceso al entrar', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'separating_stems' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: { id: 'j1', status: 'separating_stems' } });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('Separando pistas'));
    expect(container.querySelector('[aria-live]')).not.toBeNull();
  });

  it('job done: muestra pistas, voces y expiración', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'done' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: {
        id: 'j1',
        status: 'done',
        expires_at: new Date(Date.now() + 47 * 3600e3).toISOString(),
        stems: { vocals: 'https://s/v', drums: 'https://s/d' },
        voices: {
          lead: 'https://s/lead',
          backing: 'https://s/back',
          segments: [{ voice: 'Voz 1', start: 42, end: 70 }],
        },
      },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('Pistas'));
    expect(container.querySelectorAll('audio').length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain('Voz 1');
    expect(container.textContent).toContain('0:42');
    expect(container.textContent.toLowerCase()).toContain('disponible por');
  });

  it('job failed: mensaje y reintentar', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'failed', error: 'El procesamiento falló.' }],
      quota: { used: 0, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: { id: 'j1', status: 'failed', error: 'El procesamiento falló.' },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.textContent).toContain('falló'));
    expect(container.querySelector('#studio-retry')).not.toBeNull();
  });
});
