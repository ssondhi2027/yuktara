-- Yuktara schema, part 11: tables and rules the backend API needs.

-- ---------- Exercise swaps for some weeks only ----------
-- template_exercises has no week column, so "swap Romanian deadlift for hip
-- thrust in Full body C, weeks 7 and 8" is stored as an override here.
-- The client app applies the override when it builds that week's workout.
create table public.exercise_swaps (
  id                   uuid primary key default gen_random_uuid(),
  template_exercise_id uuid not null references public.template_exercises (id) on delete cascade,
  from_exercise_id     uuid not null references public.exercises (id),
  to_exercise_id       uuid not null references public.exercises (id),
  from_week            smallint not null check (from_week between 1 and 52),
  to_week              smallint not null check (to_week between 1 and 52),
  check_in_id          uuid references public.check_ins (id) on delete set null, -- the question that led to it
  created_by           uuid not null references public.users (id),
  created_at           timestamptz not null default now(),
  check (from_week <= to_week),
  check (from_exercise_id <> to_exercise_id)
);

create index exercise_swaps_template_exercise_idx on public.exercise_swaps (template_exercise_id);

alter table public.exercise_swaps enable row level security;

/** The coach who owns the program this template exercise belongs to. */
create function public.template_exercise_coach(te uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.coach_id
  from public.template_exercises x
  join public.workout_templates t on t.id = x.workout_template_id
  join public.programs p on p.id = t.program_id
  where x.id = te;
$$;

create policy "exercise_swaps: coach manages own programs" on public.exercise_swaps
  for all to authenticated
  using (public.template_exercise_coach(template_exercise_id) = (select auth.uid()))
  with check (public.template_exercise_coach(template_exercise_id) = (select auth.uid())
              and created_by = (select auth.uid()));

create policy "exercise_swaps: client reads own" on public.exercise_swaps
  for select to authenticated
  using (exists (
    select 1
    from public.template_exercises x
    join public.workout_templates t on t.id = x.workout_template_id
    join public.programs p on p.id = t.program_id
    where x.id = template_exercise_id and p.client_id = (select auth.uid())
  ));

-- ---------- Invite codes belong to coaches only ----------
-- Users may update their own row (0007), so without this a client could give
-- themselves a code. Sign-up only links codes of role = 'coach' anyway; this
-- keeps the data clean.
alter table public.users
  add constraint users_invite_code_coach_only check (invite_code is null or role = 'coach');
