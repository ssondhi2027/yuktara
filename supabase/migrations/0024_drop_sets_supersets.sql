-- Drop sets (logged by the client) and supersets (planned by the coach).
--
-- Drop sets: set_logs.set_kind 'drop' with drop_of = the set_number of the
-- working set it follows (same session and exercise). A set can have several
-- drops; they show after it in set_number order. A working set and its drops
-- count as one hard set (body map, hard sets per muscle); volume counts them all.
-- Warm-ups can't have drops. Existing rows stay normal sets.
--
-- Supersets: template_exercises.superset_group, a label ("A", "B", … "AA") shared
-- by exercises of the same workout done back to back, with the rest after the
-- round. save_program and copy_program (0015) are replaced to keep it.
-- RLS is unchanged: the client writes their own sets, the coach their own programs.

-- ---------- Drop sets ----------
alter table public.set_logs
  add column set_kind text not null default 'normal' check (set_kind in ('normal', 'drop')),
  add column drop_of smallint check (drop_of between 1 and 50),
  add constraint set_logs_drop_check check (
    (set_kind = 'drop') = (drop_of is not null)
    and (set_kind = 'normal' or (not is_warmup and drop_of <> set_number))
  );

create index set_logs_drop_idx on public.set_logs (session_id, exercise_id, drop_of) where drop_of is not null;

-- A drop needs its working set saved first; a set with drops can't become a
-- warm-up or a drop itself.
create function public.guard_drop_sets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.set_kind = 'drop' then
    if not exists (
      select 1 from public.set_logs h
      where h.session_id = new.session_id and h.exercise_id = new.exercise_id and h.set_number = new.drop_of
        and h.set_kind = 'normal' and not h.is_warmup
    ) then
      raise exception 'A drop follows a working set of the same exercise. Tick that set first.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.is_warmup or new.set_kind <> 'normal') and exists (
    select 1 from public.set_logs d
    where d.session_id = new.session_id and d.exercise_id = new.exercise_id and d.drop_of = new.set_number
  ) then
    raise exception 'This set has drops. Remove them first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Unticking a working set takes its drops with it.
create function public.delete_drops_with_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.set_kind = 'normal' then
    delete from public.set_logs
     where session_id = old.session_id and exercise_id = old.exercise_id and drop_of = old.set_number;
  end if;
  return old;
end;
$$;

create trigger set_logs_guard_drops before insert or update on public.set_logs
  for each row execute function public.guard_drop_sets();
create trigger set_logs_delete_drops after delete on public.set_logs
  for each row execute function public.delete_drops_with_set();

-- ---------- Hard sets: a set and its drops count once ----------
create or replace function public.muscle_sets_for_week(client uuid, week_start date)
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
    and sl.set_kind = 'normal'
  group by em.muscle;
$$;

-- The nightly body-map view (0006), recreated with the same rule; the refresh
-- job refers to it by name.
drop view public.muscle_week_sets;
drop materialized view analytics.muscle_week_sets;

create materialized view analytics.muscle_week_sets as
select
  ws.client_id,
  date_trunc('week', ws.performed_on)::date as week_start,
  em.muscle,
  count(*)::smallint as hard_sets
from public.set_logs sl
join public.workout_sessions ws on ws.id = sl.session_id
join public.exercise_muscles em on em.exercise_id = sl.exercise_id and em.role = 'primary'
where not sl.is_warmup
  and sl.set_kind = 'normal'
  and ws.status in ('done', 'partial')
group by 1, 2, 3;

create unique index on analytics.muscle_week_sets (client_id, week_start, muscle);

create view public.muscle_week_sets with (security_barrier) as
  select * from analytics.muscle_week_sets
  where public.can_see_client(client_id);

grant select on public.muscle_week_sets to authenticated;
revoke all on public.muscle_week_sets from anon;

-- ---------- Supersets ----------
alter table public.template_exercises
  add column superset_group text check (superset_group ~ '^[A-Z]{1,2}$');

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
               superset_group = nullif(upper(btrim(coalesce(x.body->>'superset_group', ''))), '')
         where id = xid;
      end if;
      if xid is null then
        insert into public.template_exercises (workout_template_id, exercise_id, position, target_sets, target_reps,
                                               target_rpe, rest_seconds, notes, superset_group)
        values (wid, (x.body->>'exercise_id')::uuid, x.pos, (x.body->>'target_sets')::smallint,
                btrim(x.body->>'target_reps'), nullif(x.body->>'target_rpe', '')::numeric,
                nullif(x.body->>'rest_seconds', '')::smallint, nullif(btrim(coalesce(x.body->>'notes', '')), ''),
                nullif(upper(btrim(coalesce(x.body->>'superset_group', ''))), ''))
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
                                           target_rpe, rest_seconds, notes, superset_group)
    select ntid, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds, notes, superset_group
    from public.template_exercises
    where workout_template_id = t.id and removed_at is null;
  end loop;
  return nid;
end;
$$;
