/**
 * zoneChannelsDiff.test.js — Pruebas TDD del helper puro diffZoneChannels.
 *
 * No requiere mocks: es una función pura sobre arrays.
 */

import { describe, it, expect } from 'vitest';
import { diffZoneChannels } from '../../src/world/zoneChannelsDiff.js';

describe('diffZoneChannels', () => {
  // Sin cambios: mismas zonas, mismo channelId
  it('devuelve listas vacías cuando no hay cambios', () => {
    const current = [
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala B', channelId: 'sala-b' },
    ];
    const next = [
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala B', channelId: 'sala-b' },
    ];
    const { changed, removed } = diffZoneChannels(current, next);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  // Una zona cambia su channelId (mismo nombre, distinto id)
  it('detecta zonas cuyo channelId cambió', () => {
    const current = [
      { name: 'Sala A', channelId: 'sala-a-v1' },
      { name: 'Sala B', channelId: 'sala-b' },
    ];
    const next = [
      { name: 'Sala A', channelId: 'sala-a-v2' }, // channelId cambió
      { name: 'Sala B', channelId: 'sala-b' },
    ];
    const { changed, removed } = diffZoneChannels(current, next);
    expect(changed).toHaveLength(1);
    expect(changed[0].name).toBe('Sala A');
    expect(removed).toHaveLength(0);
  });

  // Una zona desaparece del nuevo mapa
  it('detecta zonas que desaparecen del nuevo mapa', () => {
    const current = [
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala Vieja', channelId: 'sala-vieja' },
    ];
    const next = [
      { name: 'Sala A', channelId: 'sala-a' },
      // 'Sala Vieja' ya no existe en el nuevo mapa
    ];
    const { changed, removed } = diffZoneChannels(current, next);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(1);
    expect(removed[0].name).toBe('Sala Vieja');
  });

  // Combinación: una cambia channelId y otra desaparece
  it('detecta simultáneamente zonas cambiadas y eliminadas', () => {
    const current = [
      { name: 'Lobby', channelId: 'lobby-1' },
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala Vieja', channelId: 'sala-vieja' },
    ];
    const next = [
      { name: 'Lobby', channelId: 'lobby-2' }, // channelId cambió
      { name: 'Sala A', channelId: 'sala-a' }, // sin cambio
      // 'Sala Vieja' eliminada
      { name: 'Sala Nueva', channelId: 'sala-nueva' }, // nueva — no cuenta como changed/removed
    ];
    const { changed, removed } = diffZoneChannels(current, next);
    expect(changed).toHaveLength(1);
    expect(changed[0].name).toBe('Lobby');
    expect(removed).toHaveLength(1);
    expect(removed[0].name).toBe('Sala Vieja');
  });

  // Zonas nuevas en el mapa siguiente NO se incluyen en ninguna lista
  it('ignora zonas nuevas que solo existen en el mapa siguiente', () => {
    const current = [{ name: 'Sala A', channelId: 'sala-a' }];
    const next = [
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala Nueva', channelId: 'sala-nueva' },
    ];
    const { changed, removed } = diffZoneChannels(current, next);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  // Listas vacías en ambos lados
  it('maneja listas vacías sin errores', () => {
    const { changed, removed } = diffZoneChannels([], []);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  // Lista actual vacía, siguiente con zonas
  it('sin zonas actuales no hay nada que comparar', () => {
    const { changed, removed } = diffZoneChannels([], [{ name: 'Sala A', channelId: 'sala-a' }]);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  // Lista siguiente vacía: todas las zonas actuales se eliminan
  it('con mapa siguiente vacío, todas las zonas actuales se marcan como eliminadas', () => {
    const current = [
      { name: 'Sala A', channelId: 'sala-a' },
      { name: 'Sala B', channelId: 'sala-b' },
    ];
    const { changed, removed } = diffZoneChannels(current, []);
    expect(changed).toHaveLength(0);
    expect(removed).toHaveLength(2);
  });
});
