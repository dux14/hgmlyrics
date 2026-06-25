// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSongJson } from '../../scripts/acordes/lib/emitSongJson.mjs'

describe('buildSongJson', () => {
  it('produce un modelo válido con capas y sin tocar text', () => {
    const enriched = {
      title: 'Olor a tostadas', cejilla: 2, key: null,
      voiceRoster: [{ id: 'tenor', label: 'tenor', category: 'tenor' }],
      sections: [{ type: 'verse', lines: [{ text: 'Sal de ti', chords: [], groups: [{ start: 0, end: 9, voiceId: 'tenor' }] }] }],
    }
    const json = buildSongJson(enriched)
    expect(json.sections[0].lines[0].text).toBe('Sal de ti')
    expect(json.valid).toBe(true)
    expect(json.schemaVersion).toBe(3)
  })
})
