/**
 * studioApiClient.test.js — cliente src/lib/studioApi.js del Estudio de una
 * canción (Task D4a): getSongStudio (200 → objeto, 404 → null, otros → throw).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => ({ access_token: 'tok' })),
}));

import { getSession } from '../src/lib/authStore.js';
import { getSongStudio } from '../src/lib/studioApi.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockReturnValue({ access_token: 'tok' });
  global.fetch = vi.fn();
});

describe('getSongStudio', () => {
  it('200 devuelve el objeto del estudio', async () => {
    const body = { stems: [], analysis: null, sections: [], timings: null, title: 'T' };
    global.fetch.mockResolvedValue(jsonResponse(200, body));
    const result = await getSongStudio('s1');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/studio', {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('404 devuelve null (sin lanzar)', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse(404, { error: 'Esta canción todavía no tiene estudio publicado' }),
    );
    const result = await getSongStudio('s1');
    expect(result).toBeNull();
  });

  it('500 lanza con status', async () => {
    global.fetch.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    await expect(getSongStudio('s1')).rejects.toMatchObject({ status: 500, message: 'boom' });
  });

  it('sin sesión → sin header Authorization', async () => {
    getSession.mockReturnValue(null);
    global.fetch.mockResolvedValue(jsonResponse(200, {}));
    await getSongStudio('s1');
    expect(global.fetch).toHaveBeenCalledWith('/api/songs/s1/studio', { headers: {} });
  });
});
