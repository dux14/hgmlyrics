import { describe, it, expect, beforeEach } from 'vitest';

// storage.js lanza en el top-level si faltan estas vars; ponemos stubs antes del import.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub_service_key';
process.env.REPLICATE_API_TOKEN = 'r8_stub_token';

const { providerFor } = await import('../api/stems/_provider.js');

describe('providerFor', () => {
  beforeEach(() => { delete process.env.STEMS_PROVIDER; delete process.env.STEMS_PROVIDER_KARAOKE; });

  it('default replicate', () => { expect(providerFor('stems')).toBe('replicate'); });
  it('STEMS_PROVIDER=modal aplica a todos', () => {
    process.env.STEMS_PROVIDER = 'modal';
    expect(providerFor('stems')).toBe('modal');
    expect(providerFor('karaoke')).toBe('modal');
    expect(providerFor('diarization')).toBe('modal');
  });
  it('override de karaoke gana sobre el global', () => {
    process.env.STEMS_PROVIDER = 'modal';
    process.env.STEMS_PROVIDER_KARAOKE = 'replicate';
    expect(providerFor('karaoke')).toBe('replicate');
    expect(providerFor('stems')).toBe('modal');
  });
});
