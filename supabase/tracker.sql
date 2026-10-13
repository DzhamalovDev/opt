-- Run once in the Supabase SQL Editor. Tracker data is one private JSON document per account.
create table if not exists public.trackers (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.trackers enable row level security;

revoke all on public.trackers from anon;
revoke all on public.trackers from authenticated;
grant select, insert, update on public.trackers to authenticated;

drop policy if exists "Read own tracker" on public.trackers;
drop policy if exists "Insert own tracker" on public.trackers;
drop policy if exists "Update own tracker" on public.trackers;

create policy "Read own tracker" on public.trackers for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Insert own tracker" on public.trackers for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Update own tracker" on public.trackers for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
