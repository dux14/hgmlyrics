-- supabase/migrations/20260616000100_ephemeral_list_items.sql
-- Reemplaza ephemeral_list_songs por una tabla polimórfica que acepta
-- item_type 'song' | 'weekly_word'. Se copian todos los datos existentes.

CREATE TABLE ephemeral_list_items (
  list_id    uuid NOT NULL REFERENCES ephemeral_lists(id) ON DELETE CASCADE,
  item_type  text NOT NULL CHECK (item_type IN ('song', 'weekly_word')),
  item_id    text NOT NULL,   -- songs.id (text) | weekly_words.id (uuid as text)
  position   int  NOT NULL,
  PRIMARY KEY (list_id, item_type, item_id)
);

-- Copiar datos históricos.
INSERT INTO ephemeral_list_items (list_id, item_type, item_id, position)
SELECT list_id, 'song', song_id::text, position
FROM ephemeral_list_songs;

-- Eliminar tabla antigua.
DROP TABLE ephemeral_list_songs;
