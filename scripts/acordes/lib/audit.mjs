// scripts/acordes/lib/audit.mjs
import { isInlineableChord } from './chords.mjs';

/** Normaliza letra para comparación: sin acentos/emojis, alargamientos (3+) colapsados. */
export function normalizeLyric(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/(.)\1{2,}/g, '$1')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenLines(song) {
  const out = [];
  for (const sec of song.sections || []) for (const l of sec.lines || []) out.push(l);
  return out;
}

function diffChords(pc = [], dc = [], lineIdx, findings) {
  const key = (c) => `${c.pos}:${c.ch}`;
  const pset = new Set(pc.map(key));
  const dset = new Set(dc.map(key));
  for (const c of pc) {
    if (!dset.has(key(c)))
      findings.push({ severity: 'MEDIA', kind: 'chord', detail: `Línea ${lineIdx}: ${c.ch}@${c.pos} en PDF, no en BD` });
    if (!isInlineableChord(c.ch))
      findings.push({ severity: 'BAJA', kind: 'chord-extended', detail: `Línea ${lineIdx}: ${c.ch} no inlineable (colocar manual)` });
  }
  for (const c of dc)
    if (!pset.has(key(c)))
      findings.push({ severity: 'MEDIA', kind: 'chord', detail: `Línea ${lineIdx}: ${c.ch}@${c.pos} en BD, no en PDF` });
}

/** Compara modelo PDF vs BD → findings con severidad. */
export function diffSong(pdfSong, dbSong) {
  const findings = [];
  const pl = flattenLines(pdfSong);
  const dl = flattenLines(dbSong);
  const n = Math.max(pl.length, dl.length);
  for (let i = 0; i < n; i++) {
    const p = pl[i];
    const d = dl[i];
    if (!p || !d) {
      findings.push({ severity: 'ALTA', kind: 'line-count', detail: `Línea ${i}: presente solo en ${p ? 'PDF' : 'BD'}` });
      continue;
    }
    if (normalizeLyric(p.text) !== normalizeLyric(d.text)) {
      findings.push({ severity: 'ALTA', kind: 'text', detail: `Línea ${i}: texto difiere — PDF "${p.text}" vs BD "${d.text}"` });
      continue;
    }
    diffChords(p.chords, d.chords, i, findings);
  }
  if ((pdfSong.cejilla ?? null) !== (dbSong.cejilla ?? null))
    findings.push({ severity: 'BAJA', kind: 'cejilla', detail: `cejilla PDF ${pdfSong.cejilla} vs BD ${dbSong.cejilla}` });
  if (pdfSong.key && (pdfSong.key ?? null) !== (dbSong.key ?? null))
    findings.push({ severity: 'BAJA', kind: 'key', detail: `key PDF ${pdfSong.key} vs BD ${dbSong.key}` });
  return findings;
}

const SEV_ORDER = { ALTA: 0, MEDIA: 1, BAJA: 2 };

/** results: [{title, findings}] → Markdown con dashboard + detalle por severidad + listas no-match. */
export function buildReport(results, unmatchedPdf, unmatchedDb) {
  const sevCount = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  for (const r of results) for (const f of r.findings) sevCount[f.severity]++;

  const worst = (r) => r.findings.reduce((m, f) => Math.max(m, 3 - SEV_ORDER[f.severity]), 0);
  const sorted = [...results].filter((r) => r.findings.length).sort((a, b) => worst(b) - worst(a));

  const out = [];
  out.push('# Reporte de incongruencias — ITER 1\n');
  out.push('## Dashboard\n');
  out.push(`- Canciones emparejadas: ${results.length}`);
  out.push(`- Sin match (PDF): ${unmatchedPdf.length}`);
  out.push(`- Sin match (BD): ${unmatchedDb.length}`);
  out.push(`- Conflictos: ALTA ${sevCount.ALTA} · MEDIA ${sevCount.MEDIA} · BAJA ${sevCount.BAJA}\n`);

  out.push('## Canciones (por severidad)\n');
  for (const r of sorted) {
    out.push(`### ${r.title}`);
    for (const f of [...r.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]))
      out.push(`- **${f.severity}** [${f.kind}] ${f.detail}`);
    out.push('');
  }
  if (unmatchedPdf.length) {
    out.push('## PDF sin match en BD (faltantes)\n');
    for (const p of unmatchedPdf) out.push(`- ${p.title}`);
    out.push('');
  }
  if (unmatchedDb.length) {
    out.push('## BD sin match en PDF (renombradas)\n');
    for (const d of unmatchedDb) out.push(`- ${d.title}`);
    out.push('');
  }
  return out.join('\n');
}
