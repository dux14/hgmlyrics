/**
 * WorldScene.js — Escena principal del mundo virtual (Phaser 3).
 *
 * Assets de prueba (dev):
 *   public/world/dev-map.json   — tilemap Tiled 20×15 (suelo + colisión)
 *   public/world/dev-tileset.png — tileset 64×48 px (6 tiles de 16×16)
 *
 * Para regenerar dev-tileset.png: ver scripts/gen-dev-tileset.mjs
 */
import Phaser from 'phaser';

const SPEED = 160; // px/s

export class WorldScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WorldScene' });
    /** @type {Phaser.GameObjects.Rectangle} */
    this.player = null;
    /** @type {Phaser.Types.Input.Keyboard.CursorKeys} */
    this.cursors = null;
    /** @type {{ left: Phaser.Input.Keyboard.Key, right: Phaser.Input.Keyboard.Key, up: Phaser.Input.Keyboard.Key, down: Phaser.Input.Keyboard.Key }} */
    this.wasd = null;
    /** @type {'up'|'down'|'left'|'right'} última dirección dominante */
    this.lastDir = 'down';
  }

  preload() {
    this.load.tilemapTiledJSON('dev-map', '/world/dev-map.json');
    this.load.image('dev-tileset', '/world/dev-tileset.png');
  }

  create() {
    // ---- Tilemap ----
    const map = this.make.tilemap({ key: 'dev-map' });
    const tileset = map.addTilesetImage('dev-tileset', 'dev-tileset');

    // Capa de suelo (visible, sin colisión)
    map.createLayer('ground', tileset, 0, 0);

    // Capa de colisión
    const wallLayer = map.createLayer('walls', tileset, 0, 0);
    wallLayer.setCollisionByProperty({ collides: true });

    // ---- Jugador (rectángulo provisional) ----
    const startX = map.widthInPixels / 2;
    const startY = map.heightInPixels / 2;
    this.player = this.add.rectangle(startX, startY, 16, 24, 0x4fc3f7);
    this.physics.add.existing(this.player);
    /** @type {Phaser.Physics.Arcade.Body} */
    const body = this.player.body;
    body.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, wallLayer);

    // ---- Cámara ----
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // ---- Input ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // ---- Límites del mundo ----
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  }

  update() {
    /** @type {Phaser.Physics.Arcade.Body} */
    const body = this.player.body;
    body.setVelocity(0, 0);

    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    if (left) {
      body.setVelocityX(-SPEED);
      this.lastDir = 'left';
    } else if (right) {
      body.setVelocityX(SPEED);
      this.lastDir = 'right';
    }

    if (up) {
      body.setVelocityY(-SPEED);
      this.lastDir = 'up';
    } else if (down) {
      body.setVelocityY(SPEED);
      this.lastDir = 'down';
    }

    // Normalizar velocidad diagonal para mantener speed constante
    if ((left || right) && (up || down)) {
      body.velocity.normalize().scale(SPEED);
    }
  }
}
