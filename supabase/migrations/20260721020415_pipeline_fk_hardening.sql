-- Hardening de FKs del pipeline unificado (review DB 2026-07-21):
-- indexar todas las FK (regla del repo) y alinear created_by con el patron
-- ON DELETE CASCADE de pitch_jobs.

-- Indices de FK faltantes.
create index if not exists song_pipeline_runs_created_by_idx
  on public.song_pipeline_runs (created_by);
create index if not exists song_stems_run_id_idx
  on public.song_stems (run_id);
create index if not exists song_pitch_analysis_run_id_idx
  on public.song_pitch_analysis (run_id);
create index if not exists song_section_audio_run_id_idx
  on public.song_section_audio (run_id);

-- Alinear created_by con el patron del repo (pitch_jobs.user_id ON DELETE CASCADE).
alter table public.song_pipeline_runs
  drop constraint if exists song_pipeline_runs_created_by_fkey;
alter table public.song_pipeline_runs
  add constraint song_pipeline_runs_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade;
