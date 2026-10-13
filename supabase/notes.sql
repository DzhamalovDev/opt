-- Run once in the Supabase SQL Editor. Never put a secret/service role key in the website.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 50000),
  pinned boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  constraint note_owner_id_unique unique (user_id, id)
);

create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
alter table public.notes enable row level security;

revoke all on public.notes from anon;
revoke all on public.notes from authenticated;
grant select, insert, update on public.notes to authenticated;

create policy "Read own notes" on public.notes for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Insert own notes" on public.notes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Update own notes" on public.notes for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
