-- Quitar NOT NULL de email/username en feature_flag_users.
--
-- La migración 20260601164534 reemplazó el PK compuesto (flag_key, email,
-- username) por un id surrogado, PERO `DROP CONSTRAINT ..._pkey` en Postgres NO
-- elimina los NOT NULL implícitos que el PRIMARY KEY había añadido a esas
-- columnas. Por eso una asignación solo-email (username = NULL) seguía fallando
-- con "null value ... violates not-null constraint".
--
-- La CHECK (email IS NOT NULL OR username IS NOT NULL) garantiza que al menos
-- uno esté presente, así que cada columna individualmente puede ser NULL.
ALTER TABLE feature_flag_users ALTER COLUMN email    DROP NOT NULL;
ALTER TABLE feature_flag_users ALTER COLUMN username DROP NOT NULL;
