import { describe, it, expect, vi } from 'vitest';

// AvatarCreator.js transitively imports supabase.js (requires env vars) and
// authStore.js; mock both so the module loads in jsdom without credentials.
vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
    storage: { from: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('../../src/lib/authStore.js', () => ({
  getSession: vi.fn(() => null),
  getProfile: vi.fn(() => null),
  authStore: {},
}));

import { defaultConfig, orderedLayerSources } from '../../src/components/AvatarCreator.js';

// ---------------------------------------------------------------------------
// Manifest fixture inline
// ---------------------------------------------------------------------------

const MANIFEST = {
  version: 1,
  frame: { w: 64, h: 64, cols: 9, rows: 4 },
  rowDir: ['up', 'left', 'down', 'right'],
  bodyTypes: [
    { id: 'male', name: 'Masculino' },
    { id: 'female', name: 'Femenino' },
  ],
  layers: [
    {
      key: 'body',
      name: 'Cuerpo',
      zPos: 10,
      required: true,
      options: [
        {
          id: 'base',
          name: 'Base',
          files: { male: 'lpc/body/base/male.png', female: 'lpc/body/base/female.png' },
        },
      ],
    },
    {
      key: 'legs',
      name: 'Pantalon',
      zPos: 20,
      required: false,
      options: [
        {
          id: 'black',
          name: 'Negro',
          files: { male: 'lpc/legs/black/male.png', female: 'lpc/legs/black/female.png' },
        },
        {
          id: 'blue',
          name: 'Azul',
          files: { male: 'lpc/legs/blue/male.png', female: 'lpc/legs/blue/female.png' },
        },
      ],
    },
    {
      key: 'torso',
      name: 'Camiseta',
      zPos: 35,
      required: false,
      options: [
        {
          id: 'shortsleeve',
          name: 'Manga corta',
          files: {
            male: 'lpc/torso/shortsleeve/male.png',
            female: 'lpc/torso/shortsleeve/female.png',
          },
        },
      ],
    },
    {
      key: 'hair',
      name: 'Pelo',
      zPos: 120,
      required: false,
      options: [
        {
          id: 'plain',
          name: 'Liso',
          files: { male: 'lpc/hair/plain.png', female: 'lpc/hair/plain.png' },
        },
        {
          id: 'long',
          name: 'Largo',
          files: { male: 'lpc/hair/long.png', female: 'lpc/hair/long.png' },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// defaultConfig
// ---------------------------------------------------------------------------

describe('defaultConfig', () => {
  it('usa el primer bodyType del manifest', () => {
    const cfg = defaultConfig(MANIFEST);
    expect(cfg.bodyType).toBe('male');
  });

  it('selecciona la primera opcion para capas required', () => {
    const cfg = defaultConfig(MANIFEST);
    expect(cfg.layers.body).toBe('base');
  });

  it('deja null las capas no-required', () => {
    const cfg = defaultConfig(MANIFEST);
    expect(cfg.layers.legs).toBeNull();
    expect(cfg.layers.torso).toBeNull();
    expect(cfg.layers.hair).toBeNull();
  });

  it('incluye todas las claves de capas del manifest', () => {
    const cfg = defaultConfig(MANIFEST);
    const keys = Object.keys(cfg.layers).sort();
    expect(keys).toEqual(['body', 'hair', 'legs', 'torso']);
  });

  it('manifest con un solo bodyType lo usa como default', () => {
    const m = { ...MANIFEST, bodyTypes: [{ id: 'female', name: 'Femenino' }] };
    const cfg = defaultConfig(m);
    expect(cfg.bodyType).toBe('female');
  });
});

// ---------------------------------------------------------------------------
// orderedLayerSources
// ---------------------------------------------------------------------------

describe('orderedLayerSources', () => {
  it('devuelve body siempre cuando tiene seleccion', () => {
    const cfg = { bodyType: 'male', layers: { body: 'base', legs: null, torso: null, hair: null } };
    const sources = orderedLayerSources(cfg, MANIFEST);
    expect(sources.some((s) => s.key === 'body')).toBe(true);
  });

  it('resuelve la URL como /world/<file> para bodyType male', () => {
    const cfg = { bodyType: 'male', layers: { body: 'base', legs: null, torso: null, hair: null } };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const body = sources.find((s) => s.key === 'body');
    expect(body.url).toBe('/world/lpc/body/base/male.png');
  });

  it('resuelve la URL correcta para bodyType female', () => {
    const cfg = {
      bodyType: 'female',
      layers: { body: 'base', legs: 'black', torso: null, hair: null },
    };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const body = sources.find((s) => s.key === 'body');
    expect(body.url).toBe('/world/lpc/body/base/female.png');
    const legs = sources.find((s) => s.key === 'legs');
    expect(legs.url).toBe('/world/lpc/legs/black/female.png');
  });

  it('salta capas con seleccion null', () => {
    const cfg = { bodyType: 'male', layers: { body: 'base', legs: null, torso: null, hair: null } };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const keys = sources.map((s) => s.key);
    expect(keys).not.toContain('legs');
    expect(keys).not.toContain('torso');
    expect(keys).not.toContain('hair');
  });

  it('incluye capas seleccionadas distintas de null', () => {
    const cfg = {
      bodyType: 'male',
      layers: { body: 'base', legs: 'blue', torso: 'shortsleeve', hair: 'plain' },
    };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const keys = sources.map((s) => s.key);
    expect(keys).toContain('body');
    expect(keys).toContain('legs');
    expect(keys).toContain('torso');
    expect(keys).toContain('hair');
  });

  it('ordena por zPos ascendente (body < legs < torso < hair)', () => {
    const cfg = {
      bodyType: 'male',
      layers: { body: 'base', legs: 'black', torso: 'shortsleeve', hair: 'long' },
    };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const zPositions = sources.map((s) => s.zPos);
    expect(zPositions).toEqual([...zPositions].sort((a, b) => a - b));
  });

  it('el orden de keys resultante es body, legs, torso, hair (zPos 10,20,35,120)', () => {
    const cfg = {
      bodyType: 'male',
      layers: { body: 'base', legs: 'black', torso: 'shortsleeve', hair: 'plain' },
    };
    const sources = orderedLayerSources(cfg, MANIFEST);
    expect(sources.map((s) => s.key)).toEqual(['body', 'legs', 'torso', 'hair']);
  });

  it('cambiar bodyType cambia las URLs resueltas', () => {
    const cfgMale = {
      bodyType: 'male',
      layers: { body: 'base', legs: null, torso: null, hair: null },
    };
    const cfgFemale = {
      bodyType: 'female',
      layers: { body: 'base', legs: null, torso: null, hair: null },
    };

    const srcMale = orderedLayerSources(cfgMale, MANIFEST);
    const srcFemale = orderedLayerSources(cfgFemale, MANIFEST);

    expect(srcMale[0].url).toBe('/world/lpc/body/base/male.png');
    expect(srcFemale[0].url).toBe('/world/lpc/body/base/female.png');
    expect(srcMale[0].url).not.toBe(srcFemale[0].url);
  });

  it('devuelve array vacio si todas las capas son null y no hay required', () => {
    // Manifest sin capas required
    const m = {
      ...MANIFEST,
      layers: MANIFEST.layers.map((l) => ({ ...l, required: false })),
    };
    const cfg = { bodyType: 'male', layers: { body: null, legs: null, torso: null, hair: null } };
    const sources = orderedLayerSources(cfg, m);
    expect(sources).toHaveLength(0);
  });

  it('expone el zPos de cada entrada', () => {
    const cfg = {
      bodyType: 'male',
      layers: { body: 'base', legs: 'black', torso: null, hair: null },
    };
    const sources = orderedLayerSources(cfg, MANIFEST);
    const body = sources.find((s) => s.key === 'body');
    const legs = sources.find((s) => s.key === 'legs');
    expect(body.zPos).toBe(10);
    expect(legs.zPos).toBe(20);
  });
});
