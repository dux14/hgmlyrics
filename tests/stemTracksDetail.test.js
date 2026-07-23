// @vitest-environment jsdom
// tests/stemTracksDetail.test.js — conservar el setup/mocks de entorno ya
// existentes en este archivo; reemplazar los casos por el contrato multitrack.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMultiTrackPlayer = vi.fn(() => ({
  el: Object.assign(document.createElement('div'), { className: 'mtp' }),
  destroy: vi.fn(),
  onTime: vi.fn(() => () => {}),
  seek: vi.fn(),
}));
vi.mock('../src/components/pipeline/MultiTrackPlayer.js', () => ({
  createMultiTrackPlayer: (...args) => createMultiTrackPlayer(...args),
}));

const { createStemTracksDetail } = await import(
  '../src/components/pipeline/StemTracksDetail.js'
);

function runWith(tracks, extra = {}) {
  return { phases: { stems: { status: 'done', tracks } }, structure: { segments: [] }, ...extra };
}

beforeEach(() => createMultiTrackPlayer.mockClear());

describe('StemTracksDetail multipista', () => {
  it('monta MultiTrackPlayer con los tracks disponibles y la estructura del run', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    const structure = { segments: [{ label: 'coro', startMs: 0, endMs: 1000 }] };
    d.update({ phases: { stems: { status: 'done', tracks: { lead: 'u1', backing: 'u2' } } }, structure });
    expect(createMultiTrackPlayer).toHaveBeenCalledTimes(1);
    const arg = createMultiTrackPlayer.mock.calls[0][0];
    expect(arg.tracks).toEqual([
      { kind: 'lead', url: 'u1', label: 'Voz principal', durationSec: null },
      { kind: 'backing', url: 'u2', label: 'Coros', durationSec: null },
    ]);
    expect(arg.structure).toBe(structure);
    expect(d.el.querySelector('.mtp')).toBeTruthy();
  });

  it('NO recrea el player si solo cambian las URLs firmadas (misma firma de kinds)', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update(runWith({ lead: 'u1' }));
    d.update(runWith({ lead: 'u1-refirmada' }));
    expect(createMultiTrackPlayer).toHaveBeenCalledTimes(1);
  });

  it('recrea el player (destruyendo el anterior) cuando aparece un kind nuevo', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update(runWith({ lead: 'u1' }));
    const first = createMultiTrackPlayer.mock.results[0].value;
    d.update(runWith({ lead: 'u1', backing: 'u2' }));
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(createMultiTrackPlayer).toHaveBeenCalledTimes(2);
  });

  it('muestra el ecualizador mientras stems corre sin lead/backing y lo quita al terminar', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update({ phases: { stems: { status: 'running', tracks: { vocals: 'u0' } } } });
    expect(d.el.querySelector('.track--eq')).toBeTruthy();
    d.update(runWith({ vocals: 'u0', lead: 'u1', backing: 'u2' }));
    expect(d.el.querySelector('.track--eq')).toBeNull();
  });

  it('agrega la sub-línea de clips cuando clips termina', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update({ phases: { stems: { status: 'done', tracks: { lead: 'u1' } }, clips: { status: 'done' } } });
    expect(d.el.querySelector('.track--clips')).toBeTruthy();
  });

  it('recrea el player cuando la estructura llega después con los mismos kinds', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update({ phases: { stems: { status: 'done', tracks: { lead: 'u1' } } }, structure: { segments: [] } });
    const first = createMultiTrackPlayer.mock.results[0].value;
    d.update({ phases: { stems: { status: 'done', tracks: { lead: 'u1' } } }, structure: { segments: [{ label: 'coro', startMs: 0, endMs: 1000 }] } });
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(createMultiTrackPlayer).toHaveBeenCalledTimes(2);
    expect(createMultiTrackPlayer.mock.calls[1][0].structure.segments).toHaveLength(1);
  });

  it('tolera update(null) y update(undefined) sin lanzar', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    expect(() => d.update(null)).not.toThrow();
    expect(() => d.update(undefined)).not.toThrow();
    expect(createMultiTrackPlayer).not.toHaveBeenCalled();
  });

  it('destroy() destruye el player montado', () => {
    const d = createStemTracksDetail({ songId: 's1' });
    d.update(runWith({ lead: 'u1' }));
    const player = createMultiTrackPlayer.mock.results[0].value;
    d.destroy();
    expect(player.destroy).toHaveBeenCalledTimes(1);
  });
});
