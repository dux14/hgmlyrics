-- Resultados permanentes del pipeline unificado (spec 2026-07-20).

-- Letra canonica de referencia (ingesta del cancionero PDF).
create table if not exists public.song_lyrics_canonical (
  song_id text primary key references public.songs(id) on delete cascade,
  source text not null,
  content jsonb not null,
  ingested_at timestamptz not null default now()
);
alter table public.song_lyrics_canonical enable row level security;

-- Pistas completas separadas, permanentes (bucket song-audio, <songId>/stems/).
create table if not exists public.song_stems (
  id uuid primary key default gen_random_uuid(),
  song_id text not null references public.songs(id) on delete cascade,
  kind text not null
    check (kind in ('vocals','instrumental','lead','backing','male','female',
                    'guitar','piano','bass','drums','other','voice_a','voice_b')),
  storage_key text not null,
  duration_sec numeric,
  display text,
  run_id uuid references public.song_pipeline_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (song_id, kind)
);
alter table public.song_stems enable row level security;

-- Partitura vocal publicada (analysis de hkn-pitch + artefactos render).
create table if not exists public.song_pitch_analysis (
  song_id text primary key references public.songs(id) on delete cascade,
  run_id uuid references public.song_pipeline_runs(id) on delete set null,
  analysis jsonb not null,
  artifacts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.song_pitch_analysis enable row level security;

-- Clips por seccion generados por el pipeline (los manuales quedan run_id null
-- y NUNCA se pisan en re-runs).
alter table public.song_section_audio
  add column if not exists run_id uuid references public.song_pipeline_runs(id) on delete set null;
