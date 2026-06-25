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

  // --- casos nuevos (bug de fragmento con offset) ---

  it('fragmento con offset: pos 0 en Canva "ti afecte" → índice 7 en base "Sal de ti afecte"', () => {
    // 'Sal de ti afecte'[7] === 't' (inicio de "ti")
    const result = remapPositions([{ pos: 0, dir: 'up' }], 'ti afecte', 'Sal de ti afecte')
    expect(result).toHaveLength(1)
    expect(result[0].pos).toBe(7)
    expect(result[0].dir).toBe('up') // campo extra preservado
  })

  it('intra-palabra: pos 1 en Canva "ti" → pos 8 en base "Sal de ti" (intra 1 dentro de "ti")', () => {
    const result = remapPositions([{ pos: 1 }], 'ti', 'Sal de ti')
    expect(result).toHaveLength(1)
    expect(result[0].pos).toBe(8)
  })

  it('preserva campos extra (dir, len, kind) en el objeto resultante', () => {
    const result = remapPositions(
      [{ pos: 0, dir: 'up', len: 3, kind: 'bend' }],
      'ti afecte',
      'Sal de ti afecte'
    )
    expect(result[0]).toMatchObject({ dir: 'up', len: 3, kind: 'bend' })
  })

  it('ancla al final: pos === canvaClean.length mapea a baseText.length o dentro de rango', () => {
    const canva = 'ti afecte'
    const base = 'Sal de ti afecte'
    const result = remapPositions([{ pos: canva.length }], canva, base)
    expect(result).toHaveLength(1)
    expect(result[0].pos).toBeGreaterThanOrEqual(0)
    expect(result[0].pos).toBeLessThanOrEqual(base.length)
  })

  it('multi-palabra en orden: [pos:0, pos:4] en "de ti" mapea a "de" y "ti" en "xx de ti yy"', () => {
    // "xx de ti yy": "de" arranca en 3, "ti" arranca en 6
    const result = remapPositions([{ pos: 0 }, { pos: 3 }], 'de ti', 'xx de ti yy')
    expect(result).toHaveLength(2)
    // pos:0 → inicio de "de" en base (índice 3)
    expect(result[0].pos).toBe(3)
    // pos:3 → inicio de "ti" en base (índice 6)
    expect(result[1].pos).toBe(6)
  })
})
