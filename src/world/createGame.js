/**
 * createGame.js — Factory de la instancia Phaser para el mundo virtual.
 * Ver WorldScene.js para la escena.
 *
 * @param {string} parentId  id del elemento DOM host
 * @returns {Phaser.Game}
 */
import Phaser from 'phaser';
import { WorldScene } from './WorldScene.js';

export function createGame(parentId) {
  return new Phaser.Game({
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
}
