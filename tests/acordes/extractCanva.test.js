// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { splitSections, sectionLines } from '../../scripts/acordes/lib/extractCanva.mjs'

const olor = readFileSync(new URL('./fixtures/canva-olor.html', import.meta.url), 'utf-8')

describe('sectionLines', () => {
  it('extrae líneas en orden desde la capa opacity:0', () => {
    const lines = sectionLines(olor)
    expect(lines[0]).toBe('🍞Olor a tostadas')
    expect(lines).toContain('HOMBRES')
    expect(lines).toContain('MUJERES,  BAJOS Y ALTOS: sal de tiii-iiii↘️')
    expect(lines.every(l => !l.includes('<'))).toBe(true)
  })
})

describe('splitSections', () => {
  it('una section sola devuelve un elemento', () => {
    expect(splitSections(olor)).toHaveLength(1)
  })
})
