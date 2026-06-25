// scripts/acordes/run.mjs
// Orquesta: extraer PDF → match BD → emitir borradores → auditar → status/report.
// Uso:
//   node --env-file=.env scripts/acordes/run.mjs --pilot "Olor a Tostadas"   (Fase A)
//   node --env-file=.env scripts/acordes/run.mjs --all                        (Fase B/C)
import { mkdir, writeFile } from 'node:fs/promises';
import sql from '../../api/_lib/db.js';
import { extractSongs } from './extractPdf.mjs';
import { matchByTitle, normalizeTitle } from './lib/titles.mjs';
import { emitDraftText } from './lib/draft.mjs';
import { diffSong, buildReport } from './lib/audit.mjs';

const PDF = 'Cancionero + Acordes 2026.pdf';
const OUT = 'docs/acordes-tono/out';

function slug(title) {
  return normalizeTitle(title).replace(/\s+/g, '-') || 'sin-titulo';
}

async function main() {
  const args = process.argv.slice(2);
  const pilotIdx = args.indexOf('--pilot');
  const pilot = pilotIdx >= 0 ? args[pilotIdx + 1] : null;

  await mkdir(`${OUT}/drafts`, { recursive: true });

  let pdfSongs = await extractSongs(PDF);
  if (pilot) {
    const key = normalizeTitle(pilot);
    pdfSongs = pdfSongs.filter((s) => normalizeTitle(s.title) === key);
    console.log(`Piloto: ${pdfSongs.length} canción(es) tras filtrar "${pilot}".`);
  }

  const dbSongs = await sql`SELECT id, title, sections, cejilla, key FROM songs`;
  const { pairs, unmatchedPdf, unmatchedDb } = matchByTitle(pdfSongs, dbSongs);

  const results = [];
  const status = [];
  for (const { pdf, db } of pairs) {
    try {
      const { text, skipped } = emitDraftText(pdf);
      await writeFile(`${OUT}/drafts/${slug(pdf.title)}.txt`, text, 'utf8');
      const findings = diffSong(pdf, { sections: db.sections, cejilla: db.cejilla, key: db.key });
      results.push({ title: pdf.title, findings });
      const worst = findings.reduce((m, f) => (f.severity === 'ALTA' ? 'ALTA' : m), 'ok');
      status.push({ title: pdf.title, dbId: db.id, state: worst === 'ALTA' ? 'conflictos-ALTA' : 'ok', skipped: skipped.length, findings: findings.length });
    } catch (e) {
      status.push({ title: pdf.title, dbId: db.id, state: 'fallo-extracción', error: String(e) });
    }
  }
  for (const p of unmatchedPdf) status.push({ title: p.title, state: 'sin-match' });

  await writeFile(`${OUT}/status.json`, JSON.stringify(status, null, 2), 'utf8');
  await writeFile(`${OUT}/report.md`, buildReport(results, unmatchedPdf, unmatchedDb), 'utf8');

  // Barrida de control (Fase C): resumen en consola.
  const byState = status.reduce((m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m), {});
  console.log('Resumen:', byState);
  console.log(`Borradores en ${OUT}/drafts/ · reporte en ${OUT}/report.md`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
