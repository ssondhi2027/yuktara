-- Yuktara schema, part 4: nutrition and daily habits.

-- Targets are versioned by effective_from, so each past week is judged against
-- the targets it had. The current target is the latest row on or before a date.
create table public.nutrition_targets (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.users (id) on delete cascade,
  effective_from date not null,
  calories       integer not null check (calories > 0),
  protein_g      smallint not null,
  carbs_g        smallint not null,
  fat_g          smallint not null,
  water_ml       integer,
  steps          integer,
  sleep_hours    numeric(3, 1), -- shown as "Sleep (h)" in Targets for week N
  set_by         uuid not null references public.users (id),
  unique (client_id, effective_from)
);

create table public.meal_logs (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.users (id) on delete cascade,
  eaten_at   timestamptz not null default now(),
  meal_type  public.meal_type not null,
  title      text not null,
  photo_url  text, -- path in the private meal-photos bucket
  calories   integer,
  protein_g  numeric,
  carbs_g    numeric,
  fat_g      numeric,
  on_plan    public.on_plan
);

create index meal_logs_client_idx on public.meal_logs (client_id, eaten_at desc);

create table public.meal_items (
  id          uuid primary key default gen_random_uuid(),
  meal_log_id uuid not null references public.meal_logs (id) on delete cascade,
  food_name   text not null,
  quantity    numeric(7, 2) not null,
  unit        text not null, -- e.g. g, ml
  calories    integer,
  protein_g   numeric,
  carbs_g     numeric,
  fat_g       numeric
);

create index meal_items_meal_idx on public.meal_items (meal_log_id);

create table public.daily_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.users (id) on delete cascade,
  log_date    date not null,
  steps       integer,
  water_ml    integer,
  sleep_hours numeric(3, 1),
  weight_kg   numeric(5, 1),
  day_rating  public.on_plan, -- "Today so far, on plan?" on the Food tab
  unique (client_id, log_date)
);

/** Targets in force for a client on a given date. */
create function public.targets_on(client uuid, d date)
returns public.nutrition_targets
language sql
stable
as $$
  select * from public.nutrition_targets
  where client_id = client and effective_from <= d
  order by effective_from desc
  limit 1;
$$;
