-- Skipped workouts: a client marks a planned workout as skipped (optionally with
-- a reason in notes) instead of it just showing as missed. It's a
-- workout_sessions row with status 'skipped', finished, and no sets. The existing
-- RLS (0013) already lets clients add and delete their own sessions; this adds
-- the rules that keep a skip a skip.

-- A skip has no start time or duration, and one skip per workout per day.
alter table public.workout_sessions
  add constraint workout_sessions_skip_check
  check (status <> 'skipped' or (started_at is null and duration_min is null and finished_at is not null));

create unique index workout_sessions_skip_idx
  on public.workout_sessions (client_id, workout_template_id, performed_on)
  where status = 'skipped';

-- No sets in a skipped session, and a session with sets can't become a skip.
create function public.guard_skipped_session()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'set_logs' then
    if exists (select 1 from public.workout_sessions s where s.id = new.session_id and s.status = 'skipped') then
      raise exception 'This workout was skipped. Undo the skip to log sets.' using errcode = '23514';
    end if;
  elsif new.status = 'skipped' and exists (select 1 from public.set_logs l where l.session_id = new.id) then
    raise exception 'This workout has sets logged, so it can''t be marked skipped.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger set_logs_not_in_skipped before insert or update on public.set_logs
  for each row execute function public.guard_skipped_session();
create trigger workout_sessions_skip_without_sets before update of status on public.workout_sessions
  for each row execute function public.guard_skipped_session();
