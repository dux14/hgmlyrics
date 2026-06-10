/**
 * createGame.js — Factory de la instancia Phaser para el mundo virtual.
 * Ver WorldScene.js para la escena.
 *
 * @param {string} parentId  id del elemento DOM host
 * @param {{ supabase: object, me: { id: string, name: string }, mapDescriptor?: object, onRoster: Function, onZoneChange?: Function, input?: { vector: { x: number, y: number } }, onStatus?: Function }|null} [context]
 * @returns {Phaser.Game}
 */
import Phaser from 'phaser';
import { WorldScene } from './WorldScene.js';

export function createGame(parentId, context) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    backgroundColor: '#1a1a2e',
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [WorldScene],
  });
  // Stash context so WorldScene can read it via this.registry.get('worldContext').
  // mapDescriptor (si existe) se separa en su propia clave del registry para que
  // WorldScene lo use en preload() sin necesidad de desestructurar el contexto
  // de red.
  game.registry.set('worldContext', context ?? null);
  if (context?.mapDescriptor) {
    game.registry.set('worldMapDescriptor', context.mapDescriptor);
  }
  return game;
}
