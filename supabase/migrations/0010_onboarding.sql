-- Yuktara schema, part 10: sign-up, coach invite codes and profile setup.
--
-- Flow:
--   1. Create account → supabase.auth.signUp(email, password,
--      data: { full_name, invite_code, timezone }). Supabase adds auth.users.
--   2. handle_new_user (below) inserts public.users (role = client) and a
--      client_profiles row linked to the coach whose invite code was used.
--   3. The profile setup window fills that row in and sets setup_completed_at.
--      Signed-in clients with setup_completed_at = null see the window again.

-- ---------- Coach invite codes ----------
create type public.train_location as enum ('gym', 'home', 'both');
create type public.diet_type as enum ('none', 'vegetarian', 'eggetarian', 'vegan', 'halal', 'other');

alter table public.users
  add column invite_code extensions.citext unique
    check (invite_code is null or invite_code ~ '^[A-Za-z0-9-]{4,20}$');

comment on column public.users.invite_code is
  'Coaches only. Clients enter it at sign-up to be linked to this coach, e.g. SIMRAN-7Q4.';

-- Lets the sign-up form check a code before creating the account.
-- Reveals only whether a code exists.
create function public.invite_code_valid(code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where role = 'coach' and invite_code = upper(trim(code))::extensions.citext
  );
$$;

grant execute on function public.invite_code_valid(text) to anon, authenticated;

-- ---------- Profile setup answers ----------
-- The row now exists from sign-up, before the client has answered anything.
alter table public.client_profiles
  alter column coach_id drop not null, -- no invite code yet: the coach assigns later
  alter column goal drop not null,
  alter column start_date set default current_date,
  add column date_of_birth       date check (date_of_birth > '1900-01-01'),
  add column phone               text check (length(phone) <= 32),
  add column experience          public.exercise_level,
  add column training_days       smallint check (training_days between 1 and 7),
  add column train_location      public.train_location,
  add column injuries            text check (length(injuries) <= 2000),
  add column diet                public.diet_type,
  add column foods_to_avoid      text check (length(foods_to_avoid) <= 500),
  add column meals_per_day       smallint check (meals_per_day between 1 and 8),
  add column cleared_to_exercise boolean not null default false,
  add column setup_completed_at  timestamptz,
  add constraint client_profiles_setup_complete check (
    setup_completed_at is null or (goal is not null and cleared_to_exercise)
  );

-- ---------- Sign-up trigger: users row + coach link ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  coach uuid;
  code text := nullif(upper(trim(new.raw_user_meta_data ->> 'invite_code')), '');
begin
  insert into public.users (id, email, full_name, timezone)
  values (
    new.id,
    new.email,
    -- Email sign-up sends full_name; Google sends full_name or name.
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC')
  );

  if code is not null then
    select id into coach from public.users where role = 'coach' and invite_code = code::extensions.citext;
  end if;

  insert into public.client_profiles (user_id, coach_id) values (new.id, coach);
  return new;
end;
$$;

-- ---------- RLS for the setup window ----------
-- The row normally exists from sign-up; this covers accounts made before
-- 0010 so Finish setup can upsert. A client can't pick their coach or write notes.
create policy "client_profiles: client creates own" on public.client_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()) and coach_id is null and coach_notes is null);

revoke insert on public.client_profiles from anon;
grant select (date_of_birth, phone, experience, training_days, train_location, injuries, diet,
              foods_to_avoid, meals_per_day, cleared_to_exercise, setup_completed_at)
  on public.client_profiles to authenticated;
grant update (date_of_birth, phone, experience, training_days, train_location, injuries, diet,
              foods_to_avoid, meals_per_day, cleared_to_exercise, setup_completed_at)
  on public.client_profiles to authenticated;

-- During setup the client fills in goal, weights, height and check-in day.
-- Afterwards those belong to the coach, except the personal fields, body
-- model and check-in day ("you can change it later").
create or replace function public.guard_client_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) and old.coach_id is distinct from (select auth.uid()) then
    if new.coach_id is distinct from old.coach_id or new.coach_notes is distinct from old.coach_notes then
      raise exception 'Only your coach can change this';
    end if;
    if old.setup_completed_at is not null then
      if new.setup_completed_at is distinct from old.setup_completed_at then
        raise exception 'Setup is already finished';
      end if;
      if (new.status, new.goal, new.start_date, new.height_cm, new.start_weight_kg, new.goal_weight_kg)
         is distinct from
         (old.status, old.goal, old.start_date, old.height_cm, old.start_weight_kg, old.goal_weight_kg) then
        raise exception 'Only your coach can change these settings';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------- Jobs: only clients who finished setup get check-ins ----------
create or replace function public.roll_check_ins()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.check_ins (client_id, week_start, status)
  select cp.user_id, date_trunc('week', (now() at time zone u.timezone))::date, 'due'
  from public.client_profiles cp
  join public.users u on u.id = cp.user_id
  where cp.status = 'active'
    and cp.setup_completed_at is not null
    and extract(dow from (now() at time zone u.timezone)) = cp.check_in_day
  on conflict (client_id, week_start) do nothing;

  update public.check_ins c
  set status = 'missed'
  from public.users u
  where u.id = c.client_id
    and c.status = 'due'
    -- Two days' grace: a Sunday check-in can still come in on Monday or Tuesday.
    and c.week_start < date_trunc('week', (now() at time zone u.timezone) - interval '2 days')::date;
end;
$$;
