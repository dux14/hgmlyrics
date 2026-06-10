import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveAvatar, loadAvatar } from '../../src/lib/worldAvatarStore.js';

// ---- Helpers para construir fakes chainables de Supabase ----

/**
 * Crea un fake de supabase.storage.from() que espía upload y getPublicUrl.
 * @param {{ uploadResult?: object, publicUrl?: string }} opts
 */
function makeStorageFake({
  uploadResult = { data: {}, error: null },
  publicUrl = 'https://cdn/avatars/u1.png',
} = {}) {
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl } });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
  return { storage: { from }, _spies: { from, upload, getPublicUrl } };
}

/**
 * Crea un fake de supabase.from() chainable para tabla world_avatars.
 * @param {{ upsertResult?: object, selectResult?: object }} opts
 */
function makeDbFake({
  upsertResult = { error: null },
  selectResult = { data: { config: { color: '#f00' } }, error: null },
} = {}) {
  // Para upsert: supabase.from('world_avatars').upsert(...)
  const upsert = vi.fn().mockResolvedValue(upsertResult);

  // Para select: supabase.from('world_avatars').select('config').eq('uid', uid).maybeSingle()
  const maybeSingle = vi.fn().mockResolvedValue(selectResult);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  const from = vi.fn().mockReturnValue({ upsert, select });
  return { from, _spies: { from, upsert, select, eq, maybeSingle } };
}

// ---- Tests de saveAvatar ----

describe('saveAvatar', () => {
  let storageFake;
  let dbFake;
  let supabase;
  const user = { id: 'u1' };
  const config = { color: '#f00', shape: 'circle' };
  const blob = new Blob(['fake-png'], { type: 'image/png' });

  beforeEach(() => {
    storageFake = makeStorageFake();
    dbFake = makeDbFake();
    supabase = { ...storageFake, ...dbFake };
  });

  it('sube el blob al path {uid}.png en bucket avatars con upsert', async () => {
    await saveAvatar({ supabase, user, config, blob });

    expect(storageFake._spies.from).toHaveBeenCalledWith('avatars');
    expect(storageFake._spies.upload).toHaveBeenCalledWith('u1.png', blob, {
      upsert: true,
      contentType: 'image/png',
    });
  });

  it('hace upsert de { uid, config } en world_avatars', async () => {
    await saveAvatar({ supabase, user, config, blob });

    expect(dbFake._spies.from).toHaveBeenCalledWith('world_avatars');
    expect(dbFake._spies.upsert).toHaveBeenCalledWith({ uid: 'u1', config });
  });

  it('devuelve { uid } del usuario', async () => {
    const result = await saveAvatar({ supabase, user, config, blob });
    expect(result).toEqual({ uid: 'u1' });
  });

  it('lanza si el upload devuelve error', async () => {
    const uploadError = new Error('storage quota exceeded');
    const failStorage = makeStorageFake({ uploadResult: { data: null, error: uploadError } });
    const failSupabase = { ...failStorage, ...dbFake };

    await expect(saveAvatar({ supabase: failSupabase, user, config, blob })).rejects.toThrow(
      'storage quota exceeded',
    );
  });

  it('lanza si el upsert de tabla devuelve error', async () => {
    const dbError = new Error('unique constraint violated');
    const failDb = makeDbFake({ upsertResult: { error: dbError } });
    const failSupabase = { ...storageFake, ...failDb };

    await expect(saveAvatar({ supabase: failSupabase, user, config, blob })).rejects.toThrow(
      'unique constraint violated',
    );
  });
});

// ---- Tests de loadAvatar ----

describe('loadAvatar', () => {
  it('devuelve config + url publica cuando existe la fila', async () => {
    const storageFake = makeStorageFake({ publicUrl: 'https://cdn/avatars/u2.png' });
    const dbFake = makeDbFake({
      selectResult: { data: { config: { color: '#0f0' } }, error: null },
    });
    const supabase = { ...storageFake, ...dbFake };

    const result = await loadAvatar({ supabase, uid: 'u2' });

    expect(result).toEqual({
      config: { color: '#0f0' },
      url: 'https://cdn/avatars/u2.png',
    });
    expect(storageFake._spies.getPublicUrl).toHaveBeenCalledWith('u2.png');
    expect(dbFake._spies.eq).toHaveBeenCalledWith('uid', 'u2');
  });

  it('devuelve null cuando no hay fila (data es null)', async () => {
    const storageFake = makeStorageFake();
    const dbFake = makeDbFake({ selectResult: { data: null, error: null } });
    const supabase = { ...storageFake, ...dbFake };

    const result = await loadAvatar({ supabase, uid: 'u3' });

    expect(result).toBeNull();
  });

  it('propaga error de query si lo hay', async () => {
    const queryError = new Error('permission denied');
    const storageFake = makeStorageFake();
    const dbFake = makeDbFake({ selectResult: { data: null, error: queryError } });
    const supabase = { ...storageFake, ...dbFake };

    await expect(loadAvatar({ supabase, uid: 'u4' })).rejects.toThrow('permission denied');
  });
});
