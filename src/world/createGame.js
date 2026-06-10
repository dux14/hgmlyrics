/**
 * createGame.js — Factory de la instancia Phaser para el mundo virtual.
 * Ver WorldScene.js para la escena.
 *
 * @param {string} parentId  id del elemento DOM host
 * @param {{ supabase: object, me: { id: string, name: string }, onRoster: Function, onZoneChange?: Function, input?: { vector: { x: number, y: number } }, onStatus?: Function }|null} [context]
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
  // Stash context so WorldScene can read it via this.registry.get('worldContext')
  game.registry.set('worldContext', context ?? null);
  return game;
}
