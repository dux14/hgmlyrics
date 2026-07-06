import { it, expect, vi, beforeEach } from 'vitest';
vi.mock('../api/_lib/db.js', () => ({ default: vi.fn() }));
vi.mock('../api/_lib/auth.js', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('../api/pitch/_lib/storage.js', () => ({
  signPitchDownload: vi.fn(async (uri) => `https://signed/${uri}`),
  deletePitchPrefix: vi.fn(async () => {}),
}));
import sql from '../api/_lib/db.js';
import detail from '../api/pitch/jobs/[id].js';
import { makeRes } from './helpers/makeRes.js';
beforeEach(() => vi.clearAllMocks());

const KINDS = ['score_svg', 'score_png', 'midi', 'musicxml'];

it('firma los 4 kinds de render sin allow-list de kind (M2)', async () => {
  const artifacts = KINDS.map((kind) => ({ kind, storage_uri: `u1/j/render/${kind}` }));
  sql.mockImplementation(async () => [
    { id: 'j', user_id: 'u1', status: 'succeeded', phases: {}, artifacts },
  ]);
  const res = makeRes();
  await detail({ method: 'GET', query: { id: 'j' } }, res);
  expect(res.body.artifacts.every((a) => typeof a.url === 'string' && a.url.startsWith('https://signed/'))).toBe(
    true,
  );
});
