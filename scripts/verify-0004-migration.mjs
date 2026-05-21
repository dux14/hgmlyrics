#!/usr/bin/env node
/**
 * verify-0004-migration.mjs — Read-only verification of migration 0004.
 *
 * Usage:
 *   node scripts/verify-0004-migration.mjs
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (or .env.local).
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env.development.local' });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key);

const VALID = new Set(['soprano', 'contralto', 'tenor', 'bass']);

async function main() {
  const { data: rows, error } = await sb.from('songs').select('id, sections');
  if (error) throw error;

  let withSections = 0;
  let stillHasLegacy = 0;
  let totalRanges = 0;
  let invalidRanges = 0;

  for (const row of rows) {
    if (!row.sections) continue;
    withSections++;
    if (hasLegacyVoices(row.sections)) stillHasLegacy++;
    for (const sec of row.sections) {
      for (const line of sec.lines || []) {
        for (const r of line.voiceRanges || []) {
          totalRanges++;
          const okBounds = Number.isInteger(r.start) && Number.isInteger(r.end) && r.start < r.end;
          const okVoices = Array.isArray(r.voices) && r.voices.length > 0 && r.voices.every((v) => VALID.has(v));
          if (!okBounds || !okVoices) {
            invalidRanges++;
            console.error(`Invalid range in song ${row.id}:`, r);
          }
        }
      }
    }
  }

  console.log('VERIFY 0004 ──────────');
  console.log('total_songs_with_sections:', withSections);
  console.log('still_has_legacy:        ', stillHasLegacy);
  console.log('total_ranges_count:      ', totalRanges);
  console.log('invalid_ranges:          ', invalidRanges);
  console.log('──────────');

  if (stillHasLegacy > 0 || invalidRanges > 0) {
    console.error('FAIL: legacy fields or invalid ranges present');
    process.exit(2);
  }
  console.log('PASS');
}

function hasLegacyVoices(sections) {
  for (const sec of sections) {
    if (sec.voices !== undefined) return true;
    for (const line of sec.lines || []) {
      if (line.voices !== undefined) return true;
      if (line.color !== undefined) return true;
    }
  }
  return false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
