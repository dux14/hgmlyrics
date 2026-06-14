import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
}));

const { createList } = await import('../src/lib/lists.js');

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ id: 'c1' }) }));
});

describe('createList', () => {
  it('envía parent_id cuando se pasa', async () => {
    await createList('Ensayo', '2026-06-18T00:00:00Z', 'evt1');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      name: 'Ensayo',
      expires_at: '2026-06-18T00:00:00Z',
      parent_id: 'evt1',
    });
  });

  it('parent_id es null cuando no se pasa', async () => {
    await createList('Lista', '2026-06-18T00:00:00Z');
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.parent_id).toBeNull();
  });
});
