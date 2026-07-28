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

// El secreto se elige por fase (mismo criterio que api/pipeline/webhook.js):
// 'pitch' firma con PITCH_MODAL_WEBHOOK_SECRET, el resto con MODAL_WEBHOOK_SECRET.
function signedReq(bodyObj) {
  const secret = bodyObj.phase === 'pitch' ? 'secret-pitch' : 'modalwebhooksecret';
  const body = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
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
    req.headers = {
      'x-modal-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-modal-signature': 'deadbeef',
    };
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

  it('acepta eventos firmados con PITCH_MODAL_WEBHOOK_SECRET (fase pitch)', async () => {
    process.env.PITCH_MODAL_WEBHOOK_SECRET = 'secret-pitch';

    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.pitch.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // insert song_pitch_analysis
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const bodyObj = {
      runId: 'run-1',
      phase: 'pitch',
      ok: true,
      snapshotHash: 'h1',
      payload: { analysis: {} },
    };
    const body = JSON.stringify(bodyObj);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'secret-pitch').update(`${timestamp}.${body}`).digest('hex');
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
    req.query = {};
    req.url = '/api/pipeline/webhook';

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).not.toBe(401);
  });

  it('rechaza un evento de fase "stems" firmado con PITCH_MODAL_WEBHOOK_SECRET (no cruzar secretos entre fases)', async () => {
    process.env.PITCH_MODAL_WEBHOOK_SECRET = 'secret-pitch';

    const bodyObj = {
      runId: 'run-1',
      phase: 'stems',
      ok: true,
      tracks: { vocals: 'song-1/stems/vocals.mp3' },
    };
    const body = JSON.stringify(bodyObj);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'secret-pitch').update(`${timestamp}.${body}`).digest('hex');
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
    req.query = {};
    req.url = '/api/pipeline/webhook';

    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it('rechaza un evento de fase "pitch" firmado con MODAL_WEBHOOK_SECRET (debe usar el secreto de pitch)', async () => {
    const bodyObj = { runId: 'run-1', phase: 'pitch', ok: true, payload: { analysis: {} } };
    const body = JSON.stringify(bodyObj);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', 'modalwebhooksecret')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const req = Readable.from([Buffer.from(body)]);
    req.method = 'POST';
    req.headers = { 'x-modal-timestamp': timestamp, 'x-modal-signature': sig };
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
        tracks: {
          vocals: 'song-1/stems/vocals.mp3',
          instrumental: 'song-1/stems/instrumental.mp3',
        },
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

  it('stems con storage key de otra canción → se descarta, no se inserta', async () => {
    sqlResponses.push([runRow()]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'stems',
        ok: true,
        partial: true,
        tracks: { vocals: 'otra-cancion/stems/vocals.mp3' },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_stems'))).toBe(false);
  });

  it('stems final (ok, sin partial) → fase done + status recalculado', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';
    phases.stems.tracks = {
      vocals: 'song-1/stems/vocals.mp3',
      instrumental: 'song-1/stems/instrumental.mp3',
    };
    sqlResponses.push([runRow({ phases })]);
    sqlResponses.push([]); // insert song_stems lead
    sqlResponses.push([]); // insert song_stems backing
    sqlResponses.push([]); // UPDATE song_pipeline_runs (commit del CAS del webhook)
    // advanceNextPhase re-lee `phases` FRESCO en su propia tx antes de despachar.
    const doneStemsPhases = structuredClone(phases);
    doneStemsPhases.stems = {
      status: 'done',
      tracks: {
        vocals: 'song-1/stems/vocals.mp3',
        instrumental: 'song-1/stems/instrumental.mp3',
        lead: 'song-1/stems/lead.mp3',
        backing: 'song-1/stems/backing.mp3',
      },
    };
    sqlResponses.push([{ phases: doneStemsPhases }]); // SELECT phases FOR UPDATE (claim)
    sqlResponses.push([]); // UPDATE phases (marca transcription 'running')

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'stems',
        ok: true,
        tracks: { lead: 'song-1/stems/lead.mp3', backing: 'song-1/stems/backing.mp3' },
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
    await handler(
      signedReq({ runId: 'run-1', phase: 'stems', ok: true, tracks: { instrumental: 'k2' } }),
      res,
    );

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

describe('POST /api/pipeline/webhook — sync', () => {
  it('sync ok con snapshotHash igual al approvedHash → NO queda stale', async () => {
    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.sync.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(signedReq({ runId: 'run-1', phase: 'sync', ok: true, snapshotHash: 'h1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBeUndefined();
  });

  it('sync con snapshotHash distinto al approvedHash → fase stale (guarda anti-zombie)', async () => {
    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.sync.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs (marca stale)

    const res = makeRes();
    await handler(
      signedReq({ runId: 'run-1', phase: 'sync', ok: true, snapshotHash: 'h-vieja' }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBe(true);
  });

  it('sync sin snapshotHash (karaoke, no debería llegar por este webhook pero no debe romper) → no queda stale', async () => {
    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.sync.status = 'running';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'h1' } })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(signedReq({ runId: 'run-1', phase: 'sync', ok: true }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBeUndefined();
  });

  it('webhook tardío tras reopen (approvedHash invalidado a "reopened") → sync NO revive a done', async () => {
    // Simula el estado que deja reopenLyrics: la fase quedó 'stale' por la
    // cascada de phasesAfterLyricsEdit y approvedHash ya no es el hash viejo
    // ('h1-vieja') sino el centinela 'reopened' — nunca coincide con un
    // sha256 hex real, así que el guard SIEMPRE marca stale este evento.
    const phases = initialPhases();
    phases.lyrics_review.status = 'pending';
    phases.sync.status = 'stale';
    sqlResponses.push([runRow({ phases, lyricsReview: { approvedHash: 'reopened' } })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs (marca/mantiene stale)

    const res = makeRes();
    await handler(
      signedReq({ runId: 'run-1', phase: 'sync', ok: true, snapshotHash: 'h1-vieja' }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBe(true);
    // La fase sync NO debe quedar 'done' — el guard cortó antes de aplicar
    // applyPhaseEvent, así que ni siquiera se llega a publicar nada de sync.
    const upd = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    expect(upd).toBeDefined();
    const phasesArg = upd.values.find((v) => v && typeof v === 'object' && v.sync);
    expect(phasesArg.sync.status).toBe('stale');
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
            {
              sectionIndex: 0,
              voiceScope: null,
              storageKey: 'song-1/clips/full/section-0.mp3',
              durationSec: 4.2,
            },
            {
              sectionIndex: 1,
              voiceScope: 'lead',
              storageKey: 'song-1/clips/lead/section-1.mp3',
              durationSec: 3.1,
            },
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

  it('clips con storage key de otra canción → se descarta, no se inserta', async () => {
    const phases = initialPhases();
    phases.sync.status = 'done';
    phases.clips.status = 'running';
    sqlResponses.push([runRow({ phases })]);
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'clips',
        ok: true,
        payload: {
          clips: [
            {
              sectionIndex: 0,
              voiceScope: null,
              storageKey: 'otra-cancion/clips/full/section-0.mp3',
            },
          ],
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes('song_section_audio'))).toBe(false);
  });
});

describe('POST /api/pipeline/webhook — guarda de run terminal', () => {
  it('run cancelled → 200 ignorado, sin efectos de publicación ni dispatch', async () => {
    sqlResponses.push([runRow({ status: 'cancelled' })]); // SELECT FOR UPDATE

    const res = makeRes();
    await handler(
      signedReq({ runId: 'run-1', phase: 'stems', ok: true, tracks: { vocals: 'k1' } }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(dispatchPhaseMock).not.toHaveBeenCalled();
    expect(sqlCalls.some((c) => c.text.includes('UPDATE song_pipeline_runs'))).toBe(false);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_stems'))).toBe(false);
  });
});

describe('POST /api/pipeline/webhook — sección de stems (adapter hkn-stems)', () => {
  it('leadBacking done con {lead,backing,vocals} → fase stems final, upsert 3 tracks, dispara transcription', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // insert song_stems lead
    sqlResponses.push([]); // insert song_stems backing
    sqlResponses.push([]); // insert song_stems vocals
    sqlResponses.push([]); // UPDATE song_pipeline_runs (commit del CAS del webhook)
    const doneStemsPhases = structuredClone(phases);
    doneStemsPhases.stems = {
      status: 'done',
      tracks: {
        lead: 'song-1/stems/lead.mp3',
        backing: 'song-1/stems/backing.mp3',
        vocals: 'song-1/stems/vocals.mp3',
      },
    };
    sqlResponses.push([{ phases: doneStemsPhases }]); // advanceNextPhase: claim
    sqlResponses.push([]); // marca transcription 'running'

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'leadBacking',
        result: {
          status: 'done',
          model: 'karaoke',
          outputs: {
            lead: 'song-1/stems/lead.mp3',
            backing: 'song-1/stems/backing.mp3',
            vocals: 'song-1/stems/vocals.mp3',
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.filter((c) => c.text.includes('INSERT INTO song_stems')).length).toBe(3);
    expect(dispatchPhaseMock).toHaveBeenCalledWith('transcription', expect.anything());
  });

  it('voiceInstrumental done con outputs vacíos → partial, sin upsert de song_stems ni advance', async () => {
    const phases = initialPhases();
    phases.stems.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs (sin tracks que insertar)

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'voiceInstrumental',
        result: { status: 'done', model: 'x', outputs: {} },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_stems'))).toBe(false);
    expect(dispatchPhaseMock).not.toHaveBeenCalled();
  });

  it('gender done con outputs.chorus:{male,female} → publica song_stems kind=male y kind=female (no "chorus")', async () => {
    const phases = initialPhases();
    phases.stems.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // insert song_stems male
    sqlResponses.push([]); // insert song_stems female
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'gender',
        result: {
          status: 'done',
          model: 'chorus_bs_roformer',
          outputs: { chorus: { male: 'song-1/stems/male.mp3', female: 'song-1/stems/female.mp3' } },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const inserts = sqlCalls.filter((c) => c.text.includes('INSERT INTO song_stems'));
    expect(inserts.length).toBe(2);
    const kinds = inserts.map((c) => c.values[1]).sort();
    expect(kinds).toEqual(['female', 'male']);
    expect(kinds).not.toContain('chorus');
  });

  it("voiceInstrumental done con 'vocals' en outputs → NO publica song_stems.kind='vocals' (filtrado por STEM_KINDS)", async () => {
    const phases = initialPhases();
    phases.stems.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // insert song_stems instrumental
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'voiceInstrumental',
        result: {
          status: 'done',
          model: 'ep_317+demucs',
          outputs: {
            vocals: 'song-1/stems/vocals.mp3',
            instrumental: 'song-1/stems/instrumental.mp3',
          },
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const inserts = sqlCalls.filter((c) => c.text.includes('INSERT INTO song_stems'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].values[1]).toBe('instrumental');
  });

  it('leadBacking failed → fase stems queda failed', async () => {
    const phases = initialPhases();
    phases.stems.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'leadBacking',
        result: { status: 'failed', model: 'karaoke', outputs: {} },
        error: 'boom',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const upd = sqlCalls.find((c) => c.text.includes('UPDATE song_pipeline_runs'));
    const phasesArg = upd.values.find((v) => v && typeof v === 'object' && v.stems);
    expect(phasesArg.stems.status).toBe('failed');
    expect(dispatchPhaseMock).not.toHaveBeenCalled();
  });

  it('gender failed → ignorado (200), la fase stems no falla', async () => {
    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'gender',
        result: { status: 'failed', model: 'x', outputs: {} },
        error: 'sin género detectado',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(sqlCalls.length).toBe(0); // ni siquiera llega al CAS: adapter la ignora antes
  });

  it('sección desconocida → 400', async () => {
    const res = makeRes();
    await handler(
      signedReq({ jobId: 'run-1', section: 'unknown', result: { status: 'done', outputs: {} } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/pipeline/webhook — structure (SongFormer)', () => {
  it('structure done (payload.segments) → upsert song_structure y fase done', async () => {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.structure.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // upsert song_structure
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'structure',
        ok: true,
        payload: {
          segments: [{ label: 'coro', startMs: 64200, endMs: 105800 }],
          model: 'songformer',
        },
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    const upsert = sqlCalls.find((c) => c.text.includes('INSERT INTO song_structure'));
    expect(upsert).toBeDefined();
    expect(upsert.text).toContain('ON CONFLICT');
    const phasesArg = sqlCalls
      .find((c) => c.text.includes('UPDATE song_pipeline_runs'))
      .values.find((v) => v && typeof v === 'object' && v.structure);
    expect(phasesArg.structure.status).toBe('done');
  });

  it('structure failed (sección de stems) → fase structure queda failed, sin upsert', async () => {
    const phases = initialPhases();
    phases.structure.status = 'running';
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    const res = makeRes();
    await handler(
      signedReq({
        jobId: 'run-1',
        section: 'structure',
        result: { status: 'failed', model: 'songformer' },
        error: 'timeout de inferencia',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(sqlCalls.some((c) => c.text.includes('INSERT INTO song_structure'))).toBe(false);
    const phasesArg = sqlCalls
      .find((c) => c.text.includes('UPDATE song_pipeline_runs'))
      .values.find((v) => v && typeof v === 'object' && v.structure);
    expect(phasesArg.structure.status).toBe('failed');
    expect(phasesArg.structure.error).toBe('timeout de inferencia');
  });
});

describe('applyPipelinePhaseEvent — CAS directo (reuso B7)', () => {
  it('run inexistente → null', async () => {
    sqlResponses.push([]);
    const outcome = await applyPipelinePhaseEvent(sqlMock, 'run-x', { phase: 'stems', ok: true });
    expect(outcome).toBeNull();
  });
});

describe('applyPipelinePhaseEvent — durationSec server-side (Task 7)', () => {
  it('evento stems con durationSec + input_meta sin durationSec → lo persiste', async () => {
    sqlResponses.push([runRow({ inputMeta: { filename: 'cancion.mp3' } })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    await applyPipelinePhaseEvent(sqlMock, 'run-1', {
      phase: 'stems',
      ok: true,
      partial: false,
      tracks: {},
      durationSec: 252.1,
    });

    const updateCall = sqlCalls.find(
      (c) => c.text.includes('UPDATE song_pipeline_runs') && c.text.includes('input_meta'),
    );
    expect(updateCall).toBeDefined();
    const mergedMeta = updateCall.values.find(
      (v) => v && typeof v === 'object' && 'durationSec' in v,
    );
    expect(mergedMeta).toEqual({ durationSec: 252.1 });
  });

  it('evento stems con durationSec pero input_meta.durationSec ya presente → NO lo pisa', async () => {
    sqlResponses.push([runRow({ inputMeta: { filename: 'cancion.mp3', durationSec: 187 } })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    await applyPipelinePhaseEvent(sqlMock, 'run-1', {
      phase: 'stems',
      ok: true,
      partial: false,
      tracks: {},
      durationSec: 252.1,
    });

    const updateCall = sqlCalls.find(
      (c) => c.text.includes('UPDATE song_pipeline_runs') && c.text.includes('input_meta'),
    );
    expect(updateCall).toBeUndefined();
  });

  it('evento stems sin durationSec → no toca input_meta', async () => {
    sqlResponses.push([runRow({ inputMeta: { filename: 'cancion.mp3' } })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs

    await applyPipelinePhaseEvent(sqlMock, 'run-1', {
      phase: 'stems',
      ok: true,
      partial: true,
      tracks: {},
    });

    const updateCall = sqlCalls.find(
      (c) => c.text.includes('UPDATE song_pipeline_runs') && c.text.includes('input_meta'),
    );
    expect(updateCall).toBeUndefined();
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negativo', -1],
  ])(
    'evento stems con durationSec no valido (%s) → NO lo persiste (misma regla que confirm.js)',
    async (_label, durationSec) => {
      sqlResponses.push([runRow({ inputMeta: { filename: 'cancion.mp3' } })]); // SELECT FOR UPDATE
      sqlResponses.push([]); // UPDATE song_pipeline_runs

      await applyPipelinePhaseEvent(sqlMock, 'run-1', {
        phase: 'stems',
        ok: true,
        partial: false,
        tracks: {},
        durationSec,
      });

      const updateCall = sqlCalls.find(
        (c) => c.text.includes('UPDATE song_pipeline_runs') && c.text.includes('input_meta'),
      );
      expect(updateCall).toBeUndefined();
    },
  );
});

// La app Modal hkn-pitch anterior al fix 69dd37f (y cualquier webhook tardío
// suyo) correlaciona con el jobId versionado en vez del runId. Ese valor iba
// directo al WHERE id = ${runId} de una columna uuid -> 22P02 -> 500, y el
// evento se perdía dejando la fase colgada (incidente 28-jul).
describe('POST /api/pipeline/webhook — retry automático (Tarea 4)', () => {
  function transcriptionRunningPhases(overrides = {}) {
    const phases = initialPhases();
    phases.upload.status = 'done';
    phases.stems.status = 'done';
    phases.stems.tracks = { vocals: 'song-1/stems/vocals.mp3' };
    phases.transcription = {
      status: 'running',
      error: null,
      retries: 0,
      autoRetries: 0,
      ...overrides,
    };
    return phases;
  }

  it('evento ok:false transitorio → re-dispatch inmediato (auto:true)', async () => {
    const phases = transcriptionRunningPhases();
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE (webhook CAS)
    sqlResponses.push([]); // UPDATE song_pipeline_runs (commit CAS, marca failed)

    const failedPhases = structuredClone(phases);
    failedPhases.transcription = {
      ...phases.transcription,
      status: 'failed',
      error: 'connection reset',
    };
    sqlResponses.push([{ phases: failedPhases, autoRetries: 0 }]); // maybeAutoRetry: SELECT plano

    sqlResponses.push([runRow({ phases: failedPhases, status: 'processing' })]); // retryPhase: claim FOR UPDATE
    sqlResponses.push([]); // retryPhase: UPDATE (auto:true)

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'transcription',
        ok: false,
        error: 'connection reset',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(dispatchPhaseMock).toHaveBeenCalledWith(
      'transcription',
      expect.anything(),
      expect.objectContaining({ isRetry: true }),
    );
    expect(sqlCalls.some((c) => c.text.includes('next_retry_at = now()'))).toBe(false);
  });

  it('evento ok:false con OOM (permanente) → no re-dispatch', async () => {
    const phases = transcriptionRunningPhases();
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs (commit CAS)

    const failedPhases = structuredClone(phases);
    failedPhases.transcription = {
      ...phases.transcription,
      status: 'failed',
      error: 'CUDA out of memory',
    };
    sqlResponses.push([{ phases: failedPhases, autoRetries: 0 }]); // maybeAutoRetry: SELECT plano

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'transcription',
        ok: false,
        error: 'CUDA out of memory',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(dispatchPhaseMock).not.toHaveBeenCalled();
    expect(sqlCalls.filter((c) => c.text.includes('UPDATE song_pipeline_runs')).length).toBe(1);
  });

  it('segundo fallo transitorio de la misma fase (autoRetries ya en 1) → no re-dispatch, programa next_retry_at', async () => {
    const phases = transcriptionRunningPhases({ retries: 1, autoRetries: 1 });
    sqlResponses.push([runRow({ phases })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // UPDATE song_pipeline_runs (commit CAS)

    const failedPhases = structuredClone(phases);
    failedPhases.transcription = {
      ...phases.transcription,
      status: 'failed',
      error: 'connection reset',
    };
    sqlResponses.push([{ phases: failedPhases, autoRetries: 1 }]); // maybeAutoRetry: SELECT plano
    sqlResponses.push([]); // UPDATE next_retry_at

    const res = makeRes();
    await handler(
      signedReq({
        runId: 'run-1',
        phase: 'transcription',
        ok: false,
        error: 'connection reset',
      }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(dispatchPhaseMock).not.toHaveBeenCalled();
    expect(sqlCalls.some((c) => c.text.includes('next_retry_at = now()'))).toBe(true);
  });
});

describe('POST /api/pipeline/webhook — runId versionado por ciclo de letra', () => {
  it('normaliza `runId:snapshotHash` al runId plano antes de consultar', async () => {
    const phases = initialPhases();
    phases.lyrics_review.status = 'done';
    phases.pitch.status = 'running';
    sqlResponses.push([runRow({ phases, status: 'running' })]); // SELECT FOR UPDATE
    sqlResponses.push([]); // publicación / UPDATE

    await applyPipelinePhaseEvent(sqlMock, 'run-1:d1e2f3', {
      phase: 'pitch',
      ok: false,
      error: 'boom',
    });

    const select = sqlCalls.find((c) => c.text.includes('FROM song_pipeline_runs'));
    expect(select.values).toContain('run-1');
    expect(select.values).not.toContain('run-1:d1e2f3');
  });
});
