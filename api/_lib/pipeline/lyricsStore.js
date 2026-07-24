/**
 * lyricsStore.js — acceso a song_pipeline_lyrics (letra IA-independiente del
 * pipeline, spec 2026-07-23). Los helpers reciben el cliente postgres.js
 * (sql o tx) como primer argumento: approveGate los usa dentro de su
 * transacción y los tests inyectan un fake. También vive acá la proyección
 * pura del snapshot del store (timingLinesFromSections/pipelineLinesFor):
 * es su hogar natural (proyectan lo que este módulo persiste) y ponerla acá
 * evita un ciclo de imports con api/songs/[id]/pipeline/lyrics.js, que
 * también consume upsertPipelineLyrics/getPipelineLyrics (Task 2.2).
 */
import { isNil } from './lyricsReview.js';

/**
 * Upsert de la letra aprobada del pipeline (una fila por canción). `language`
 * cae a 'es' si el documento no lo trae (columna con default 'es', pero el
 * INSERT explícito no puede depender del default de la tabla si algún día
 * cambia).
 * @param {Function} sql cliente postgres.js (sql o tx)
 * @param {{songId:string, runId:string|null, sections:Array, hash:string, language?:string}} args
 */
export function upsertPipelineLyrics(sql, { songId, runId, sections, hash, language }) {
  return sql`
    INSERT INTO song_pipeline_lyrics (song_id, run_id, sections, hash, language, approved_at)
    VALUES (${songId}, ${runId}, ${sql.json(sections)}, ${hash}, ${language ?? 'es'}, now())
    ON CONFLICT (song_id) DO UPDATE
      SET run_id = EXCLUDED.run_id, sections = EXCLUDED.sections,
        hash = EXCLUDED.hash, language = EXCLUDED.language, approved_at = EXCLUDED.approved_at
  `;
}

/**
 * Letra aprobada del pipeline para una canción, o null si no hay.
 * @param {Function} sql cliente postgres.js
 * @param {string} songId
 * @returns {Promise<{songId:string, runId:string|null, sections:Array, hash:string, language:string, approvedAt:string}|null>}
 */
export async function getPipelineLyrics(sql, songId) {
  const rows = await sql`
    SELECT song_id AS "songId", run_id AS "runId", sections, hash, language,
      approved_at AS "approvedAt"
    FROM song_pipeline_lyrics WHERE song_id = ${songId}
  `;
  return rows[0] ?? null;
}

// Score valido solo si es number Y cae en [0,1] (mismo criterio que
// api/align/webhook.js:177); fuera de rango o no-numerico -> null.
function clampScore(line) {
  const c = line.confidence;
  return typeof c === 'number' && c >= 0 && c <= 1 ? c : null;
}

/** Proyeccion plana {i, startMs, score, interpolated} de las sections del
 * store para el shim song_line_timings. i = posicion plana (misma semantica
 * incremental que projectLines). Renglon sin timing: reparte proporcional
 * dentro del hueco entre la vecina anterior conocida (`prev`/`nextKnown`,
 * vecinos en `known[]`) y la siguiente; monotonia estricta (nunca <=
 * `prevEmitted`, el ULTIMO valor YA EMITIDO) se aplica despues como red de
 * seguridad — son dos marcos de referencia distintos a proposito: uno mira
 * los datos crudos, el otro lo que ya se decidio emitir.
 * (Task 2.2: movida acá desde api/songs/[id]/pipeline/lyrics.js para que
 * pipelineLinesFor la reuse sin ciclo de imports; lyrics.js y audio.js la
 * importan de acá.) */
export function timingLinesFromSections(sections) {
  const flat = sections.flatMap((s) => s.lines);
  const known = flat.map((l) => l.manualStartMs ?? l.startMs);
  const lines = [];
  let i = 0;
  while (i < flat.length) {
    if (!isNil(known[i])) {
      let startMs = known[i];
      // Monotonia estricta: nunca <= al ULTIMO valor ya emitido (prevEmitted),
      // aplica igual a renglones con timing real (ej. dos startMs iguales).
      const prevEmitted = lines[lines.length - 1];
      if (prevEmitted && startMs <= prevEmitted.startMs) startMs = prevEmitted.startMs + 1;
      lines.push({ i, startMs, score: clampScore(flat[i]), interpolated: false });
      i += 1;
      continue;
    }
    // Hueco: [i, gapEnd) son todos nulos. gapEnd es el primer índice conocido
    // (o flat.length si el hueco llega hasta el final).
    let gapEnd = i;
    while (gapEnd < flat.length && isNil(known[gapEnd])) gapEnd += 1;
    const gapLen = gapEnd - i;
    const prev = i > 0 ? known[i - 1] : 0;
    const nextKnown = gapEnd < flat.length ? known[gapEnd] : undefined;
    for (let k = 0; k < gapLen; k += 1) {
      const idx = i + k;
      // Interior (hay endpoint real a ambos lados): reparto proporcional del
      // hueco. Final (sin nextKnown, ej. el outro): no hay endpoint real,
      // incrementos monotonicos simples desde prev.
      let startMs =
        nextKnown === undefined
          ? prev + k + 1
          : prev + Math.round(((nextKnown - prev) * (k + 1)) / (gapLen + 1));
      const prevEmitted = lines[lines.length - 1];
      if (prevEmitted && startMs <= prevEmitted.startMs) startMs = prevEmitted.startMs + 1;
      lines.push({ i: idx, startMs, score: clampScore(flat[idx]), interpolated: true });
    }
    i = gapEnd;
  }
  return lines;
}

/**
 * Aplana el snapshot aprobado del gate a `[{text, startMs, endMs}]` en orden
 * de documento — el contrato que la fase pitch va a consumir como fuente
 * única de la letra (Task 2.2; el dispatch que la enchufa es otra tarea) para
 * acotar segmentos del forced align en GPU. Pura: reusa
 * timingLinesFromSections para el startMs de los renglones sin timing propio
 * (mismo punto medio/monotonia estricta que ya exige validateLines). endMs
 * sale de la última word del renglón; sin words (o sin endMs finito en la
 * última), del startMs de la línea siguiente; en la última línea del
 * documento, su propio startMs (el consumidor lo acota contra la duración
 * del audio) — ese caso queda con endMs===startMs A PROPOSITO, no entra en
 * el clamp de abajo.
 *
 * Invariante `endMs > startMs` (todo renglón salvo el último): startMs y
 * endMs salen de dos fuentes que pueden desincronizarse — startMs de
 * timingLinesFromSections (manualStartMs, o el bump de monotonia estricta
 * sobre un startMs duplicado del ASR) y endMs de las words originales del
 * renglón, que nunca se reajustan contra esos dos casos. Sin el clamp, un
 * offset manual muy adelantado a sus propias words, o dos renglones
 * adyacentes con el mismo startMs de ASR, emiten un intervalo invertido o de
 * duración cero que corrompe el forced align de la canción entera (hallazgo
 * Critical, review). Clamp elegido: mínimo 1ms de duración
 * (`startMs + 1`, mismo patrón de +1ms que ya usa timingLinesFromSections
 * para su propia monotonía) en vez de descartar la line o recalcular su
 * startMs — es el fix mínimo que no toca timingLinesFromSections (fuera de
 * alcance) ni cambia el orden/cantidad de líneas emitidas.
 * @param {Array} sections snapshot de `song_pipeline_lyrics.sections`
 * @returns {Array<{text:string, startMs:number, endMs:number}>}
 */
export function pipelineLinesFor(sections) {
  const flat = sections.flatMap((s) => s.lines);
  const timed = timingLinesFromSections(sections);
  return timed.map((t, idx) => {
    const line = flat[t.i];
    const words = Array.isArray(line.words) ? line.words : [];
    const lastWord = words[words.length - 1];
    const isLastLine = idx === timed.length - 1;
    let endMs = Number.isFinite(lastWord?.endMs)
      ? lastWord.endMs
      : !isLastLine
        ? timed[idx + 1].startMs
        : t.startMs;
    if (!isLastLine && endMs <= t.startMs) endMs = t.startMs + 1;
    return { text: line.text, startMs: t.startMs, endMs };
  });
}
