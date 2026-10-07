-- Yuktara schema, part 13: workout logging from the Train tab.
--
-- A session is started (finished_at null), sets are saved one by one as the
-- client ticks them, and "Finish workout" sets finished_at, duration_min and
-- status. While a session is open its status is 'partial', so its sets already
-- count as hard sets (muscle_sets_for_week, muscle_week_sets) but it isn't a
-- "done" workout yet (weekly summaries, sessions missed).
--
-- Logs belong to the client: from here on the coach can read them but not
-- write them (0007 let the coach correct them).

-- ---------- Sessions: open until finished ----------
-- Default now(): rows written any other way (and every existing row) count as finished.
alter table public.workout_sessions add column finished_at timestamptz default now();

-- One open session per client: "Start workout" resumes it instead of starting another.
create unique index workout_sessions_open_idx on public.workout_sessions (client_id) where finished_at is null;

alter table public.workout_sessions
  add constraint workout_sessions_duration_check check (duration_min is null or duration_min between 0 and 600),
  add constraint workout_sessions_notes_check check (notes is null or char_length(notes) <= 2000);

-- ---------- Sets: which planned exercise they were logged against ----------
-- Null for an exercise the client added. When exercise_id differs from the
-- template exercise's, the client swapped it for this session only.
alter table public.set_logs
  add column template_exercise_id uuid references public.template_exercises (id) on delete set null;

alter table public.set_logs
  add constraint set_logs_reps_check check (reps is null or reps between 0 and 100),
  add constraint set_logs_weight_check check (weight_kg is null or weight_kg between 0 and 1000),
  add constraint set_logs_rpe_check check (rpe is null or (rpe between 1 and 10 and rpe * 2 = round(rpe * 2))),
  add constraint set_logs_set_number_check check (set_number between 1 and 50);

-- "Last time" for an exercise: the client's most recent sets of it.
create index set_logs_exercise_session_idx on public.set_logs (exercise_id, session_id);

-- ---------- RLS: the client writes, their coach reads ----------
drop policy "workout_sessions: client or coach" on public.workout_sessions;
drop policy "set_logs: via session" on public.set_logs;

-- True if `template` is a workout in one of the caller's own programs.
create function public.is_my_workout_template(template uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.workout_templates t
    join public.programs p on p.id = t.program_id
    where t.id = template and p.client_id = (select auth.uid())
  );
$$;

create function public.is_my_template_exercise(item uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.template_exercises te
    join public.workout_templates t on t.id = te.workout_template_id
    join public.programs p on p.id = t.program_id
    where te.id = item and p.client_id = (select auth.uid())
  );
$$;

grant execute on function public.is_my_workout_template(uuid) to authenticated;
grant execute on function public.is_my_template_exercise(uuid) to authenticated;

create policy "workout_sessions: client or coach reads" on public.workout_sessions
  for select to authenticated
  using (public.can_see_client(client_id));

create policy "workout_sessions: client adds own" on public.workout_sessions
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and (workout_template_id is null or public.is_my_workout_template(workout_template_id))
  );

create policy "workout_sessions: client edits own" on public.workout_sessions
  for update to authenticated
  using (client_id = (select auth.uid()))
  with check (
    client_id = (select auth.uid())
    and (workout_template_id is null or public.is_my_workout_template(workout_template_id))
  );

create policy "workout_sessions: client deletes own" on public.workout_sessions
  for delete to authenticated
  using (client_id = (select auth.uid()));

create policy "set_logs: client or coach reads" on public.set_logs
  for select to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and public.can_see_client(s.client_id)));

-- Writes: only into the caller's own sessions, with an exercise they can see
-- (library, their own, their coach's) and, if given, a slot from their own program.
create policy "set_logs: client adds own" on public.set_logs
  for insert to authenticated
  with check (
    exists (select 1 from public.workout_sessions s where s.id = session_id and s.client_id = (select auth.uid()))
    and exists (select 1 from public.exercises e where e.id = exercise_id)
    and (template_exercise_id is null or public.is_my_template_exercise(template_exercise_id))
  );

create policy "set_logs: client edits own" on public.set_logs
  for update to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.client_id = (select auth.uid())))
  with check (
    exists (select 1 from public.workout_sessions s where s.id = session_id and s.client_id = (select auth.uid()))
    and exists (select 1 from public.exercises e where e.id = exercise_id)
    and (template_exercise_id is null or public.is_my_template_exercise(template_exercise_id))
  );

create policy "set_logs: client deletes own" on public.set_logs
  for delete to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.client_id = (select auth.uid())));
