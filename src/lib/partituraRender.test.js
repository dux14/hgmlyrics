import { describe, it, expect } from 'vitest';
import { renderVoiceLines } from './partituraRender.js';

describe('renderVoiceLines', () => {
  it('renderiza texto y nota por silaba', () => {
    const html = renderVoiceLines({
      lines: [{ syllables: [{ text: 'Me', note: 'C4', ditto: false, blank: false }] }],
    });
    expect(html).toContain('>Me<');
    expect(html).toContain('>C4<');
  });

  it('silaba blank produce label vacio', () => {
    const html = renderVoiceLines({
      lines: [{ syllables: [{ text: '-', note: 'D4', blank: true }] }],
    });
    expect(html).toContain('<span class="partitura__syl-note"></span>');
  });

  it('silaba ditto produce label de comillas repetidas', () => {
    const html = renderVoiceLines({
      lines: [{ syllables: [{ text: 'la', ditto: true }] }],
    });
    expect(html).toContain('&#39;&#39;');
  });

  it('escapa XSS en el texto de la silaba', () => {
    const html = renderVoiceLines({
      lines: [{ syllables: [{ text: '<img src=x onerror=alert(1)>', note: 'E4' }] }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('voz null devuelve string vacio sin romper', () => {
    expect(renderVoiceLines(null)).toBe('');
  });

  it('voz sin lines devuelve string vacio sin romper', () => {
    expect(renderVoiceLines({})).toBe('');
  });
});
