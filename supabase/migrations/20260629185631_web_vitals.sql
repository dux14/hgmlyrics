create table if not exists public.web_vitals (
  id bigint generated always as identity primary key,
  metric text not null check (metric in ('INP','LCP','CLS','FCP','TTFB')),
  value double precision not null,
  rating text,
  navigation_type text,
  path text,
  attribution jsonb,
  ua text,
  created_at timestamptz not null default now()
);
alter table public.web_vitals enable row level security;
-- Sin policies de cliente: deny-all. Solo service_role (DATABASE_URL) inserta.
create index if not exists web_vitals_created_idx on public.web_vitals (created_at desc);
