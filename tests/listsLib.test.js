// tests/listsLib.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  },
}));

const fetchCalls = [];
global.fetch = vi.fn(async (url, opts) => {
  fetchCalls.push({ url, opts });
  return { ok: true, status: 200, json: async () => ({ count: 2 }) };
});

import {
  setListItems,
  setActiveContext,
  getAdjacentInList,
  getActiveContext,
} from '../src/lib/lists.js';

beforeEach(() => {
  fetchCalls.length = 0;
  setActiveContext(null);
});

describe('setListItems', () => {
  it('hace PUT /api/lists/:id/songs con items tipados', async () => {
    await setListItems('l1', [
      { item_type: 'song', item_id: 's1' },
      { item_type: 'weekly_word', item_id: 'ww1' },
    ]);
    const call = fetchCalls[0];
    expect(call.url).toBe('/api/lists/l1/songs');
    const body = JSON.parse(call.opts.body);
    expect(body.items).toHaveLength(2);
    expect(body.items[1].item_type).toBe('weekly_word');
  });
});

describe('setActiveContext + getAdjacentInList (typed)', () => {
  it('navega entre items de tipo mixto con orderedItems', () => {
    setActiveContext({
      listId: 'l1',
      name: 'Lista mixta',
      orderedItems: [
        { item_type: 'song', item_id: 's1' },
        { item_type: 'weekly_word', item_id: 'ww1' },
        { item_type: 'song', item_id: 's2' },
      ],
    });
    const adj = getAdjacentInList('l1', 'weekly_word', 'ww1');
    expect(adj.prev).toEqual({ item_type: 'song', item_id: 's1' });
    expect(adj.next).toEqual({ item_type: 'song', item_id: 's2' });
    expect(adj.currentIndex).toBe(1);
    expect(adj.total).toBe(3);
  });

  it('devuelve null si no corresponde al listId', () => {
    setActiveContext({ listId: 'otro', name: 'X', orderedItems: [] });
    expect(getAdjacentInList('l1', 'song', 's1')).toBeNull();
  });
});
