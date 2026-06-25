import { describe, it, expect } from 'vitest'
import { expandVoices } from '../../scripts/acordes/lib/voiceMap.mjs'

describe('expandVoices', () => {
  it('mapea marcadores simples a SATB', () => {
    expect(expandVoices('HOMBRES')).toEqual(['tenor', 'bass'])
    expect(expandVoices('MUJERES')).toEqual(['soprano', 'contralto'])
    expect(expandVoices('TODOS')).toEqual(['soprano', 'contralto', 'tenor', 'bass'])
    expect(expandVoices('ALTAS')).toEqual(['soprano'])
    expect(expandVoices('ALTOS')).toEqual(['tenor'])
  })
  it('une combinaciones por coma/Y sin duplicar', () => {
    expect(expandVoices('MUJERES, BAJOS Y ALTOS')).toEqual(['soprano', 'contralto', 'bass', 'tenor'])
  })
  it('devuelve null para texto que no es marcador', () => {
    expect(expandVoices('Basta de preguntarse')).toBeNull()
  })
})
