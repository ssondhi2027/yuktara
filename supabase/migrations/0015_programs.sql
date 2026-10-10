-- Yuktara schema, part 15: the coach's program builder.
--
-- A client program is a draft until the coach assigns it (assigned_at null,
-- start_date null), so the client app and the summaries ignore it. Assigning
-- sets start_date; the program it replaces stops at that week. Templates are
-- programs with is_template (client_id null), as in 0003.
--
-- Logged history is never rewritten: a workout or exercise that sessions or
-- sets already point at is marked removed instead of deleted, and changing the
-- exercise of a slot with logged sets gives the plan a new slot.

-- ---------- Programs ----------
alter table public.programs
  add column goal          public.goal_type,
  add column level         public.exercise_level,
  add column days_per_week smallint check (days_per_week between 1 and 7),
  -- Null = draft (client programs) or template. Existing rows count as assigned.
  add column assigned_at   timestamptz default now(),
  -- The start date a draft will get when it's assigned.
  add column draft_start   date;

update public.programs set assigned_at = null where is_template;

create index programs_coach_template_idx on public.programs (coach_id) where is_template;

-- ---------- Workouts and exercises ----------
alter table public.workout_templates
  add column removed_at timestamptz;

alter table public.template_exercises
  add column removed_at timestamptz,
  add column notes      text check (char_length(notes) <= 500),
  add constraint template_exercises_sets_check check (target_sets between 1 and 10),
  add constraint template_exercises_rpe_check check (target_rpe is null or target_rpe between 1 and 10),
  add constraint template_exercises_reps_check check (char_length(btrim(target_reps)) between 1 and 20),
  add constraint template_exercises_rest_check check (rest_seconds is null or rest_seconds between 0 and 900);

alter table public.workout_templates
  add constraint workout_templates_name_check check (char_length(btrim(name)) between 1 and 80),
  add constraint workout_templates_notes_check check (notes is null or char_length(notes) <= 1000);

-- ---------- RLS ----------
-- Clients read only programs that were assigned to them (never drafts) and
-- never write. Coaches manage their own templates and their own clients'
-- programs, and may delete only drafts and templates (an assigned program has
-- history hanging off it).
drop policy "programs: client reads own" on public.programs;
create policy "programs: client reads own assigned" on public.programs
  for select to authenticated
  using (client_id = (select auth.uid()) and assigned_at is not null and not is_template);

drop policy "programs: coach manages own" on public.programs;
create policy "programs: coach reads own" on public.programs
  for select to authenticated
  using (coach_id = (select auth.uid()));
create policy "programs: coach adds own" on public.programs
  for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.is_coach()
              and (client_id is null or public.is_coach_of(client_id)));
create policy "programs: coach edits own" on public.programs
  for update to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and public.is_coach()
              and (client_id is null or public.is_coach_of(client_id)));
create policy "programs: coach deletes drafts and templates" on public.programs
  for delete to authenticated
  using (coach_id = (select auth.uid()) and (is_template or assigned_at is null));

-- ---------- Save a whole program at once ----------
-- The builder sends the program as JSON:
--   {id?, client_id?, name, weeks, goal?, level?, days_per_week?, draft_start?,
--    workouts: [{id?, name, day_of_week?, notes?,
--                exercises: [{id?, exercise_id, target_sets, target_reps, target_rpe?, rest_seconds?, notes?}]}]}
-- Order in the arrays is the order in the program. Rows without an id are new.
-- Security invoker: RLS decides what the caller may write.
create function public.save_program(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pid    uuid := nullif(p->>'id', '')::uuid;
  client uuid := nullif(p->>'client_id', '')::uuid;
  w      record;
  x      record;
  wid    uuid;
  xid    uuid;
  old_ex uuid;
  keep_w uuid[] := '{}';
  keep_x uuid[];
begin
  if pid is null then
    insert into public.programs (coach_id, client_id, is_template, name, weeks, goal, level, days_per_week,
                                 draft_start, start_date, assigned_at)
    values ((select auth.uid()), client, client is null, btrim(p->>'name'), (p->>'weeks')::smallint,
            nullif(p->>'goal', '')::public.goal_type, nullif(p->>'level', '')::public.exercise_level,
            nullif(p->>'days_per_week', '')::smallint,
            case when client is null then null else nullif(p->>'draft_start', '')::date end, null, null)
    returning id into pid;
  else
    update public.programs
       set name = btrim(p->>'name'),
           weeks = (p->>'weeks')::smallint,
           goal = nullif(p->>'goal', '')::public.goal_type,
           level = nullif(p->>'level', '')::public.exercise_level,
           days_per_week = nullif(p->>'days_per_week', '')::smallint,
           draft_start = case when assigned_at is null and not is_template
                              then nullif(p->>'draft_start', '')::date else draft_start end
     where id = pid;
    if not found then
      raise exception 'That program doesn''t exist.' using errcode = 'PT404';
    end if;
  end if;

  for w in
    select value as body, (ordinality - 1)::smallint as pos
    from jsonb_array_elements(coalesce(p->'workouts', '[]'::jsonb)) with ordinality
  loop
    wid := nullif(w.body->>'id', '')::uuid;
    if wid is not null and exists (
      select 1 from public.workout_templates where id = wid and program_id = pid and removed_at is null
    ) then
      update public.workout_templates
         set name = btrim(w.body->>'name'), day_of_week = nullif(w.body->>'day_of_week', '')::smallint,
             position = w.pos, notes = nullif(btrim(coalesce(w.body->>'notes', '')), '')
       where id = wid;
    else
      insert into public.workout_templates (program_id, name, day_of_week, position, notes)
      values (pid, btrim(w.body->>'name'), nullif(w.body->>'day_of_week', '')::smallint, w.pos,
              nullif(btrim(coalesce(w.body->>'notes', '')), ''))
      returning id into wid;
    end if;
    keep_w := keep_w || wid;
    keep_x := '{}';

    for x in
      select value as body, (ordinality - 1)::smallint as pos
      from jsonb_array_elements(coalesce(w.body->'exercises', '[]'::jsonb)) with ordinality
    loop
      xid := nullif(x.body->>'id', '')::uuid;
      old_ex := null;
      if xid is not null then
        select exercise_id into old_ex
        from public.template_exercises
        where id = xid and workout_template_id = wid and removed_at is null;
      end if;
      if old_ex is null then
        xid := null;
      elsif old_ex <> (x.body->>'exercise_id')::uuid
            and exists (select 1 from public.set_logs s where s.template_exercise_id = xid) then
        -- Sets were logged against the old exercise: keep that slot for history, start a new one.
        update public.template_exercises set removed_at = now() where id = xid;
        xid := null;
      else
        update public.template_exercises
           set exercise_id = (x.body->>'exercise_id')::uuid, position = x.pos,
               target_sets = (x.body->>'target_sets')::smallint, target_reps = btrim(x.body->>'target_reps'),
               target_rpe = nullif(x.body->>'target_rpe', '')::numeric,
               rest_seconds = nullif(x.body->>'rest_seconds', '')::smallint,
               notes = nullif(btrim(coalesce(x.body->>'notes', '')), '')
         where id = xid;
      end if;
      if xid is null then
        insert into public.template_exercises (workout_template_id, exercise_id, position, target_sets, target_reps,
                                               target_rpe, rest_seconds, notes)
        values (wid, (x.body->>'exercise_id')::uuid, x.pos, (x.body->>'target_sets')::smallint,
                btrim(x.body->>'target_reps'), nullif(x.body->>'target_rpe', '')::numeric,
                nullif(x.body->>'rest_seconds', '')::smallint, nullif(btrim(coalesce(x.body->>'notes', '')), ''))
        returning id into xid;
      end if;
      keep_x := keep_x || xid;
    end loop;

    -- Exercises taken out of this workout: keep the ones with logged sets (marked removed), delete the rest.
    update public.template_exercises te set removed_at = now()
     where te.workout_template_id = wid and te.removed_at is null and not (te.id = any (keep_x))
       and exists (select 1 from public.set_logs s where s.template_exercise_id = te.id);
    delete from public.template_exercises te
     where te.workout_template_id = wid and te.removed_at is null and not (te.id = any (keep_x));
  end loop;

  -- Workouts taken out of the program: same rule, with logged sessions.
  update public.workout_templates t set removed_at = now()
   where t.program_id = pid and t.removed_at is null and not (t.id = any (keep_w))
     and exists (select 1 from public.workout_sessions s where s.workout_template_id = t.id);
  delete from public.workout_templates t
   where t.program_id = pid and t.removed_at is null and not (t.id = any (keep_w));

  return pid;
end;
$$;

-- ---------- Assign ----------
-- Makes a client program active from `start`. The program it replaces stops at
-- the end of the week before; one that hadn't reached that week yet is
-- unscheduled. Old programs keep their workouts, so logged sessions still
-- point at them.
create function public.assign_program(program uuid, start date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.programs;
  monday date := date_trunc('week', start)::date;
begin
  select * into p from public.programs where id = program and coach_id = (select auth.uid()) and not is_template;
  if not found then
    raise exception 'That program doesn''t exist.' using errcode = 'PT404';
  end if;
  -- current_date is UTC; a day of slack covers coaches west of UTC in the evening.
  if start < current_date - 1 then
    raise exception 'Pick a start date from today on.' using errcode = 'P0001';
  end if;

  update public.programs q
     set weeks = ((monday - date_trunc('week', q.start_date)::date) / 7)::smallint
   where q.client_id = p.client_id and q.id <> p.id and q.start_date is not null
     and date_trunc('week', q.start_date)::date < monday
     and date_trunc('week', q.start_date)::date + q.weeks * 7 > monday;

  update public.programs q
     set start_date = null
   where q.client_id = p.client_id and q.id <> p.id and q.start_date is not null
     and date_trunc('week', q.start_date)::date >= monday;

  update public.programs
     set start_date = start, assigned_at = coalesce(assigned_at, now()), draft_start = null
   where id = program;
end;
$$;

-- ---------- Copy ----------
-- client null: save as one of the coach's templates; otherwise a new draft for
-- that client (e.g. "Use template"). Removed workouts and exercises aren't copied.
create function public.copy_program(source uuid, client uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  src  public.programs;
  nid  uuid;
  t    record;
  ntid uuid;
begin
  select * into src from public.programs where id = source and coach_id = (select auth.uid());
  if not found then
    raise exception 'That program doesn''t exist.' using errcode = 'PT404';
  end if;
  insert into public.programs (coach_id, client_id, is_template, name, weeks, goal, level, days_per_week,
                               start_date, assigned_at, draft_start)
  values ((select auth.uid()), client, client is null, src.name, src.weeks, src.goal, src.level, src.days_per_week,
          null, null, null)
  returning id into nid;
  for t in
    select * from public.workout_templates where program_id = source and removed_at is null order by position
  loop
    insert into public.workout_templates (program_id, name, day_of_week, position, notes)
    values (nid, t.name, t.day_of_week, t.position, t.notes)
    returning id into ntid;
    insert into public.template_exercises (workout_template_id, exercise_id, position, target_sets, target_reps,
                                           target_rpe, rest_seconds, notes)
    select ntid, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, notes
    from public.template_exercises
    where workout_template_id = t.id and removed_at is null;
  end loop;
  return nid;
end;
$$;

grant execute on function public.save_program(jsonb) to authenticated;
grant execute on function public.assign_program(uuid, date) to authenticated;
grant execute on function public.copy_program(uuid, uuid) to authenticated;

-- ---------- Weekly summaries ----------
-- Recreated from 0006 with two changes, matching the apps:
--   planned = the program's live workouts that have a day (not removed ones,
--             not drafts, which have no start_date);
--   done    = distinct planned workouts with a finished session that week, so
--             an extra workout doesn't make up for a missed one.
drop view public.weekly_summaries;
drop materialized view analytics.weekly_summaries;

create materialized view analytics.weekly_summaries as
with weeks as (
  select cp.user_id as client_id, gs::date as week_start
  from public.client_profiles cp
  cross join lateral generate_series(
    date_trunc('week', cp.start_date), date_trunc('week', current_date), interval '1 week'
  ) gs
),
planned as (
  select w.client_id, w.week_start, count(wt.id)::int as n
  from weeks w
  join public.programs p
    on p.client_id = w.client_id
   and p.start_date is not null
   and w.week_start >= date_trunc('week', p.start_date)
   and w.week_start < date_trunc('week', p.start_date) + make_interval(weeks => p.weeks)
  join public.workout_templates wt
    on wt.program_id = p.id and wt.removed_at is null and wt.day_of_week is not null
  group by 1, 2
),
done as (
  select client_id, date_trunc('week', performed_on)::date as week_start,
         count(distinct workout_template_id) filter (where status = 'done')::int as n
  from public.workout_sessions
  where workout_template_id is not null
  group by 1, 2
),
meals as (
  select ml.client_id,
         date_trunc('week', (ml.eaten_at at time zone u.timezone))::date as week_start,
         count(*)::int as logged,
         count(*) filter (where ml.on_plan = 'yes')::int as on_plan,
         count(*) filter (where ml.on_plan = 'partly')::int as partly
  from public.meal_logs ml
  join public.users u on u.id = ml.client_id
  group by 1, 2
),
daily_food as (
  select ml.client_id, (ml.eaten_at at time zone u.timezone)::date as d,
         sum(ml.calories) as kcal, sum(ml.protein_g) as protein
  from public.meal_logs ml
  join public.users u on u.id = ml.client_id
  group by 1, 2
),
food_avg as (
  select client_id, date_trunc('week', d)::date as week_start,
         round(avg(kcal))::int as avg_calories, round(avg(protein), 1) as avg_protein_g
  from daily_food
  group by 1, 2
),
weight as (
  select client_id, date_trunc('week', log_date)::date as week_start,
         round(avg(weight_kg), 1) as avg_weight_kg
  from public.daily_logs
  where weight_kg is not null
  group by 1, 2
),
checkins as (
  select client_id, week_start, avg_weight_kg
  from public.check_ins
  where status in ('submitted', 'reviewed')
),
weight_week as (
  select w.client_id, w.week_start, coalesce(ci.avg_weight_kg, wt.avg_weight_kg) as kg
  from weeks w
  left join checkins ci using (client_id, week_start)
  left join weight wt using (client_id, week_start)
),
joined as (
  select
    w.client_id,
    w.week_start,
    coalesce(p.n, 0) as workouts_planned,
    coalesce(d.n, 0) as workouts_done,
    (case when coalesce(p.n, 0) = 0 then null
          else least(100, 100.0 * coalesce(d.n, 0) / p.n) end)::numeric(5, 2) as training_pct,
    coalesce(m.logged, 0) as meals_logged,
    coalesce(m.on_plan, 0) as meals_on_plan,
    (case when coalesce(m.logged, 0) = 0 then null
          else 100.0 * (m.on_plan + 0.5 * m.partly) / m.logged end)::numeric(5, 2) as nutrition_pct,
    f.avg_calories,
    f.avg_protein_g::numeric(6, 1) as avg_protein_g,
    ww.kg::numeric(5, 1) as avg_weight_kg,
    (ww.kg - lag(ww.kg) over (partition by w.client_id order by w.week_start))::numeric(4, 1) as weight_change_kg
  from weeks w
  left join planned p using (client_id, week_start)
  left join done d using (client_id, week_start)
  left join meals m using (client_id, week_start)
  left join food_avg f using (client_id, week_start)
  left join weight_week ww using (client_id, week_start)
)
select
  j.*,
  case
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 75 then 'on_track'
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 60 then 'slipping'
    else 'off_track'
  end::public.week_status as status
from joined j;

create unique index on analytics.weekly_summaries (client_id, week_start);

create view public.weekly_summaries with (security_barrier) as
  select * from analytics.weekly_summaries
  where public.can_see_client(client_id);

grant select on public.weekly_summaries to authenticated;
revoke all on public.weekly_summaries from anon;
