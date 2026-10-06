-- Yuktara schema, part 7: row-level security.
--
-- Clients see only their own rows. A coach sees rows for clients whose
-- client_profiles.coach_id is theirs. More coaches later = more users with
-- role 'coach'; no policy changes needed.

alter table public.users              enable row level security;
alter table public.client_profiles    enable row level security;
alter table public.exercises          enable row level security;
alter table public.exercise_muscles   enable row level security;
alter table public.programs           enable row level security;
alter table public.workout_templates  enable row level security;
alter table public.template_exercises enable row level security;
alter table public.workout_sessions   enable row level security;
alter table public.set_logs           enable row level security;
alter table public.nutrition_targets  enable row level security;
alter table public.meal_logs          enable row level security;
alter table public.meal_items         enable row level security;
alter table public.daily_logs         enable row level security;
alter table public.check_ins          enable row level security;
alter table public.checkin_questions  enable row level security;
alter table public.checkin_answers    enable row level security;
alter table public.progress_photos    enable row level security;
alter table public.messages           enable row level security;
alter table public.review_drafts      enable row level security;

-- ---------- Accounts ----------
create policy "users: self, my coach, my clients" on public.users
  for select to authenticated
  using (id = (select auth.uid()) or id = public.my_coach_id() or public.is_coach_of(id));

-- Role cannot be changed from the client; see trigger below.
create policy "users: update self" on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create function public.guard_user_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and current_user = 'authenticated' then
    raise exception 'Role can only be changed by an admin';
  end if;
  return new;
end;
$$;

create trigger users_guard_role before update on public.users
  for each row execute function public.guard_user_role();

create policy "client_profiles: client reads own" on public.client_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or coach_id = (select auth.uid()));

-- Clients may change their own body model (Train tab) only; coaches manage the rest.
create policy "client_profiles: client updates own" on public.client_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "client_profiles: coach manages" on public.client_profiles
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and public.is_coach());

-- coach_notes is private. Column grants hide it from everyone using the API;
-- coaches read and write it through the two functions below.
revoke select, update on public.client_profiles from authenticated, anon;
grant select (user_id, coach_id, status, goal, start_date, height_cm, start_weight_kg,
              goal_weight_kg, check_in_day, body_model)
  on public.client_profiles to authenticated;
grant update (body_model) on public.client_profiles to authenticated;
grant update (status, goal, start_date, height_cm, start_weight_kg, goal_weight_kg, check_in_day)
  on public.client_profiles to authenticated; -- RLS limits these rows to the coach

create function public.get_coach_notes(client uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coach_notes from public.client_profiles
  where user_id = client and coach_id = (select auth.uid());
$$;

create function public.set_coach_notes(client uuid, notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.client_profiles set coach_notes = notes
  where user_id = client and coach_id = (select auth.uid());
  if not found then raise exception 'Not your client'; end if;
end;
$$;

-- A client must not edit coach-owned profile fields. Column grants allow the
-- coach's columns to "authenticated", so check who is updating.
create function public.guard_client_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) and old.coach_id <> (select auth.uid()) then
    if (new.status, new.goal, new.start_date, new.height_cm, new.start_weight_kg,
        new.goal_weight_kg, new.check_in_day, new.coach_id)
       is distinct from
       (old.status, old.goal, old.start_date, old.height_cm, old.start_weight_kg,
        old.goal_weight_kg, old.check_in_day, old.coach_id) then
      raise exception 'Only your coach can change these settings';
    end if;
  end if;
  return new;
end;
$$;

create trigger client_profiles_guard before update on public.client_profiles
  for each row execute function public.guard_client_profile();

-- ---------- Exercise library ----------
create policy "exercises: library, mine, my coach's" on public.exercises
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()) or created_by = public.my_coach_id());

create policy "exercises: coach writes own" on public.exercises
  for all to authenticated
  using (created_by = (select auth.uid()) and public.is_coach())
  with check (created_by = (select auth.uid()) and public.is_coach());

create policy "exercise_muscles: readable with exercise" on public.exercise_muscles
  for select to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id));

create policy "exercise_muscles: coach writes own" on public.exercise_muscles
  for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id and e.created_by = (select auth.uid())))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id and e.created_by = (select auth.uid())));

-- ---------- Programs ----------
create policy "programs: coach manages own" on public.programs
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and public.is_coach()
              and (client_id is null or public.is_coach_of(client_id)));

create policy "programs: client reads own" on public.programs
  for select to authenticated
  using (client_id = (select auth.uid()));

create policy "workout_templates: via program" on public.workout_templates
  for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id));

create policy "workout_templates: coach writes" on public.workout_templates
  for all to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id and p.coach_id = (select auth.uid())))
  with check (exists (select 1 from public.programs p where p.id = program_id and p.coach_id = (select auth.uid())));

create policy "template_exercises: via template" on public.template_exercises
  for select to authenticated
  using (exists (select 1 from public.workout_templates t where t.id = workout_template_id));

create policy "template_exercises: coach writes" on public.template_exercises
  for all to authenticated
  using (exists (
    select 1 from public.workout_templates t join public.programs p on p.id = t.program_id
    where t.id = workout_template_id and p.coach_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workout_templates t join public.programs p on p.id = t.program_id
    where t.id = workout_template_id and p.coach_id = (select auth.uid())));

-- ---------- Client-owned logs: client writes, coach reads and can correct ----------
create policy "workout_sessions: client or coach" on public.workout_sessions
  for all to authenticated
  using (public.can_see_client(client_id))
  with check (public.can_see_client(client_id));

create policy "set_logs: via session" on public.set_logs
  for all to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and public.can_see_client(s.client_id)))
  with check (exists (select 1 from public.workout_sessions s where s.id = session_id and public.can_see_client(s.client_id)));

create policy "meal_logs: client or coach" on public.meal_logs
  for all to authenticated
  using (public.can_see_client(client_id))
  with check (public.can_see_client(client_id));

create policy "meal_items: via meal" on public.meal_items
  for all to authenticated
  using (exists (select 1 from public.meal_logs m where m.id = meal_log_id and public.can_see_client(m.client_id)))
  with check (exists (select 1 from public.meal_logs m where m.id = meal_log_id and public.can_see_client(m.client_id)));

create policy "daily_logs: client or coach" on public.daily_logs
  for all to authenticated
  using (public.can_see_client(client_id))
  with check (public.can_see_client(client_id));

-- ---------- Targets: coach sets, client reads ----------
create policy "nutrition_targets: read" on public.nutrition_targets
  for select to authenticated
  using (public.can_see_client(client_id));

create policy "nutrition_targets: coach writes" on public.nutrition_targets
  for all to authenticated
  using (public.is_coach_of(client_id))
  with check (public.is_coach_of(client_id) and set_by = (select auth.uid()));

-- ---------- Check-ins ----------
create policy "check_ins: read" on public.check_ins
  for select to authenticated
  using (public.can_see_client(client_id));

create policy "check_ins: client creates own" on public.check_ins
  for insert to authenticated
  with check (client_id = (select auth.uid()) and status in ('due', 'submitted'));

-- Field-level rules (client can't mark reviewed, etc.) are in check_ins_guard.
create policy "check_ins: update" on public.check_ins
  for update to authenticated
  using (public.can_see_client(client_id))
  with check (public.can_see_client(client_id));

create policy "checkin_questions: coach manages" on public.checkin_questions
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and public.is_coach());

create policy "checkin_questions: client reads coach's" on public.checkin_questions
  for select to authenticated
  using (coach_id = public.my_coach_id() and is_active);

create policy "checkin_answers: via check-in" on public.checkin_answers
  for all to authenticated
  using (exists (select 1 from public.check_ins c where c.id = check_in_id and public.can_see_client(c.client_id)))
  with check (exists (select 1 from public.check_ins c where c.id = check_in_id and c.client_id = (select auth.uid()) and c.status <> 'reviewed'));

create policy "progress_photos: via check-in" on public.progress_photos
  for all to authenticated
  using (exists (select 1 from public.check_ins c where c.id = check_in_id and public.can_see_client(c.client_id)))
  with check (exists (select 1 from public.check_ins c where c.id = check_in_id and c.client_id = (select auth.uid())));

create policy "review_drafts: coach only" on public.review_drafts
  for all to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid())
              and exists (select 1 from public.check_ins c where c.id = check_in_id and public.is_coach_of(c.client_id)));

-- ---------- Messages ----------
create policy "messages: thread members read" on public.messages
  for select to authenticated
  using (public.can_see_client(client_id));

create policy "messages: thread members send as self" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_see_client(client_id));

-- Only the recipient marks a message read.
create policy "messages: recipient marks read" on public.messages
  for update to authenticated
  using (public.can_see_client(client_id) and sender_id <> (select auth.uid()))
  with check (public.can_see_client(client_id) and sender_id <> (select auth.uid()));

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;
