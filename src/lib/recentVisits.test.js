// recentVisits.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Estado mutable compartido con las factorías hoisted de vi.mock.
const h = vi.hoisted(() => ({
  session: null,
  selectResult: { data: [], error: null },
  selectCalls: 0,
  upsertCalls: [],
  upsertResult: { error: null },
  authListeners: new Set(),
}));

vi.mock('./supabase.js', () => ({
  supabase: {
    from: (table) => ({
      select: () => {
        h.selectCalls++;
        return {
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve(h.selectResult),
            }),
          }),
        };
      },
      upsert: (rows, opts) => {
        h.upsertCalls.push({ table, rows, opts });
        return Promise.resolve(h.upsertResult);
      },
    }),
  },
}));

vi.mock('./authStore.js', () => ({
  getSession: () => h.session,
  subscribe: (fn) => {
    h.authListeners.add(fn);
    return () => h.authListeners.delete(fn);
  },
}));

import { recordVisit, getRecentVisitIds, initRecentVisits, subscribe } from './recentVisits.js';

const STORAGE_KEY = 'hkn:recent-visits';

function emitAuth(session) {
  h.session = session;
  h.authListeners.forEach((fn) => fn({ session, profile: null, pending: false }));
}

function seedLocal(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

beforeEach(() => {
  localStorage.clear();
  h.session = null;
  h.selectResult = { data: [], error: null };
  h.selectCalls = 0;
  h.upsertCalls = [];
  h.upsertResult = { error: null };
  h.authListeners.clear();
});

describe('recordVisit / getRecentVisitIds (local)', () => {
  it('devuelve los ids del más reciente al más antiguo', () => {
    recordVisit('s1');
    recordVisit('s2');
    recordVisit('s3');
    expect(getRecentVisitIds()).toEqual(['s3', 's2', 's1']);
  });

  it('una visita repetida mueve el id al frente sin duplicarlo', () => {
    recordVisit('s1');
    recordVisit('s2');
    recordVisit('s1');
    expect(getRecentVisitIds()).toEqual(['s1', 's2']);
  });

  it('acota el historial a 24 entradas', () => {
    for (let i = 0; i < 30; i++) recordVisit(`s${i}`);
    const ids = getRecentVisitIds(100);
    expect(ids.length).toBe(24);
    expect(ids[0]).toBe('s29');
  });

  it('ignora songId falsy', () => {
    recordVisit(null);
    recordVisit(undefined);
    recordVisit('');
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('devuelve [] si el JSON almacenado es inválido', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('devuelve [] si el valor almacenado no es un array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 's1' }));
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('ignora entradas corruptas sin id', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ at: 1 }, { id: 's1', at: 2 }]));
    expect(getRecentVisitIds()).toEqual(['s1']);
  });

  it('no explota si localStorage lanza al leer o escribir', () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage bloqueado');
        },
        setItem: () => {
          throw new Error('storage lleno');
        },
      },
    });

    expect(() => recordVisit('s1')).not.toThrow();
    expect(getRecentVisitIds()).toEqual([]);

    Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
  });
});

describe('recordVisit (sync con cuenta)', () => {
  it('sin sesión no toca Supabase', () => {
    recordVisit('s1');
    expect(h.upsertCalls).toEqual([]);
  });

  it('con sesión hace upsert de la visita en recent_visits', () => {
    h.session = { user: { id: 'u1' } };
    recordVisit('s1');
    expect(h.upsertCalls).toHaveLength(1);
    const call = h.upsertCalls[0];
    expect(call.table).toBe('recent_visits');
    expect(call.rows).toMatchObject({ user_id: 'u1', song_id: 's1' });
    expect(typeof call.rows.visited_at).toBe('string');
    expect(call.opts).toMatchObject({ onConflict: 'user_id,song_id' });
  });

  it('un fallo del upsert no rompe el registro local', () => {
    h.session = { user: { id: 'u1' } };
    h.upsertResult = { error: { message: 'network' } };
    expect(() => recordVisit('s1')).not.toThrow();
    expect(getRecentVisitIds()).toEqual(['s1']);
  });
});

describe('initRecentVisits (merge servidor + local)', () => {
  it('sin sesión deja el historial local intacto y no consulta', async () => {
    seedLocal([{ id: 's1', at: 100 }]);
    await initRecentVisits();
    expect(getRecentVisitIds()).toEqual(['s1']);
    expect(h.upsertCalls).toEqual([]);
  });

  it('fusiona lo del servidor con lo local ordenado por fecha', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([
      { id: 'local-new', at: 3000 },
      { id: 'both', at: 1000 },
    ]);
    h.selectResult = {
      data: [
        { song_id: 'both', visited_at: new Date(2000).toISOString() },
        { song_id: 'server-old', visited_at: new Date(500).toISOString() },
      ],
      error: null,
    };
    await initRecentVisits();
    expect(getRecentVisitIds()).toEqual(['local-new', 'both', 'server-old']);
  });

  it('sube al servidor las entradas locales ausentes o más nuevas', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([
      { id: 'local-only', at: 3000 },
      { id: 'local-newer', at: 2500 },
      { id: 'server-newer', at: 100 },
    ]);
    h.selectResult = {
      data: [
        { song_id: 'local-newer', visited_at: new Date(2000).toISOString() },
        { song_id: 'server-newer', visited_at: new Date(1500).toISOString() },
      ],
      error: null,
    };
    await initRecentVisits();
    expect(h.upsertCalls).toHaveLength(1);
    const pushed = h.upsertCalls[0].rows;
    expect(Array.isArray(pushed)).toBe(true);
    expect(pushed.map((r) => r.song_id).sort()).toEqual(['local-newer', 'local-only']);
    expect(pushed.every((r) => r.user_id === 'u1')).toBe(true);
  });

  it('si la consulta falla conserva el historial local', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 's1', at: 100 }]);
    h.selectResult = { data: null, error: { message: 'offline' } };
    await initRecentVisits();
    expect(getRecentVisitIds()).toEqual(['s1']);
  });

  it('al iniciar sesión después del boot sincroniza', async () => {
    await initRecentVisits();
    seedLocal([{ id: 'local', at: 1000 }]);
    h.selectResult = {
      data: [{ song_id: 'server', visited_at: new Date(2000).toISOString() }],
      error: null,
    };
    emitAuth({ user: { id: 'u1' } });
    await vi.waitFor(() => {
      expect(getRecentVisitIds()).toEqual(['server', 'local']);
    });
  });

  it('al cerrar sesión limpia el historial local del dispositivo', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 's1', at: 100 }]);
    await initRecentVisits();
    emitAuth(null);
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('un snapshot sin sesión en boot de invitado NO borra el historial local', async () => {
    seedLocal([{ id: 's1', at: 100 }]);
    await initRecentVisits();
    emitAuth(null);
    expect(getRecentVisitIds()).toEqual(['s1']);
  });

  it('un sync en vuelo no repuebla el historial después de un sign-out (carrera)', async () => {
    await initRecentVisits();

    // Sign-in dispara un sync cuya consulta queda colgada en la red.
    let resolveSelect;
    h.selectResult = new Promise((resolve) => {
      resolveSelect = resolve;
    });
    emitAuth({ user: { id: 'u1' } });

    // Antes de que la consulta resuelva, la cuenta cierra sesión.
    emitAuth(null);
    expect(getRecentVisitIds()).toEqual([]);

    // La consulta vieja resuelve con el historial de la cuenta anterior:
    // no debe volver a escribirse en el cache local.
    resolveSelect({
      data: [{ song_id: 'de-la-cuenta-anterior', visited_at: new Date(2000).toISOString() }],
      error: null,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(getRecentVisitIds()).toEqual([]);
  });

  it('un rechazo de red en el sync no revienta (promesa manejada)', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 's1', at: 100 }]);
    h.selectResult = Promise.reject(new Error('fetch failed'));
    await expect(initRecentVisits()).resolves.toBeUndefined();
    expect(getRecentVisitIds()).toEqual(['s1']);
  });
});

describe('subscribe (canal de cambios del historial)', () => {
  it('notifica cuando el merge del sync cambia el historial', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 'local', at: 1000 }]);
    h.selectResult = {
      data: [{ song_id: 'server', visited_at: new Date(2000).toISOString() }],
      error: null,
    };
    const spy = vi.fn();
    const unsub = subscribe(spy);
    await initRecentVisits();
    expect(spy).toHaveBeenCalled();
    unsub();
  });

  it('no notifica si el merge no altera el historial', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 's1', at: 1000 }]);
    h.selectResult = {
      data: [{ song_id: 's1', visited_at: new Date(1000).toISOString() }],
      error: null,
    };
    const spy = vi.fn();
    const unsub = subscribe(spy);
    await initRecentVisits();
    expect(spy).not.toHaveBeenCalled();
    unsub();
  });

  it('notifica al limpiar el historial en sign-out', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 's1', at: 100 }]);
    await initRecentVisits();
    const spy = vi.fn();
    const unsub = subscribe(spy);
    emitAuth(null);
    expect(spy).toHaveBeenCalled();
    expect(getRecentVisitIds()).toEqual([]);
    unsub();
  });

  it('el unsubscribe devuelto deja de notificar', async () => {
    h.session = { user: { id: 'u1' } };
    seedLocal([{ id: 'local', at: 1000 }]);
    h.selectResult = {
      data: [{ song_id: 'server', visited_at: new Date(2000).toISOString() }],
      error: null,
    };
    const spy = vi.fn();
    subscribe(spy)();
    await initRecentVisits();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('re-sync al volver a primer plano', () => {
  it('al volver la pestaña a visible con sesión vuelve a consultar y fusiona', async () => {
    await initRecentVisits();
    h.session = { user: { id: 'u1' } };
    h.selectCalls = 0;
    h.selectResult = {
      data: [{ song_id: 'otro-dispositivo', visited_at: new Date(5000).toISOString() }],
      error: null,
    };
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(getRecentVisitIds()).toEqual(['otro-dispositivo']);
    });
    expect(h.selectCalls).toBe(1);
  });

  it('sin sesión no consulta al volver a visible', async () => {
    await initRecentVisits();
    h.selectCalls = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.selectCalls).toBe(0);
  });

  it('con la pestaña oculta no consulta', async () => {
    await initRecentVisits();
    h.session = { user: { id: 'u1' } };
    h.selectCalls = 0;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.selectCalls).toBe(0);
    delete document.visibilityState;
  });

  it('el focus de la ventana también re-sincroniza', async () => {
    await initRecentVisits();
    h.session = { user: { id: 'u1' } };
    h.selectCalls = 0;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => {
      expect(h.selectCalls).toBe(1);
    });
  });

  it('eventos seguidos con un sync en vuelo no duplican la consulta', async () => {
    await initRecentVisits();
    h.session = { user: { id: 'u1' } };
    h.selectCalls = 0;
    let resolveSelect;
    h.selectResult = new Promise((resolve) => {
      resolveSelect = resolve;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(h.selectCalls).toBe(1);
    resolveSelect({ data: [], error: null });
    await new Promise((r) => setTimeout(r, 0));
  });

  it('múltiples init no duplican los listeners de visibilidad', async () => {
    await initRecentVisits();
    await initRecentVisits();
    h.session = { user: { id: 'u1' } };
    h.selectCalls = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.selectCalls).toBe(1);
  });
});
