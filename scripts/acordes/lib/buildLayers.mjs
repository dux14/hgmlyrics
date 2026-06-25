// scripts/acordes/lib/buildLayers.mjs
const CATEGORY = { soprano: 'soprano', contralto: 'contralto', tenor: 'tenor', bass: 'bass' }

export function applyVoiceBlocks(lines) {
  let current = []
  return lines.map(l => {
    if (l.marker?.mode === 'block') { current = l.marker.voices; return { ...l, voices: current } }
    if (l.marker?.mode === 'inline') return { ...l, voices: l.marker.voices }
    return { ...l, voices: current }
  })
}

export function mergeLayers(baseSong, layersByBaseLine) {
  const rosterIds = new Set()
  const sections = baseSong.sections.map((sec, si) => ({
    ...sec,
    lines: sec.lines.map((ln, li) => {
      const layer = layersByBaseLine[`${si}:${li}`]
      if (!layer) return ln
      const end = ln.text.length
      const groups = (layer.voices ?? []).map(v => { rosterIds.add(v); return { start: 0, end, voiceId: v } })
      return {
        ...ln,
        ...(groups.length ? { groups } : {}),
        ...(layer.stretches?.length ? { stretches: layer.stretches } : {}),
        ...(layer.bends?.length ? { bends: layer.bends } : {}),
      }
    }),
    ...(sec.directives ? { directives: sec.directives } : {}),
  }))
  const voiceRoster = [...rosterIds].map(id => ({ id, label: id, category: CATEGORY[id] ?? id }))
  return { ...baseSong, sections, voiceRoster }
}
