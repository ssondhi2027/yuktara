-- Yuktara schema, part 14: two-way messaging between a client and their coach.
--
-- A conversation is every message with the same client_id; its members are the
-- client and their current coach (can_see_client). Plain messages are inserted
-- straight from the apps as the signed-in user; check-in feedback comes from
-- the backend (POST /checkins/{id}/review), also as the user, so RLS covers both.

-- ---------- Who may send ----------
-- Replaces 0007's insert policy, which let a client without a coach write into
-- their own thread and let a sender set check_in_id or read_at.
drop policy "messages: thread members send as self" on public.messages;

create policy "messages: client to their coach, coach to their client" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and read_at is null
    and (
      (client_id = (select auth.uid()) and public.my_coach_id() is not null)
      or public.is_coach_of(client_id)
    )
    -- Check-in feedback: only the coach, only for that client's check-in.
    and (
      check_in_id is null
      or (
        public.is_coach_of(client_id)
        and exists (select 1 from public.check_ins c where c.id = check_in_id and c.client_id = messages.client_id)
      )
    )
    -- Chat messages are capped at 2000 characters; review feedback keeps the table's 5000.
    and (check_in_id is not null or char_length(body) <= 2000)
  );

-- ---------- Who may mark read ----------
-- The recipient only: the client for anything in their thread they didn't send,
-- the coach for what the client sent. (0007's rule also let a new coach mark a
-- previous coach's messages to the client as read.) Only read_at is updatable
-- (column grant in 0007), and nobody can delete a message.
drop policy "messages: recipient marks read" on public.messages;

create policy "messages: recipient marks read" on public.messages
  for update to authenticated
  using (
    (client_id = (select auth.uid()) and sender_id <> (select auth.uid()))
    or (sender_id = client_id and public.is_coach_of(client_id))
  )
  with check (
    (client_id = (select auth.uid()) and sender_id <> (select auth.uid()))
    or (sender_id = client_id and public.is_coach_of(client_id))
  );

-- ---------- Rate limit ----------
-- Direct inserts skip the API, so the limit lives in the database: at most 10
-- messages a minute and 60 per 10 minutes per sender, check-in feedback
-- included. SQLSTATE PT429 makes PostgREST answer 429; the API maps it too.
create function public.messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_minute integer;
  last_ten integer;
begin
  select count(*) filter (where created_at > now() - interval '1 minute'), count(*)
    into last_minute, last_ten
  from public.messages
  where sender_id = new.sender_id and created_at > now() - interval '10 minutes';
  if last_minute >= 10 or last_ten >= 60 then
    raise exception 'You''re sending messages too fast. Wait a minute and try again.' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();

create index messages_sender_idx on public.messages (sender_id, created_at desc);
-- Unread counts look only at unread rows.
create index messages_unread_idx on public.messages (client_id, sender_id) where read_at is null;
-- "Latest message per client" uses messages_thread_idx (client_id, created_at desc) from 0005.

-- ---------- Reads for the apps ----------
-- Security invoker: RLS decides what each caller counts.

-- The coach's conversation list: every client, their latest message and how many
-- of the client's messages the coach hasn't read.
create function public.message_threads()
returns table (
  client_id uuid, full_name text, last_body text, last_at timestamptz, last_sender_id uuid,
  last_check_in_id uuid, unread integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select cp.user_id, u.full_name, m.body, m.created_at, m.sender_id, m.check_in_id,
         (select count(*)::integer from public.messages x
          where x.client_id = cp.user_id and x.sender_id = cp.user_id and x.read_at is null)
  from public.client_profiles cp
  join public.users u on u.id = cp.user_id
  left join lateral (
    select body, created_at, sender_id, check_in_id
    from public.messages
    where messages.client_id = cp.user_id
    order by created_at desc
    limit 1
  ) m on true
  where cp.coach_id = (select auth.uid());
$$;

-- Unread messages for the signed-in user: for a client, what others wrote in
-- their thread; for a coach, what their clients wrote.
create function public.unread_message_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
  from public.messages m
  where m.read_at is null
    and (
      (m.client_id = (select auth.uid()) and m.sender_id <> (select auth.uid()))
      or (m.sender_id = m.client_id and public.is_coach_of(m.client_id))
    );
$$;

grant execute on function public.message_threads() to authenticated;
grant execute on function public.unread_message_count() to authenticated;
