/**
 * worldAdminChannel.test.js — Pruebas TDD del canal de administración del mundo.
 *
 * Usa un fake de supabase.channel() que registra handlers broadcast
 * sin tocar la red. Mismo patrón que zoneChannel.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { joinWorldAdmin } from '../../src/lib/worldAdminChannel.js';

// ---------------------------------------------------------------------------
// Fake Supabase
// ---------------------------------------------------------------------------

function makeFakeSupabase() {
  /** @type {Map<string, Function>} clave = "type:event" */
  const handlers = new Map();
  const sentMessages = [];
  let removeChannelCount = 0;
  let removedChannel = null;

  const fakeChannel = {
    on(type, filter, cb) {
      const key = `${type}:${filter.event}`;
      handlers.set(key, cb);
      return this;
    },
    subscribe() {
      return this;
    },
    send(msg) {
      sentMessages.push(msg);
      return Promise.resolve('ok');
    },
    _handlers: handlers,
    _sentMessages: sentMessages,
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

describe('joinWorldAdmin', () => {
  let supabase;

  beforeEach(() => {
    supabase = makeFakeSupabase();
  });

  // (a) broadcastMapUpdated envía el evento correcto
  describe('broadcastMapUpdated', () => {
    it('emite un mensaje broadcast con evento map-updated y payload', () => {
      const admin = joinWorldAdmin({ supabase });
      admin.broadcastMapUpdated({ mapId: 'map-001', mapName: 'Sala Principal' });

      const msgs = supabase._fakeChannel._sentMessages;
      expect(msgs).toHaveLength(1);
      const msg = msgs[0];
      expect(msg.type).toBe('broadcast');
      expect(msg.event).toBe('map-updated');
      expect(msg.payload).toMatchObject({ mapId: 'map-001', mapName: 'Sala Principal' });
    });

    it('emite con payload vacío cuando no se pasa ninguno', () => {
      const admin = joinWorldAdmin({ supabase });
      admin.broadcastMapUpdated();

      const msgs = supabase._fakeChannel._sentMessages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].payload).toEqual({});
    });
  });

  // (b) onMapUpdated se invoca al recibir un evento map-updated entrante
  describe('onMapUpdated', () => {
    it('dispara el callback con el payload al recibir broadcast map-updated', () => {
      const admin = joinWorldAdmin({ supabase });
      const received = [];
      admin.onMapUpdated((payload) => received.push(payload));

      const handler = supabase._fakeChannel._handlers.get('broadcast:map-updated');
      expect(handler).toBeDefined();
      handler({ payload: { mapId: 'map-002', mapName: 'Sala Secundaria' } });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ mapId: 'map-002', mapName: 'Sala Secundaria' });
    });

    it('dispara el callback con objeto vacío cuando el payload es null', () => {
      const admin = joinWorldAdmin({ supabase });
      const received = [];
      admin.onMapUpdated((payload) => received.push(payload));

      const handler = supabase._fakeChannel._handlers.get('broadcast:map-updated');
      handler({ payload: null });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({});
    });
  });

  // (c) leave() elimina el canal
  describe('leave', () => {
    it('llama removeChannel con el canal creado', () => {
      const admin = joinWorldAdmin({ supabase });
      admin.leave();
      expect(supabase._getRemovedChannel()).toBe(supabase._fakeChannel);
    });

    it('segunda llamada a leave() NO vuelve a llamar removeChannel (idempotente)', () => {
      const admin = joinWorldAdmin({ supabase });
      admin.leave();
      admin.leave();
      expect(supabase._getRemoveChannelCount()).toBe(1);
    });

    it('después de leave() los callbacks de onMapUpdated ya no se invocan', () => {
      const admin = joinWorldAdmin({ supabase });
      const received = [];
      admin.onMapUpdated((p) => received.push(p));
      admin.leave();

      // Intentar disparar el handler tras leave — no debería llegar al callback
      const handler = supabase._fakeChannel._handlers.get('broadcast:map-updated');
      handler({ payload: { mapId: 'map-003' } });

      expect(received).toHaveLength(0);
    });
  });
});
