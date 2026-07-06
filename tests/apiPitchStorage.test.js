import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock de @supabase/supabase-js: capturamos los args de createSignedUploadUrl.
const mockCreateSignedUploadUrl = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: mockCreateSignedUploadUrl,
      }),
    },
  }),
}));

// storage.js exige SUPABASE_URL/SERVICE_ROLE_KEY en import time.
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

const { createPitchSignedPutUrl, createPitchUploadUrl } =
  await import('../api/pitch/_lib/storage.js');

describe('pitch storage — PUT firmado del pipeline', () => {
  beforeEach(() => mockCreateSignedUploadUrl.mockReset());

  it('createPitchSignedPutUrl pasa { upsert: true } para poder sobrescribir en re-runs/retry', async () => {
    // Regresión del 400 "The resource already exists": el nodo Modal reusa el
    // mismo jobId (mismo prefijo de storage) y debe poder re-subir su artefacto.
    mockCreateSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed/put' },
      error: null,
    });
    const url = await createPitchSignedPutUrl('u1/j1/stems/lead.wav');
    expect(url).toBe('https://signed/put');
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('u1/j1/stems/lead.wav', {
      upsert: true,
    });
  });

  it('propaga el error del storage (withErrors lo mapea a su .status)', async () => {
    const err = Object.assign(new Error('The resource already exists'), {
      status: 400,
      name: 'StorageApiError',
    });
    mockCreateSignedUploadUrl.mockResolvedValue({ data: null, error: err });
    await expect(createPitchSignedPutUrl('u1/j1/stems/lead.wav')).rejects.toBe(err);
  });

  it('createPitchUploadUrl (input del browser, jobId nuevo) NO fuerza upsert', async () => {
    mockCreateSignedUploadUrl.mockResolvedValue({ data: { path: 'p', token: 't' }, error: null });
    await createPitchUploadUrl('u1/j1/input/audio');
    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('u1/j1/input/audio');
  });
});
