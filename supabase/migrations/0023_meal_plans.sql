-- Coach meal plans that clients follow on the Food page.
--
-- A plan is a list of foods with amounts per meal (breakfast, lunch, dinner,
-- snack) from the food list (0022), plus a note per meal ("or swap rice for
-- quinoa"). One plan for every day, or (split) separate training-day and
-- rest-day plans: each item says which day it belongs to.
--
-- Client plans are versioned like nutrition targets: each applies from
-- effective_from until the next one. client_id null is one of the coach's
-- templates (no date). The coach writes their own clients' plans and templates;
-- the client reads their own plans and can't change them.

create table public.meal_plans (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid not null references public.users (id) on delete cascade,
  client_id      uuid references public.users (id) on delete cascade, -- null = the coach's template
  name           text not null default 'Meal plan' check (char_length(btrim(name)) between 1 and 80),
  effective_from date,
  split          boolean not null default false,
  -- A note per meal, keyed "<day>:<meal>" ("every:breakfast", "training:lunch").
  notes          jsonb not null default '{}'::jsonb check (jsonb_typeof(notes) = 'object'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((client_id is null) = (effective_from is null))
);

create unique index meal_plans_version_idx on public.meal_plans (client_id, effective_from) where client_id is not null;
create index meal_plans_coach_idx on public.meal_plans (coach_id);

create table public.meal_plan_items (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.meal_plans (id) on delete cascade,
  day_type  text not null default 'every' check (day_type in ('every', 'training', 'rest')),
  meal_type public.meal_type not null,
  position  smallint not null default 0 check (position between 0 and 99),
  food_id   uuid not null references public.foods (id), -- a food in a plan can't be deleted
  quantity  numeric(7, 2) not null check (quantity > 0 and quantity <= 10000),
  unit      text not null check (unit in ('g', 'ml', 'serving')),
  serving   text check (serving is null or char_length(serving) between 1 and 40),
  check ((unit = 'serving') = (serving is not null))
);

create index meal_plan_items_plan_idx on public.meal_plan_items (plan_id);

alter table public.meal_plans enable row level security;
alter table public.meal_plan_items enable row level security;

-- The coach sees their templates and their current clients' plans; the client sees their own.
create policy "meal_plans: coach or the client reads" on public.meal_plans
  for select to authenticated
  using (
    (coach_id = (select auth.uid()) and (client_id is null or public.is_coach_of(client_id)))
    or client_id = (select auth.uid())
  );

create policy "meal_plans: coach writes own clients' and templates" on public.meal_plans
  for all to authenticated
  using (coach_id = (select auth.uid()) and public.is_coach() and (client_id is null or public.is_coach_of(client_id)))
  with check (coach_id = (select auth.uid()) and public.is_coach() and (client_id is null or public.is_coach_of(client_id)));

create policy "meal_plan_items: readable with the plan" on public.meal_plan_items
  for select to authenticated
  using (exists (select 1 from public.meal_plans p where p.id = plan_id));

create policy "meal_plan_items: coach writes" on public.meal_plan_items
  for all to authenticated
  using (exists (
    select 1 from public.meal_plans p
    where p.id = plan_id and p.coach_id = (select auth.uid()) and (p.client_id is null or public.is_coach_of(p.client_id))
  ))
  with check (
    exists (
      select 1 from public.meal_plans p
      where p.id = plan_id and p.coach_id = (select auth.uid()) and (p.client_id is null or public.is_coach_of(p.client_id))
    )
    and exists (select 1 from public.foods f where f.id = food_id) -- a food the coach can see
  );

-- p: {id?, client_id?, name, effective_from?, split, notes: {key: text}, items: [{day_type, meal_type,
-- position, food_id, quantity, unit, serving}]}. A client plan saved for a date that already has a
-- version replaces it; otherwise it's a new version. Runs as the coach (RLS applies).
create function public.save_meal_plan(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pid    uuid := nullif(p->>'id', '')::uuid;
  client uuid := nullif(p->>'client_id', '')::uuid;
  eff    date := nullif(p->>'effective_from', '')::date;
  nm     text := coalesce(nullif(btrim(p->>'name'), ''), 'Meal plan');
  meal_notes jsonb := coalesce(p->'notes', '{}'::jsonb);
begin
  if not public.is_coach() then
    raise exception 'Only coaches write meal plans.' using errcode = '42501';
  end if;
  if client is not null and eff is null then
    raise exception 'Choose when the plan starts.';
  end if;
  if client is not null and eff < current_date - 1 then
    raise exception 'A plan starts today or later; earlier days keep the plan they had.';
  end if;
  if jsonb_typeof(meal_notes) <> 'object'
     or exists (select 1 from jsonb_each_text(meal_notes) n where char_length(n.value) > 300) then
    raise exception 'Meal notes can be up to 300 characters.';
  end if;

  if client is not null then
    select id into pid from public.meal_plans where client_id = client and effective_from = eff;
  end if;

  if pid is null then
    insert into public.meal_plans (coach_id, client_id, name, effective_from, split, notes)
    values ((select auth.uid()), client, nm, eff, coalesce((p->>'split')::boolean, false), meal_notes)
    returning id into pid;
  else
    update public.meal_plans
       set name = nm, split = coalesce((p->>'split')::boolean, false), notes = meal_notes, updated_at = now()
     where id = pid and coach_id = (select auth.uid());
    if not found then
      raise exception 'That meal plan doesn''t exist (or isn''t yours).' using errcode = 'PT404';
    end if;
    delete from public.meal_plan_items where plan_id = pid;
  end if;

  insert into public.meal_plan_items (plan_id, day_type, meal_type, position, food_id, quantity, unit, serving)
  select pid, coalesce(x.day_type, 'every'), x.meal_type::public.meal_type, coalesce(x.position, 0),
         x.food_id, x.quantity, x.unit, nullif(btrim(x.serving), '')
  from jsonb_to_recordset(coalesce(p->'items', '[]'::jsonb))
       as x(day_type text, meal_type text, position int, food_id uuid, quantity numeric, unit text, serving text);
  return pid;
end;
$$;

revoke execute on function public.save_meal_plan(jsonb) from public, anon;
grant execute on function public.save_meal_plan(jsonb) to authenticated;
