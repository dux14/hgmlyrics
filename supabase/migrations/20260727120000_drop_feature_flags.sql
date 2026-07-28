-- drop_feature_flags.sql
-- Elimina el sistema de feature flags y los gates de beta cerrada.
--
-- Contexto: todas las funcionalidades que estaban detrás de un flag o de un gate
-- de beta pasan a ser públicas para cualquier usuario autenticado. El código que
-- leía estas tablas y columnas ya fue eliminado, así que quedan huérfanas.
--
-- Orden: primero la tabla hija (feature_flag_users referencia feature_flags),
-- después el catálogo. Las policies e índices asociados caen con las tablas.

DROP TABLE IF EXISTS feature_flag_users;
DROP TABLE IF EXISTS feature_flags;

-- Gates de beta cerrada por perfil. El acceso al Estudio de pistas y a la
-- Partitura vocal ya no depende de una marca por usuario.
ALTER TABLE profiles DROP COLUMN IF EXISTS studio_beta;
ALTER TABLE profiles DROP COLUMN IF EXISTS pitch_beta;
