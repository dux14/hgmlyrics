-- 0004_normalize_voice_ranges.sql
-- Replace line-level voice fields with sub-line voiceRanges.
-- - Materializes line.voices as a full-line voiceRange
-- - Removes line.voices, line.color, section.voices from the JSONB
-- - Preserves existing voiceRanges as-is
-- - Idempotent: second run finds no `voices` to migrate

BEGIN;

UPDATE songs
SET sections = (
  SELECT jsonb_agg(
    (section - 'voices') || jsonb_build_object(
      'lines', (
        SELECT jsonb_agg(
          (line - 'voices' - 'color') || jsonb_build_object(
            'voiceRanges',
            CASE
              WHEN jsonb_array_length(COALESCE(line->'voiceRanges', '[]'::jsonb)) > 0
                THEN line->'voiceRanges'
              WHEN jsonb_array_length(COALESCE(line->'voices', '[]'::jsonb)) > 0
                THEN jsonb_build_array(
                  jsonb_build_object(
                    'start', 0,
                    'end', length(line->>'text'),
                    'voices', line->'voices'
                  )
                )
              ELSE '[]'::jsonb
            END
          )
        )
        FROM jsonb_array_elements(section->'lines') AS line
      )
    )
  )
  FROM jsonb_array_elements(sections) AS section
)
WHERE sections IS NOT NULL;

COMMIT;
