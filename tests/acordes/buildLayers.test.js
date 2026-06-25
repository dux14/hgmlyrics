// tests/acordes/buildLayers.test.js
import { describe, it, expect } from 'vitest'
import { applyVoiceBlocks, mergeLayers } from '../../scripts/acordes/lib/buildLayers.mjs'

describe('applyVoiceBlocks', () => {
  it('propaga marcador en bloque hasta el siguiente; inline a su línea', () => {
    const lines = [
      { marker: { mode: 'block', voices: ['tenor','bass'] }, clean: '' },
      { marker: null, clean: 'basta de preguntarse' },
      { marker: { mode: 'inline', voices: ['soprano','contralto','tenor','bass'] }, clean: 'en un beso' },
      { marker: null, clean: 'en el agua' },
    ]
    const r = applyVoiceBlocks(lines)
    expect(r[1].voices).toEqual(['tenor','bass'])        // hereda bloque HOMBRES
    expect(r[2].voices).toEqual(['soprano','contralto','tenor','bass']) // inline TODOS
    expect(r[3].voices).toEqual(['tenor','bass'])        // vuelve al bloque vigente
  })
})

describe('mergeLayers', () => {
  it('escribe capas sin tocar text/chords', () => {
    const baseSong = { sections: [{ type: 'verse', lines: [{ text: 'Sal de ti', chords: [{ pos: 0, ch: 'A' }] }] }] }
    const layersByBaseLine = { '0:0': { voices: ['tenor','bass'], stretches: [{ pos: 7, len: 4 }], bends: [{ pos: 7, dir: 'down' }] } }
    const out = mergeLayers(baseSong, layersByBaseLine)
    const line = out.sections[0].lines[0]
    expect(line.text).toBe('Sal de ti')           // intacto
    expect(line.chords).toEqual([{ pos: 0, ch: 'A' }]) // intacto
    expect(line.groups).toEqual([{ start: 0, end: 9, voiceId: 'tenor' }, { start: 0, end: 9, voiceId: 'bass' }])
    expect(line.stretches).toEqual([{ pos: 7, len: 4 }])
    expect(out.voiceRoster.map(v => v.id)).toEqual(expect.arrayContaining(['tenor','bass']))
  })
})
