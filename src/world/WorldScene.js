/**
 * WorldScene.js — Escena principal del mundo virtual (Phaser 4).
 *
 * Assets de prueba (dev):
 *   public/world/dev-map.json   — tilemap Tiled 20×15 (suelo + colisión)
 *   public/world/dev-tileset.png — tileset 64×48 px (6 tiles de 16×16)
 *
 * Para regenerar dev-tileset.png: ver scripts/gen-dev-tileset.mjs
 */
import Phaser from 'phaser';
import { joinWorld } from '../lib/worldRealtime.js';
import { PeerBuffer } from './interpolation.js';
import { getActiveMapDescriptor } from './worldMapStore.js';
import { parseZones, zoneAt } from './zones.js';
// Nota: getActiveMapDescriptor se mantiene como fallback cuando no hay
// descriptor inyectado vía registry (modo dev sin WorldPage).
import { createAvatarSprite, publicAvatarUrl } from './avatarSprite.js';
import { mergeInputVector, deriveDir } from './input.js';

const SPEED = 160; // px/s
const PEER_COLOR = 0xe57373; // rojo claro para distinguir peers del jugador local
const INTERP_DELAY_MS = 100;
const LABEL_OFFSET_Y = 18; // px que el label de nombre se eleva sobre el sprite

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
    /** @type {{ sendPosition: Function, onPeerMove: Function, onPeerJoin: Function, onPeerLeave: Function, leave: Function }|null} */
    this.world = null;
    /**
     * Map uid → { sprite: Rectangle, label: Text, buffer: PeerBuffer, name: string,
     *              avatar: object|null, dir: string, lastMoveT: number }
     * @type {Map<string, { sprite: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text, buffer: PeerBuffer, name: string, avatar: object|null, dir: string, lastMoveT: number }>}
     */
    this.peers = new Map();
    /** @type {{ name: string, channelId: string, rect: object }[]} zonas del mapa activo */
    this.zones = [];
    /** @type {{ name: string, channelId: string }|null} zona actual del jugador */
    this.currentZone = null;
    /** @type {object|null} manager de avatar del jugador local (createAvatarSprite) */
    this.playerAvatar = null;
    /** @type {object|null} cliente supabase, guardado en create() para uso en _createPeerEntry */
    this._supabase = null;
    /** @type {{ vector: { x: number, y: number } }|null} fuente de input del joystick (ref mutable) */
    this._inputRef = null;
    /** @type {boolean} true mientras la última transición de red fue 'disconnected' */
    this._wasDisconnected = false;
    /** @type {Phaser.GameObjects.Text|null} label de nombre del jugador local */
    this.playerLabel = null;
  }

  preload() {
    // Preferir el descriptor inyectado por WorldPage (resuelto async antes de
    // crear el juego). Si no está disponible (p. ej. entorno de test sin
    // registry completo), usar el fallback estático de dev.
    const mapDesc = this.registry.get('worldMapDescriptor') ?? getActiveMapDescriptor();

    if (mapDesc.source === 'db') {
      // Mapa desde DB: el JSON de Tiled ya está en memoria — cargarlo directo
      // en la caché de Phaser sin hacer una petición HTTP.
      this.cache.tilemap.add(mapDesc.key, {
        format: Phaser.Tilemaps.Formats.TILED_JSON,
        data: mapDesc.tiledJson,
      });
      // El tileset sí viene de Storage (URL pública): descargarlo normalmente.
      this.load.image(mapDesc.tilesetKey, mapDesc.tilesetUrl);
    } else {
      // Mapa dev (fuente: fichero estático local) — comportamiento original.
      this.load.tilemapTiledJSON(mapDesc.key, mapDesc.url);
      this.load.image(mapDesc.tilesetKey, mapDesc.tilesetUrl);
    }
  }

  create() {
    // ---- Tilemap ----
    const mapDesc = this.registry.get('worldMapDescriptor') ?? getActiveMapDescriptor();
    const map = this.make.tilemap({ key: mapDesc.key });
    const tileset = map.addTilesetImage(mapDesc.tilesetName, mapDesc.tilesetKey);

    // Zonas (object layer "zones"). El JSON crudo del tilemap está en la caché;
    // parseZones tolera mapas sin la capa (devuelve []).
    this.zones = parseZones(this.cache.tilemap.get(mapDesc.key)?.data ?? {});

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

    // ---- Red (opcional: solo si hay contexto inyectado) ----
    const ctx = this.registry.get('worldContext');
    if (ctx) {
      // Guardar supabase para _createPeerEntry y carga de avatares
      this._supabase = ctx.supabase;
      // Fuente de input alterna (joystick táctil), ref mutable compartida con WorldPage
      this._inputRef = ctx.input ?? null;

      // Label de nombre del jugador local (legible: stroke + origen centrado)
      this.playerLabel = this.add.text(startX, startY - LABEL_OFFSET_Y, ctx.me.name, {
        fontSize: '10px',
        color: '#9fe6ff',
        stroke: '#000000',
        strokeThickness: 2,
      });
      this.playerLabel.setOrigin(0.5, 1);

      this.world = joinWorld({
        supabase: ctx.supabase,
        user: { id: ctx.me.id, name: ctx.me.name },
      });

      this.world.onPeerMove(({ uid, x, y, dir, t }) => {
        // Ignorar self (presence puede hacer eco del propio usuario)
        if (uid === ctx.me.id) return;
        // Crear peer lazy si llega un move antes del presence join
        if (!this.peers.has(uid)) {
          this._createPeerEntry(uid, uid);
        }
        const peer = this.peers.get(uid);
        peer.buffer.push({ x, y, t });
        if (dir) {
          peer.dir = dir;
          peer.lastMoveT = Date.now();
        }
      });

      this.world.onPeerJoin(({ key, newPresences }) => {
        const presence = newPresences?.[0] ?? {};
        const uid = presence.uid ?? key;
        // Ignorar self (Supabase presence no filtra broadcast: { self:false })
        if (uid === ctx.me.id) return;
        const name = presence.name ?? uid;
        if (!this.peers.has(uid)) {
          this._createPeerEntry(uid, name);
        } else if (this.peers.get(uid).name === uid) {
          const entry = this.peers.get(uid);
          entry.label.setText(name);
          entry.name = name;
        }
        this._pushRoster(ctx);
      });

      this.world.onPeerLeave(({ key, leftPresences }) => {
        const presence = leftPresences?.[0] ?? {};
        const uid = presence.uid ?? key;
        this._destroyPeerEntry(uid);
        this._pushRoster(ctx);
      });

      // Estado de conexión: puente hacia el overlay DOM + re-emisión de posición
      // al reconectar (spec §7.3). El re-track de presence lo hace worldRealtime
      // automáticamente en cada SUBSCRIBED.
      this.world.onStatus((state) => {
        ctx.onStatus?.(state);
        if (state === 'connected' && this._wasDisconnected) {
          this.world.sendPosition(this.player.x, this.player.y, this.lastDir, true);
        }
        this._wasDisconnected = state === 'disconnected';
      });

      // Roster inicial: solo self
      this._pushRoster(ctx);

      // ---- Avatar jugador local ----
      // Intentar cargar el spritesheet compuesto del jugador. Si falla (404),
      // se mantiene el rectángulo provisional como fallback.
      const localAvatarUrl = publicAvatarUrl(ctx.supabase, ctx.me.id);
      this.playerAvatar = createAvatarSprite(this, {
        uid: ctx.me.id,
        url: localAvatarUrl,
        depth: 10,
      });
      this.playerAvatar.ready.then((ok) => {
        if (ok) {
          // Ocultar rectángulo provisional; el sprite lo reemplaza visualmente
          this.player.setVisible(false);
        }
      });
    }

    // Limpiar canal al salir de la escena.
    // shutdown siempre precede a destroy, con un solo listener es suficiente.
    this.events.once('shutdown', () => {
      this.world?.leave();
      this.playerAvatar?.destroy();
      this.playerAvatar = null;
      this.playerLabel?.destroy();
      this.playerLabel = null;
    });
  }

  update() {
    /** @type {Phaser.Physics.Arcade.Body} */
    const body = this.player.body;

    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    const keyboard = {
      x: (right ? 1 : 0) - (left ? 1 : 0),
      y: (down ? 1 : 0) - (up ? 1 : 0),
    };
    // Joystick táctil (M5): vector analógico desde WorldPage vía ref mutable.
    const joystick = this._inputRef?.vector ?? { x: 0, y: 0 };
    const input = mergeInputVector(keyboard, joystick);

    // Velocidad: escala analógica del joystick preservada; el teclado en diagonal
    // se clampa a SPEED para no exceder la velocidad en línea recta.
    let velX = input.x * SPEED;
    let velY = input.y * SPEED;
    const speed = Math.hypot(velX, velY);
    if (speed > SPEED) {
      const k = SPEED / speed;
      velX *= k;
      velY *= k;
    }
    body.setVelocity(velX, velY);

    const moving = input.x !== 0 || input.y !== 0;
    this.lastDir = deriveDir(input.x, input.y, this.lastDir);

    // ---- Enviar posición propia ----
    if (this.world) this.world.sendPosition(this.player.x, this.player.y, this.lastDir, moving);

    // ---- Avatar jugador local + label + z-order por y ----
    this.player.setDepth(this.player.y);
    if (this.playerLabel) {
      this.playerLabel.x = this.player.x;
      this.playerLabel.y = this.player.y - LABEL_OFFSET_Y;
      this.playerLabel.setDepth(this.player.y + 1);
    }
    if (this.playerAvatar?.gameObject) {
      this.playerAvatar.setPosition(this.player.x, this.player.y);
      this.playerAvatar.update(this.lastDir, moving);
      this.playerAvatar.gameObject.setDepth(this.player.y);
    }

    // ---- Detección de zona ----
    this._updateZone();

    // ---- Interpolar peers ----
    // Los timestamps del buffer son Date.now()-based (worldRealtime usa Date.now()),
    // por eso se muestrea con Date.now() y NO con this.time.now (reloj relativo de Phaser).
    const now = Date.now();
    this.peers.forEach(({ sprite, label, buffer, avatar, dir, lastMoveT }) => {
      const pos = buffer.sample(now);
      if (pos) {
        sprite.x = pos.x;
        sprite.y = pos.y;
        sprite.setDepth(pos.y);
        label.x = pos.x;
        label.y = pos.y - LABEL_OFFSET_Y;
        label.setDepth(pos.y + 1);
        sprite.setVisible(true);
        label.setVisible(true);

        // Actualizar avatar del peer si cargó correctamente
        if (avatar?.gameObject) {
          avatar.setPosition(pos.x, pos.y);
          avatar.gameObject.setDepth(pos.y);
          const peerMoving = now - (lastMoveT ?? 0) < 200;
          avatar.update(dir ?? 'down', peerMoving);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  /**
   * Recalcula la zona del jugador y, si cambió, notifica.
   * Emite por dos canales:
   *  - `this.events.emit('zonechange', zone)` — para consumidores de la escena (Fase 2 audio).
   *  - `ctx.onZoneChange(zone)` — puente escena↔DOM (M3 chat por zona).
   * `zone` es el objeto `{ name, channelId, rect }` o `null` fuera de toda zona.
   */
  _updateZone() {
    const zone = zoneAt(this.zones, this.player.x, this.player.y);
    const newId = zone?.channelId ?? null;
    const curId = this.currentZone?.channelId ?? null;
    if (newId === curId) return;

    this.currentZone = zone;
    this.events.emit('zonechange', zone);
    const ctx = this.registry.get('worldContext');
    ctx?.onZoneChange?.(zone);
  }

  /**
   * Crea el sprite + label para un peer y lo registra en this.peers.
   * Si hay cliente supabase disponible, intenta cargar el avatar LPC del peer;
   * cuando carga OK, oculta el rectángulo provisional.
   * @param {string} uid
   * @param {string} name
   */
  _createPeerEntry(uid, name) {
    const sprite = this.add.rectangle(0, 0, 16, 24, PEER_COLOR).setVisible(false);
    const label = this.add.text(0, -LABEL_OFFSET_Y, name, {
      fontSize: '10px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    });
    label.setOrigin(0.5, 1);
    label.setVisible(false);
    const buffer = new PeerBuffer({ delayMs: INTERP_DELAY_MS });

    // Avatar peer: intento on-demand si hay supabase
    let avatar = null;
    if (this._supabase) {
      const peerUrl = publicAvatarUrl(this._supabase, uid);
      avatar = createAvatarSprite(this, { uid, url: peerUrl, depth: 10 });
      avatar.ready.then((ok) => {
        if (ok && this.peers.has(uid)) {
          // Ocultar rectángulo provisional del peer
          this.peers.get(uid).sprite.setVisible(false);
        }
      });
    }

    this.peers.set(uid, { sprite, label, buffer, name, avatar, dir: 'down', lastMoveT: 0 });
  }

  /**
   * Destruye el sprite + label (+ avatar si existe) de un peer y lo elimina de this.peers.
   * @param {string} uid
   */
  _destroyPeerEntry(uid) {
    const peer = this.peers.get(uid);
    if (!peer) return;
    peer.sprite.destroy();
    peer.label.destroy();
    peer.avatar?.destroy();
    this.peers.delete(uid);
  }

  /**
   * Llama ctx.onRoster con el array actualizado de presencias (peers + self).
   * @param {{ me: { id: string, name: string }, onRoster: Function }} ctx
   */
  _pushRoster(ctx) {
    const entries = [{ uid: ctx.me.id, name: `${ctx.me.name} (tú)` }];
    this.peers.forEach(({ name }, uid) => entries.push({ uid, name }));
    ctx.onRoster(entries);
  }
}
