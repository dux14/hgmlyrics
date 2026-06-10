/**
 * worldRealtime.test.js — Pruebas TDD del canal Realtime de posiciones.
 *
 * Usa un fake de supabase.channel() que registra handlers broadcast/presence
 * sin tocar la red. El reloj se inyecta vía `now` para verificar throttle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { joinWorld } from '../../src/lib/worldRealtime.js';

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

/**
 * Construye un fake del cliente Supabase con un único canal simulado.
 * `fakeChannel` almacena los handlers registrados y los mensajes enviados.
 */
function makeFakeSupabase() {
  /** @type {Map<string, Function>} clave = "type:event" */
  const handlers = new Map();
  const sentMessages = [];
  let trackedState = null;
  let subscribeCallback = null;
  let removedChannel = null;

  const fakeChannel = {
    /** Registra un handler. Devuelve this para chainear. */
    on(type, filter, cb) {
      const key = `${type}:${filter.event}`;
      handlers.set(key, cb);
      return this;
    },
    subscribe(cb) {
      subscribeCallback = cb;
      // Invoca SUBSCRIBED de forma síncrona para simplificar los tests
      cb('SUBSCRIBED');
      return this;
    },
    send(msg) {
      sentMessages.push(msg);
      return Promise.resolve('ok');
    },
    track(state) {
      trackedState = state;
      return Promise.resolve();
    },
    untrack() {
      trackedState = null;
      return Promise.resolve();
    },
    // Acceso interno para los tests
    _handlers: handlers,
    _sentMessages: sentMessages,
    _getTracked: () => trackedState,
  };

  const fakeSupabase = {
    channel(_name, _opts) {
      return fakeChannel;
    },
    removeChannel(ch) {
      removedChannel = ch;
    },
    _getRemovedChannel: () => removedChannel,
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
  });
});
