-- Personal records and milestone badges, kept once earned.
--
-- The app works records out from logged sets (frontend/src/lib/records.ts) and,
-- when a workout finishes, saves them here, so a badge stays put if an old set
-- is edited later. One row per record: a set that beat the client's best on an
-- exercise (weight, reps at a weight, estimated 1RM, bodyweight reps), or a
-- milestone reached (once ever per client).
--
-- The client adds their own (through save_personal_records); the client and
-- their coach read them; nobody changes or deletes one. Deleting the workout
-- (or the account) takes its records with it.

create table public.personal_records (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.users (id) on delete cascade,
  session_id  uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete cascade, -- null: a workout-count milestone
  kind        text not null check (kind in ('weight', 'reps', 'e1rm', 'bw_reps', 'milestone')),
  -- "load:bench:100kg", "bw:squat:1.5", "reps:pull-up:10", "workouts:50"
  milestone   text check (milestone is null or milestone ~ '^[a-z]+:[a-z0-9.-]{1,20}(:[a-z0-9.]{1,12})?$'),
  value       numeric(7, 2) not null check (value > 0 and value < 10000), -- kg, reps or a count
  previous    numeric(7, 2) check (previous is null or (previous >= 0 and previous < 10000)),
  set_number  smallint check (set_number is null or set_number between 1 and 99),
  weight_kg   numeric(6, 2) check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 1000)),
  reps        smallint check (reps is null or reps between 1 and 100),
  rpe         numeric(3, 1) check (rpe is null or rpe between 1 and 10),
  achieved_on date not null,
  created_at  timestamptz not null default now(),
  check ((kind = 'milestone') = (milestone is not null)),
  check (kind = 'milestone' or (exercise_id is not null and set_number is not null and reps is not null))
);

-- A set's record of each kind is saved once; each milestone once per client.
create unique index personal_records_set_idx on public.personal_records (session_id, exercise_id, kind, set_number) where kind <> 'milestone';
create unique index personal_records_milestone_idx on public.personal_records (client_id, milestone) where kind = 'milestone';
create index personal_records_client_idx on public.personal_records (client_id, achieved_on desc);

alter table public.personal_records enable row level security;

create policy "personal_records: client or coach reads" on public.personal_records
  for select to authenticated
  using (public.can_see_client(client_id));

-- Only into the client's own finished (not skipped) workouts, with an exercise they can see.
create policy "personal_records: client adds own" on public.personal_records
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and exists (
      select 1 from public.workout_sessions s
      where s.id = session_id and s.client_id = (select auth.uid()) and s.finished_at is not null and s.status <> 'skipped'
    )
    and (exercise_id is null or exists (select 1 from public.exercises e where e.id = exercise_id))
  );
-- No update or delete policy: a record, once earned, stays as it was.

-- recs: [{session_id, exercise_id, kind, milestone, value, previous, set_number, weight_kg, reps, rpe}].
-- Runs as the caller (RLS applies). The date is the workout's. Records already
-- saved are left as they are; returns how many were new.
create function public.save_personal_records(recs jsonb)
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
    (client_id, session_id, exercise_id, kind, milestone, value, previous, set_number, weight_kg, reps, rpe, achieved_on)
  select (select auth.uid()), r.session_id, r.exercise_id, r.kind, r.milestone, r.value, r.previous, r.set_number, r.weight_kg, r.reps, r.rpe, s.performed_on
    from jsonb_to_recordset(recs) as r(
      session_id uuid, exercise_id uuid, kind text, milestone text, value numeric, previous numeric,
      set_number smallint, weight_kg numeric, reps smallint, rpe numeric
    )
    join public.workout_sessions s on s.id = r.session_id
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

revoke execute on function public.save_personal_records(jsonb) from public, anon;
grant execute on function public.save_personal_records(jsonb) to authenticated;
