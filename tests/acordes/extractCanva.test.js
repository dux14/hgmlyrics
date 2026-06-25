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

import { detectSongTitle, joinContinuations } from '../../scripts/acordes/lib/extractCanva.mjs'

describe('detectSongTitle', () => {
  it('reconoce título de canción (emoji + nombre)', () => {
    expect(detectSongTitle(['🍞Olor a tostadas', 'HOMBRES'])).toEqual({ title: 'Olor a tostadas', isSong: true })
  })
  it('marca separadores/carpetas como no-canción', () => {
    expect(detectSongTitle(['Carpeta audios']).isSong).toBe(false)
    expect(detectSongTitle(['Canciones al Espíritu Santo']).isSong).toBe(false)
    expect(detectSongTitle(['🙏🏻']).isSong).toBe(false) // solo emoji
  })
})

describe('joinContinuations', () => {
  it('fusiona sections sin título nuevo en la canción anterior', () => {
    const secs = [['🦋 Libertad', 'verso A'], ['continuación sin título'], ['🤱 Madre', 'verso B']]
    const songs = joinContinuations(secs)
    expect(songs).toHaveLength(2)
    expect(songs[0].title).toBe('Libertad')
    expect(songs[0].lines).toContain('continuación sin título')
    expect(songs[1].title).toBe('Madre')
  })
})

import { splitArrangementPreamble, splitEmojiGlossary } from '../../scripts/acordes/lib/extractCanva.mjs'

describe('splitArrangementPreamble', () => {
  it('separa el preámbulo de arreglo del cuerpo', () => {
    const body = ['Base mujeres', 'Completa', 'Segundas hombres', '🎸🌻', 'HOMBRES', 'Basta de preguntarse']
    const r = splitArrangementPreamble(body)
    expect(r.preamble).toEqual(['Base mujeres', 'Completa', 'Segundas hombres'])
    expect(r.body[0]).toBe('🎸🌻')
  })
})

describe('splitEmojiGlossary', () => {
  it('separa el glosario final emoji→significado', () => {
    const lines = ['letra real', '🛸-> inicio disco', '👽 -> fin disco']
    const r = splitEmojiGlossary(lines)
    expect(r.body).toEqual(['letra real'])
    expect(r.glossary['🛸']).toBe('inicio disco')
    expect(r.glossary['👽']).toBe('fin disco')
  })
})
