-- Pipeline unificado por cancion: runs del DAG (spec 2026-07-20).
-- 1 run activo por cancion; los viejos quedan como historial (superseded/failed).
create table if not exists public.song_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  song_id text not null references public.songs(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  status text not null default 'created'
    check (status in ('created','uploading','processing','awaiting_lyrics',
                      'running','done','failed','cancelled','superseded')),
  phases jsonb not null default '{}'::jsonb,
  input_path text,
  input_meta jsonb not null default '{}'::jsonb,
  lyrics_review jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un solo run "vivo" por cancion (estados no terminales).
create unique index if not exists song_pipeline_runs_one_active_per_song
  on public.song_pipeline_runs (song_id)
  where status in ('created','uploading','processing','awaiting_lyrics','running');

create index if not exists song_pipeline_runs_song_idx
  on public.song_pipeline_runs (song_id, created_at desc);

alter table public.song_pipeline_runs enable row level security;
