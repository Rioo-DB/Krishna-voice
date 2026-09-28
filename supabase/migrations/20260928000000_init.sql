-- Talk to Krishna: transcripts and daily minutes, with no login.
-- Each browser is identified by a random device id (an httpOnly cookie set by proxy.ts).
-- Prefixed krishna_ because it can share a database with another app.
-- The tables have RLS on and no policies: the public key cannot read or write them
-- directly, only through the security-definer functions below, which always scope
-- by device id. (Scripture search runs in the app from data/corpus.json.)

drop function if exists public.krishna_minutes_used_today();
drop function if exists public.krishna_delete_my_history();
drop table if exists public.krishna_messages;
drop table if exists public.krishna_conversations;

create table public.krishna_conversations (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index on public.krishna_conversations (device_id, started_at desc);
create index on public.krishna_conversations (started_at);

create table public.krishna_messages (
  id              bigserial primary key,
  conversation_id uuid not null references public.krishna_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'krishna')),
  content         text not null check (length(content) <= 4000),
  created_at      timestamptz not null default now()
);
create index on public.krishna_messages (conversation_id, created_at);

alter table public.krishna_conversations enable row level security;
alter table public.krishna_messages      enable row level security;

-- Minutes used today (India time): this device, and everyone together.
-- An open session counts until now, capped at 60 minutes.
create function public.krishna_minutes(p_device uuid)
returns table (device_minutes numeric, all_minutes numeric)
language sql stable security definer set search_path = public as $$
  with today as (
    select device_id, least(60, extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60) as m
    from krishna_conversations
    where started_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
  )
  select coalesce(sum(m) filter (where device_id = p_device), 0), coalesce(sum(m), 0) from today;
$$;

create function public.krishna_start(p_device uuid)
returns uuid language sql volatile security definer set search_path = public as $$
  insert into krishna_conversations (device_id) values (p_device) returning id;
$$;

create function public.krishna_end(p_device uuid, p_convo uuid)
returns void language sql volatile security definer set search_path = public as $$
  update krishna_conversations set ended_at = now()
  where id = p_convo and device_id = p_device and ended_at is null;
$$;

create function public.krishna_add_message(p_device uuid, p_convo uuid, p_role text, p_content text)
returns void language sql volatile security definer set search_path = public as $$
  insert into krishna_messages (conversation_id, role, content)
  select p_convo, p_role, left(p_content, 4000)
  where exists (select 1 from krishna_conversations where id = p_convo and device_id = p_device);
$$;

create function public.krishna_history(p_device uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(c order by c.started_at desc), '[]'::json) from (
    select k.id, k.started_at, k.ended_at,
      (select coalesce(json_agg(json_build_object('role', m.role, 'content', m.content, 'created_at', m.created_at)
                                order by m.created_at), '[]'::json)
       from krishna_messages m where m.conversation_id = k.id) as messages
    from krishna_conversations k
    where k.device_id = p_device
    order by k.started_at desc
    limit 50
  ) c;
$$;

create function public.krishna_delete_history(p_device uuid)
returns void language sql volatile security definer set search_path = public as $$
  delete from krishna_conversations where device_id = p_device;
$$;

revoke all on function
  public.krishna_minutes(uuid), public.krishna_start(uuid), public.krishna_end(uuid, uuid),
  public.krishna_add_message(uuid, uuid, text, text), public.krishna_history(uuid),
  public.krishna_delete_history(uuid)
from public;
grant execute on function
  public.krishna_minutes(uuid), public.krishna_start(uuid), public.krishna_end(uuid, uuid),
  public.krishna_add_message(uuid, uuid, text, text), public.krishna_history(uuid),
  public.krishna_delete_history(uuid)
to anon, authenticated;
