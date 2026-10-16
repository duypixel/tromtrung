-- TromTrung: thống kê lượt xem trang
-- Chạy toàn bộ SQL này một lần trong Supabase > SQL Editor.
create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visited_at timestamptz not null default now(),
  session_id text not null,
  page_path text not null default '/'
);

alter table public.site_visits enable row level security;

drop policy if exists "Public can record site visits" on public.site_visits;
create policy "Public can record site visits"
on public.site_visits for insert
to anon, authenticated
with check (
  length(session_id) between 10 and 80
  and length(page_path) between 1 and 500
);

drop policy if exists "Authenticated users can read site visit stats" on public.site_visits;
create policy "Authenticated users can read site visit stats"
on public.site_visits for select
to authenticated
using (true);

create index if not exists site_visits_visited_at_idx
on public.site_visits (visited_at desc);

create index if not exists site_visits_session_id_idx
on public.site_visits (session_id);
