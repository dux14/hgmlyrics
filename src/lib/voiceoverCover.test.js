import { describe, it, expect } from 'vitest';
import { voiceoverCoverHtml } from './voiceoverCover.js';

describe('voiceoverCoverHtml', () => {
  it('usa el gradiente del color litúrgico y el icono gospel', () => {
    const html = voiceoverCoverHtml('green', { size: 48 });
    expect(html).toContain('#1a3a2a'); // bg de la paleta green
    expect(html).toContain('<svg');
    expect(html).toContain('width:48px');
  });

  it('degrada a FALLBACK cuando el color es nulo o desconocido', () => {
    const html = voiceoverCoverHtml(null);
    expect(html).toContain('#1a1a2a'); // bg del FALLBACK
  });

  it('respeta size y radius', () => {
    const html = voiceoverCoverHtml('red', { size: 32, radius: 6 });
    expect(html).toContain('width:32px');
    expect(html).toContain('height:32px');
    expect(html).toContain('border-radius:6px');
  });
});
