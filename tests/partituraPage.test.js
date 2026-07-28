import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/pitchApi.js', () => ({
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  estimateJob: vi.fn(),
  approveJob: vi.fn(),
  cancelJob: vi.fn(),
  retryJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  readAudioDuration: vi.fn().mockResolvedValue(120),
}));
vi.mock('../src/lib/authStore.js', () => ({
  signOut: vi.fn(() => Promise.resolve()),
}));

const pitchApi = await import('../src/lib/pitchApi.js');
const authStore = await import('../src/lib/authStore.js');
const { renderPartituraPage } = await import('../src/components/PartituraPage.js');
const { initRouter, navigate } = await import('../src/router.js');

// Teardown de PartituraPage cuelga de onRouteChange, igual que StudioPage:
// initRouter() activa el listener real que traduce hashchange/navigate() en
// la notificación de ruta.
initRouter();

function fileOf(name, { type = 'audio/mpeg', size = 1000 } = {}) {
  return new File(['x'], name, { type });
}

describe('renderPartituraPage', () => {
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

  it('estado vacío de un usuario nuevo sin jobs: dropzone + cuota inicial', async () => {
    pitchApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 2 } });
    await renderPartituraPage(container);
    expect(container.querySelector('.partitura__dropzone')).not.toBeNull();
    expect(container.textContent).toContain('0/2 hoy');
  });

  it('manejo de error del backend: listJobs falla → igual muestra el dropzone con cuota por defecto', async () => {
    pitchApi.listJobs.mockRejectedValueOnce(new Error('500'));
    await renderPartituraPage(container);
    expect(container.querySelector('.partitura__dropzone')).not.toBeNull();
    // Cuota por defecto declarada en el componente: 0 usados de 2.
    expect(container.textContent).toContain('0/2 hoy');
  });

  it('cuota agotada: createJob 429 muestra el aviso de límite diario y permite reintentar', async () => {
    pitchApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 2, limit: 2 } });
    await renderPartituraPage(container);

    const quotaErr = new Error('Too Many Requests');
    quotaErr.status = 429;
    pitchApi.createJob.mockRejectedValueOnce(quotaErr);

    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [fileOf('cancion.mp3')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Llegaste al límite de jobs de hoy'),
    );
    expect(container.querySelector('[data-action="retry"]')).not.toBeNull();
  });

  it('rechaza un formato no soportado sin llegar a crear el job', async () => {
    pitchApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 2 } });
    await renderPartituraPage(container);

    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [fileOf('cancion.txt', { type: 'text/plain' })] });
    input.dispatchEvent(new Event('change'));

    expect(container.textContent).toContain('Formato no soportado');
    expect(pitchApi.createJob).not.toHaveBeenCalled();
  });

  it('escapa el mensaje de error del backend en la UI (riesgo XSS)', async () => {
    pitchApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 2 } });
    await renderPartituraPage(container);

    const xssErr = new Error('<img src=x onerror=alert(1)>');
    pitchApi.createJob.mockRejectedValueOnce(xssErr);

    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [fileOf('cancion.mp3')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(container.querySelector('.partitura__error')).not.toBeNull());

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('.partitura__error').textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('#1 sesión expirada (401) durante el polling: corta el poll y lleva al login', async () => {
    pitchApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 2 } });
    await renderPartituraPage(container);

    pitchApi.createJob.mockResolvedValueOnce({ job: { id: 'j1' }, upload: { url: 'https://u' } });
    pitchApi.uploadInput.mockResolvedValueOnce(undefined);
    pitchApi.estimateJob.mockResolvedValueOnce({
      estimate: { lo: 1, hi: 2, breakdown: [{ label: 'Separación', confirmed: true }] },
    });
    pitchApi.approveJob.mockResolvedValueOnce({ success: true });

    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { value: [fileOf('cancion.mp3')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(container.querySelector('[data-action="approve"]')).not.toBeNull());

    window.location.hash = '#/partitura';
    // El mock de getJob queda listo ANTES de aprobar: startPolling arranca
    // con un tick inmediato (start({immediate:true})), así que si el 401 se
    // configura después del click puede perderse esa primera vuelta.
    const authErr = new Error('No autorizado');
    authErr.status = 401;
    pitchApi.getJob.mockRejectedValue(authErr);

    container.querySelector('[data-action="approve"]').click();
    await vi.waitFor(() => expect(pitchApi.approveJob).toHaveBeenCalled());
    await vi.waitFor(() => expect(authStore.signOut).toHaveBeenCalled());
    expect(window.location.hash).toBe('#/login?next=%2Fpartitura');
    expect(container.textContent).not.toContain('fases');
  });
});
