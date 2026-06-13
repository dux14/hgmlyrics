/**
 * Tests for the pure decision helpers in imageCompress.js.
 *
 * NOTE: The canvas encoding path (compressImageToLimit when compression is
 * actually needed) cannot be tested here because jsdom does not implement
 * createImageBitmap, HTMLCanvasElement.toBlob, or OffscreenCanvas.
 * That path is verified via Playwright E2E in the browser.
 */
import { describe, it, expect } from 'vitest';
import { needsCompression, computeTargetDimensions } from './imageCompress.js';

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// needsCompression
// ---------------------------------------------------------------------------
describe('needsCompression', () => {
  it('returns false for a small webp within the limit', () => {
    const file = new File(['x'], 'avatar.webp', { type: 'image/webp' });
    Object.defineProperty(file, 'size', { value: 1 * MB });
    expect(needsCompression(file, 2 * MB)).toBe(false);
  });

  it('returns false for a small jpeg within the limit', () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 500 * 1024 });
    expect(needsCompression(file, 2 * MB)).toBe(false);
  });

  it('returns false for a small png within the limit', () => {
    const file = new File(['x'], 'icon.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 200 * 1024 });
    expect(needsCompression(file, 2 * MB)).toBe(false);
  });

  it('returns true for an allowed type that exceeds the limit', () => {
    const file = new File(['x'], 'big.jpeg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 5 * MB });
    expect(needsCompression(file, 2 * MB)).toBe(true);
  });

  it('returns true for image/png exceeding the limit', () => {
    const file = new File(['x'], 'large.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 3 * MB });
    expect(needsCompression(file, 2 * MB)).toBe(true);
  });

  it('returns true for a non-permitted type (e.g. image/gif) even if small', () => {
    const file = new File(['x'], 'anim.gif', { type: 'image/gif' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 });
    expect(needsCompression(file, 2 * MB)).toBe(true);
  });

  it('returns true at exactly the limit boundary (size === maxBytes is ok → false)', () => {
    const file = new File(['x'], 'exact.webp', { type: 'image/webp' });
    Object.defineProperty(file, 'size', { value: 2 * MB });
    // size === maxBytes: NOT > maxBytes, so no compression needed.
    expect(needsCompression(file, 2 * MB)).toBe(false);
  });

  it('returns true one byte above the limit', () => {
    const file = new File(['x'], 'just-over.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 2 * MB + 1 });
    expect(needsCompression(file, 2 * MB)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeTargetDimensions
// ---------------------------------------------------------------------------
describe('computeTargetDimensions', () => {
  it('does not change dimensions already within the limit', () => {
    expect(computeTargetDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });

  it('does not change a square image within the limit', () => {
    expect(computeTargetDimensions(512, 512, 1024)).toEqual({ width: 512, height: 512 });
  });

  it('scales down a landscape image so the long side equals maxDimension', () => {
    // 4000×3000 with max 1024 → ratio 1024/4000 = 0.256 → 1024×768
    expect(computeTargetDimensions(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('scales down a portrait image so the long side equals maxDimension', () => {
    // 3000×4000 with max 1024 → ratio 1024/4000 = 0.256 → 768×1024
    expect(computeTargetDimensions(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('scales down a square image exceeding the limit', () => {
    // 2048×2048 with max 1024 → 1024×1024
    expect(computeTargetDimensions(2048, 2048, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('preserves aspect ratio for an odd-shaped image', () => {
    // 1920×1080 with max 1024 → ratio 1024/1920 → 1024×546 (rounded)
    const { width, height } = computeTargetDimensions(1920, 1080, 1024);
    expect(width).toBe(1024);
    expect(height).toBe(576);
  });

  it('does not upscale an image smaller than maxDimension', () => {
    expect(computeTargetDimensions(100, 100, 1024)).toEqual({ width: 100, height: 100 });
  });
});
