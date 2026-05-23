-- 0007_vocal_range_notes.sql
-- Free-text notes attached to a user's vocal range (e.g. "falsete G4-D2",
-- "registro cómodo D2-D4", "afinación ~G2-C4", "puede ser más alto").
-- Kept short (≤80) to discourage essays; UI maxlength enforces this too.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vocal_range_notes TEXT;

-- Length cap belongs at the DB so future writers (admin tools, scripts) can't
-- silently bypass the API validation.
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_vocal_range_notes_length;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_vocal_range_notes_length
    CHECK (vocal_range_notes IS NULL OR length(vocal_range_notes) <= 80);

-- Owner needs UPDATE permission on the new column (the existing RLS policy
-- restricts WHO can update; this GRANT controls which columns the role
-- targets at all). Mirrors the 0005 grant pattern.
GRANT UPDATE (vocal_range_notes) ON profiles TO authenticated;
