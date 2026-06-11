import sql from '../_lib/db.js';
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import { validateTiledMap } from '../_lib/validateTiledMap.js';

// GET  → { maps: [{ id, name, is_active, updated_at }] }  (ordenados por updated_at desc)
// POST action:"create"   body: { action:"create", name, tiledJson, tilesetUrl }
//      action:"activate" body: { action:"activate", id }

// ---------------------------------------------------------------------------
// Listar todos los mapas (usado por el panel admin en E3)
// ---------------------------------------------------------------------------
async function listMaps(_req, res) {
  const maps = await sql`
    SELECT id, name, is_active AS "isActive", updated_at AS "updatedAt"
    FROM world_maps
    ORDER BY updated_at DESC
  `;
  res.status(200).json({ maps });
}

// ---------------------------------------------------------------------------
// Crear un mapa nuevo (is_active = false hasta que el admin lo active)
// ---------------------------------------------------------------------------
async function createMap(req, res, user) {
  const { name, tiledJson, tilesetUrl } = req.body ?? {};

  // Validar inputs de entrada antes de tocar la BD
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ error: '"name" es obligatorio y debe ser un string no vacío.' });
    return;
  }
  if (!tiledJson || typeof tiledJson !== 'object' || Array.isArray(tiledJson)) {
    res
      .status(400)
      .json({ error: '"tiledJson" debe ser un objeto JSON (el contenido del mapa Tiled).' });
    return;
  }
  if (!tilesetUrl || typeof tilesetUrl !== 'string' || tilesetUrl.trim() === '') {
    res.status(400).json({ error: '"tilesetUrl" es obligatorio y debe ser un string no vacío.' });
    return;
  }

  // Validar el JSON de Tiled antes de persistir
  const { ok, errors, zones } = validateTiledMap(tiledJson);
  if (!ok) {
    res.status(400).json({ errors });
    return;
  }

  // Insertar con is_active = false (no activo hasta que el admin lo active explícitamente)
  const rows = await sql`
    INSERT INTO world_maps (name, tiled_json, tileset_url, is_active, updated_by)
    VALUES (
      ${name.trim()},
      ${sql.json(tiledJson)},
      ${tilesetUrl.trim()},
      false,
      ${user.id}
    )
    RETURNING id, name, is_active AS "isActive", updated_at AS "updatedAt"
  `;

  res.status(201).json({ map: rows[0], zones });
}

// ---------------------------------------------------------------------------
// Activar un mapa: desactiva el actual y activa el nuevo en una transacción
// Orden de UPDATEs: primero desactivar todo, luego activar el target.
// Así no se viola el índice parcial único `world_maps_one_active` en ningún
// punto intermedio de la transacción.
// ---------------------------------------------------------------------------
async function activateMap(req, res) {
  const { id } = req.body ?? {};

  if (!id) {
    res.status(400).json({ error: '"id" es obligatorio para activar un mapa.' });
    return;
  }

  let updated;
  await sql.begin(async (tx) => {
    // Verificar que el mapa existe antes de hacer cualquier cambio
    const found = await tx`SELECT id FROM world_maps WHERE id = ${id}`;
    if (!found.length) {
      const e = new Error('Mapa no encontrado.');
      e.status = 404;
      throw e;
    }

    // Paso 1: desactivar todos los mapas activos (puede ser 0 o 1)
    await tx`UPDATE world_maps SET is_active = false WHERE is_active = true`;

    // Paso 2: activar el mapa solicitado
    const rows = await tx`
      UPDATE world_maps
      SET is_active = true, updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, is_active AS "isActive", updated_at AS "updatedAt"
    `;
    updated = rows[0];
  });

  res.status(200).json({ map: updated });
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET', 'POST'])) return;

  const user = await requireAdmin(req, sql);

  if (req.method === 'GET') return listMaps(req, res);

  // POST: derivar por `action`
  const { action } = req.body ?? {};

  if (action === 'create') return createMap(req, res, user);
  if (action === 'activate') return activateMap(req, res);

  res.status(400).json({ error: 'El campo "action" debe ser "create" o "activate".' });
});
