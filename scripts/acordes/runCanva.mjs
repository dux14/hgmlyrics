// scripts/acordes/runCanva.mjs
// Uso:
//   node scripts/acordes/runCanva.mjs --pilot "Olor a Tostadas"   (modo offline, sin BD)
//   node --env-file=.env scripts/acordes/runCanva.mjs --all       (barrida completa)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  splitSections,
  sectionLines,
  joinContinuations,
  splitArrangementPreamble,
  splitEmojiGlossary,
} from './lib/extractCanva.mjs'
import {
  parseVoiceMarker,
  parseStretches,
  parseBends,
  parseDirectives,
} from './lib/parseCanvaLine.mjs'
import { alignLines, remapPositions } from './lib/alignCanva.mjs'
import { applyVoiceBlocks, mergeLayers } from './lib/buildLayers.mjs'
import { buildSongJson } from './lib/emitSongJson.mjs'
import { extractSongs } from './extractPdf.mjs'
import { matchByTitle, normalizeTitle } from './lib/titles.mjs'

const HTML = 'Letras HGM Bogotá.html'
const PDF = 'Cancionero + Acordes 2026.pdf'
const OUT = 'docs/acordes-tono/out'

function slug(title) {
  return normalizeTitle(title).replace(/\s+/g, '-') || 'sin-titulo'
}

function parseCanvaSong(rawLines) {
  const { body: b1 } = splitArrangementPreamble(rawLines.slice(1)) // [0] = título
  const { body, glossary } = splitEmojiGlossary(b1)
  return body.map(line => {
    const marker = parseVoiceMarker(line)
    let text = marker ? marker.clean : line
    const s = parseStretches(text); text = s.clean
    const b = parseBends(text); text = b.clean
    const d = parseDirectives(text, glossary); text = d.clean
    return { marker, clean: text, stretches: s.stretches, bends: b.bends, directives: d.directives }
  })
}

function processSong(canvaLines, baseSong) {
  const withVoices = applyVoiceBlocks(canvaLines)
  const baseFlat = []
  baseSong.sections.forEach((sec, si) =>
    sec.lines.forEach((ln, li) => baseFlat.push({ text: ln.text, si, li }))
  )
  const pairs = alignLines(withVoices, baseFlat.map(x => x.text))
  const layersByBaseLine = {}
  withVoices.forEach((cl, i) => {
    const p = pairs[i]; if (p.baseIndex == null) return
    const { si, li, text } = baseFlat[p.baseIndex]
    layersByBaseLine[`${si}:${li}`] = {
      voices: cl.voices,
      stretches: remapPositions(cl.stretches, cl.clean, text),
      bends: remapPositions(cl.bends, cl.clean, text),
      directives: remapPositions(cl.directives, cl.clean, text),
    }
  })
  return buildSongJson(mergeLayers(baseSong, layersByBaseLine))
}

async function main() {
  const args = process.argv.slice(2)
  const pilotIdx = args.indexOf('--pilot')
  const pilot = pilotIdx >= 0 ? args[pilotIdx + 1] : null
  const all = args.includes('--all')

  if (!pilot && !all) {
    console.error('Uso: --pilot "<Título>" | --all')
    process.exit(1)
  }

  mkdirSync(`${OUT}/json`, { recursive: true })

  // Cargar Canva HTML
  const canvaSongs = joinContinuations(
    splitSections(readFileSync(HTML, 'utf8')).map(sectionLines)
  )

  // Cargar base PDF
  const pdfSongsAll = await extractSongs(PDF)

  // ── Modo piloto (offline, sin BD) ────────────────────────────────────────
  if (pilot) {
    const key = normalizeTitle(pilot)
    const canva = canvaSongs.find(s => normalizeTitle(s.title) === key)
    const base = pdfSongsAll.find(s => normalizeTitle(s.title) === key)

    if (!canva) { console.error(`Piloto: canción "${pilot}" no encontrada en HTML.`); process.exit(1) }
    if (!base)  { console.error(`Piloto: canción "${pilot}" no encontrada en PDF.`);  process.exit(1) }

    const canvaLines = parseCanvaSong(canva.lines)
    const json = processSong(canvaLines, base)
    json.dbId = null

    const outPath = `${OUT}/json/${slug(canva.title)}.json`
    writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf8')
    console.log(`Piloto OK → ${outPath}`)
    return
  }

  // ── Modo barrida completa ─────────────────────────────────────────────────
  const { default: sql } = await import('../../api/_lib/db.js')

  try {
    const dbSongs = await sql`SELECT id, title, sections, cejilla, key FROM songs`
    const { pairs, unmatchedPdf, unmatchedDb } = matchByTitle(pdfSongsAll, dbSongs)

    // Índice rápido: normalizedTitle → par {pdf, db}
    const pairByKey = new Map()
    for (const p of pairs) pairByKey.set(normalizeTitle(p.pdf.title), p)

    const status = []

    for (const canva of canvaSongs) {
      const key = normalizeTitle(canva.title)
      const pair = pairByKey.get(key)

      if (!pair) {
        status.push({ title: canva.title, dbId: null, state: 'sin-match-pdf-db' })
        continue
      }

      try {
        const canvaLines = parseCanvaSong(canva.lines)
        const json = processSong(canvaLines, pair.pdf)
        json.dbId = pair.db.id

        const groups = json.sections?.reduce(
          (acc, s) => acc + (s.lines?.reduce((a, l) => a + (l.groups?.length ?? 0), 0) ?? 0), 0
        ) ?? 0
        const stretches = json.sections?.reduce(
          (acc, s) => acc + (s.lines?.reduce((a, l) => a + (l.stretches?.length ?? 0), 0) ?? 0), 0
        ) ?? 0
        const bends = json.sections?.reduce(
          (acc, s) => acc + (s.lines?.reduce((a, l) => a + (l.bends?.length ?? 0), 0) ?? 0), 0
        ) ?? 0
        const directives = json.sections?.reduce(
          (acc, s) => acc + (s.directives?.length ?? 0), 0
        ) ?? 0

        writeFileSync(`${OUT}/json/${slug(canva.title)}.json`, JSON.stringify(json, null, 2), 'utf8')
        status.push({
          title: canva.title,
          dbId: pair.db.id,
          state: json.valid !== false ? 'ok' : 'advertencias',
          groups,
          stretches,
          bends,
          directives,
        })
      } catch (e) {
        status.push({ title: canva.title, dbId: pair.db.id, state: 'error', error: String(e) })
      }
    }

    // sin-match desde el lado PDF (no tiene entrada canva)
    for (const p of unmatchedPdf) {
      const key = normalizeTitle(p.title)
      if (!canvaSongs.some(c => normalizeTitle(c.title) === key)) {
        status.push({ title: p.title, state: 'sin-canva' })
      }
    }

    writeFileSync(`${OUT}/status.json`, JSON.stringify(status, null, 2), 'utf8')

    // Report Markdown
    const ok = status.filter(s => s.state === 'ok').length
    const warn = status.filter(s => s.state === 'advertencias').length
    const err = status.filter(s => s.state === 'error').length
    const unmatched = status.filter(s => s.state.startsWith('sin-')).length

    const rows = status
      .filter(s => s.dbId != null)
      .map(s => `| ${s.title} | ${s.dbId} | ${s.state} | ${s.groups ?? '-'} | ${s.stretches ?? '-'} | ${s.bends ?? '-'} | ${s.directives ?? '-'} |`)
      .join('\n')

    const unmatchedRows = status
      .filter(s => s.state.startsWith('sin-'))
      .map(s => `- ${s.title} (${s.state})`)
      .join('\n')

    const report = `# Reporte Canva — ${new Date().toISOString().slice(0, 10)}

## Resumen

| Estado | Canciones |
|--------|-----------|
| ok | ${ok} |
| advertencias | ${warn} |
| error | ${err} |
| sin-match | ${unmatched} |

## Canciones procesadas

| Título | DB id | Estado | Grupos | Stretches | Bends | Directivas |
|--------|-------|--------|--------|-----------|-------|------------|
${rows}

## No emparejadas

${unmatchedRows || '_Ninguna_'}
`

    writeFileSync(`${OUT}/report-canva.md`, report, 'utf8')

    const byState = status.reduce((m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m), {})
    console.log('Resumen:', byState)
    console.log(`JSONs en ${OUT}/json/ · reporte en ${OUT}/report-canva.md`)
  } finally {
    await sql.end()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
