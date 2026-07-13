#!/usr/bin/env node
/**
 * measure-align.mjs
 *
 * Mide empíricamente la precisión del alignment vocal comparando un
 * ground-truth corregido a mano (por Samu, en el editor) contra un
 * re-align posterior. TANDA D del backlog "refinamiento-backlog-post-fullview".
 *
 * Runbook operacional (también queda escrito en el REPORT.md que genera):
 *   1. Samu corrige a mano las líneas mal alineadas en el editor de preview.
 *   2. `export <songId>`  → guarda ese estado corregido como ground-truth local.
 *   3. Se relanza el align real vía Modal (fuera de este script).
 *   4. `report <songId>`  → compara el resultado nuevo contra el ground-truth.
 *   5. `restore <songId>` → si hace falta, vuelve a aplicar las correcciones.
 *
 * CRÍTICO: el paso 2 (export) tiene que correr ANTES de relanzar el align real
 * (paso 3) — el re-align pisa in-place las correcciones manuales, así que si
 * no se exporta antes el ground-truth se pierde.
 *
 * Uso:
 *   node scripts/measure-align.mjs export  <songId> [--base <url>]
 *   node scripts/measure-align.mjs report  <songId> [--base <url>]
 *   node scripts/measure-align.mjs restore <songId> [--base <url>]
 *
 * Auth: HKN_ADMIN_TOKEN en el entorno (token de sesión de un admin; PATCH lo exige).
 * Datos locales: docs/align-precision/ (gitignored, material de trabajo).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mean, median, p90, pearson, matchByIndex } from './measure-align-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'docs', 'align-precision');
const REPORT_PATH = path.join(DATA_DIR, 'REPORT.md');
const DEFAULT_BASE = 'https://hgmlyrics-pitch-preview.vercel.app';

const HELP = `
measure-align.mjs — precisión del alignment vs ground-truth corregido a mano

Uso:
  node scripts/measure-align.mjs export  <songId> [--base <url>]
  node scripts/measure-align.mjs report  <songId> [--base <url>]
  node scripts/measure-align.mjs restore <songId> [--base <url>]

Opciones:
  --base <url>   Base de la API (default: ${DEFAULT_BASE})

Env:
  HKN_ADMIN_TOKEN   Bearer token de un admin (obligatorio)

IMPORTANTE: correr "export" ANTES de relanzar el align real — el re-align
pisa in-place las correcciones manuales del editor.
`;

function parseArgs(argv) {
  const [cmd, songId, ...rest] = argv;
  let base = DEFAULT_BASE;
  for (let idx = 0; idx < rest.length; idx += 1) {
    if (rest[idx] === '--base') {
      base = rest[idx + 1];
      idx += 1;
    }
  }
  return { cmd, songId, base };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireToken() {
  const token = process.env.HKN_ADMIN_TOKEN;
  if (!token) {
    fail('Falta HKN_ADMIN_TOKEN en el entorno (token de sesión de un admin).');
  }
  return token;
}

async function apiFetch(base, token, pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(`HTTP ${res.status} ${res.statusText} en ${pathname}\n${body}`);
  }
  return res.json();
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function groundTruthPath(songId) {
  return path.join(DATA_DIR, `${songId}.ground-truth.json`);
}

async function readGroundTruth(songId) {
  const raw = await fs.readFile(groundTruthPath(songId), 'utf8').catch(() => {
    fail(
      `No hay ground-truth local para ${songId}. Corré primero "export ${songId}" con las líneas ya corregidas a mano.`
    );
  });
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

async function cmdExport(songId, base, token) {
  const data = await apiFetch(base, token, `/api/songs/${songId}/audio`, { method: 'GET' });
  const timings = data?.timings;
  if (!timings || timings.status !== 'ready' || !Array.isArray(timings.lines)) {
    fail(
      `La canción ${songId} no tiene timings listos (status=${timings?.status ?? 'sin timings'}). No hay nada que exportar.`
    );
  }
  await ensureDataDir();
  const payload = { songId, exportedAt: new Date().toISOString(), lines: timings.lines };
  await fs.writeFile(groundTruthPath(songId), JSON.stringify(payload, null, 2));
  console.log(`exportado ${timings.lines.length} líneas → ${path.relative(ROOT, groundTruthPath(songId))}`);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

/** Calcula el bloque de estadísticas (media/mediana/p90/±300/±700) de un array de errores en ms. */
function statsForErrors(errors) {
  if (errors.length === 0) return null;
  const within = (limit) => (errors.filter((e) => e <= limit).length / errors.length) * 100;
  return {
    n: errors.length,
    meanErr: mean(errors),
    medianErr: median(errors),
    p90Err: p90(errors),
    pct300: within(300),
    pct700: within(700),
  };
}

function fmtMs(n) {
  return `${n.toFixed(1)} ms`;
}

function fmtPct(n) {
  return `${n.toFixed(1)}%`;
}

function renderStatsTable(label, stats) {
  if (!stats) return `- **${label}**: sin datos\n`;
  return (
    `- **${label}** (n=${stats.n}): media ${fmtMs(stats.meanErr)} · mediana ${fmtMs(stats.medianErr)} · ` +
    `p90 ${fmtMs(stats.p90Err)} · dentro de ±300ms ${fmtPct(stats.pct300)} · dentro de ±700ms ${fmtPct(stats.pct700)}\n`
  );
}

/** Arma la sección markdown de una canción a partir de las estadísticas ya calculadas. */
function renderSongSection(songId, { total, overall, anchored, interpolated, correlation, warnings }) {
  const lines = [];
  lines.push(`<!-- song:${songId}:start -->`);
  lines.push(`### ${songId}`);
  lines.push('');
  lines.push(`Comparadas ${total} líneas (ground-truth vs re-align).`);
  lines.push('');
  lines.push(renderStatsTable('General', overall));
  lines.push(renderStatsTable('Ancladas (interpolated=false)', anchored));
  lines.push(renderStatsTable('Interpoladas (interpolated=true)', interpolated));
  if (correlation === null) {
    lines.push('- **Correlación score↔error (Pearson)**: sin datos suficientes (faltan scores numéricos)\n');
  } else {
    const senal =
      correlation < -0.3
        ? 'score bajo tiende a predecir error alto (coherente con el umbral 0.75 del editor)'
        : 'sin señal clara de que el score prediga el error';
    lines.push(`- **Correlación score↔error (Pearson)**: ${correlation.toFixed(3)} — ${senal}\n`);
  }
  if (warnings.length > 0) {
    lines.push(`- Avisos: ${warnings.join('; ')}\n`);
  }
  lines.push(`<!-- song:${songId}:end -->`);
  return lines.join('\n');
}

const RUNBOOK = `# Precisión del alignment vs ground-truth

Runbook manual (ver también \`node scripts/measure-align.mjs --help\`):

1. Samu corrige a mano las líneas mal alineadas en el editor de preview.
2. \`export <songId>\` — guarda ese estado corregido como ground-truth local.
3. Se relanza el align real vía Modal (fuera de este script).
4. \`report <songId>\` — compara el resultado nuevo contra el ground-truth.
5. \`restore <songId>\` — si hace falta, vuelve a aplicar las correcciones manuales.
`;

/** Inserta o reemplaza la sección de una canción en el REPORT.md, de forma idempotente. */
async function upsertReportSection(songId, section) {
  const startMarker = `<!-- song:${songId}:start -->`;
  const endMarker = `<!-- song:${songId}:end -->`;
  let existing = await fs.readFile(REPORT_PATH, 'utf8').catch(() => RUNBOOK + '\n');
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + endMarker.length);
    existing = `${before}${section}${after}`;
  } else {
    const separator = existing.endsWith('\n') ? '' : '\n';
    existing = `${existing}${separator}\n${section}\n`;
  }
  await ensureDataDir();
  await fs.writeFile(REPORT_PATH, existing);
}

async function cmdReport(songId, base, token) {
  const gt = await readGroundTruth(songId);
  const data = await apiFetch(base, token, `/api/songs/${songId}/audio`, { method: 'GET' });
  const newLines = data?.timings?.lines;
  if (!Array.isArray(newLines)) {
    fail(`La canción ${songId} no tiene timings.lines en el endpoint actual.`);
  }

  const { pairs, orphanGt, orphanNew } = matchByIndex(gt.lines, newLines);
  const warnings = [];
  if (orphanGt.length > 0) warnings.push(`${orphanGt.length} línea(s) del ground-truth sin match (i: ${orphanGt.join(',')})`);
  if (orphanNew.length > 0) warnings.push(`${orphanNew.length} línea(s) nueva(s) sin match (i: ${orphanNew.join(',')})`);
  if (pairs.length === 0) fail('No hay líneas emparejadas por índice i entre ground-truth y timings nuevos.');

  const enriched = pairs.map(({ i, gt: g, next }) => ({
    i,
    errorMs: Math.abs(next.startMs - g.startMs),
    interpolated: Boolean(g.interpolated),
    score: typeof g.score === 'number' ? g.score : null,
  }));

  const overall = statsForErrors(enriched.map((p) => p.errorMs));
  const anchored = statsForErrors(enriched.filter((p) => !p.interpolated).map((p) => p.errorMs));
  const interpolated = statsForErrors(enriched.filter((p) => p.interpolated).map((p) => p.errorMs));

  const withScore = enriched.filter((p) => p.score !== null);
  const correlation =
    withScore.length >= 2
      ? pearson(
          withScore.map((p) => p.score),
          withScore.map((p) => p.errorMs)
        )
      : null;

  const section = renderSongSection(songId, {
    total: enriched.length,
    overall,
    anchored,
    interpolated,
    correlation,
    warnings,
  });
  await upsertReportSection(songId, section);

  console.log(`--- ${songId} ---`);
  console.log(`líneas comparadas: ${enriched.length}`);
  if (overall) {
    console.log(
      `general: media ${fmtMs(overall.meanErr)} · mediana ${fmtMs(overall.medianErr)} · p90 ${fmtMs(overall.p90Err)} · ±300ms ${fmtPct(overall.pct300)} · ±700ms ${fmtPct(overall.pct700)}`
    );
  }
  if (correlation !== null) console.log(`correlación score↔error: ${correlation.toFixed(3)}`);
  for (const w of warnings) console.warn(`aviso: ${w}`);
  console.log(`REPORT.md actualizado → ${path.relative(ROOT, REPORT_PATH)}`);
}

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

/**
 * El endpoint PATCH valida monotonía ESTRICTA contra las vecinas en el estado
 * ACTUAL persistido (startMs > línea i-1, < línea i+1). Como el ground-truth
 * puede requerir mover varias líneas a la vez, aplicar todas en un solo orden
 * fijo (p.ej. ascendente por i) puede violar transitoriamente esa monotonía:
 * una corrección puede quedar temporalmente "por debajo" o "por encima" de una
 * vecina que todavía no se corrigió.
 *
 * Estrategia: multi-pasada. En cada pasada se intentan TODAS las líneas
 * pendientes (en orden de i). Se cuenta cuántas pasan (200) y cuántas fallan
 * por monotonía (400). Si al menos una pasó, el estado cambió → se repite.
 * Si una pasada completa no logra aplicar ninguna, ya no hay progreso posible
 * y se aborta reportando las líneas irresolubles.
 */
async function cmdRestore(songId, base, token) {
  const gt = await readGroundTruth(songId);
  const pending = new Map(gt.lines.map((line) => [line.i, line.startMs]));
  const applied = new Set();
  const lastError = new Map();

  let progress = true;
  while (progress && pending.size > 0) {
    progress = false;
    const attemptOrder = [...pending.keys()].sort((a, b) => a - b);
    for (const i of attemptOrder) {
      const startMs = pending.get(i);
      const res = await fetch(`${base}/api/songs/${songId}/audio`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineTiming: { i, startMs } }),
      });
      if (res.ok) {
        pending.delete(i);
        applied.add(i);
        progress = true;
      } else {
        const body = await res.text().catch(() => '');
        lastError.set(i, `HTTP ${res.status}: ${body}`);
      }
    }
  }

  if (pending.size > 0) {
    console.error(`No se pudieron aplicar ${pending.size} línea(s) tras varias pasadas:`);
    for (const i of [...pending.keys()].sort((a, b) => a - b)) {
      console.error(`  i=${i}: ${lastError.get(i) ?? 'sin detalle'}`);
    }
    fail(`restore incompleto: ${applied.size}/${gt.lines.length} líneas aplicadas.`);
  }

  // Verificación final: confirma que el startMs persistido coincide con el ground-truth
  // (todas las líneas pendientes ya se aplicaron con éxito en el loop de arriba).
  const data = await apiFetch(base, token, `/api/songs/${songId}/audio`, { method: 'GET' });
  const currentMap = new Map((data?.timings?.lines ?? []).map((line) => [line.i, line.startMs]));
  let correct = 0;
  for (const { i, startMs } of gt.lines) {
    if (currentMap.get(i) === startMs) correct += 1;
  }
  console.log(`restore completo: ${correct}/${gt.lines.length} líneas coinciden con el ground-truth.`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const { cmd, songId, base } = parseArgs(argv);
  if (!songId) fail(`Falta songId.\n${HELP}`);
  if (!['export', 'report', 'restore'].includes(cmd)) fail(`Comando desconocido: ${cmd}\n${HELP}`);

  const token = requireToken();

  if (cmd === 'export') await cmdExport(songId, base, token);
  else if (cmd === 'report') await cmdReport(songId, base, token);
  else if (cmd === 'restore') await cmdRestore(songId, base, token);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
