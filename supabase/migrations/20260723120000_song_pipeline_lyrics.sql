-- Letra IA-independiente del pipeline (spec 2026-07-23): una fila por canción,
-- poblada al aprobar el gate. NO reemplaza songs.sections (cancionero manual);
-- el karaoke la prefiere si existe (resolución de fuente en api/songs/[id]/audio.js).
create table if not exists public.song_pipeline_lyrics (
  song_id     text primary key references public.songs(id) on delete cascade,
  run_id      uuid references public.song_pipeline_runs(id) on delete set null,
  -- [{type, label, startMs, endMs, lines:[{text, startMs, endMs,
  --   words:[{word,startMs,endMs,score}], confidence, vocalization, breath,
  --   manualStartMs}]}] — shape v2, ver decisiones transversales del plan.
  sections    jsonb not null default '[]'::jsonb,
  hash        text not null,
  approved_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists song_pipeline_lyrics_run_id_idx on public.song_pipeline_lyrics (run_id);
alter table public.song_pipeline_lyrics enable row level security; -- deny-all: solo service role, patrón pipeline (song_structure)
drop trigger if exists song_pipeline_lyrics_updated_at on public.song_pipeline_lyrics;
create trigger song_pipeline_lyrics_updated_at
  before update on public.song_pipeline_lyrics
  for each row execute function set_updated_at();
