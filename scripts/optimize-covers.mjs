#!/usr/bin/env node
/**
 * optimize-covers.mjs
 *
 * Resizes album covers in public/covers/ to a sane mobile-retina target,
 * re-encodes to WebP q80 and preserves the original if the optimized output
 * is larger.
 *
 * First run creates public/covers.backup/ with a copy of the originals so the
 * script is always idempotent: subsequent runs read from the backup, never
 * from already-optimized output.
 */

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COVERS = path.join(ROOT, 'public', 'covers');
const BACKUP = path.join(ROOT, 'public', 'covers.backup');

const TARGET = 480; // mobile 362px × DPR ~1.33 with margin; desktop is smaller
const QUALITY = 80;
const EFFORT = 4; // 0-6 (cpu/size tradeoff)

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureBackup() {
  if (await exists(BACKUP)) {
    console.log(`✓ Backup already exists at public/covers.backup/`);
    return;
  }
  console.log(`→ Creating backup: public/covers/ → public/covers.backup/`);
  await fs.cp(COVERS, BACKUP, { recursive: true });
}

function fmtKB(n) {
  return (n / 1024).toFixed(1).padStart(7);
}

async function optimize() {
  await ensureBackup();

  const files = (await fs.readdir(BACKUP)).filter((f) => f.endsWith('.webp'));
  console.log(
    `\nOptimizing ${files.length} covers → ${TARGET}×${TARGET} (fit:inside, no enlargement, webp q${QUALITY})\n`,
  );

  let totalBefore = 0;
  let totalAfter = 0;
  let kept = 0;

  for (const f of files) {
    const src = path.join(BACKUP, f);
    const dst = path.join(COVERS, f);
    const before = (await fs.stat(src)).size;

    const buf = await sharp(src)
      .resize(TARGET, TARGET, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: EFFORT })
      .toBuffer();

    let after = buf.length;
    let note = '';

    if (after >= before) {
      // Re-encoding made it larger — keep the original.
      await fs.copyFile(src, dst);
      after = before;
      note = ' (kept original)';
      kept++;
    } else {
      await fs.writeFile(dst, buf);
    }

    totalBefore += before;
    totalAfter += after;

    const saved = before - after;
    const pct = ((saved / before) * 100).toFixed(0).padStart(3);
    console.log(`  ${f.padEnd(28)} ${fmtKB(before)} → ${fmtKB(after)} KB  ${pct}%${note}`);
  }

  const totalSaved = totalBefore - totalAfter;
  const totalPct = ((totalSaved / totalBefore) * 100).toFixed(1);
  console.log(
    `\nTotal: ${fmtKB(totalBefore)} → ${fmtKB(totalAfter)} KB  (saved ${fmtKB(totalSaved)} KB, ${totalPct}%)`,
  );
  if (kept > 0) console.log(`Kept ${kept} originals (optimization would have grown them).`);
  console.log(`\n💡 Backup remains at public/covers.backup/ — re-run anytime for a fresh pass.`);
}

optimize().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
