// api/ordo/[date].js
import { requireAdmin } from '../_lib/auth.js';
import { allowMethods, withErrors } from '../_lib/http.js';
import sql from '../_lib/db.js';

const ORDO_API =
  'https://74j2tngwfd.execute-api.us-east-1.amazonaws.com/api-app/ediciones/obtener-contenido-principal';

/** Strip HTML tags, replace block tags with newlines, decode common entities. */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó')
    .replace(/&uacute;/g, 'ú')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .trim();
}

/** Extract "Mt 9,36-10,8" from the first <strong> tag. */
function extractReadingRef(html) {
  const match = html?.match(/<strong>([^<]+)<\/strong>/);
  return match ? match[1].trim().replace(/,\s+/g, ',') : '';
}

/** YYYY-MM-DD validation */
function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/**
 * El ordo reporta el color en español ("Verde", "Morado", …). El sistema usa
 * claves en inglés ('green'|'purple'|'white'|'red') en LITURGICAL_PALETTES.
 * Mapea español → clave; null si no reconoce (cae en paleta neutra).
 */
function mapLiturgicalColor(raw) {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('verde')) return 'green';
  if (s.includes('morad') || s.includes('púrpur') || s.includes('purpur') || s.includes('violet')) {
    return 'purple';
  }
  if (s.includes('blanc')) return 'white';
  if (s.includes('rojo') || s.includes('roja')) return 'red';
  // Rosa (domingos Gaudete/Laetare): pertenece a tiempos morados.
  if (s.includes('rosa') || s.includes('rosác')) return 'purple';
  return null;
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  await requireAdmin(req, sql);

  const date = req.query.date;
  if (!isValidDate(date)) {
    const e = new Error('Fecha inválida (formato YYYY-MM-DD)');
    e.status = 400;
    throw e;
  }

  const apiRes = await fetch(ORDO_API);
  if (!apiRes.ok) {
    const e = new Error('Ordo no disponible');
    e.status = 502;
    throw e;
  }
  const json = await apiRes.json();
  const entry = (json.data ?? []).find((d) => d.fecha === date);
  if (!entry) {
    const e = new Error('Fecha no encontrada en el ordo');
    e.status = 404;
    throw e;
  }

  const gospelRef = extractReadingRef(entry.evangelio ?? '');
  const gospelBody = stripHtml(entry.evangelio ?? '');
  const liturgicalTitle = entry.encabezado || entry.celebracion || '';
  const liturgicalColor = mapLiturgicalColor(entry.colores_dia);

  res.status(200).json({ gospelRef, gospelBody, liturgicalTitle, liturgicalColor });
});
