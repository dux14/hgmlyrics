import { describe, it, expect } from 'vitest'
import { parseVoiceMarker } from '../../scripts/acordes/lib/parseCanvaLine.mjs'

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
