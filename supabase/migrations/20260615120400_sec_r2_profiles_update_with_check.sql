-- sec_r2_profiles_update_with_check.sql
-- 2ª auditoría RLS: Fix 2 (Bajo, conf 7)
--
-- Problema: policy profiles_update_own definía solo USING (auth.uid() = id)
-- sin WITH CHECK. Sin WITH CHECK el estado post-update no se valida a nivel RLS
-- (mitigado hoy por GRANTs column-level + PK inmutable, pero faltaba defensa en
-- profundidad).
--
-- Fix: recrear la policy con WITH CHECK equivalente al USING existente.
-- La lógica USING no cambia — solo se añade WITH CHECK para consistencia de RLS.

DROP POLICY IF EXISTS profiles_update_own ON profiles;

CREATE POLICY profiles_update_own ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
