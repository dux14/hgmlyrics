/**
 * avatarSprite.js — Helper para sprites LPC animados en WorldScene.
 *
 * Exporta funciones puras (testeables sin Phaser) para calcular frames de
 * animación, más un factory `createAvatarSprite` que gestiona la carga
 * on-demand del spritesheet y crea el Phaser.Sprite que sigue al cuerpo
 * físico existente.
 *
 * Contratos del spritesheet compuesto (576×256):
 *   cols = 9, rows = 4, frameWidth = 64, frameHeight = 64
 *   rowDir = ['up', 'left', 'down', 'right']
 *   Columna 0 = quieto (standing); columnas 1-8 = ciclo caminar.
 */

// ─── Funciones puras ────────────────────────────────────────────────────────

const DEFAULT_ROW_DIR = ['up', 'left', 'down', 'right'];
const DEFAULT_COLS = 9;

/**
 * Devuelve el índice de fila para una dirección dada.
 * @param {'up'|'left'|'down'|'right'} dir
 * @param {string[]} rowDir — orden de filas (default LPC: up/left/down/right)
 * @returns {number}
 */
export function dirRow(dir, rowDir = DEFAULT_ROW_DIR) {
  const idx = rowDir.indexOf(dir);
  return idx === -1 ? rowDir.indexOf('down') : idx;
}

/**
 * Devuelve el índice global del frame de quieto para una dirección.
 * @param {'up'|'left'|'down'|'right'} dir
 * @param {number} cols — columnas del spritesheet (default 9)
 * @param {string[]} rowDir
 * @returns {number}
 */
export function standingFrame(dir, cols = DEFAULT_COLS, rowDir = DEFAULT_ROW_DIR) {
  return dirRow(dir, rowDir) * cols;
}

/**
 * Devuelve el array de índices de frame para el ciclo de caminar de una dirección
 * (columnas 1..8, es decir 8 frames).
 * @param {'up'|'left'|'down'|'right'} dir
 * @param {number} cols
 * @param {string[]} rowDir
 * @returns {number[]}
 */
export function walkFrames(dir, cols = DEFAULT_COLS, rowDir = DEFAULT_ROW_DIR) {
  const base = dirRow(dir, rowDir) * cols;
  const frames = [];
  for (let c = 1; c < cols; c++) {
    frames.push(base + c);
  }
  return frames;
}

/**
 * Obtiene la URL pública del PNG de avatar de un usuario desde Supabase Storage.
 * @param {object} supabase — cliente Supabase
 * @param {string} uid
 * @returns {string}
 */
export function publicAvatarUrl(supabase, uid) {
  return supabase.storage.from('avatars').getPublicUrl(`${uid}.png`).data.publicUrl;
}

// ─── Factory (requiere Phaser en runtime) ───────────────────────────────────

/**
 * Crea y gestiona un Phaser Sprite animado cargado on-demand desde un spritesheet URL.
 *
 * El sprite es una capa visual pura: NO tiene física, simplemente sigue
 * la posición que le indiques vía `setPosition(x, y)`.
 *
 * @param {Phaser.Scene} scene
 * @param {{ uid: string, url: string, depth?: number }} opts
 * @returns {{
 *   ready: Promise<boolean>,
 *   setPosition: (x: number, y: number) => void,
 *   update: (dir: string, moving: boolean) => void,
 *   gameObject: Phaser.GameObjects.Sprite|null,
 *   destroy: () => void,
 * }}
 */
export function createAvatarSprite(scene, { uid, url, depth = 10 }) {
  const textureKey = `avatar-${uid}`;
  const DIRS = DEFAULT_ROW_DIR;
  const COLS = DEFAULT_COLS;

  /** @type {Phaser.GameObjects.Sprite|null} */
  let sprite = null;
  let currentDir = 'down';

  // Registrar animaciones de caminar para las 4 direcciones
  function _registerAnims() {
    DIRS.forEach((dir) => {
      const key = `${textureKey}-walk-${dir}`;
      if (!scene.anims.exists(key)) {
        scene.anims.create({
          key,
          frames: walkFrames(dir, COLS, DIRS).map((frame) => ({ key: textureKey, frame })),
          frameRate: 10,
          repeat: -1,
        });
      }
    });
  }

  /** @type {Promise<boolean>} */
  const ready = new Promise((resolve) => {
    // Si la textura ya fue cargada anteriormente, reutilizarla
    if (scene.textures.exists(textureKey)) {
      _registerAnims();
      sprite = scene.add.sprite(0, 0, textureKey);
      sprite.setDepth(depth);
      sprite.setOrigin(0.5, 0.5);
      resolve(true);
      return;
    }

    // Escuchar error de carga ANTES de iniciar (para no perder el evento)
    const onError = (_file) => {
      if (_file.key !== textureKey) return;
      scene.load.off('loaderror', onError);
      scene.load.off('complete', onComplete);
      resolve(false);
    };

    const onComplete = () => {
      scene.load.off('loaderror', onError);
      scene.load.off('complete', onComplete);
      if (!scene.textures.exists(textureKey)) {
        resolve(false);
        return;
      }
      _registerAnims();
      sprite = scene.add.sprite(0, 0, textureKey);
      sprite.setDepth(depth);
      sprite.setOrigin(0.5, 0.5);
      resolve(true);
    };

    scene.load.on('loaderror', onError);
    scene.load.on('complete', onComplete);

    scene.load.spritesheet(textureKey, url, {
      frameWidth: 64,
      frameHeight: 64,
    });
    scene.load.start();
  });

  return {
    ready,

    /** Posiciona el sprite en las coordenadas dadas. */
    setPosition(x, y) {
      if (sprite) {
        sprite.x = x;
        sprite.y = y;
      }
    },

    /**
     * Actualiza la animación según dirección y estado de movimiento.
     * Si moving → reproduce anim de caminar para esa dir.
     * Si !moving → muestra el frame quieto de esa dir.
     * @param {'up'|'left'|'down'|'right'} dir
     * @param {boolean} moving
     */
    update(dir, moving) {
      if (!sprite) return;
      currentDir = dir || currentDir;
      if (moving) {
        const animKey = `${textureKey}-walk-${currentDir}`;
        if (sprite.anims.currentAnim?.key !== animKey) {
          sprite.anims.play(animKey, true);
        }
      } else {
        sprite.anims.stop();
        sprite.setFrame(standingFrame(currentDir, COLS, DIRS));
      }
    },

    /** Devuelve el Phaser.Sprite subyacente (null si aún no cargó o falló). */
    get gameObject() {
      return sprite;
    },

    /** Destruye el sprite y limpia recursos. */
    destroy() {
      if (sprite) {
        sprite.destroy();
        sprite = null;
      }
    },
  };
}
