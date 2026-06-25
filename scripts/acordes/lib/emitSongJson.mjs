import { validateSongV3 } from '../../../src/lib/voiceSystem.js'

/**
 * Construye el JSON final de la canción a emitir, con schemaVersion:3
 * y validación estructural delegada en validateSongV3 de la app.
 * @param {object} enriched - modelo enriquecido (sin schemaVersion)
 * @returns {{ ...enriched, schemaVersion: 3, valid: boolean }}
 */
export function buildSongJson(enriched) {
  const model = { ...enriched, schemaVersion: 3 }
  let valid = false
  try {
    validateSongV3(model)
    valid = true
  } catch {
    valid = false
  }
  return { ...model, valid }
}
