/**
 * imageCompress.js — Client-side image compression before upload.
 *
 * NOTE: The canvas encoding path (createImageBitmap + toBlob) cannot be
 * tested in Vitest/jsdom because jsdom does not implement canvas rendering.
 * The pure decision helpers (needsCompression, computeTargetDimensions) are
 * fully unit-tested. The canvas encoding path is verified via Playwright E2E.
 */

const ALLOWED_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);
const MAX_ITERATIONS = 20;

/**
 * Returns true if the file needs to go through canvas compression.
 * A file does NOT need compression when:
 *   - its MIME type is already an allowed upload type, AND
 *   - its size is within the byte limit.
 *
 * @param {File} file
 * @param {number} maxBytes
 * @returns {boolean}
 */
export function needsCompression(file, maxBytes) {
  return !ALLOWED_TYPES.has(file.type) || file.size > maxBytes;
}

/**
 * Compute output dimensions such that neither side exceeds maxDimension,
 * preserving aspect ratio. If both dimensions are already within the limit,
 * returns them unchanged.
 *
 * @param {number} width  original width in pixels
 * @param {number} height original height in pixels
 * @param {number} maxDimension
 * @returns {{ width: number, height: number }}
 */
export function computeTargetDimensions(width, height, maxDimension) {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const ratio = maxDimension / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Compress a File (image) in the browser using Canvas so that the result is:
 *   - one of image/webp, image/jpeg (allowed by the upload endpoint)
 *   - at most maxBytes in size
 *
 * Behaviour for non-image files (MIME does not start with "image/"):
 *   Throws an Error — the upload input is already constrained to image types,
 *   so reaching this path would be a programming mistake.
 *
 * Behaviour when the file is already a permitted type AND within the size limit:
 *   Returns the original File unchanged (no re-encoding, no quality loss).
 *
 * @param {File} file
 * @param {{ maxBytes?: number, maxDimension?: number }} [options]
 * @returns {Promise<File>}
 */
export async function compressImageToLimit(
  file,
  { maxBytes = 2 * 1024 * 1024, maxDimension = 1024 } = {},
) {
  if (!file.type.startsWith('image/')) {
    throw new Error(`El archivo no es una imagen (tipo: ${file.type})`);
  }

  // Fast path: already a valid type and within the size limit.
  if (!needsCompression(file, maxBytes)) return file;

  // Decode the image once.
  const bitmap = await createImageBitmap(file);

  let result = null;

  try {
    const initial = computeTargetDimensions(bitmap.width, bitmap.height, maxDimension);
    let width = initial.width;
    let height = initial.height;

    // Detect WebP encode support once: some browsers (Safari/iOS) silently return
    // a PNG blob instead of null when asked for image/webp. We treat any response
    // whose type is not 'image/webp' as "no WebP support" and use JPEG for all
    // iterations — JPEG reliably respects the quality parameter.
    const probeBlob = await encodeCanvas(bitmap, width, height, 'image/webp', 0.9);
    const webpSupported = probeBlob !== null && probeBlob.type === 'image/webp';
    const format = webpSupported ? 'image/webp' : 'image/jpeg';

    // Reuse the probe result for the first quality step to avoid a wasted encode.
    // It is only valid at the initial dimensions and quality 0.9.
    let probeConsumed = false;

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      // Try at decreasing quality levels (start at 0.9, down to 0.4).
      let quality = 0.9;
      while (quality >= 0.4) {
        let candidate;
        if (webpSupported && !probeConsumed && quality === 0.9) {
          // Reuse the probe (same dimensions, same quality, same format).
          candidate = probeBlob;
          probeConsumed = true;
        } else {
          candidate = await encodeCanvas(bitmap, width, height, format, quality);
        }
        if (candidate && candidate.size <= maxBytes) {
          result = candidate;
          break;
        }
        quality = Math.round((quality - 0.1) * 10) / 10; // avoid float drift
      }

      if (result) break;

      // Still too large — shrink dimensions and retry.
      width = Math.max(1, Math.round(width * 0.8));
      height = Math.max(1, Math.round(height * 0.8));
      iterations++;
    }
  } finally {
    // Always release the ImageBitmap, even if an error is thrown above.
    bitmap.close();
  }

  if (!result) {
    throw new Error('No se pudo reducir la imagen por debajo del limite de tamano.');
  }

  const ext = result.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([result], `avatar.${ext}`, { type: result.type });
}

/**
 * Draw `bitmap` at `width × height` on a canvas and encode it.
 * Returns the Blob, or null if the browser returns null (unsupported format).
 *
 * @param {ImageBitmap} bitmap
 * @param {number} width
 * @param {number} height
 * @param {string} format  e.g. "image/webp"
 * @param {number} quality 0–1
 * @returns {Promise<Blob|null>}
 */
async function encodeCanvas(bitmap, width, height, format, quality) {
  const useOffscreen =
    typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function';

  if (useOffscreen) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // Fill white so transparent PNG pixels don't turn black when encoded as JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    try {
      return await canvas.convertToBlob({ type: format, quality });
    } catch {
      return null;
    }
  }

  // Regular HTMLCanvasElement path (main thread).
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // Fill white so transparent PNG pixels don't turn black when encoded as JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), format, quality);
  });
}
