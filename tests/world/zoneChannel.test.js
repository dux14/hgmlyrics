/**
 * zoneChannel.test.js — Pruebas TDD del canal de chat por zona.
 *
 * Usa un fake de supabase.channel() que registra handlers broadcast
 * sin tocar la red. Patrón idéntico al de worldRealtime.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { joinZone } from '../../src/lib/zoneChannel.js';

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

/**
 * Construye un fake del cliente Supabase con un único canal simulado.
 */
function makeFakeSupabase({ deferSubscribe = false } = {}) {
  /** @type {Map<string, Function>} clave = "type:event" */
  const handlers = new Map();
  const sentMessages = [];
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
    // Acceso interno para los tests
    _handlers: handlers,
    _sentMessages: sentMessages,
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

describe('joinZone', () => {
  let supabase;
  let user;

  beforeEach(() => {
    supabase = makeFakeSupabase();
    user = { id: 'uid-abc', display_name: 'Alice' };
  });

  // (a) send antes / después de SUBSCRIBED
  describe('send — guard SUBSCRIBED', () => {
    it('NO emite antes de recibir SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const zone = joinZone({ supabase: deferredSupabase, channelId: 'sala-1', user });
      zone.send('hola');
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(0);
    });

    it('sí emite después de que el canal recibe SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const zone = joinZone({ supabase: deferredSupabase, channelId: 'sala-1', user });
      // Antes de SUBSCRIBED: sin envíos
      zone.send('hola');
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(0);
      // Disparar SUBSCRIBED manualmente
      deferredSupabase._fakeChannel._triggerSubscribe('SUBSCRIBED');
      // Ahora sí debe enviar
      zone.send('hola');
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(1);
    });
  });

  // (b) send emite broadcast 'msg' con payload correcto
  describe('send — payload', () => {
    it('hace broadcast evento msg con uid, name, text, ts', () => {
      const zone = joinZone({ supabase, channelId: 'sala-1', user });
      zone.send('hola mundo');
      const msgs = supabase._fakeChannel._sentMessages;
      expect(msgs).toHaveLength(1);
      const msg = msgs[0];
      expect(msg.type).toBe('broadcast');
      expect(msg.event).toBe('msg');
      expect(msg.payload).toMatchObject({
        uid: 'uid-abc',
        name: 'Alice',
        text: 'hola mundo',
      });
      expect(typeof msg.payload.ts).toBe('number');
    });

    it('usa email como fallback de name cuando no hay display_name', () => {
      const userNoDisplay = { id: 'uid-abc', email: 'alice@example.com' };
      const zone = joinZone({ supabase, channelId: 'sala-1', user: userNoDisplay });
      zone.send('test');
      const payload = supabase._fakeChannel._sentMessages[0].payload;
      expect(payload.name).toBe('alice@example.com');
    });

    it('usa "anon" cuando no hay display_name ni email', () => {
      const userAnon = { id: 'uid-abc' };
      const zone = joinZone({ supabase, channelId: 'sala-1', user: userAnon });
      zone.send('test');
      const payload = supabase._fakeChannel._sentMessages[0].payload;
      expect(payload.name).toBe('anon');
    });
  });

  // (c) broadcast 'msg' entrante dispara onMessage
  describe('onMessage', () => {
    it('dispara el callback con el payload al recibir broadcast msg', () => {
      const zone = joinZone({ supabase, channelId: 'sala-1', user });
      const received = [];
      zone.onMessage((data) => received.push(data));

      const handler = supabase._fakeChannel._handlers.get('broadcast:msg');
      expect(handler).toBeDefined();
      handler({ payload: { uid: 'uid-xyz', name: 'Bob', text: 'hey', ts: 9999 } });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ uid: 'uid-xyz', name: 'Bob', text: 'hey', ts: 9999 });
    });
  });

  // (d) leave() llama removeChannel
  describe('leave', () => {
    it('llama removeChannel con el canal creado', () => {
      const zone = joinZone({ supabase, channelId: 'sala-1', user });
      zone.leave();
      expect(supabase._getRemovedChannel()).toBe(supabase._fakeChannel);
    });

    it('segunda llamada a leave() NO vuelve a llamar removeChannel', () => {
      const zone = joinZone({ supabase, channelId: 'sala-1', user });
      zone.leave();
      zone.leave();
      expect(supabase._getRemoveChannelCount()).toBe(1);
    });
  });
});
