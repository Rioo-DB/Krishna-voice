-- Talk to Krishna: login with email and password (Supabase Auth).
-- Conversations now belong to the signed-in user (auth.uid()) instead of a browser cookie.
-- Additive only: the device-id functions from 20260928000000_init.sql keep working for the
-- deployed no-login build until it is replaced; drop them afterwards.
-- The tables keep RLS on with no policies: everything goes through these security-definer
-- functions, which scope by auth.uid() and are granted to signed-in users only.

alter table public.krishna_conversations
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.krishna_conversations alter column device_id drop not null;
create index if not exists krishna_conversations_user_idx
  on public.krishna_conversations (user_id, started_at desc);

-- Minutes used: by me today and this month, and by everyone today (India time).
-- An open session counts until now, capped at 60 minutes.
create or replace function public.krishna_my_minutes()
returns table (my_today numeric, my_month numeric, all_today numeric)
language sql stable security definer set search_path = public as $$
  with c as (
    select user_id, started_at,
           least(60, extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60) as m
    from krishna_conversations
    where started_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
  ), today as (
    select * from c
    where started_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
  )
  select
    coalesce((select sum(m) from today where user_id = auth.uid()), 0),
    coalesce((select sum(m) from c where user_id = auth.uid()), 0),
    coalesce((select sum(m) from today), 0);
$$;

create or replace function public.krishna_my_start()
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into krishna_conversations (user_id) values (auth.uid()) returning krishna_conversations.id into id;
  return id;
end;
$$;

create or replace function public.krishna_my_end(p_convo uuid)
returns void language sql volatile security definer set search_path = public as $$
  update krishna_conversations set ended_at = now()
  where id = p_convo and user_id = auth.uid() and ended_at is null;
$$;

create or replace function public.krishna_my_add_message(p_convo uuid, p_role text, p_content text)
returns void language sql volatile security definer set search_path = public as $$
  insert into krishna_messages (conversation_id, role, content)
  select p_convo, p_role, left(p_content, 4000)
  where p_role in ('user', 'krishna')
    and exists (select 1 from krishna_conversations where id = p_convo and user_id = auth.uid());
$$;

create or replace function public.krishna_my_history(p_limit int default 50)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(c order by c.started_at desc), '[]'::json) from (
    select k.id, k.started_at, k.ended_at,
      (select coalesce(json_agg(json_build_object('role', m.role, 'content', m.content, 'created_at', m.created_at)
                                order by m.created_at), '[]'::json)
       from krishna_messages m where m.conversation_id = k.id) as messages
    from krishna_conversations k
    where k.user_id = auth.uid()
    order by k.started_at desc
    limit least(greatest(p_limit, 1), 200)
  ) c;
$$;

create or replace function public.krishna_my_delete_history()
returns void language sql volatile security definer set search_path = public as $$
  delete from krishna_conversations where user_id = auth.uid();
$$;

revoke all on function
  public.krishna_my_minutes(), public.krishna_my_start(), public.krishna_my_end(uuid),
  public.krishna_my_add_message(uuid, text, text), public.krishna_my_history(int),
  public.krishna_my_delete_history()
from public, anon;
grant execute on function
  public.krishna_my_minutes(), public.krishna_my_start(), public.krishna_my_end(uuid),
  public.krishna_my_add_message(uuid, text, text), public.krishna_my_history(int),
  public.krishna_my_delete_history()
to authenticated;
