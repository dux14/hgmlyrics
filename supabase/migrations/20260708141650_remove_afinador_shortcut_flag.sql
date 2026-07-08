-- remove_afinador_shortcut_flag.sql
-- El flag `afinador_shortcut` quedó huérfano: su único consumidor (la fila
-- "Afinar" vieja de SongView) se eliminó en el rediseño de refactor/uiux-ambient-kinetic.
-- El nuevo afinador flotante es intencionalmente ungated. Se elimina el flag
-- por completo (sin repropósito).

-- Asignaciones primero (FK a feature_flags.key).
DELETE FROM feature_flag_users WHERE flag_key = 'afinador_shortcut';

DELETE FROM feature_flags WHERE key = 'afinador_shortcut';
