import { describe, it, expect } from 'vitest';
import { buildLetraLineHTML } from '../src/lib/lyricsRender.js';

describe('buildLetraLineHTML', () => {
  it('devuelve texto escapado plano, sin wrappers ni color', () => {
    expect(buildLetraLineHTML('Santo es el Señor')).toBe('Santo es el Señor');
  });

  it('escapa HTML', () => {
    expect(buildLetraLineHTML('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });

  it('tolera vacío/undefined', () => {
    expect(buildLetraLineHTML('')).toBe('');
    expect(buildLetraLineHTML(undefined)).toBe('');
  });
});
