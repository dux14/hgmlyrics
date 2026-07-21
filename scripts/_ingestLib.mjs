// scripts/_ingestLib.mjs
// Funciones puras de la ingesta del cancionero (Task A6): parseo de la
// respuesta de Claude, matching de títulos contra `songs` y armado de los
// upserts. Sin I/O — testeables sin mockear filesystem/red/DB.
import { titleSimilarity, TITLE_MATCH_THRESHOLD } from '../api/_lib/pipeline/titleMatch.js';

// Schema JSON estricto que le pedimos a Claude via output_config.
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['canciones'],
  properties: {
    canciones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'secciones'],
        properties: {
          titulo: { type: 'string' },
          secciones: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['lineas'],
              properties: {
                tipo: { type: 'string' },
                lineas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['texto'],
                    properties: {
                      texto: { type: 'string' },
                      acordes: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const EXTRACTION_PROMPT = `Extrae TODAS las canciones de este cancionero en formato JSON segun el schema dado.

Para cada cancion:
- "titulo": el titulo tal como aparece impreso.
- "secciones": una entrada por cada seccion (introduccion, estrofa, coro,
  puente, etc.). Si el cancionero no marca secciones explicitas, usa una
  unica seccion con todas las lineas.
- "lineas": el texto de cada linea VERBATIM, respetando la letra tal como
  esta impresa (sin corregir ni parafrasear). Si hay acordes escritos sobre
  las silabas, incluilos en "acordes" (texto libre, tal como aparecen).

No omitas canciones ni las resumas. No inventes contenido que no este en el PDF.`;

// Valida y devuelve el array de canciones de una respuesta ya parseada como
// JSON. Lanza si el shape no cumple el minimo exigido por el pipeline
// (`secciones[].lineas[].texto`, ver api/songs/[id]/pipeline/_dispatch.js).
export function parseExtraction(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Respuesta de Claude no es JSON válido: ${err.message}`, { cause: err });
  }
  if (!data || !Array.isArray(data.canciones)) {
    throw new Error('Respuesta sin campo "canciones" (array).');
  }
  for (const cancion of data.canciones) {
    if (!cancion?.titulo || typeof cancion.titulo !== 'string') {
      throw new Error('Cancion sin "titulo" válido.');
    }
    if (!Array.isArray(cancion.secciones) || cancion.secciones.length === 0) {
      throw new Error(`Cancion "${cancion.titulo}" sin "secciones".`);
    }
    for (const seccion of cancion.secciones) {
      if (!Array.isArray(seccion.lineas)) {
        throw new Error(`Seccion sin "lineas" en "${cancion.titulo}".`);
      }
      for (const linea of seccion.lineas) {
        if (typeof linea?.texto !== 'string' || !linea.texto.trim()) {
          throw new Error(`Linea sin "texto" en "${cancion.titulo}".`);
        }
      }
    }
  }
  return data.canciones;
}

// Matchea cada cancion extraida contra `songsFromDb` ({id, title}[]) por
// similitud de titulo (reusa titleMatch.js, umbral 60%). Devuelve
// { linked, unlinked }: linked trae songId + score, unlinked queda para
// revisión manual (nunca inventamos song_id).
export function matchSongs(canciones, songsFromDb) {
  const linked = [];
  const unlinked = [];
  for (const cancion of canciones) {
    let best = null;
    for (const song of songsFromDb) {
      const score = titleSimilarity(cancion.titulo, song.title);
      if (!best || score > best.score) best = { song, score };
    }
    if (best && best.score >= TITLE_MATCH_THRESHOLD) {
      linked.push({ cancion, songId: best.song.id, score: best.score });
    } else {
      unlinked.push({ cancion, bestScore: best?.score ?? 0 });
    }
  }
  return { linked, unlinked };
}

// Arma los pares song_id/content con el shape que consume el pipeline:
// { secciones: [ { tipo?, lineas: [ { texto, acordes? } ] } ] }.
export function buildUpserts(linked) {
  return linked.map(({ cancion, songId }) => ({
    songId,
    content: {
      titulo: cancion.titulo,
      secciones: cancion.secciones.map((s) => ({
        ...(s.tipo ? { tipo: s.tipo } : {}),
        lineas: s.lineas.map((l) => ({
          texto: l.texto,
          ...(l.acordes ? { acordes: l.acordes } : {}),
        })),
      })),
    },
  }));
}
