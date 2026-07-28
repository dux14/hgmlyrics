/**
 * avatarUrl.js — miniaturas de avatar vía el transformador de Supabase Storage.
 *
 * Los avatares custom se guardan en el bucket público `avatars` tal como los
 * sube el usuario: una foto de cámara llega a 3024×4032 y ~1,6 MB. Pintar ese
 * original dentro de un `<img>` de 46 px obliga al navegador a decodificar ~12
 * megapíxeles (~49 MB de bitmap) por fila; en Safari iOS eso supera el
 * presupuesto de memoria de decodificación y la foto queda en blanco, que es el
 * síntoma "las fotos custom no cargan en mobile".
 *
 * Reescribir `/object/public/` a `/render/image/public/` con las medidas reales
 * hace que Storage sirva la miniatura ya recortada (~2 KB). Las URLs de otros
 * orígenes (avatar de Google) se devuelven intactas: ya vienen dimensionadas.
 */

const PUBLIC_SEGMENT = '/storage/v1/object/public/';
const RENDER_SEGMENT = '/storage/v1/render/image/public/';

/**
 * Devuelve la URL de una miniatura cuadrada del avatar.
 *
 * @param {string} url URL del avatar tal como la guarda el perfil.
 * @param {number} size Lado del hueco en px CSS (el mismo del `<img>`).
 * @returns {string} URL transformada, o la original si no es de Storage.
 */
export function avatarThumb(url, size = 48) {
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url, globalThis.location?.href ?? 'https://hgmlyrics.vercel.app');
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith('.supabase.co')) return url;
  if (!parsed.pathname.includes(PUBLIC_SEGMENT)) return url;

  // El transformador entrega píxeles físicos: en pantallas retina se pide el
  // doble, con tope en 2x para no volver a traer archivos grandes.
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const px = Math.max(1, Math.round(size * dpr));

  parsed.pathname = parsed.pathname.replace(PUBLIC_SEGMENT, RENDER_SEGMENT);
  parsed.searchParams.set('width', String(px));
  parsed.searchParams.set('height', String(px));
  parsed.searchParams.set('resize', 'cover');
  parsed.searchParams.set('quality', '75');
  return parsed.toString();
}
