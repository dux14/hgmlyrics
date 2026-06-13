/**
 * iceConfig.test.js — Pruebas TDD de getIceServers().
 *
 * Verifica que la función retorna los servidores STUN por defecto
 * y agrega TURN con credenciales cuando las variables de entorno
 * correspondientes están presentes.
 */

import { describe, it, expect } from 'vitest';
import { getIceServers } from '../../src/world/iceConfig.js';

describe('getIceServers', () => {
  describe('sin variables de entorno (solo STUN)', () => {
    it('retorna dos entradas de STUN de Google', () => {
      const servers = getIceServers({});
      expect(servers).toHaveLength(2);
      expect(servers[0].urls).toBe('stun:stun.l.google.com:19302');
      expect(servers[1].urls).toBe('stun:stun1.l.google.com:19302');
    });

    it('cada entrada STUN no tiene username ni credential', () => {
      const servers = getIceServers({});
      for (const s of servers) {
        expect(s.username).toBeUndefined();
        expect(s.credential).toBeUndefined();
      }
    });

    it('sin args retorna STUN por defecto', () => {
      const servers = getIceServers();
      expect(servers).toHaveLength(2);
    });

    it('VITE_TURN_URL vacío no agrega TURN', () => {
      const servers = getIceServers({ VITE_TURN_URL: '' });
      expect(servers).toHaveLength(2);
    });

    it('VITE_TURN_URL con solo espacios no agrega TURN', () => {
      const servers = getIceServers({ VITE_TURN_URL: '   ' });
      expect(servers).toHaveLength(2);
    });
  });

  describe('con VITE_TURN_URL definida (STUN + TURN)', () => {
    it('agrega entrada TURN cuando la URL está presente', () => {
      const servers = getIceServers({ VITE_TURN_URL: 'turn:mi-turn.example.com:3478' });
      expect(servers).toHaveLength(3);
      expect(servers[2].urls).toBe('turn:mi-turn.example.com:3478');
    });

    it('agrega username y credential cuando se proveen', () => {
      const servers = getIceServers({
        VITE_TURN_URL: 'turn:mi-turn.example.com:3478',
        VITE_TURN_USERNAME: 'usuario-test',
        VITE_TURN_CREDENTIAL: 'clave-secreta',
      });
      expect(servers[2].username).toBe('usuario-test');
      expect(servers[2].credential).toBe('clave-secreta');
    });

    it('TURN sin credenciales no tiene username ni credential', () => {
      const servers = getIceServers({ VITE_TURN_URL: 'turn:mi-turn.example.com:3478' });
      expect(servers[2].username).toBeUndefined();
      expect(servers[2].credential).toBeUndefined();
    });

    it('las entradas STUN siguen siendo las primeras dos', () => {
      const servers = getIceServers({ VITE_TURN_URL: 'turn:mi-turn.example.com:3478' });
      expect(servers[0].urls).toBe('stun:stun.l.google.com:19302');
      expect(servers[1].urls).toBe('stun:stun1.l.google.com:19302');
    });

    it('recorta espacios del VITE_TURN_URL', () => {
      const servers = getIceServers({ VITE_TURN_URL: '  turn:mi-turn.example.com:3478  ' });
      expect(servers[2].urls).toBe('turn:mi-turn.example.com:3478');
    });
  });
});
