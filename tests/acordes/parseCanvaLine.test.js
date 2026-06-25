import { describe, it, expect } from 'vitest'
import { parseVoiceMarker, parseStretches, parseBends, parseDirectives, parseCanvaLine } from '../../scripts/acordes/lib/parseCanvaLine.mjs'

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
  it('directiva de texto a mitad de línea + emoji: cada pos cae en el borde correcto del clean', () => {
    const r = parseDirectives('Sal de ti REPITE gloria 🎹 final', gloss)
    expect(r.clean).toBe('Sal de ti gloria final')
    // pos de cada directiva debe ubicarse en un borde de palabra del clean, no a mitad
    for (const d of r.directives) {
      const before = r.clean.slice(0, d.pos)
      expect(before === '' || /\s$/.test(before) || /\w$/.test(r.clean[d.pos] ?? '') === false).toBe(true)
    }
    const repite = r.directives.find(d => d.kind === 'repite')
    const piano = r.directives.find(d => d.kind === 'piano')
    expect(r.clean.slice(repite.pos).startsWith('gloria')).toBe(true)
    expect(r.clean.slice(0, piano.pos).trimEnd()).toBe('Sal de ti gloria')
  })
  it('no deja espacios dobles tras quitar directivas', () => {
    const r = parseDirectives('uno [silencio 2] dos 🛸 tres', gloss)
    expect(r.clean).toBe('uno dos tres')
    expect(r.clean).not.toMatch(/ {2,}/)
  })
})

describe('parseBends — map de deleción', () => {
  it('a↗️b → map lleva índice de b al índice correcto en "ab"', () => {
    const r = parseBends('a↗️b')
    // input: 'a'=0, '↗'=1, '️'=2(VS16), 'b'=3 → clean: 'a'=0, 'b'=1
    // map[0]=0 (a→a), map[3]=1 (b→b en clean)
    expect(r.clean).toBe('ab')
    expect(r.map).toBeDefined()
    // índice 0 ('a') → 0 en clean
    expect(r.map[0]).toBe(0)
    // índice de 'b' en el input (3) → 1 en clean
    const bIdx = 'a↗️'.length // posición de 'b' en la cadena original
    expect(r.map[bIdx]).toBe(1)
  })

  it('map es monótono no decreciente', () => {
    const r = parseBends('do↘️↗️re')
    expect(r.clean).toBe('dore')
    for (let i = 1; i < r.map.length; i++) {
      expect(r.map[i]).toBeGreaterThanOrEqual(r.map[i - 1])
    }
  })
})

describe('parseCanvaLine — composición con reenvío de coordenadas', () => {
  it('desfase de coords: [REPITE] sal de tiii-iiii → pos del stretch apunta a la i final', () => {
    const r = parseCanvaLine('[REPITE] sal de tiii-iiii')
    expect(r.clean).toBe('sal de ti')
    // directiva repite en pos 0 del clean
    const repite = r.directives.find(d => d.kind === 'repite')
    expect(repite).toBeDefined()
    expect(repite.pos).toBe(0)
    // stretch debe apuntar a la 'i' de 'ti' en el clean final
    expect(r.stretches).toHaveLength(1)
    expect(r.stretches[0].pos).toBe(8)
    expect(r.clean[r.stretches[0].pos]).toBe('i')
  })

  it('stretch + bend + directiva coexistiendo con clamp en [0, clean.length]', () => {
    // clean esperado: "gloria" (stretch→ "tiii-iiii"→"ti" pero luego todo se quita con SILENCIO y 🎹→"piano")
    // Línea: "[SILENCIO] tiii-iiii↗️ gloria 🎹"
    // 1. parseVoiceMarker → null (no hay marcador de voz)
    // 2. parseStretches("[SILENCIO] tiii-iiii↗️ gloria 🎹") → stretch pos en "[SILENCIO] ti↗️ gloria 🎹"
    // 3. parseBends → remueve ↗️
    // 4. parseDirectives("[SILENCIO] ti gloria 🎹", {'🎹':'piano'}) → remueve [SILENCIO] y 🎹
    //    clean = "ti gloria"... pero [SILENCIO] + espacios colapsados → clean = "ti gloria"
    // Recheck: parseDirectives quita [SILENCIO] al inicio → "ti gloria" luego quita 🎹 → "ti gloria"
    // clean final = "ti gloria"
    const r = parseCanvaLine('[SILENCIO] tiii-iiii↗️ gloria 🎹', { '🎹': 'piano' })
    // Verificar clean razonable (sin directivas ni flechas ni stretch)
    expect(r.clean).not.toMatch(/↗|↘|〰|➡/)
    expect(r.clean).not.toMatch(/\[/)
    expect(r.clean).not.toMatch(/🎹/)
    // Todas las pos dentro de [0, clean.length]
    for (const s of r.stretches) {
      expect(s.pos).toBeGreaterThanOrEqual(0)
      expect(s.pos).toBeLessThanOrEqual(r.clean.length)
    }
    for (const b of r.bends) {
      expect(b.pos).toBeGreaterThanOrEqual(0)
      expect(b.pos).toBeLessThanOrEqual(r.clean.length)
    }
    for (const d of r.directives) {
      expect(d.pos).toBeGreaterThanOrEqual(0)
      expect(d.pos).toBeLessThanOrEqual(r.clean.length)
    }
    // El stretch debe apuntar a un índice válido con contenido real o al borde
    if (r.stretches.length > 0) {
      const pos = r.stretches[0].pos
      const ch = r.clean[pos]
      // si apunta dentro del string, debe ser letra o estar en el borde
      if (pos < r.clean.length) {
        expect(ch).toMatch(/\S/)
      }
    }
    // directives incluye silencio y piano
    expect(r.directives.some(d => d.kind === 'silencio')).toBe(true)
    expect(r.directives.some(d => d.kind === 'piano')).toBe(true)
  })

  it('marcador de voz + stretch: TODOS sal de tiii-iiii → marker inline, clean "sal de ti", stretch pos 8', () => {
    const r = parseCanvaLine('TODOS sal de tiii-iiii')
    expect(r.marker).not.toBeNull()
    expect(r.marker.mode).toBe('inline')
    expect(r.clean).toBe('sal de ti')
    expect(r.stretches).toHaveLength(1)
    expect(r.stretches[0].pos).toBe(8)
    expect(r.clean[r.stretches[0].pos]).toBe('i')
  })

  it('línea sin anotaciones → pasa limpia', () => {
    const r = parseCanvaLine('basta de quererla comprender')
    expect(r.clean).toBe('basta de quererla comprender')
    expect(r.stretches).toEqual([])
    expect(r.bends).toEqual([])
    expect(r.directives).toEqual([])
    expect(r.marker).toBeNull()
  })
})
