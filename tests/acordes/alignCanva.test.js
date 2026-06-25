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

  // --- anti-robo: fragmento no debe robar la línea completa ---

  it('anti-robo: fragmento ANTES de la completa — la línea completa gana el base', () => {
    // "sal de ti" (fragmento, ci=0) procesado antes que la línea completa (ci=1)
    // Ambos tienen conf 1.00 contra base[1], pero la completa tiene mayor `inter`
    const canva = [
      { clean: 'sal de ti' },
      { clean: 'Sal de ti, que todo te afecte,' },
    ]
    const base = ['otra cosa', 'Sal de ti, que todo te afecte,']
    const pairs = alignLines(canva, base)
    // La línea completa (ci=1) debe obtener baseIndex 1
    expect(pairs[1].baseIndex).toBe(1)
    // El fragmento (ci=0) no tiene base libre disponible → null
    expect(pairs[0].baseIndex).toBeNull()
  })

  it('anti-robo: fragmento DESPUÉS de la completa — el resultado no depende del orden de entrada', () => {
    const canva = [
      { clean: 'Sal de ti, que todo te afecte,' },
      { clean: 'sal de ti' },
    ]
    const base = ['Sal de ti, que todo te afecte,']
    const pairs = alignLines(canva, base)
    // La completa (ci=0) toma baseIndex 0
    expect(pairs[0].baseIndex).toBe(0)
    // El fragmento (ci=1) queda sin base
    expect(pairs[1].baseIndex).toBeNull()
  })

  it('anti-robo: dos instancias base + eco — las completas toman las instancias, el eco queda null', () => {
    const canva = [
      { clean: 'Sal de ti, que todo te afecte,' },
      { clean: 'sal de ti' },
      { clean: 'Sal de ti, que todo te afecte,' },
    ]
    const base = [
      'Sal de ti, que todo te afecte,',
      'x y z',
      'Sal de ti, que todo te afecte,',
    ]
    const pairs = alignLines(canva, base)
    // Las dos líneas completas (ci=0 y ci=2) toman base 0 y base 2 (en algún orden)
    const assigned = [pairs[0].baseIndex, pairs[2].baseIndex].sort()
    expect(assigned).toEqual([0, 2])
    // El eco (ci=1) queda sin base
    expect(pairs[1].baseIndex).toBeNull()
  })

  it('determinismo: el mismo input produce el mismo resultado en dos ejecuciones', () => {
    const canva = [
      { clean: 'sal de ti' },
      { clean: 'Sal de ti, que todo te afecte,' },
      { clean: 'rie duerme' },
    ]
    const base = ['Sal de ti, que todo te afecte,', 'Ríe, duerme,', 'otra cosa']
    const r1 = alignLines(canva, base)
    const r2 = alignLines(canva, base)
    expect(r1).toEqual(r2)
  })

  it('no regresión de empate simple: fragmentos cortos distintos se asignan correctamente', () => {
    const canva = [{ clean: 'sal de ti' }, { clean: 'rie duerme' }]
    const base = ['Sal de ti,', 'Ríe, duerme,']
    const pairs = alignLines(canva, base)
    expect(pairs[0].baseIndex).toBe(0)
    expect(pairs[1].baseIndex).toBe(1)
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
