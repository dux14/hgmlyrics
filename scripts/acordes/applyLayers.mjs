// scripts/acordes/applyLayers.mjs
// Aplica los JSONs generados por runCanva.mjs a la BD (UPDATE songs).
// Uso: node --env-file=.env.local scripts/acordes/applyLayers.mjs <slug|--all>
// Requiere songs_lyrics_backup con filas (creado por iter 1 / backupLyrics.mjs).
import postgres from 'postgres'
import { readFileSync, readdirSync } from 'node:fs'

const sql = postgres(process.env.DATABASE_URL)
const OUT = 'docs/acordes-tono/out'

async function main() {
  const args = process.argv.slice(2)
  const applyAll = args.includes('--all')
  const targetSlug = applyAll ? null : args[0]

  if (!applyAll && !targetSlug) {
    console.error('Uso: applyLayers.mjs <slug> | --all')
    await sql.end()
    process.exit(1)
  }

  // Asegurar que el backup existe y tiene filas antes de cualquier UPDATE
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM songs_lyrics_backup`
  if (count === 0) {
    console.error('ERROR: songs_lyrics_backup está vacío. Ejecuta backupLyrics.mjs primero.')
    await sql.end()
    process.exit(1)
  }

  // Resolver lista de archivos JSON a procesar
  let files
  if (applyAll) {
    files = readdirSync(`${OUT}/json`).filter(f => f.endsWith('.json'))
  } else {
    files = [`${targetSlug}.json`]
  }

  let updated = 0
  let skipped = 0

  for (const file of files) {
    const filePath = `${OUT}/json/${file}`
    let json
    try {
      json = JSON.parse(readFileSync(filePath, 'utf8'))
    } catch (e) {
      console.error(`  [skip] ${file}: no se pudo leer — ${e.message}`)
      skipped++
      continue
    }

    if (json.dbId == null) {
      console.log(`  [skip] ${file}: dbId null (modo piloto)`)
      skipped++
      continue
    }

    if (json.valid === false) {
      console.log(`  [skip] ${file}: valid=false`)
      skipped++
      continue
    }

    try {
      await sql`
        UPDATE songs
        SET
          sections       = ${sql.json(json.sections)},
          voice_roster   = ${sql.json(json.voiceRoster)},
          schema_version = 3
        WHERE id = ${json.dbId}
      `
      console.log(`  [ok]   ${file} → songs id=${json.dbId}`)
      updated++
    } catch (e) {
      console.error(`  [error] ${file}: ${e.message}`)
      skipped++
    }
  }

  console.log(`\nListo: ${updated} actualizadas, ${skipped} saltadas.`)
  console.log('Reversible vía songs_lyrics_backup.')
  await sql.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
