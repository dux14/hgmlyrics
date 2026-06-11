-- Columna studio_beta en profiles: controla el acceso a la beta del Estudio.
-- Los administradores ya pasan por is_admin; esta columna es para usuarios normales
-- que se quieran habilitar manualmente en la beta.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS studio_beta boolean NOT NULL DEFAULT false;
