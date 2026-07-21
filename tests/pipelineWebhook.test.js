import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

// sql mock: sql.begin(cb) ejecuta cb con un sql interno que va sacando de
// sqlResponses en orden (mismo patrón que apiStemsWebhook.test.js).
const sqlResponses = [];
const sqlCalls = [];
function makeInnerSql() {
  const inner = (strings, ...values) => {
    if (!strings?.raw) return strings;
    sqlCalls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    return Promise.resolve(sqlResponses.shift() ?? []);
  };
  inner.json = (v) => v;
  return inner;
}
const sqlMock = makeInnerSql();
sqlMock.begin = async (cb) => cb(makeInnerSql());
vi.mock('postgres', () => ({ default: () => sqlMock }));

// dispatchPhase real toca Modal/Storage — se mockea para aislar el webhook.
const dispatchPhaseMock = vi.fn().mockResolvedValue({ id: 'call-1' });
vi.mock('../api/songs/[id]/pipeline/_dispatch.js', () => ({
  dispatchPhase: (...args) => dispatchPhaseMock(...args),
}));

process.env.DATABASE_URL = 'postgresql://test';
process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';
process.env.MODAL_WEBHOOK_SECRET = 'modalwebhooksecret';

const { default: handler, applyPipelinePhaseEvent } = await import('../api/pipeline/webhook.js');
const { initialPhases } = await import('../api/_lib/pipeline/state.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function signedReq(bodyObj) {
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', 'modalwebhooksecret').update(`${timestamp}.${body}`).digest('hex');
  const req = Readable.from([Buffer.from(body)]);
  req.method = 'POST';
  req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
  req.query = {};
  req.url = '/api/pipeline/webhook';
  return req;
}

function runRow(overrides = {}) {
  return {
    id: 'run-1',
    songId: 'song-1',
    status: 'processing',
    phases: initialPhases(),
    lyricsReview: {},
    ...overrides,
  };
}

beforeEach(() => {
  sqlResponses.length = 0;
  sqlCalls.length = 0;
  dispatchPhaseMock.mockClear();
});

describe('POST /api/pipeline/webhook — firma HMAC', () => {
  it('401 si la firma es inválida', async () => {
    const body = JSON.stringify({ runId: 'run-1', phase: 'stems', ok: true });
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': String(Math.floor(Date.now() / 1000)), 'x-modal-signature': 'deadbeef' };
    req.query = {};
    req.url = '/api/pipeline/webhook';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('401 si el timestamp está fuera de ventana (anti-replay)', async () => {
    const bodyObj = { runId: 'run-1', phase: 'stems', ok: true };
    const body = JSON.stringify(bodyObj);
    const oldTs = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const sig = createHmac('sha256', 'modalwebhooksecret').update(`${oldTs}.${body}`).digest('hex');
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': oldTs, 'x-modal-signature': sig };
    req.query = {};
    req.url = '/api/pipeline/webhook';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/pipeline/webhook — stems parcial y final', () => {
  it('stems parcial (vocals+instrumental) → running, tracks mergeados, upsert song_stems', async () => {
    sqlResponses.push([runRow()]); // SELECT FOR UPDATE
    sqlResponses.push([]); // insert song_stems vocals
    sqlResponses.push([]); // insert song_stems instrumental
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'stems',
        ok: true,
        partial: true,
        tracks: { vocals: 'song-1/stems/vocals.mp3', instrumental: 'song-1/stems/instrumental.mp3' },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(sqlCalls.some((c) => c.text.includes('FOR UPDATE'))).toBe(true);
    expect(sqlCalls.filter((c) => c.text.includes('INSERT INTO song_stems')).length).toBe(2);
    const finalUpdate = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(finalUpdate).toBeDefined();
  });

  it('stems final (ok, sin partial) → fase done + status recalculado', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';
    phases.stems.tracks = { vocals: 'k1', instrumental: 'k2' };
    sqlResponses.push([runRow({ phases })]);
    sqlResponses.push([]); // insert song_stems lead
    sqlResponses.push([]); // insert song_stems backing
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'stems',
        ok: true,
        tracks: { lead: 'k3', backing: 'k4' },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    // Debe disparar 'transcription' post-commit porque vocals ya está presente.
    expect(dispatchPhaseMock).toHaveBeenCalledWith('transcription', expect.anything());
  });
});

describe('POST /api/pipeline/webhook — CAS sobre fase terminal', () => {
  it('evento sobre fase ya done → 200 ignorado, no cambia nada', async () => {
    const phases = initialPhases();
    phases.stems.status = 'done';
    phases.stems.tracks = { vocals: 'k1' };
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE

    const res = makeRes();
    await handler(signedReq({ runId: 'run-1', phase: 'stems', ok: true, tracks: { instrumental: 'k2' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_stems'))).toBe(false);
    expect(sqlCalls.some((c) => c.text.includes('UPDATE song_pipeline_runs'))).toBe(false);
  });
});

describe('POST /api/pipeline/webhook — transcription', () => {
  it('transcription done con {text,words,perLine} → guarda en lyrics_review y status awaiting_lyrics', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'done';
    phases.stems.tracks = { vocals: 'k1' };
    phases.transcription.status = 'running';
    sqlResponses.push([runRow({ phases })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'transcription',
        ok: true,
        payload: { text: 'la la la', words: [{ w: 'la', t: 0 }], perLine: [{ start: 0, end: 1 }] },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const upd = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(upd).toBeDefined();
    const lyricsReviewArg = upd.values.find(
      (v) => v && typeof v === 'object' && v.transcription && v.transcription.text === 'la la la',
    );
    expect(lyricsReviewArg).toBeDefined();
    const statusArg = upd.values.find((v) => v === 'awaiting_lyrics');
    expect(statusArg).toBe('awaiting_lyrics');
  });
});

describe('POST /api/pipeline/webhook — pitch', () => {
  it('pitch done → upsert song_pitch_analysis (analysis + artifacts)', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'done';
    phases.stems.tracks = { lead: 'kl', backing: 'kb' };
    phases.lyrics_review.status = 'done';
    phases.pitch.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // insert song_pitch_analysis
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'pitch',
        ok: true,
        snapshotHash: 'h1',
        artifacts: { renderUrl: 'r.png' },
        payload: { analysis: { notes: [] } },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_pitch_analysis'))).toBe(true);
  });

  it('pitch con snapshotHash distinto al approvedHash → fase stale, no publica', async () => {
    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.pitch.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs (marca stale)

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'pitch',
        ok: true,
        snapshotHash: 'h-vieja',
        payload: { analysis: { notes: [] } },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_pitch_analysis'))).toBe(false);
    const upd = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(upd).toBeDefined();
  });
});

describe('POST /api/pipeline/webhook — clips', () => {
  it('clips done → upsert song_section_audio con run_id (respeta filas run_id null)', async () => {
    const phases = initialPhases();
    phases.sync.status = 'done';
    phases.clips.status = 'running';
    sqlResponses.push([runRow({ phases })]);
    sqlResponses.push([]); // insert/upsert clip 0
    sqlResponses.push([]); // insert/upsert clip 1
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'clips',
        ok: true,
        payload: {
          clips: [
            { sectionIndex: 0, voiceScope: null, storageKey: 'c0.mp3', durationSec: 4.2 },
            { sectionIndex: 1, voiceScope: 'lead', storageKey: 'c1.mp3', durationSec: 3.1 },
          ],
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const upserts = sqlCalls.filter((c) => c.text.includes('song_section_audio'));
    expect(upserts.length).toBe(2);
    expect(upserts.every((c) => c.text.includes('run_id IS NOT NULL'))).toBe(true);
  });
});

describe('applyPipelinePhaseEvent — CAS directo (reuso B7)', () => {
  it('run inexistente → null', async () => {
    sqlResponses.push([]);
    const outcome = await applyPipelinePhaseEvent(sqlMock, 'run-x', { phase: 'stems', ok: true });
    expect(outcome).toBeNull();
  });
});
