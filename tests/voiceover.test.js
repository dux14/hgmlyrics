// tests/voiceover.test.js
import { describe, it, expect } from 'vitest';
import { splitVoiceover } from '../src/lib/voiceover.js';

describe('splitVoiceover(voiceoverBody, gospelBody)', () => {
  it('corta en separador explícito ---', () => {
    const body = 'Soy el camino.\nY la verdad.\n---\nReflexión propia.';
    const { scripture, reflection } = splitVoiceover(body, null);
    expect(scripture).toBe('Soy el camino.\nY la verdad.');
    expect(reflection).toBe('Reflexión propia.');
  });

  it('el separador --- puede tener espacios alrededor', () => {
    const body = 'Cita.\n  ---  \nReflexión.';
    const { scripture, reflection } = splitVoiceover(body, null);
    expect(scripture).toBe('Cita.');
    expect(reflection).toBe('Reflexión.');
  });

  it('match contra gospel_body: extrae escritura detectada', () => {
    const gospel = 'Yo soy el camino, la verdad y la vida.\nNadie llega al Padre sino por mí.';
    const voz = 'Yo soy el camino, la verdad y la vida.\nReflexionando sobre esto, pienso que...';
    const { scripture, reflection } = splitVoiceover(voz, gospel);
    expect(scripture).toContain('Yo soy el camino');
    expect(reflection).toContain('Reflexionando sobre esto');
  });

  it('normaliza acentos y comillas al comparar (ignora diferencias tipográficas)', () => {
    const gospel = 'Yo soy el camino, la verdad y la vida.';
    const voz = '«Yo soy el camino, la verdad y la vida.»\nReflexión.';
    const { scripture, reflection } = splitVoiceover(voz, gospel);
    expect(scripture).toContain('camino');
    expect(reflection).toContain('Reflexión');
  });

  it('degradación elegante: sin match y sin ---, devuelve todo como scripture, reflexión vacía', () => {
    const body = 'Texto completamente ajeno al evangelio.';
    const gospel = 'En aquel tiempo dijo Jesús a sus discípulos...';
    const { scripture, reflection } = splitVoiceover(body, gospel);
    expect(scripture).toBe(body);
    expect(reflection).toBe('');
  });

  it('gospel_body null devuelve todo como scripture', () => {
    const body = 'Texto sin evangelio disponible.';
    const { scripture, reflection } = splitVoiceover(body, null);
    expect(scripture).toBe(body);
    expect(reflection).toBe('');
  });
});
