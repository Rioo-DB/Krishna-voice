-- Talk to Krishna: accounts, transcripts and daily quota. Prefixed krishna_ because it can share a database.
-- (Scripture search runs inside the app from data/corpus.json, so no tables are needed for it.)

-- 1. Conversations and messages (private per user)
create table public.krishna_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index on public.krishna_conversations (user_id, started_at desc);

create table public.krishna_messages (
  id              bigserial primary key,
  conversation_id uuid not null references public.krishna_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade default auth.uid(),
  role            text not null check (role in ('user','krishna')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index on public.krishna_messages (conversation_id, created_at);

alter table public.krishna_conversations enable row level security;
alter table public.krishna_messages      enable row level security;

create policy "krishna: own conversations" on public.krishna_conversations
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "krishna: own messages" on public.krishna_messages
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 2. Minutes used today, India time (an open session counts until now, capped at 60 min)
create or replace function public.krishna_minutes_used_today()
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(
    least(60, extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60)
  ), 0)
  from public.krishna_conversations
  where user_id = auth.uid()
    and started_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

-- 3. "Delete my history"
create or replace function public.krishna_delete_my_history()
returns void language sql security invoker set search_path = public as $$
  delete from public.krishna_conversations where user_id = auth.uid();
$$;
