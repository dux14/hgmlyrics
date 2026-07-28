-- Fix 1 (TOCTOU de cuota): garantiza a nivel de DB que un usuario no puede tener
-- más de un job "activo" (created/uploaded/processing) a la vez. Sin este índice,
-- dos POST /api/stems/jobs casi simultáneos pueden insertar 2 filas 'created' antes
-- de que el check de "job en proceso" vea ninguna, y disparar /start en paralelo
-- para ambas dispara 2 jobs GPU en Modal para el mismo usuario.
CREATE UNIQUE INDEX IF NOT EXISTS stem_jobs_one_active_per_user
  ON public.stem_jobs (user_id)
  WHERE status IN ('created', 'uploaded', 'processing');
