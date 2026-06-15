-- SEC-13: Revocar grant column-level muerto GRANT UPDATE (key) ON songs TO authenticated.
--
-- Situación original: 20260522064548_song_key.sql otorgó UPDATE (key) a authenticated
-- sin que exista una policy UPDATE en songs para ese rol — el grant es inerte hoy
-- (RLS lo bloquea antes de que el grant importe) pero es una trampa futura: si se
-- añade una policy UPDATE permisiva en songs, el authenticated podría mutar la clave
-- tonal sin pasar por el guard de requireAdmin del backend.
--
-- Las ediciones de canciones van exclusivamente por service_role + requireAdmin.
-- No hay ninguna ruta de código que dependa de este grant para usuarios normales.

REVOKE UPDATE (key) ON songs FROM authenticated;
