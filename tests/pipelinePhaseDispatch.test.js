/**
 * pipelinePhaseDispatch.test.js — reconciliación B7-1: `dispatchPhase`
 * (api/songs/[id]/pipeline/_dispatch.js) debe armar dbLines/canonicalLines/
 * snapshotHash reales antes de llamar a dispatchTranscribe/dispatchPitch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_lib/storage.js', () => ({
  pipelineStemKey: (songId, kind) => `${songId}/stems/${kind}.mp3`,
  createSongAudioSignedPutUrl: vi.fn(async (key) => `https://signed/put/${key}`),
  signSongAudioDownload: vi.fn(async (key) => `https://signed/get/${key}`),
}));
vi.mock('../api/_lib/pipeline/dispatch.js', () => ({
  dispatchStems: vi.fn(async () => ({ id: 'stems-call' })),
  dispatchTranscribe: vi.fn(async () => ({ id: 'transcribe-call' })),
  dispatchAlign: vi.fn(async () => ({ id: 'align-call' })),
  dispatchPitch: vi.fn(async () => ({ id: 'pitch-call' })),
  dispatchClips: vi.fn(async () => ({ id: 'clips-call' })),
}));

let sqlResponses = [];
function sqlMock() {
  return Promise.resolve(sqlResponses.shift() ?? []);
}
sqlMock.json = (v) => v;
vi.mock('../api/_lib/db.js', () => ({ default: sqlMock }));

process.env.PUBLIC_BASE_URL = 'https://hgmlyrics.vercel.app';

const { dispatchPhase } = await import('../api/songs/[id]/pipeline/_dispatch.js');
const { dispatchTranscribe, dispatchAlign, dispatchPitch, dispatchClips } = await import(
  '../api/_lib/pipeline/dispatch.js'
);

const SANTO_SECTIONS = [
  { type: 'verse', lines: [{ text: 'Santo, Santo, Santo' }, { text: '(instrumental)', annotation: true }] },
  { type: 'chorus', lines: [{ text: 'Es el Señor' }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  sqlResponses = [];
});

describe("dispatchPhase('transcription')", () => {
  it('arma dbLines desde songs.sections y pasa runId/vocalsGetUrl con nombres correctos', async () => {
    sqlResponses.push([{ sections: SANTO_SECTIONS }]); // SELECT sections FROM songs (dbLinesFor)
    sqlResponses.push([]); // SELECT content FROM song_lyrics_canonical (sin fila)

    const run = {
      id: 'run1',
      songId: 'song1',
      phases: { stems: { tracks: { vocals: 'song1/stems/vocals.mp3' } } },
    };
    await dispatchPhase('transcription', run);

    expect(dispatchTranscribe).toHaveBeenCalledTimes(1);
    const args = dispatchTranscribe.mock.calls[0][0];
    expect(args.run).toEqual({ id: 'run1', songId: 'song1' });
    expect(args.vocalsGetUrl).toBe('https://signed/get/song1/stems/vocals.mp3');
    expect(args.dbLines).toEqual(['Santo, Santo, Santo', 'Es el Señor']);
    expect(args.canonicalLines).toBeUndefined();
    expect(args.webhookUrl).toBe('https://hgmlyrics.vercel.app/api/pipeline/webhook');
  });

  it('canonicalLines se aplana desde song_lyrics_canonical.content cuando existe fila', async () => {
    sqlResponses.push([{ sections: SANTO_SECTIONS }]);
    sqlResponses.push([{ content: { secciones: [{ lineas: [{ texto: 'Santo Santo Santo' }, { texto: 'Es el Señor' }] }] } }]);

    const run = { id: 'run1', songId: 'song1', phases: { stems: { tracks: { vocals: 'k' } } } };
    await dispatchPhase('transcription', run);

    const args = dispatchTranscribe.mock.calls[0][0];
    expect(args.canonicalLines).toEqual(['Santo Santo Santo', 'Es el Señor']);
  });

  it("409 si la fase 'stems' no publicó pista vocals", async () => {
    const run = { id: 'run1', songId: 'song1', phases: { stems: { tracks: {} } } };
    await expect(dispatchPhase('transcription', run)).rejects.toMatchObject({ status: 409 });
    expect(dispatchTranscribe).not.toHaveBeenCalled();
  });
});

describe("dispatchPhase('pitch')", () => {
  it('pasa snapshotHash desde run.lyricsReview.approvedHash cuando está presente', async () => {
    const run = {
      id: 'run1',
      songId: 'song1',
      phases: { stems: { tracks: { lead: 'song1/stems/lead.mp3', backing: 'song1/stems/backing.mp3' } } },
      lyricsReview: { approvedHash: 'hash123' },
    };
    await dispatchPhase('pitch', run);

    expect(dispatchPitch).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotHash: 'hash123' }),
    );
  });

  it('sin lyricsReview → snapshotHash undefined, no rompe', async () => {
    const run = {
      id: 'run1',
      songId: 'song1',
      phases: { stems: { tracks: { lead: 'l', backing: 'b' } } },
    };
    await dispatchPhase('pitch', run);
    const args = dispatchPitch.mock.calls[0][0];
    expect(args.snapshotHash).toBeUndefined();
  });
});

describe("dispatchPhase('sync')", () => {
  it('pasa snapshotHash desde run.lyricsReview.approvedHash cuando está presente', async () => {
    const run = { id: 'run1', songId: 'song1', phases: {}, lyricsReview: { approvedHash: 'hash123' } };
    await dispatchPhase('sync', run);
    expect(dispatchAlign).toHaveBeenCalledWith('song1', 'hash123');
  });

  it('sin lyricsReview (karaoke) → snapshotHash undefined, no rompe', async () => {
    const run = { id: 'run1', songId: 'song1', phases: {} };
    await dispatchPhase('sync', run);
    expect(dispatchAlign).toHaveBeenCalledWith('song1', undefined);
  });
});

// Snapshot con un coro repetido (lines:null, no aporta líneas canónicas) para
// verificar que projectLineSections lo salta igual que projectCanonicalLines.
const CLIPS_SECTIONS = [
  { type: 'verse', lines: [{ text: 'A' }, { text: '(instrumental)', annotation: true }, { text: 'B' }] },
  { type: 'chorus', lines: [{ text: 'C' }] },
  { type: 'chorus', lines: null },
  { type: 'verse', lines: [{ text: 'D' }] },
];
const CLIPS_LINE_TIMINGS = [
  { i: 0, startMs: 100 },
  { i: 1, startMs: 2100 },
  { i: 2, startMs: 4000 },
  { i: 3, startMs: 6000 },
];

describe("dispatchPhase('clips')", () => {
  it('deriva lineSections de songs.sections (saltando lines:null) y totalMs de song_audio.duration_sec', async () => {
    sqlResponses.push([{ sections: CLIPS_SECTIONS }]); // SELECT sections FROM songs
    sqlResponses.push([{ lines: CLIPS_LINE_TIMINGS }]); // SELECT lines FROM song_line_timings
    sqlResponses.push([{ durationSec: '8.5' }]); // SELECT duration_sec FROM song_audio

    const run = {
      id: 'run1',
      songId: 'song1',
      phases: { stems: { tracks: { vocals: 'song1/stems/vocals.mp3' } } },
    };
    await dispatchPhase('clips', run);

    expect(dispatchClips).toHaveBeenCalledTimes(1);
    const args = dispatchClips.mock.calls[0][0];
    // sectionIndex 0='verse'(A,B), 1='chorus'(C), 2='chorus repetido'(sin lineas), 3='verse'(D)
    expect(args.lineSections).toEqual([0, 0, 1, 3]);
    expect(args.totalMs).toBe(8500);
  });

  it('duration_sec null → totalMs cae al máximo startMs de los line timings', async () => {
    sqlResponses.push([{ sections: CLIPS_SECTIONS }]);
    sqlResponses.push([{ lines: CLIPS_LINE_TIMINGS }]);
    sqlResponses.push([{ durationSec: null }]);

    const run = {
      id: 'run1',
      songId: 'song1',
      phases: { stems: { tracks: { vocals: 'song1/stems/vocals.mp3' } } },
    };
    await dispatchPhase('clips', run);

    const args = dispatchClips.mock.calls[0][0];
    expect(args.totalMs).toBe(6000);
  });
});
