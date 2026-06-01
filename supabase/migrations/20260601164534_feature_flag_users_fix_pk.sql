-- Fix feature_flag_users primary key.
--
-- The original composite PK (flag_key, email, username) forces ALL three
-- columns NOT NULL (Postgres PK semantics), which contradicts the intent of
-- allowing an assignment by EITHER email OR username (one of them null).
-- Replace it with a surrogate identity key + partial, case-insensitive unique
-- indexes that enforce real de-duplication and make the endpoint's
-- `ON CONFLICT DO NOTHING` work as intended. Table is new and empty.

ALTER TABLE feature_flag_users DROP CONSTRAINT feature_flag_users_pkey;

ALTER TABLE feature_flag_users
  ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY;

-- One assignment per (flag, email) and per (flag, username), case-insensitive.
CREATE UNIQUE INDEX feature_flag_users_flag_email_uq
  ON feature_flag_users (flag_key, lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX feature_flag_users_flag_username_uq
  ON feature_flag_users (flag_key, lower(username))
  WHERE username IS NOT NULL;
