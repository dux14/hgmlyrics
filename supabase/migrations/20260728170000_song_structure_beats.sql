-- BPM/beats detectados en la fase structure del pipeline unificado (librosa,
-- best-effort). Antes solo vivian en align_app.py (fase sync, que el pipeline
-- nunca despacha) -- el approve terminaba escribiendo bpm_detected/beats en
-- NULL siempre. Ahora structure ya descarga la mezcla completa y detecta el
-- tempo ahi; el approve los lee de esta columna en vez de perderlos.
alter table public.song_structure
  add column if not exists beats jsonb; -- {bpm: number, beatsMs: [int, ...]} | null
