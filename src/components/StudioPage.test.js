import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isMp3File } from '../lib/studioFile.js';

describe('isMp3File', () => {
  it('acepta archivo con type audio/mpeg sin importar la extensión', () => {
    const file = { type: 'audio/mpeg', name: 'cancion' };
    expect(isMp3File(file)).toBe(true);
  });

  it('acepta archivo con nombre .MP3 en mayúsculas aunque el type sea vacío', () => {
    const file = { type: '', name: 'TRACK.MP3' };
    expect(isMp3File(file)).toBe(true);
  });

  it('acepta archivo con nombre .mp3 y type vacío (navegadores móviles)', () => {
    const file = { type: '', name: 'cancion.mp3' };
    expect(isMp3File(file)).toBe(true);
  });

  it('rechaza archivo .wav', () => {
    const file = { type: 'audio/wav', name: 'pista.wav' };
    expect(isMp3File(file)).toBe(false);
  });

  it('rechaza archivo .m4a', () => {
    const file = { type: 'audio/mp4', name: 'pista.m4a' };
    expect(isMp3File(file)).toBe(false);
  });

  it('rechaza archivo .wav con type vacío (por extensión)', () => {
    const file = { type: '', name: 'pista.wav' };
    expect(isMp3File(file)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onStatus — sin render optimista con datos parciales
// Verifica que cuando llega un push de Realtime, onStatus solo dispara getJob
// (refresh) y NO pinta players desde datos parciales (sin stems firmados).
// ---------------------------------------------------------------------------

// Mocks de módulos que usan APIs de navegador o red.
vi.mock('../lib/stemsApi.js', () => {
  const getJobMock = vi.fn();
  const watchJobRealtimeMock = vi.fn();
  const listJobsMock = vi.fn();
  return {
    getJob: getJobMock,
    watchJobRealtime: watchJobRealtimeMock,
    listJobs: listJobsMock,
    createJob: vi.fn(),
    uploadInput: vi.fn(),
    startJob: vi.fn(),
    readAudioDuration: vi.fn(),
  };
});

vi.mock('../lib/authStore.js', () => ({ getSession: vi.fn() }));
vi.mock('../lib/studioZip.js', () => ({
  downloadAllZip: vi.fn(),
  buildZipBlob: vi.fn(),
}));
vi.mock('../lib/driveAuth.js', () => ({ getDriveToken: vi.fn() }));
vi.mock('../lib/driveUpload.js', () => ({ uploadZipToDrive: vi.fn() }));
vi.mock('./StudioPlayer.js', () => ({
  createStudioPlayer: vi.fn(() => {
    const el = document.createElement('div');
    const audio = document.createElement('audio');
    return { el, audio };
  }),
}));
vi.mock('./StudioSectionTimeline.js', () => ({
  renderTimeline: vi.fn(() => document.createElement('div')),
  markActive: vi.fn(),
}));
vi.mock('./StudioSectionCard.js', () => ({
  renderSectionCard: vi.fn(() => document.createElement('div')),
}));
vi.mock('../lib/icons.js', () => ({ icon: vi.fn(() => '') }));
vi.mock('../lib/studioSections.js', () => ({ SECTION_KEYS: ['s1', 's2', 's3', 's4'] }));

describe('onStatus — sin render optimista parcial', () => {
  let capturedOnStatus;

  beforeEach(async () => {
    // Importamos los mocks ya registrados.
    const { listJobs, getJob, watchJobRealtime } = await import('../lib/stemsApi.js');

    // listJobs → un job en processing.
    listJobs.mockResolvedValue({
      jobs: [{ id: 'job-1', status: 'processing', input_meta: { filename: 'cancion.mp3' } }],
      quota: { limit: 5, used: 1 },
    });

    // getJob → job aún en processing (sin stems firmados aún).
    getJob.mockResolvedValue({
      job: {
        id: 'job-1',
        status: 'processing',
        sections: { s1: { status: 'processing' } },
        stems: {},
        voices: {},
      },
    });

    // watchJobRealtime captura el onStatus para que el test lo dispare a mano.
    watchJobRealtime.mockImplementation(({ onStatus }) => {
      capturedOnStatus = onStatus;
      return { leave: vi.fn() };
    });

    // Montar la página.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { renderStudioPage } = await import('./StudioPage.js');
    renderStudioPage(container);

    // Esperar a que loadInitial + watchJob + primer refresh resuelvan.
    await vi.waitFor(() => expect(capturedOnStatus).toBeDefined());
    // Dar un tick extra para que el primer refresh() también resuelva.
    await new Promise((r) => setTimeout(r, 0));
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('cuando llega un push con sections, dispara getJob (refresh) exactamente una vez adicional', async () => {
    const { getJob } = await import('../lib/stemsApi.js');
    const callsBefore = getJob.mock.calls.length;

    // Simular push de Realtime con sections pero sin stems firmados.
    capturedOnStatus({ status: 'processing', sections: { s1: { status: 'done' } } });

    await new Promise((r) => setTimeout(r, 0));

    // Debe haber llamado getJob exactamente una vez más (el refresh()).
    expect(getJob.mock.calls.length).toBe(callsBefore + 1);
  });

  it('después de un push, el DOM no contiene studio-player-mount vacíos pintados desde datos parciales', async () => {
    const container = document.body.querySelector('.studio');
    const mountsBefore = container ? container.querySelectorAll('.studio-player-mount').length : 0;

    capturedOnStatus({ status: 'processing', sections: { s1: { status: 'done' } } });
    // Dar un tick para que cualquier render sincrónico se aplique.
    await new Promise((r) => setTimeout(r, 0));

    // Si hubiese habido render optimista con stems={}, aparecerían mounts vacíos.
    // Con el fix, la cantidad de mounts solo cambia via refresh() (getJob), no desde el push.
    const mountsAfterPush = container
      ? container.querySelectorAll('.studio-player-mount').length
      : 0;
    expect(mountsAfterPush).toBe(mountsBefore);
  });
});
