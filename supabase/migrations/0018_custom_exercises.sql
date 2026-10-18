-- Coaches' own exercises: exercises.created_by = the coach (null = the shared
-- library). RLS from 0007 already lets a coach write their own exercises and
-- muscle rows, and lets that coach and their clients read them. This adds the
-- limits the form relies on, unique names per coach, and save_exercise(), which
-- saves an exercise with its muscles in one step.

-- A coach's account going away takes their exercises with it, instead of
-- turning them into shared library rows (the old "on delete set null").
alter table public.exercises drop constraint exercises_created_by_fkey;
alter table public.exercises
  add constraint exercises_created_by_fkey foreign key (created_by) references public.users (id) on delete cascade,
  add constraint exercises_name_check check (char_length(btrim(name)) between 2 and 80),
  add constraint exercises_cue_check check (cue is null or char_length(cue) <= 300),
  add constraint exercises_equipment_check check (equipment is null or char_length(equipment) <= 40);

create unique index exercises_coach_name_idx on public.exercises (created_by, lower(name)) where created_by is not null;

-- e: {id?, name, level, equipment, cue, primary: [muscle], secondary: [muscle]}.
-- Runs as the caller (RLS applies); returns the exercise id.
create function public.save_exercise(e jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  eid  uuid := nullif(e->>'id', '')::uuid;
  nm   text := btrim(coalesce(e->>'name', ''));
  prim text[] := array(select distinct jsonb_array_elements_text(coalesce(e->'primary', '[]'::jsonb)));
  sec  text[] := array(select distinct jsonb_array_elements_text(coalesce(e->'secondary', '[]'::jsonb)));
begin
  if not public.is_coach() then
    raise exception 'Only coaches add exercises.' using errcode = '42501';
  end if;
  if coalesce(array_length(prim, 1), 0) = 0 then
    raise exception 'Choose at least one main muscle.';
  end if;
  if prim && sec then
    raise exception 'A muscle is either main or secondary, not both.';
  end if;
  if exists (select 1 from public.exercises x where x.created_by is null and lower(x.name) = lower(nm)) then
    raise exception 'The library already has "%". Pick it from the list instead.', nm;
  end if;

  if eid is null then
    insert into public.exercises (name, level, equipment, cue, created_by)
    values (nm, coalesce(nullif(e->>'level', '')::public.exercise_level, 'beginner'),
            nullif(btrim(e->>'equipment'), ''), nullif(btrim(e->>'cue'), ''), (select auth.uid()))
    returning id into eid;
  else
    update public.exercises
       set name = nm,
           level = coalesce(nullif(e->>'level', '')::public.exercise_level, 'beginner'),
           equipment = nullif(btrim(e->>'equipment'), ''),
           cue = nullif(btrim(e->>'cue'), '')
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

revoke execute on function public.save_exercise(jsonb) from public, anon;
grant execute on function public.save_exercise(jsonb) to authenticated;
