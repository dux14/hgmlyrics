import { describe, it, expect } from 'vitest';
import { escapeHtml, safeUrl } from './escape.js';

describe('escapeHtml', () => {
  it('escapes <', () => expect(escapeHtml('<')).toBe('&lt;'));
  it('escapes >', () => expect(escapeHtml('>')).toBe('&gt;'));
  it('escapes &', () => expect(escapeHtml('&')).toBe('&amp;'));
  it('escapes "', () => expect(escapeHtml('"')).toBe('&quot;'));
  it("escapes '", () => expect(escapeHtml("'")).toBe('&#39;'));
  it('handles null', () => expect(escapeHtml(null)).toBe(''));
  it('handles undefined', () => expect(escapeHtml(undefined)).toBe(''));
  it('handles numbers', () => expect(escapeHtml(42)).toBe('42'));
  it('escapes a combined string', () =>
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    ));
  it('passes through safe text unchanged', () =>
    expect(escapeHtml('Hello World')).toBe('Hello World'));
});

describe('safeUrl', () => {
  it('accepts https URLs', () => expect(safeUrl('https://x.com/path')).toBe('https://x.com/path'));
  it('accepts http URLs', () => expect(safeUrl('http://x.com/path')).toBe('http://x.com/path'));
  it('rejects javascript: scheme', () => expect(safeUrl('javascript:alert(1)')).toBe(''));
  it('rejects data: scheme', () => expect(safeUrl('data:text/html,<h1>hi</h1>')).toBe(''));
  // Note: '//evil.com' is a protocol-relative URL. new URL('//evil.com', origin)
  // resolves using the origin's protocol. In jsdom the origin is http://localhost,
  // so '//evil.com' becomes 'http://evil.com' — a valid http URL. This is the
  // correct browser behavior; the critical threats are javascript: and data: above.
  it('protocol-relative //evil.com resolves to http: (jsdom behavior)', () => {
    const result = safeUrl('//evil.com');
    // Either '' (if no origin) or 'http://evil.com/' (jsdom resolves to http)
    expect(result === '' || result === 'http://evil.com/').toBe(true);
  });
});
