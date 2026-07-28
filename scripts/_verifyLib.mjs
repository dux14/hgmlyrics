// scripts/_verifyLib.mjs
// Funciones puras de la verificación de la letra canónica (Task A7): validar
// el shape de `content`, calcular cobertura y detectar desajustes de
// cantidad de líneas. Sin I/O — testeables sin mockear la DB.

// Valida que `content` cumpla el shape mínimo que consume el pipeline
// (secciones[].lineas[].texto, ver api/songs/[id]/pipeline/_dispatch.js ::
// canonicalLinesFor). A diferencia de `parseExtraction` en _ingestLib.mjs
// (que lanza al primer error, pensado para abortar la ingesta), esta NUNCA
// lanza: junta todos los `problems` encontrados para el reporte de A7.
export function validateCanonicalContent(content) {
  const problems = [];
  let sectionCount = 0;
  let lineCount = 0;

  if (!content || typeof content !== 'object') {
    return { ok: false, sectionCount, lineCount, problems: ['"content" no es un objeto.'] };
  }
  if (!Array.isArray(content.secciones) || content.secciones.length === 0) {
    problems.push('sin "secciones" (array no vacío).');
    return { ok: false, sectionCount, lineCount, problems };
  }

  content.secciones.forEach((seccion, si) => {
    sectionCount += 1;
    if (!Array.isArray(seccion?.lineas)) {
      problems.push(`sección #${si} sin "lineas" (array).`);
      return;
    }
    if (seccion.lineas.length === 0) {
      problems.push(`sección #${si} sin líneas.`);
    }
    seccion.lineas.forEach((linea, li) => {
      if (typeof linea?.texto !== 'string' || !linea.texto.trim()) {
        problems.push(`sección #${si}, línea #${li} sin "texto".`);
        return;
      }
      lineCount += 1;
    });
  });

  return { ok: problems.length === 0, sectionCount, lineCount, problems };
}

// Cobertura de `song_lyrics_canonical` sobre `songs`: cuántas canciones
// tienen letra canónica ingresada. `canonicalCount` es la cantidad de filas
// en `song_lyrics_canonical` (song_id es PK, 1 fila por canción cubierta).
export function coverageReport(totalSongs, canonicalCount) {
  const covered = Math.min(canonicalCount, totalSongs);
  const missing = Math.max(totalSongs - covered, 0);
  const pct = totalSongs > 0 ? (covered / totalSongs) * 100 : 0;
  return { covered, missing, pct };
}

// Compara la cantidad de líneas canónicas contra la cantidad de líneas de
// `songs.sections` (la letra ya en DB). No es un error -- es una señal para
// "revisar a mano": flaggea cuando la diferencia relativa supera el 50%.
export function lineCountMismatch(canonicalLines, dbLines) {
  const base = Math.max(dbLines, 1);
  const ratio = Math.abs(canonicalLines - dbLines) / base;
  return { flag: ratio > 0.5, ratio };
}

// Proyección local de líneas cantables de `songs.sections`, para comparar
// contra la letra canónica. Réplica intencional de `projectCanonicalLines`
// (api/_lib/align.js): misma regla (salta `annotation`, orden de documento).
// No se importa align.js directo porque importa api/_lib/db.js, que exige
// DATABASE_URL e instancia un segundo pool de conexión al cargar el módulo.
export function projectSongLines(sections) {
  const lines = [];
  for (const section of sections || []) {
    for (const line of section?.lines || []) {
      if (line.annotation) continue;
      lines.push(line.text || '');
    }
  }
  return lines;
}
