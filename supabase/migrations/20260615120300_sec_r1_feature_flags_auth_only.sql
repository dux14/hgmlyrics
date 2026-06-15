-- sec_r1_feature_flags_auth_only.sql
-- 2ª auditoría RLS: Fix 1 (Medio, conf 9)
--
-- Problema: policy feature_flags_read no declaraba TO <role>, por lo que aplica
-- también a `anon` → cualquier cliente con la ANON_KEY podía listar todos los
-- feature flags vía PostgREST sin autenticarse.
--
-- El backend (api/) usa DATABASE_URL / postgres.js que conecta como service_role
-- y bypassa RLS, por lo que restringir a `authenticated` es seguro para el back.
--
-- Fix: recrear la policy restringida a `authenticated`.

DROP POLICY IF EXISTS feature_flags_read ON feature_flags;

CREATE POLICY feature_flags_read ON feature_flags
  FOR SELECT TO authenticated USING (true);
