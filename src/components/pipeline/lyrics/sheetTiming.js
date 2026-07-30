/**
 * Traduce el índice plano de renglones (el que usa `timings`, tal como lo agrega el
 * backend al payload de la letra) a ubicación en el documento (sección + renglón) y a
 * ventanas de tiempo, para que el resaltado sepa qué renglón suena en cada milisegundo.
 * Módulo puro: sin DOM, sin Web Audio.
 *
 * El índice plano cuenta solo renglones: una sección instrumental tiene `lines: []` y
 * no corre el índice, igual que `sections.flatMap((s) => s.lines)`.
 */
export function buildTimeline(sections, timings, durationMs = null) {
  const byIndex = new Map();
  let flatIdx = 0;
  sections.forEach((section, sIdx) => {
    (section.lines ?? []).forEach((_line, lIdx) => {
      byIndex.set(flatIdx, { sIdx, lIdx });
      flatIdx += 1;
    });
  });

  const entries = (timings ?? [])
    .filter((t) => byIndex.has(t.i))
    .map((t) => {
      const { sIdx, lIdx } = byIndex.get(t.i);
      return { i: t.i, sIdx, lIdx, startMs: t.startMs, endMs: Infinity, interpolated: Boolean(t.interpolated) };
    })
    .sort((a, b) => a.startMs - b.startMs);

  // Segunda pasada: la ventana del renglón k termina donde empieza la k+1; la última
  // llega hasta durationMs o se queda en Infinity (no se apaga sin saber la duración).
  for (let k = 0; k < entries.length - 1; k += 1) {
    entries[k].endMs = entries[k + 1].startMs;
  }
  if (entries.length > 0 && typeof durationMs === 'number') {
    entries[entries.length - 1].endMs = durationMs;
  }

  const bands = sections
    .map((section, sIdx) => ({ section, sIdx }))
    .filter(({ section }) => section.type === 'instrumental' && section.startMs != null && section.endMs != null)
    .map(({ section, sIdx }) => ({ sIdx, startMs: section.startMs, endMs: section.endMs }));

  return { entries, bands };
}

/**
 * Busca primero en `bands`: la banda instrumental es tiempo real del segmento y le
 * gana a la ventana (extendida) del renglón anterior. Recién si no hay banda activa se
 * busca en `entries`.
 */
export function activeAt(timeline, ms) {
  if (!timeline) return null;

  const band = timeline.bands.find((b) => ms >= b.startMs && ms < b.endMs);
  if (band) return { sIdx: band.sIdx, lIdx: null };

  const entry = timeline.entries.find((e) => ms >= e.startMs && ms < e.endMs);
  if (entry) return { sIdx: entry.sIdx, lIdx: entry.lIdx, interpolated: entry.interpolated };

  return null;
}
