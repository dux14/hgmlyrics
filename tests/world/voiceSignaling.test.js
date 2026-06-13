/**
 * voiceSignaling.test.js — Pruebas TDD de la capa de señalización WebRTC.
 *
 * Usa un fake de supabase.channel() idéntico al patrón de zoneChannel.test.js.
 * Sin red real; toda la señalización es local en memoria.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { joinSignaling } from '../../src/lib/voiceSignaling.js';

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

describe('joinSignaling', () => {
  let supabase;
  let userA;
  let userB;

  beforeEach(() => {
    supabase = makeFakeSupabase();
    userA = { id: 'uid-alice' };
    userB = { id: 'uid-bob' };
  });

  // (a) sendSignal emite broadcast 'sig' con el payload correcto
  describe('sendSignal — payload', () => {
    it('hace broadcast evento sig con from, to, type y payload', () => {
      const sig = joinSignaling({ supabase, channelId: 'zona-1', user: userA });
      sig.sendSignal(userB.id, { type: 'offer', payload: { sdp: 'desc' } });

      const msgs = supabase._fakeChannel._sentMessages;
      expect(msgs).toHaveLength(1);
      const msg = msgs[0];
      expect(msg.type).toBe('broadcast');
      expect(msg.event).toBe('sig');
      expect(msg.payload).toEqual({
        from: userA.id,
        to: userB.id,
        type: 'offer',
        payload: { sdp: 'desc' },
      });
    });

    it('NO envía antes de recibir SUBSCRIBED', () => {
      const deferredSupabase = makeFakeSupabase({ deferSubscribe: true });
      const sig = joinSignaling({ supabase: deferredSupabase, channelId: 'zona-1', user: userA });
      sig.sendSignal(userB.id, { type: 'ice', payload: { candidate: 'x' } });
      expect(deferredSupabase._fakeChannel._sentMessages).toHaveLength(0);
    });
  });

  // (b) señal dirigida a mí dispara onSignal
  describe('onSignal — señal dirigida a mí', () => {
    it('invoca el callback cuando to === user.id', () => {
      const sig = joinSignaling({ supabase, channelId: 'zona-1', user: userA });
      const received = [];
      sig.onSignal((data) => received.push(data));

      const handler = supabase._fakeChannel._handlers.get('broadcast:sig');
      expect(handler).toBeDefined();

      // Simular señal entrante dirigida a userA
      handler({
        payload: {
          from: userB.id,
          to: userA.id,
          type: 'answer',
          payload: { sdp: 'answer-desc' },
        },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        fromUid: userB.id,
        toUid: userA.id,
        type: 'answer',
        payload: { sdp: 'answer-desc' },
      });
    });
  });

  // (c) señal dirigida a otro uid NO dispara onSignal
  describe('onSignal — señal NO dirigida a mí', () => {
    it('NO invoca el callback cuando to !== user.id', () => {
      const sig = joinSignaling({ supabase, channelId: 'zona-1', user: userA });
      const received = [];
      sig.onSignal((data) => received.push(data));

      const handler = supabase._fakeChannel._handlers.get('broadcast:sig');

      // Simular señal dirigida a otro usuario (no a userA)
      handler({
        payload: {
          from: userA.id,
          to: 'uid-charlie',
          type: 'offer',
          payload: { sdp: 'offer-desc' },
        },
      });

      expect(received).toHaveLength(0);
    });
  });

  // (d) leave() llama removeChannel
  describe('leave', () => {
    it('llama removeChannel con el canal creado', () => {
      const sig = joinSignaling({ supabase, channelId: 'zona-1', user: userA });
      sig.leave();
      expect(supabase._getRemovedChannel()).toBe(supabase._fakeChannel);
    });

    it('segunda llamada a leave() NO vuelve a llamar removeChannel', () => {
      const sig = joinSignaling({ supabase, channelId: 'zona-1', user: userA });
      sig.leave();
      sig.leave();
      expect(supabase._getRemoveChannelCount()).toBe(1);
    });
  });
});
