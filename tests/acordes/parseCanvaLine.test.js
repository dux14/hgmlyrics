import { describe, it, expect } from 'vitest'
import { parseVoiceMarker, parseStretches, parseBends, parseDirectives } from '../../scripts/acordes/lib/parseCanvaLine.mjs'

describe('parseVoiceMarker', () => {
  it('marcador en línea sola → block', () => {
    expect(parseVoiceMarker('HOMBRES')).toEqual({ mode: 'block', voices: ['tenor', 'bass'], clean: '' })
  })
  it('prefijo inline → aplica a la línea', () => {
    expect(parseVoiceMarker('TODOS Basta de compararse')).toEqual({
      mode: 'inline', voices: ['soprano','contralto','tenor','bass'], clean: 'Basta de compararse' })
  })
  it('combinación inline con dos puntos', () => {
    const r = parseVoiceMarker('MUJERES,  BAJOS Y ALTOS: sal de ti')
    expect(r.mode).toBe('inline')
    expect(r.voices).toEqual(['soprano','contralto','bass','tenor'])
    expect(r.clean).toBe('sal de ti')
  })
  it('línea sin marcador → null', () => {
    expect(parseVoiceMarker('basta de quererla comprender')).toBeNull()
  })
})

describe('parseStretches', () => {
  it('pegado con guiones: tiii-iiii → ti', () => {
    const r = parseStretches('sal de tiii-iiii')
    expect(r.clean).toBe('sal de ti')
    expect(r.stretches).toHaveLength(1)
    expect(r.clean[r.stretches[0].pos]).toBe('i') // la vocal alargada
    expect(r.stretches[0].len).toBeGreaterThan(1)
  })
  it('anotación entre paréntesis: (aaa-aaa-aaa) se elimina del texto', () => {
    const r = parseStretches('en el olor (aaa-aaa-aaa) de unas tostadas')
    expect(r.clean).toBe('en el olor de unas tostadas')
    expect(r.stretches).toHaveLength(1)
  })
  it('vocal repetida pegada: eternidaaaad → eternidad', () => {
    const r = parseStretches('en toda la eternidaaaad')
    expect(r.clean).toBe('en toda la eternidad')
    expect(r.stretches[0].len).toBeGreaterThan(1)
  })
  it('sin alargamiento → stretches vacío', () => {
    expect(parseStretches('basta de quererla').stretches).toEqual([])
  })
})

describe('parseBends', () => {
  it('↘️ al final → down y se quita del texto', () => {
    const r = parseBends('sal de ti↘️')
    expect(r.clean).toBe('sal de ti')
    expect(r.bends).toEqual([{ pos: 9, dir: 'down' }])
  })
  it('mapea las 4 flechas', () => {
    expect(parseBends('a↗️').bends[0].dir).toBe('up')
    expect(parseBends('a〰️').bends[0].dir).toBe('wave')
    expect(parseBends('a➡️').bends[0].dir).toBe('flat')
  })
  it('no confunde emojis de producción (🛸👽) con bends', () => {
    const r = parseBends('La vida pasa.👽')
    expect(r.bends).toEqual([])
    expect(r.clean).toBe('La vida pasa.👽') // 👽 lo maneja parseDirectives, no bends
  })
})

describe('parseDirectives', () => {
  const gloss = { '👽': 'fin disco', '🛸': 'inicio disco', '🎹': 'piano' }
  it('emoji de producción inline → directiva con pos exacta, se quita del texto', () => {
    const r = parseDirectives('La vida pasa.👽', gloss)
    expect(r.clean).toBe('La vida pasa.')
    expect(r.directives).toEqual([{ kind: 'fin disco', pos: 13, raw: '👽' }])
  })
  it('marcador de texto de dirección: [silencio 4]', () => {
    const r = parseDirectives('[silencio 4]', gloss)
    expect(r.directives[0].kind).toBe('silencio')
  })
  it('línea sin directiva → vacío', () => {
    expect(parseDirectives('basta de quererla', gloss).directives).toEqual([])
  })
})
