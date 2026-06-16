-- Add searchable title field to weekly_words.
-- Allows admins to assign a short display title used for search indexing
-- and to disambiguate entries beyond gospel_ref alone.
ALTER TABLE weekly_words ADD COLUMN title text;
