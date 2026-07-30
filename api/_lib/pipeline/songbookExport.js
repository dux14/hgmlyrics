/**
 * songbookExport.js — exporta la letra aprobada del gate (song_pipeline_lyrics)
 * al cancionero (songs.sections) haciendo merge por renglón, en vez de pisar
 * la fila entera. Del gate mandan texto, cortes de renglón, cantidad de
 * secciones, tipo y etiqueta; del cancionero se conservan acordes, voces y
 * preset de velocidad allí donde el texto no cambió. Un acorde posicionado
 * sobre un texto distinto al que el admin lo puso es peor que ningún acorde
 * (la posición ya no corresponde a nada), así que se suelta y se reporta en
 * vez de arrastrarlo. Dominio PURO: sin sql, sin fetch, sin Date.now, no muta
 * la entrada (mismo patrón que songbookSync.js en este mismo directorio).
 */

// Las primeras cuatro replican el mapa visible de SongEditor.js:76-79; Intro y
// Final son los nombres para los dos tipos que normalizeSectionType produce
// pero el editor no ofrece.
const SECTION_LABELS = {
  verse: 'Verso',
  chorus: 'Coro',
  bridge: 'Puente',
  prechorus: 'Pre-Coro',
  intro: 'Intro',
  outro: 'Final',
};

/**
 * Separa las líneas del cancionero en canónicas y anotaciones ancladas al
 * índice canónico que las precedía (-1 = antes de la primera). Las anotaciones
 * no son renglones canónicos: projectCanonicalLines las saltea, así que no
 * pueden consumir un renglón del gate al emparejar por posición.
 */
function splitAnnotations(lines) {
  const canonical = [];
  const anchored = [];
  for (const line of lines) {
    if (line.annotation) {
      anchored.push({ after: canonical.length - 1, line: { text: line.text, annotation: true } });
    } else {
      canonical.push(line);
    }
  }
  return { canonical, anchored };
}

/**
 * Hace el merge por renglón de la letra aprobada del gate contra la sección
 * correspondiente del cancionero (por posición, no por contenido).
 * @param {Array} approvedSections letra aprobada del pipeline (por sección: type, label, lines[].text/vocalization)
 * @param {Array} songSections songs.sections actual (puede traer chords/groups/annotation/speedPreset)
 * @returns {{sections: Array, dropped: Array<{sectionIndex:number, lineIndex:number, text:string, reason:'chords'|'annotation'}>}}
 */
export function exportSections(approvedSections, songSections = []) {
  const dropped = [];
  const sections = approvedSections.map((section, sectionIndex) => {
    const prev = songSections[sectionIndex] ?? null;
    const { canonical, anchored } = splitAnnotations(prev?.lines ?? []);

    const lines = section.lines.map((line, lineIndex) => {
      const base = line.vocalization ? { text: line.text, spoken: true } : { text: line.text };
      const old = canonical[lineIndex] ?? null;
      if (!old) return base;
      if (old.text !== line.text) {
        if (old.chords?.length || old.groups?.length) {
          dropped.push({ sectionIndex, lineIndex, text: line.text, reason: 'chords' });
        }
        return base;
      }
      return {
        ...base,
        ...(old.chords?.length ? { chords: old.chords } : {}),
        ...(old.groups?.length ? { groups: old.groups } : {}),
      };
    });

    // Reintercalado de anotaciones. Una anclada a un índice que ya no existe se
    // pierde y se reporta: moverla a otro renglón diría algo que nadie escribió.
    const out = [];
    const before = anchored.filter((a) => a.after === -1);
    for (const a of before) out.push(a.line);
    lines.forEach((line, idx) => {
      out.push(line);
      for (const a of anchored) if (a.after === idx) out.push(a.line);
    });
    for (const a of anchored) {
      if (a.after >= lines.length) {
        dropped.push({
          sectionIndex,
          lineIndex: a.after,
          text: a.line.text ?? '',
          reason: 'annotation',
        });
      }
    }

    return {
      type: section.type,
      label: section.label || SECTION_LABELS[section.type] || 'Verso',
      ...(prev?.speedPreset ? { speedPreset: prev.speedPreset } : {}),
      lines: out,
    };
  });
  return { sections, dropped };
}
