/**
 * pipelineDispatch.test.js — reconciliación B7-1: los payloads que arma
 * api/_lib/pipeline/dispatch.js deben calzar con el contrato real de las
 * apps Modal (modal/align_app.py `run_transcribe`, modal/pitch/pitch_app.py).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/http.js', () => ({
  fetchWithTimeout: vi.fn(async () => ({ ok: true, json: async () => ({ callId: 'call1' }) })),
}));
vi.mock('../api/_lib/modal.js', () => ({
  invokeModalPipeline: vi.fn(async () => ({ id: 'stems-call' })),
}));
vi.mock('../api/pitch/_lib/modal.js', () => ({
  invokePitchPipeline: vi.fn(async (payload) => ({ id: 'pitch-call', payload })),
}));
vi.mock('../api/_lib/align.js', () => ({
  dispatchAlign: vi.fn(),
}));

process.env.MODAL_TRANSCRIBE_ENDPOINT = 'https://modal.example/transcribe';
process.env.MODAL_INBOUND_SECRET = 'inbound-secret';

const { fetchWithTimeout } = await import('../api/_lib/http.js');
const { invokeModalPipeline } = await import('../api/_lib/modal.js');
const { invokePitchPipeline } = await import('../api/pitch/_lib/modal.js');
const { dispatchStems, dispatchTranscribe, dispatchPitch } = await import('../api/_lib/pipeline/dispatch.js');

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => ({ callId: 'call1' }) });
});

describe('dispatchStems', () => {
  it('pasa enabledSections/uploads del caller sin hardcodearlos (Task 6)', async () => {
    const enabledSections = ['voiceInstrumental', 'structure', 'leadBacking', 'gender', 'duet'];
    const uploads = { leadBacking: { lead: 'https://put/lead' } };
    await dispatchStems({
      run: { id: 'run1', songId: 'song1', inputGetUrl: 'https://get/input.mp3' },
      uploads,
      enabledSections,
      webhookUrl: 'https://x/webhook',
    });

    expect(invokeModalPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'run1',
        input: { getUrl: 'https://get/input.mp3' },
        enabledSections,
        uploads,
      }),
    );
  });
});

describe('dispatchTranscribe', () => {
  it('postea runId/vocalsGetUrl/dbLines con los nombres exactos de align_app.py', async () => {
    await dispatchTranscribe({
      run: { id: 'run1', songId: 'song1' },
      vocalsGetUrl: 'https://get/vocals.mp3',
      dbLines: ['Santo, Santo, Santo', 'Es el Señor'],
      canonicalLines: ['Santo Santo Santo'],
      snapshotHash: 'hash123',
      webhookUrl: 'https://hgmlyrics.vercel.app/api/pipeline/webhook',
    });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = fetchWithTimeout.mock.calls[0];
    expect(endpoint).toBe('https://modal.example/transcribe');
    expect(opts.headers['x-inbound-secret']).toBe('inbound-secret');
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      runId: 'run1',
      vocalsGetUrl: 'https://get/vocals.mp3',
      dbLines: ['Santo, Santo, Santo', 'Es el Señor'],
      canonicalLines: ['Santo Santo Santo'],
      webhookUrl: 'https://hgmlyrics.vercel.app/api/pipeline/webhook',
      snapshotHash: 'hash123',
    });
  });

  it('dbLines no vacío (contrato: Modal rechaza dbLines vacío)', async () => {
    await dispatchTranscribe({
      run: { id: 'run1', songId: 'song1' },
      vocalsGetUrl: 'https://get/vocals.mp3',
      dbLines: ['una línea'],
      webhookUrl: 'https://x/webhook',
    });
    const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body.dbLines.length).toBeGreaterThan(0);
  });
});

describe('dispatchPitch', () => {
  it('incluye snapshotHash dentro de input cuando el run lo tiene', async () => {
    await dispatchPitch({
      run: { id: 'run1', songId: 'song1' },
      leadGetUrl: 'https://get/lead.mp3',
      backingGetUrl: 'https://get/backing.mp3',
      snapshotHash: 'hash123',
      webhookUrl: 'https://x/webhook',
    });
    expect(invokePitchPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          leadGetUrl: 'https://get/lead.mp3',
          backingGetUrl: 'https://get/backing.mp3',
          snapshotHash: 'hash123',
        }),
      }),
    );
  });

  it('sin snapshotHash (pre-aprobación) → undefined, no rompe', async () => {
    await dispatchPitch({
      run: { id: 'run1', songId: 'song1' },
      leadGetUrl: 'https://get/lead.mp3',
      backingGetUrl: 'https://get/backing.mp3',
      webhookUrl: 'https://x/webhook',
    });
    const call = invokePitchPipeline.mock.calls[0][0];
    expect(call.input.snapshotHash).toBeUndefined();
  });
});
