-- Secciones estructurales detectadas del audio (SongFormer, fase structure del pipeline).
create table if not exists public.song_structure (
  song_id    text primary key references public.songs(id) on delete cascade,
  run_id     uuid references public.song_pipeline_runs(id) on delete set null,
  segments   jsonb not null default '[]'::jsonb, -- [{label, startMs, endMs}]
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists song_structure_run_id_idx on public.song_structure (run_id);
alter table public.song_structure enable row level security; -- deny-all: solo service role, patron pipeline
