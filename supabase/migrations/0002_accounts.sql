-- Yuktara schema, part 2: accounts.
--
-- Supabase Auth owns credentials (auth.users), so public.users carries the
-- profile and role but no password_hash. A trigger creates the row on sign-up.

create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'client',
  email       extensions.citext not null unique,
  full_name   text not null default '',
  avatar_url  text,
  timezone    text not null default 'UTC',
  unit_system public.unit_system not null default 'metric',
  created_at  timestamptz not null default now()
);

create table public.client_profiles (
  user_id         uuid primary key references public.users (id) on delete cascade,
  coach_id        uuid not null references public.users (id),
  status          public.client_status not null default 'active',
  goal            public.goal_type not null,
  start_date      date not null,
  height_cm       numeric(5, 1),
  start_weight_kg numeric(5, 1),
  goal_weight_kg  numeric(5, 1),
  check_in_day    smallint not null default 0 check (check_in_day between 0 and 6), -- 0 = Sunday
  body_model      public.body_model not null default 'female',
  coach_notes     text -- private: clients cannot select this column (see 0007_rls.sql)
);

create index client_profiles_coach_idx on public.client_profiles (coach_id);

-- New auth user → public.users row. Role and name come from sign-up metadata;
-- only the service role can create coaches (see backend), so default to client.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, timezone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Access helpers used by RLS ----------
-- security definer so policies can call them without recursing into RLS.

create function public.is_coach()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.users where id = (select auth.uid()) and role = 'coach');
$$;

create function public.is_coach_of(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.client_profiles
    where user_id = client and coach_id = (select auth.uid())
  );
$$;

/** The signed-in user is this client, or their coach. */
create function public.can_see_client(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select client = (select auth.uid()) or public.is_coach_of(client);
$$;

create function public.my_coach_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coach_id from public.client_profiles where user_id = (select auth.uid());
$$;
