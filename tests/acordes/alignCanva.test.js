// tests/acordes/alignCanva.test.js
import { describe, it, expect } from 'vitest'
import { alignLines, remapPositions } from '../../scripts/acordes/lib/alignCanva.mjs'

describe('alignLines', () => {
  it('empareja por texto normalizado pese a mayúsculas/acentos', () => {
    const canva = [{ clean: 'sal de ti' }, { clean: 'rie duerme' }]
    const base = ['Sal de ti,', 'Ríe, duerme,']
    const pairs = alignLines(canva, base)
    expect(pairs[0]).toMatchObject({ baseIndex: 0, confidence: expect.any(Number) })
    expect(pairs[0].confidence).toBeGreaterThan(0.8)
  })
  it('línea Canva sin contraparte → baseIndex null', () => {
    const pairs = alignLines([{ clean: 'xyz inexistente' }], ['Sal de ti'])
    expect(pairs[0].baseIndex).toBeNull()
  })
})

describe('remapPositions', () => {
  it('traslada pos directo si el texto limpio coincide', () => {
    expect(remapPositions([{ pos: 7, dir: 'down' }], 'sal de ti', 'Sal de ti,')).toEqual([{ pos: 7, dir: 'down' }])
  })
  it('descarta anotación si la confianza es baja (texto difiere mucho)', () => {
    expect(remapPositions([{ pos: 3, dir: 'up' }], 'abcdef', 'zzzzzz')).toEqual([])
  })
})
