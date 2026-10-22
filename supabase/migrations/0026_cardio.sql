-- Cardio: treadmill, cycling, rowing and the like, logged by time (and
-- optionally distance, level and heart rate) instead of weight × reps.
--
-- exercises.kind is 'strength' (everything so far) or 'cardio'. Cardio
-- exercises have no muscles, so the body map, the muscle pages, hard-set counts
-- and the program generator leave them out as they are. A cardio set is one
-- bout or interval: duration_s is required, distance_m, level (incline or
-- resistance) and avg_hr are optional, and weight, reps, warm-ups and drops
-- don't apply (guard_cardio_sets). A strength set has none of the cardio fields.
--
-- Coaches plan cardio on a program slot: target_sets rounds of target_minutes
-- (or target_distance_m) at target_zone, resting rest_seconds between rounds
-- ("5 × 1 min hard, 1 min easy between"). target_reps keeps a short summary.
--
-- Personal records (0025) gain cardio kinds: distance (longest bout, km),
-- duration (longest bout, minutes) and pace (fastest bout of 1 km or more,
-- seconds per km), with the bout's time and distance.

-- ---------- Exercises ----------
alter table public.exercises
  add column kind text not null default 'strength' check (kind in ('strength', 'cardio'));

-- The shared cardio library (no muscles). Same names are left alone.
insert into public.exercises (name, level, equipment, cue, kind)
values
  ('Treadmill run', 'beginner', 'treadmill', 'Run tall with quick, light steps; hold the rails only to get on and off.', 'cardio'),
  ('Treadmill walk', 'beginner', 'treadmill', 'Walk tall with an easy arm swing; raise the incline rather than holding on.', 'cardio'),
  ('Outdoor run', 'beginner', 'outdoors', 'Easy runs at a pace you could talk at, unless the plan says otherwise.', 'cardio'),
  ('Brisk walk', 'beginner', 'outdoors', 'Fast enough to breathe a little harder, still able to talk.', 'cardio'),
  ('Hiking', 'beginner', 'outdoors', 'Shorter steps uphill, and keep a steady effort rather than a steady pace.', 'cardio'),
  ('Cycling', 'beginner', 'bike', 'Outdoors: a steady cadence, easier gears on the climbs.', 'cardio'),
  ('Stationary bike', 'beginner', 'bike', 'Saddle at hip height, a slight bend in the knee at the bottom.', 'cardio'),
  ('Air bike', 'intermediate', 'air bike', 'Push and pull the handles; the harder you go, the harder it gets.', 'cardio'),
  ('Rowing machine', 'beginner', 'rower', 'Legs, then body, then arms; reverse the order on the way back.', 'cardio'),
  ('Elliptical', 'beginner', 'elliptical', 'Stand tall, push through the whole foot.', 'cardio'),
  ('Stair climber', 'beginner', 'stair climber', 'Light hands on the rails, stand tall, full steps.', 'cardio'),
  ('Swimming', 'beginner', 'pool', 'Any stroke; log the time and the distance swum.', 'cardio'),
  ('Ski erg', 'intermediate', 'ski erg', 'Hinge at the hips and pull down with the arms together.', 'cardio'),
  ('HIIT intervals', 'intermediate', 'bodyweight', 'Hard efforts with easy recovery between; log each round.', 'cardio')
on conflict do nothing;

-- A coach's own exercise: strength (with muscles) or cardio (none). The kind
-- can't change once a program or a logged set uses the exercise.
create or replace function public.save_exercise(e jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  eid  uuid := nullif(e->>'id', '')::uuid;
  nm   text := btrim(coalesce(e->>'name', ''));
  knd  text := coalesce(nullif(e->>'kind', ''), 'strength');
  prim text[] := array(select distinct jsonb_array_elements_text(coalesce(e->'primary', '[]'::jsonb)));
  sec  text[] := array(select distinct jsonb_array_elements_text(coalesce(e->'secondary', '[]'::jsonb)));
begin
  if not public.is_coach() then
    raise exception 'Only coaches add exercises.' using errcode = '42501';
  end if;
  if knd not in ('strength', 'cardio') then
    raise exception 'An exercise is strength or cardio.';
  end if;
  if knd = 'cardio' then
    prim := '{}';
    sec := '{}';
  elsif coalesce(array_length(prim, 1), 0) = 0 then
    raise exception 'Choose at least one main muscle.';
  end if;
  if prim && sec then
    raise exception 'A muscle is either main or secondary, not both.';
  end if;
  if exists (select 1 from public.exercises x where x.created_by is null and lower(x.name) = lower(nm)) then
    raise exception 'The library already has "%". Pick it from the list instead.', nm;
  end if;

  if eid is null then
    insert into public.exercises (name, level, equipment, cue, created_by, kind)
    values (nm, coalesce(nullif(e->>'level', '')::public.exercise_level, 'beginner'),
            nullif(btrim(e->>'equipment'), ''), nullif(btrim(e->>'cue'), ''), (select auth.uid()), knd)
    returning id into eid;
  else
    if exists (select 1 from public.exercises x where x.id = eid and x.kind <> knd)
       and (exists (select 1 from public.set_logs s where s.exercise_id = eid)
            or exists (select 1 from public.template_exercises t where t.exercise_id = eid)) then
      raise exception 'This exercise is in a program or a logged workout, so it can''t switch between strength and cardio.';
    end if;
    update public.exercises
       set name = nm,
           level = coalesce(nullif(e->>'level', '')::public.exercise_level, 'beginner'),
           equipment = nullif(btrim(e->>'equipment'), ''),
           cue = nullif(btrim(e->>'cue'), ''),
           kind = knd
     where id = eid and created_by = (select auth.uid());
    if not found then
      raise exception 'That exercise doesn''t exist (or isn''t yours).' using errcode = 'PT404';
    end if;
    delete from public.exercise_muscles where exercise_id = eid;
  end if;

  insert into public.exercise_muscles (exercise_id, muscle, role)
  select eid, m::public.muscle_group, 'primary'::public.muscle_role from unnest(prim) m
  union all
  select eid, m::public.muscle_group, 'secondary'::public.muscle_role from unnest(sec) m;
  return eid;
end;
$$;

-- ---------- Logged sets ----------
alter table public.set_logs
  add column duration_s  integer check (duration_s is null or duration_s between 1 and 86400),
  add column distance_m  numeric(8, 1) check (distance_m is null or (distance_m > 0 and distance_m <= 1000000)),
  add column level       numeric(4, 1) check (level is null or level between 0 and 100),
  add column avg_hr      smallint check (avg_hr is null or avg_hr between 30 and 250);

-- Cardio sets have a time and no weight, reps, warm-up or drop; strength sets have no cardio fields.
create function public.guard_cardio_sets()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cardio boolean := exists (select 1 from public.exercises e where e.id = new.exercise_id and e.kind = 'cardio');
begin
  if cardio then
    if new.duration_s is null then
      raise exception 'Enter how long it took.' using errcode = '23514';
    end if;
    if new.weight_kg is not null or new.reps is not null or new.is_warmup or new.set_kind <> 'normal' then
      raise exception 'Cardio is logged by time and distance, without weight, reps, warm-ups or drops.' using errcode = '23514';
    end if;
  elsif new.duration_s is not null or new.distance_m is not null or new.level is not null or new.avg_hr is not null then
    raise exception 'Time, distance, level and heart rate are for cardio exercises.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger set_logs_guard_cardio before insert or update on public.set_logs
  for each row execute function public.guard_cardio_sets();

-- ---------- Planned cardio ----------
alter table public.template_exercises
  add column target_minutes    numeric(5, 1) check (target_minutes is null or (target_minutes > 0 and target_minutes <= 600)),
  add column target_distance_m numeric(8, 1) check (target_distance_m is null or (target_distance_m > 0 and target_distance_m <= 1000000)),
  add column target_zone       text check (target_zone is null or target_zone in ('easy', 'moderate', 'hard', 'max'));

-- save_program and copy_program as in 0024, keeping the cardio targets.
create or replace function public.save_program(p jsonb)
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
               notes = nullif(btrim(coalesce(x.body->>'notes', '')), ''),
               superset_group = nullif(upper(btrim(coalesce(x.body->>'superset_group', ''))), ''),
               target_minutes = nullif(x.body->>'target_minutes', '')::numeric,
               target_distance_m = nullif(x.body->>'target_distance_m', '')::numeric,
               target_zone = nullif(x.body->>'target_zone', '')
         where id = xid;
      end if;
      if xid is null then
        insert into public.template_exercises (workout_template_id, exercise_id, position, target_sets, target_reps,
                                               target_rpe, rest_seconds, notes, superset_group,
                                               target_minutes, target_distance_m, target_zone)
        values (wid, (x.body->>'exercise_id')::uuid, x.pos, (x.body->>'target_sets')::smallint,
                btrim(x.body->>'target_reps'), nullif(x.body->>'target_rpe', '')::numeric,
                nullif(x.body->>'rest_seconds', '')::smallint, nullif(btrim(coalesce(x.body->>'notes', '')), ''),
                nullif(upper(btrim(coalesce(x.body->>'superset_group', ''))), ''),
                nullif(x.body->>'target_minutes', '')::numeric, nullif(x.body->>'target_distance_m', '')::numeric,
                nullif(x.body->>'target_zone', ''))
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

create or replace function public.copy_program(source uuid, client uuid)
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
                                           target_rpe, rest_seconds, notes, superset_group,
                                           target_minutes, target_distance_m, target_zone)
    select ntid, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, notes, superset_group,
           target_minutes, target_distance_m, target_zone
    from public.template_exercises
    where workout_template_id = t.id and removed_at is null;
  end loop;
  return nid;
end;
$$;

-- ---------- Personal records: cardio ----------
alter table public.personal_records
  add column duration_s integer check (duration_s is null or duration_s between 1 and 86400),
  add column distance_m numeric(8, 1) check (distance_m is null or (distance_m > 0 and distance_m <= 1000000));

-- value is km (distance), minutes (duration) or seconds per km (pace) for the cardio kinds.
alter table public.personal_records drop constraint personal_records_kind_check;
alter table public.personal_records
  add constraint personal_records_kind_check
  check (kind in ('weight', 'reps', 'e1rm', 'bw_reps', 'distance', 'duration', 'pace', 'milestone'));
alter table public.personal_records drop constraint personal_records_check1;
alter table public.personal_records
  add constraint personal_records_set_check check (
    kind = 'milestone'
    or (exercise_id is not null and set_number is not null
        and (reps is not null or (kind in ('distance', 'duration', 'pace') and duration_s is not null)))
  );

create or replace function public.save_personal_records(recs jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  added integer;
begin
  if jsonb_typeof(recs) is distinct from 'array' then
    raise exception 'Records must be a list.';
  end if;
  if jsonb_array_length(recs) > 500 then
    raise exception 'Too many records at once.';
  end if;
  insert into public.personal_records
    (client_id, session_id, exercise_id, kind, milestone, value, previous, set_number, weight_kg, reps, rpe,
     duration_s, distance_m, achieved_on)
  select (select auth.uid()), r.session_id, r.exercise_id, r.kind, r.milestone, r.value, r.previous, r.set_number,
         r.weight_kg, r.reps, r.rpe, r.duration_s, r.distance_m, s.performed_on
    from jsonb_to_recordset(recs) as r(
      session_id uuid, exercise_id uuid, kind text, milestone text, value numeric, previous numeric,
      set_number smallint, weight_kg numeric, reps smallint, rpe numeric, duration_s integer, distance_m numeric
    )
    join public.workout_sessions s on s.id = r.session_id
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;
