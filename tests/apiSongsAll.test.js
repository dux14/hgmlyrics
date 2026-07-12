import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ default: mockSql }));
vi.mock('../api/_lib/http.js', () => ({
  allowMethods: vi.fn(() => false),
  withErrors: (fn) => fn,
  cachePublic: vi.fn(),
}));

process.env.DATABASE_URL = 'postgresql://test';
const handler = (await import('../api/songs/all.js')).default;

function makeRes() {
  let body = null;
  return {
    status() {
      return this;
    },
    json(data) {
      body = data;
    },
    get body() {
      return body;
    },
  };
}

describe('GET /api/songs/all', () => {
  beforeEach(() => mockSql.mockReset());

  it('incluye voiceRoster y schemaVersion (paridad con /api/songs/:id para offline)', async () => {
    mockSql.mockResolvedValueOnce([
      {
        id: 's1',
        title: 'T',
        sections: [],
        updatedAt: '2026-07-01T00:00:00Z',
        voicePercentMale: 50,
        voicePercentFemale: 50,
        voiceRoster: [{ id: 'v1' }],
        schemaVersion: 2,
      },
    ]);
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.body.songs[0].voiceRoster).toEqual([{ id: 'v1' }]);
    expect(res.body.songs[0].schemaVersion).toBe(2);
    // Verifica que el SELECT realmente pide las columnas (template literal de postgres.js)
    const queryText = mockSql.mock.calls[0][0].join('');
    expect(queryText).toContain('voice_roster');
    expect(queryText).toContain('schema_version');
  });
});
