import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/stemsApi.js', () => ({
  createJob: vi.fn(),
  uploadInput: vi.fn(),
  startJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  readAudioDuration: vi.fn().mockResolvedValue(180),
  watchJobRealtime: vi.fn(() => ({ leave: vi.fn() })),
  updateJobTitle: vi.fn(),
}));
vi.mock('../src/lib/authStore.js', () => ({
  getSession: () => ({ access_token: 'tok' }),
}));

const stemsApi = await import('../src/lib/stemsApi.js');
const { renderStudioPage } = await import('../src/components/StudioPage.js');

// Fixture de job done con las 4 secciones y datos firmados
const JOB_DONE_FIXTURE = {
  id: 'j1',
  status: 'done',
  expires_at: new Date(Date.now() + 47 * 3600e3).toISOString(),
  input_meta: { filename: 'cancion.mp3' },
  stems: {
    vocals: 'https://s/vocals',
    instrumental: 'https://s/instrumental',
    drums: 'https://s/drums',
  },
  voices: {
    lead: 'https://s/lead',
    backing: 'https://s/back',
  },
  sections: {
    voiceInstrumental: { status: 'done' },
    structure: {
      status: 'done',
      segments: [
        { label: 'intro', start: 0, end: 15 },
        { label: 'verse', start: 15, end: 45 },
        { label: 'chorus', start: 45, end: 75 },
      ],
    },
    leadBacking: { status: 'done' },
    gender: { status: 'skipped' },
  },
};

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

  it('estado idle admin: muestra "Sin límite diario" en vez del contador', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [],
      quota: { used: 5, limit: null, unlimited: true },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());
    expect(container.textContent).toContain('Sin límite diario');
    expect(container.textContent).toContain('48 h');
    // No debe mostrar "NaN" ni "null"
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('null');
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
    // Las 4 tarjetas deben existir
    await vi.waitFor(() =>
      expect(container.querySelectorAll('.studio-section-card').length).toBe(4),
    );
  });

  it('job done: 4 tarjetas, players, timeline de structure, expiración', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'done' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: JOB_DONE_FIXTURE });
    renderStudioPage(container);

    // Esperar a que aparezcan las tarjetas
    await vi.waitFor(() =>
      expect(container.querySelectorAll('.studio-section-card').length).toBe(4),
    );

    // Chips de estado correctos por sección
    const cards = container.querySelectorAll('.studio-section-card');
    expect(cards[0].classList.contains('studio-section-card--voiceInstrumental')).toBe(true);
    expect(cards[0].classList.contains('studio-section-card--done')).toBe(true);
    expect(cards[3].classList.contains('studio-section-card--gender')).toBe(true);
    expect(cards[3].classList.contains('studio-section-card--skipped')).toBe(true);

    // Chips de estado
    const chips = container.querySelectorAll('.studio-section-card__chip');
    expect(chips.length).toBe(4);
    // done chip en voiceInstrumental
    expect(chips[0].textContent).toBe('Listo');
    // skipped chip en gender
    expect(chips[3].textContent).toBe('No procesada');

    // Labels de las secciones en el texto
    expect(container.textContent).toContain('Voz e instrumentos');
    expect(container.textContent).toContain('Secciones');
    expect(container.textContent).toContain('Voz líder y coros');
    expect(container.textContent).toContain('Voces por género');

    // Players de audio montados (audio elements)
    expect(container.querySelectorAll('audio').length).toBeGreaterThanOrEqual(2);

    // Timeline de structure renderizada
    expect(container.querySelector('.studio-sectl__row')).not.toBeNull();
    expect(container.querySelector('.studio-sectl__list')).not.toBeNull();

    // Expiración
    expect(container.textContent.toLowerCase()).toContain('disponible por');

    // Género skipped: nota de sección no procesada
    expect(container.textContent).toContain('Esta sección no se procesó');
  });

  it('gender done: tarjeta muestra dos modelos lado a lado con players de audio', async () => {
    const jobWithGender = {
      ...JOB_DONE_FIXTURE,
      sections: {
        ...JOB_DONE_FIXTURE.sections,
        gender: {
          status: 'done',
          outputs: { chorus: { male: 'k1', female: 'k2' }, aufr33: { male: 'k3', female: 'k4' } },
        },
      },
      genderVoices: {
        chorus: {
          male: 'https://s/gender/chorus/male',
          female: 'https://s/gender/chorus/female',
        },
        aufr33: {
          male: 'https://s/gender/aufr33/male',
          female: 'https://s/gender/aufr33/female',
        },
      },
    };
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'done' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({ job: jobWithGender });
    renderStudioPage(container);

    await vi.waitFor(() =>
      expect(container.querySelectorAll('.studio-section-card').length).toBe(4),
    );

    const genderCard = container.querySelector('.studio-section-card--gender');
    expect(genderCard).not.toBeNull();
    expect(genderCard.classList.contains('studio-section-card--done')).toBe(true);

    // Grid de dos modelos
    expect(genderCard.querySelector('.studio-gender-grid')).not.toBeNull();
    expect(genderCard.querySelectorAll('.studio-gender-grid__col').length).toBe(2);

    // Encabezados de modelo
    const modelLabels = [...genderCard.querySelectorAll('.studio-gender-grid__model-label')].map(
      (el) => el.textContent,
    );
    expect(modelLabels[0]).toContain('Opción A');
    expect(modelLabels[1]).toContain('Opción B');

    // 4 players (2 por modelo)
    expect(genderCard.querySelectorAll('audio').length).toBe(4);

    // Etiquetas de track
    expect(genderCard.textContent).toContain('Voz masculina');
    expect(genderCard.textContent).toContain('Voz femenina');
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

  it('partial es terminal: pistas listas + retry por sección fallida', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'partial' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: {
        id: 'j1',
        status: 'partial',
        stems: { vocals: 'https://s/vocals' },
        voices: {},
        sections: {
          voiceInstrumental: { status: 'done' },
          structure: { status: 'failed', error: 'falló' },
          leadBacking: { status: 'pending' },
          gender: { status: 'skipped' },
        },
        input_meta: { filename: 'x.mp3' },
        expires_at: new Date(Date.now() + 47 * 3600e3).toISOString(),
      },
    });
    renderStudioPage(container);

    // partial es terminal: renderJob (no renderProcessing)
    await vi.waitFor(() => expect(container.querySelector('#studio-zip')).not.toBeNull());
    expect(container.textContent.toLowerCase()).toContain('disponible por');

    // Botón retry para la sección fallida
    const retryBtn = container.querySelector('.studio-section-card__retry');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.dataset.section).toBe('structure');
  });

  it('retry cableado en renderProcessing (sección falla mientras el job sigue processing)', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'processing' }],
      quota: { used: 1, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: {
        id: 'j1',
        status: 'processing',
        input_meta: { filename: 'x.mp3' },
        sections: {
          voiceInstrumental: { status: 'failed', error: 'falló' },
          structure: { status: 'running' },
          leadBacking: { status: 'pending' },
          gender: { status: 'skipped' },
        },
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderStudioPage(container);

    // renderProcessing: hay aria-live, no hay #studio-zip
    await vi.waitFor(() =>
      expect(container.querySelector('.studio-section-card__retry')).not.toBeNull(),
    );
    expect(container.querySelector('#studio-zip')).toBeNull();

    // Click en el botón retry de voiceInstrumental
    container.querySelector('.studio-section-card__retry').click();

    // Esperar a que se llame fetch (la promesa del click handler es async)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/stems/jobs/j1/retry?section=voiceInstrumental');
    expect(opts.method).toBe('POST');
    expect(opts.headers?.Authorization).toBe('Bearer tok');

    vi.unstubAllGlobals();
  });

  // SEC-09: sinks e.message y job.error no aterrizan crudos en innerHTML
  it('SEC-09: escapa job.error con payload XSS en renderJob (failed)', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [{ id: 'j1', status: 'failed', error: xssPayload }],
      quota: { used: 0, limit: 3 },
    });
    stemsApi.getJob.mockResolvedValue({
      job: { id: 'j1', status: 'failed', error: xssPayload },
    });
    renderStudioPage(container);

    await vi.waitFor(() => expect(container.querySelector('.studio__error')).not.toBeNull());

    // No debe existir <img> con onerror como elemento real del DOM
    expect(container.querySelector('img[onerror]')).toBeNull();
    const errEl = container.querySelector('.studio__error');
    // El texto debe contener el payload crudo (como texto, no ejecutable)
    expect(errEl.textContent).toContain('<img');
    // La representación HTML del elemento debe estar escapada
    expect(errEl.innerHTML).toContain('&lt;img');
  });

  it('SEC-09: escapa e.message con payload XSS cuando createJob lanza', async () => {
    const xssPayload = '<script>evil()</script>';
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [],
      quota: { used: 0, limit: 3 },
    });
    stemsApi.createJob.mockRejectedValue(new Error(xssPayload));
    renderStudioPage(container);

    // Esperar el estado idle (dropzone)
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());

    // Disparar drop con un archivo MP3 simulado
    const drop = container.querySelector('.studio-dropzone');
    const fakeFile = new File([''], 'song.mp3', { type: 'audio/mpeg' });
    const dropEvent = new Event('drop');
    dropEvent.preventDefault = vi.fn();
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [fakeFile] } });
    drop.dispatchEvent(dropEvent);

    await vi.waitFor(() =>
      expect(container.querySelector('.studio-review__submit')).not.toBeNull(),
    );
    container.querySelector('.studio-review__submit').click();

    // Esperar a que createJob rechace y aparezca el error
    await vi.waitFor(() => expect(container.querySelector('.studio__error')).not.toBeNull());

    // No debe haber <script> ejecutable en el DOM
    expect(container.querySelector('script')).toBeNull();
    const errEl = container.querySelector('.studio__error');
    expect(errEl.textContent).toContain('<script>');
    expect(errEl.innerHTML).toContain('&lt;script&gt;');
  });

  it('al elegir archivo muestra el panel de revision (titulo prellenado + selector de 4 secciones)', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 3 } });
    stemsApi.createJob.mockReturnValue(new Promise(() => {})); // no debe llamarse aun
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());

    const drop = container.querySelector('.studio-dropzone');
    const file = new File([''], 'colombia.mp3', { type: 'audio/mpeg' });
    const ev = new Event('drop');
    ev.preventDefault = vi.fn();
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    drop.dispatchEvent(ev);

    await vi.waitFor(() => expect(container.querySelector('.studio-review')).not.toBeNull());
    const titleInput = container.querySelector('.studio-review__title-input');
    expect(titleInput.value).toBe('colombia');
    const checks = container.querySelectorAll('.studio-review__section-check');
    expect(checks.length).toBe(4);
    expect([...checks].every((c) => c.checked)).toBe(true);
    expect(stemsApi.createJob).not.toHaveBeenCalled();
  });

  it('boton de procesar se deshabilita con 0 secciones y al confirmar llama createJob+startJob con la seleccion', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({ jobs: [], quota: { used: 0, limit: 3 } });
    stemsApi.createJob.mockResolvedValue({ job: { id: 'j9' }, upload: { path: 'p', token: 't' } });
    stemsApi.uploadInput.mockResolvedValue(undefined);
    stemsApi.startJob.mockResolvedValue({ ok: true });
    stemsApi.getJob.mockResolvedValue({
      job: {
        id: 'j9',
        status: 'processing',
        input_meta: { filename: 'colombia.mp3', title: 'colombia' },
        sections: {},
      },
    });
    renderStudioPage(container);
    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());

    const drop = container.querySelector('.studio-dropzone');
    const file = new File([''], 'colombia.mp3', { type: 'audio/mpeg' });
    const ev = new Event('drop');
    ev.preventDefault = vi.fn();
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
    drop.dispatchEvent(ev);
    await vi.waitFor(() => expect(container.querySelector('.studio-review')).not.toBeNull());

    const checks = [...container.querySelectorAll('.studio-review__section-check')];
    checks.forEach((c) => {
      c.checked = false;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const submit = container.querySelector('.studio-review__submit');
    expect(submit.disabled).toBe(true);

    checks[0].checked = true;
    checks[0].dispatchEvent(new Event('change', { bubbles: true }));
    checks[1].checked = true;
    checks[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(submit.disabled).toBe(false);

    const titleInput = container.querySelector('.studio-review__title-input');
    titleInput.value = 'Mi Tema';
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));

    submit.click();
    await vi.waitFor(() => expect(stemsApi.createJob).toHaveBeenCalled());
    expect(stemsApi.createJob).toHaveBeenCalledWith(file, 'Mi Tema');
    await vi.waitFor(() => expect(stemsApi.startJob).toHaveBeenCalled());
    const [, sections] = stemsApi.startJob.mock.calls[0];
    expect(sections).toEqual(['voiceInstrumental', 'structure']);
  });

  it('renderJob muestra title y permite editarlo con el lápiz (PATCH)', async () => {
    const jobDone = { ...JOB_DONE_FIXTURE, input_meta: { filename: 'colombia.mp3', title: 'Colombia Live' } };
    stemsApi.listJobs.mockResolvedValueOnce({ jobs: [{ id: 'j1', status: 'done' }], quota: { used: 1, limit: 3 } });
    stemsApi.getJob.mockResolvedValue({ job: jobDone });
    stemsApi.updateJobTitle = vi.fn().mockResolvedValue({
      job: { ...jobDone, input_meta: { filename: 'colombia.mp3', title: 'Nuevo Nombre' } },
    });
    renderStudioPage(container);

    await vi.waitFor(() =>
      expect(container.querySelectorAll('.studio-section-card').length).toBe(4),
    );

    await vi.waitFor(() => expect(container.textContent).toContain('Colombia Live'));

    const editBtn = container.querySelector('.studio__title-edit');
    expect(editBtn).not.toBeNull();
    editBtn.click();

    const input = container.querySelector('.studio__title-input');
    expect(input).not.toBeNull();
    input.value = 'Nuevo Nombre';
    const save = container.querySelector('.studio__title-save');
    save.click();

    await vi.waitFor(() => expect(stemsApi.updateJobTitle).toHaveBeenCalledWith('j1', 'Nuevo Nombre'));
  });

  // SEC-X1: file.name en innerHTML durante la subida
  it('SEC-X1: file.name con payload XSS no produce elemento ejecutable durante subida', async () => {
    stemsApi.listJobs.mockResolvedValueOnce({
      jobs: [],
      quota: { used: 0, limit: 3 },
    });
    // createJob cuelga indefinidamente (simula subida lenta) para poder inspeccionar el DOM
    stemsApi.createJob.mockReturnValue(new Promise(() => {}));
    renderStudioPage(container);

    await vi.waitFor(() => expect(container.querySelector('.studio-dropzone')).not.toBeNull());

    const drop = container.querySelector('.studio-dropzone');
    const maliciousName = '<img src=x onerror=alert(1)>.mp3';
    const fakeFile = new File([''], maliciousName, { type: 'audio/mpeg' });
    const dropEvent = new Event('drop');
    dropEvent.preventDefault = vi.fn();
    Object.defineProperty(dropEvent, 'dataTransfer', { value: { files: [fakeFile] } });
    drop.dispatchEvent(dropEvent);

    await vi.waitFor(() =>
      expect(container.querySelector('.studio-review__submit')).not.toBeNull(),
    );
    container.querySelector('.studio-review__submit').click();

    // Esperar a que se muestre el mensaje "Subiendo..."
    await vi.waitFor(() => expect(container.querySelector('[aria-busy]')).not.toBeNull());

    // No debe existir <img> con onerror ejecutable
    expect(container.querySelector('img[onerror]')).toBeNull();
    // El texto debe aparecer como texto plano
    expect(container.querySelector('[aria-busy]').textContent).toContain('<img');
    // El innerHTML del párrafo debe estar escapado
    expect(container.querySelector('[aria-busy]').innerHTML).toContain('&lt;img');
  });
});
