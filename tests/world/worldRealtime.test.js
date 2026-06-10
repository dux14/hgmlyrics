/**
 * worldRealtime.test.js — Pruebas TDD del canal Realtime de posiciones.
 *
 * Usa un fake de supabase.channel() que registra handlers broadcast/presence
 * sin tocar la red. El reloj se inyecta vía `now` para verificar throttle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { joinWorld, mapChannelStatus } from '../../src/lib/worldRealtime.js';

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

/**
 * Construye un fake del cliente Supabase con un único canal simulado.
 * `fakeChannel` almacena los handlers registrados y los mensajes enviados.
 */
function makeFakeSupabase({ deferSubscribe = false } = {}) {
  /** @type {Map<string, Function>} clave = "type:event" */
  const handlers = new Map();
  const sentMessages = [];
  let trackedState = null;
  let trackCount = 0;
  let _subscribeCb = null;
  let removeChannelCount = 0;
  let removedChannel = null;

  const fakeChannel = {
    /** Registra un handler. Devuelve this para chainear. */
    on(type, filter, cb) {
      const key = `${type}:${filter.event}`;
      handlers.set(key, cb);
      return this;
    },
    subscribe(cb) {
      _subscribeCb = cb;
      if (!deferSubscribe) {
        // Invoca SUBSCRIBED de forma síncrona para simplificar los tests
        cb('SUBSCRIBED');
      }
      return this;
    },
    send(msg) {
      sentMessages.push(msg);
      return Promise.resolve('ok');
    },
    track(state) {
      trackedState = state;
      trackCount++;
      return Promise.resolve();
    },
    // Acceso interno para los tests
    _handlers: handlers,
    _sentMessages: sentMessages,
    _getTracked: () => trackedState,
    _getTrackCount: () => trackCount,
    /** Dispara manualmente el callback de subscribe (para tests de timing) */
    _triggerSubscribe: (status) => _subscribeCb && _subscribeCb(status),
  };

  const fakeSupabase = {
    channel(_name, _opts) {
      return fakeChannel;
    },
    removeChannel(ch) {
      removeChannelCount++;
      removedChannel = ch;
    },
    _getRemovedChannel: () => removedChannel,
    _getRemoveChannelCount: () => removeChannelCount,
    _fakeChannel: fakeChannel,
  };

  return fakeSupabase;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('joinWorld', () => {
  let supabase;
  let user;
  let clock;

  beforeEach(() => {
    supabase = makeFakeSupabase();
    user = { id: 'uid-abc' };
    clock = 1000; // reloj controlable
  });

  // (a) throttle + guard moving===false
  describe('sendPosition — throttle y moving', () => {
    it('NO emite si moving===false', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.sendPosition(10, 20, 'right', false);
      expect(supabase._fakeChannel._sentMessages).toHaveLength(0);
    });

    it('emite la primera vez con moving===true', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.sendPosition(10, 20, 'right', true);
      expect(supabase._fakeChannel._sentMessages).toHaveLength(1);
      const msg = supabase._fakeChannel._sentMessages[0];
      expect(msg.type).toBe('broadcast');
      expect(msg.event).toBe('pos');
      expect(msg.payload).toMatchObject({ uid: 'uid-abc', x: 10, y: 20, dir: 'right' });
      expect(typeof msg.payload.t).toBe('number');
    });

    it('descarta el segundo envío dentro del intervalo de 100ms', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.sendPosition(10, 20, 'right', true); // t=1000 → pasa
      clock = 1050;
      world.sendPosition(15, 25, 'right', true); // t=1050 → bloqueado
      expect(supabase._fakeChannel._sentMessages).toHaveLength(1);
    });

    it('permite el envío cuando transcurren >=100ms', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.sendPosition(10, 20, 'right', true); // t=1000 → pasa
      clock = 1100;
      world.sendPosition(15, 25, 'right', true); // t=1100 → pasa
      expect(supabase._fakeChannel._sentMessages).toHaveLength(2);
    });
  });

  // (b) broadcast entrante dispara onPeerMove
  describe('onPeerMove', () => {
    it('dispara el callback con {uid,x,y,dir,t} al recibir broadcast pos', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      const received = [];
      world.onPeerMove((data) => received.push(data));

      // Simular un mensaje broadcast entrante
      const handler = supabase._fakeChannel._handlers.get('broadcast:pos');
      expect(handler).toBeDefined();
      handler({ payload: { uid: 'uid-xyz', x: 50, y: 80, dir: 'down', t: 9999 } });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ uid: 'uid-xyz', x: 50, y: 80, dir: 'down', t: 9999 });
    });
  });

  // (c) presence join/leave
  describe('onPeerJoin / onPeerLeave', () => {
    it('dispara onPeerJoin al recibir presence join', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      const joined = [];
      world.onPeerJoin((info) => joined.push(info));

      const handler = supabase._fakeChannel._handlers.get('presence:join');
      expect(handler).toBeDefined();
      handler({ key: 'uid-xyz', newPresences: [{ uid: 'uid-xyz' }] });

      expect(joined).toHaveLength(1);
      expect(joined[0]).toMatchObject({ key: 'uid-xyz' });
    });

    it('dispara onPeerLeave al recibir presence leave', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      const left = [];
      world.onPeerLeave((info) => left.push(info));

      const handler = supabase._fakeChannel._handlers.get('presence:leave');
      expect(handler).toBeDefined();
      handler({ key: 'uid-xyz', leftPresences: [{ uid: 'uid-xyz' }] });

      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({ key: 'uid-xyz' });
    });
  });

  // (d) leave() llama removeChannel
  describe('leave', () => {
    it('llama removeChannel con el canal creado', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.leave();
      expect(supabase._getRemovedChannel()).toBe(supabase._fakeChannel);
    });

    // Fix B: leave() idempotente
    it('segunda llamada a leave() NO vuelve a llamar removeChannel', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      world.leave();
      world.leave();
      expect(supabase._getRemoveChannelCount()).toBe(1);
    });
  });

  // Fix A: sendPosition no envía hasta SUBSCRIBED
  describe('sendPosition — guard SUBSCRIBED', () => {
    it('NO envía antes de recibir SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      world.sendPosition(10, 20, 'right', true);
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(0);
    });

    it('sí envía después de que el canal recibe SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      // Antes de SUBSCRIBED: sin envíos
      world.sendPosition(10, 20, 'right', true);
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(0);
      // Disparar SUBSCRIBED manualmente
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED');
      // Ahora sí debe enviar
      world.sendPosition(10, 20, 'right', true);
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(1);
    });
  });

  // Fix C: broadcast con payload nulo no llama onPeerMove
  describe('onPeerMove — payload nulo', () => {
    it('NO invoca el callback si el payload es nulo', () => {
      const world = joinWorld({ supabase, user, now: () => clock });
      const received = [];
      world.onPeerMove((data) => received.push(data));

      const handler = supabase._fakeChannel._handlers.get('broadcast:pos');
      handler({ payload: null });

      expect(received).toHaveLength(0);
    });
  });

  // M5.3 — estados de conexión / reconexión
  describe('onStatus — estados de conexión', () => {
    it('reporta "connected" cuando el canal recibe SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      const states = [];
      world.onStatus((s) => states.push(s));
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED');
      expect(states).toContain('connected');
    });

    it('reporta "disconnected" ante CHANNEL_ERROR / TIMED_OUT / CLOSED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      const states = [];
      world.onStatus((s) => states.push(s));
      deferredSupabase._fakeChannel._triggerSubscribe('CHANNEL_ERROR');
      deferredSupabase._fakeChannel._triggerSubscribe('TIMED_OUT');
      deferredSupabase._fakeChannel._triggerSubscribe('CLOSED');
      expect(states).toEqual(['disconnected', 'disconnected', 'disconnected']);
    });

    it('re-rastrea presence en cada SUBSCRIBED (reconexión → re-track)', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED'); // conexión inicial
      deferredSupabase._fakeChannel._triggerSubscribe('CHANNEL_ERROR'); // caída
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED'); // reconexión
      expect(deferredSupabase._fakeChannel._getTrackCount()).toBe(2);
    });

    it('al notificar "connected", el guard de envío ya permite sendPosition (re-emit §7.3)', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      // Simula el handler de la escena: re-emite posición al reconectar.
      world.onStatus((s) => {
        if (s === 'connected') world.sendPosition(7, 8, 'up', true);
      });
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED');
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(1);
      expect(deferredSupabase._fakeChannel._sentMessages[0].payload).toMatchObject({ x: 7, y: 8 });
    });

    it('leave() limpia el callback de estado (no se invoca tras leave)', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const world = joinWorld({ supabase: deferredSupabase, user, now: () => clock });
      const states = [];
      world.onStatus((s) => states.push(s));
      world.leave();
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED');
      expect(states).toHaveLength(0);
    });
  });
});

describe('mapChannelStatus — mapeo puro de estados Supabase', () => {
  it('SUBSCRIBED → connected', () => {
    expect(mapChannelStatus('SUBSCRIBED')).toBe('connected');
  });
  it('CHANNEL_ERROR / TIMED_OUT / CLOSED → disconnected', () => {
    expect(mapChannelStatus('CHANNEL_ERROR')).toBe('disconnected');
    expect(mapChannelStatus('TIMED_OUT')).toBe('disconnected');
    expect(mapChannelStatus('CLOSED')).toBe('disconnected');
  });
  it('estado desconocido → connecting', () => {
    expect(mapChannelStatus('JOINING')).toBe('connecting');
    expect(mapChannelStatus(undefined)).toBe('connecting');
  });
});
