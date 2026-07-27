-- Fix HIGH (auditoria de seguridad): la cuota diaria de Partitura vocal se
-- derivaba de status IN ('running','succeeded','partial'). Como cancel.js
-- permite running -> cancelled y 'cancelled' no cuenta, un usuario podia
-- aprobar (dispara GPU), cancelar de inmediato, y repetir sin limite: la
-- cuota quedaba siempre en 0.
--
-- Fix: la cuota se consume en el momento del dispatch (approve/retry), no se
-- deriva del estado vivo del job. `dispatched_at` se fija una sola vez por
-- intento de GPU y ya no se borra al cancelar.
ALTER TABLE pitch_jobs ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- Fix HIGH: retry.js no tenia tope de reintentos (a diferencia de su gemelo
-- en stems, MAX_RETRIES=3). Cada POST relanzaba GPU con reset:true sin limite.
ALTER TABLE pitch_jobs ADD COLUMN IF NOT EXISTS retries integer NOT NULL DEFAULT 0;
