import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/stemsApi.js', () => ({
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  startJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  readAudioDuration: vi.fn().mockResolvedValue(180),
  watchJobRealtime: vi.fn(() => ({ leave: vi.fn() })),
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
      jobs: [{ id: 'j1', status: 'processing' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: { id: 'j1', status: 'processing' } });
    renderStudioPage(container);
    // El render de procesamiento muestra las 4 secciones del DAG
    await vi.waitFor(() => expect(container.textContent).toContain('Voz e instrumentos'));
    expect(container.textContent).toContain('Secciones');
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
    expect(container.textContent).toContain('Voz 1'); // leyenda de la timeline
    // El segmento se renderiza como bloque de la timeline; su rango va en aria-label.
    const block = container.querySelector('.studio-tl__block');
    expect(block).not.toBeNull();
    expect(block.getAttribute('aria-label')).toContain('0:42');
    expect(container.textContent.toLowerCase()).toContain('disponible por');
  });

  it('FIX-7: el polling se detiene al cambiar el hash fuera de #/estudio', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'processing' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: { id: 'j1', status: 'processing' } });

    renderStudioPage(container);
    // Esperar a que watchJob arranque (tick inicial) y setInterval esté activo
    await vi.waitFor(() => expect(stemsApi.getJob).toHaveBeenCalled());
    // Dejar que el intervalo dispare al menos una vez más
    await vi.advanceTimersByTimeAsync(5100);
    const callsAfterFirstTick = stemsApi.getJob.mock.calls.length;
    expect(callsAfterFirstTick).toBeGreaterThan(0);

    // Disparar hashchange — en jsdom el hash es '' (no '#/estudio'), la guarda detiene el polling
    window.dispatchEvent(new Event('hashchange'));

    // Forzar que cualquier promesa pendiente se resuelva antes de avanzar timers
    await Promise.resolve();

    // Avanzar 3 ticks más — no debe haber nuevas llamadas a getJob
    await vi.advanceTimersByTimeAsync(15100);
    expect(stemsApi.getJob.mock.calls.length).toBe(callsAfterFirstTick);
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
