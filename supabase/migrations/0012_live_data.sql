-- Yuktara schema, part 12: what the apps need to run on live data.

-- ---------- Weekly check-ins: which week, and the first partial week ----------
-- A check-in reviews the Monday–Sunday week that ended most recently on or
-- before the check-in day. Sunday check-ins cover the week ending that day;
-- a Wednesday check-in covers the week that ended the Sunday before.
--   week_start = Monday of (check-in date − 6 days)
-- Day 1 is the client's start_date. If that first week has fewer than 3 of
-- the client's days in it, the first check-in waits until the next week.
-- A check-in not sent within 2 days of opening is marked missed.
create or replace function public.roll_check_ins()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.check_ins (client_id, week_start, status)
  select l.user_id, l.week_start, 'due'
  from (
    select cp.user_id, cp.start_date, cp.check_in_day,
           (now() at time zone u.timezone)::date as today,
           date_trunc('week', (now() at time zone u.timezone)::date - 6)::date as week_start
    from public.client_profiles cp
    join public.users u on u.id = cp.user_id
    where cp.status = 'active' and cp.setup_completed_at is not null
  ) l
  where extract(dow from l.today) = l.check_in_day
    and (l.week_start + 6) - greatest(l.week_start, l.start_date) + 1 >= 3
  on conflict (client_id, week_start) do nothing;

  update public.check_ins c
  set status = 'missed'
  from public.users u, public.client_profiles cp
  where u.id = c.client_id and cp.user_id = c.client_id
    and c.status = 'due'
    -- opened on week_start + 6 + check_in_day (Sunday = 0); two days' grace after that
    and (now() at time zone u.timezone)::date > c.week_start + 6 + cp.check_in_day + 2;
end;
$$;

revoke execute on function public.roll_check_ins() from public, anon, authenticated;

-- ---------- New clients show up in the summaries straight away ----------
create function public.refresh_summaries_after_setup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_summaries();
  return null;
end;
$$;

create trigger client_profiles_setup_refresh
  after update of setup_completed_at on public.client_profiles
  for each row
  when (old.setup_completed_at is null and new.setup_completed_at is not null)
  execute function public.refresh_summaries_after_setup();

-- ---------- Body map for the current week, always up to date ----------
-- muscle_week_sets is a materialized view refreshed nightly; the Train tab
-- needs this week's sets the moment they're logged. Security invoker, so RLS
-- decides whose sets the caller can count (their own, or their clients').
create function public.muscle_sets_for_week(client uuid, week_start date)
returns table (muscle public.muscle_group, hard_sets integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select em.muscle, count(*)::integer
  from public.set_logs sl
  join public.workout_sessions ws on ws.id = sl.session_id
  join public.exercise_muscles em on em.exercise_id = sl.exercise_id and em.role = 'primary'
  where ws.client_id = client
    and ws.performed_on between week_start and week_start + 6
    and ws.status in ('done', 'partial')
    and not sl.is_warmup
  group by em.muscle;
$$;

grant execute on function public.muscle_sets_for_week(uuid, date) to authenticated;
