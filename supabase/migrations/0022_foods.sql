-- A food list with nutrition per amount, for logging meals and for coaches'
-- meal plans. Each food has calories and macros per 100 g (or per 100 ml for
-- drinks) and optional named servings ("1 egg" = 50 g). created_by null is the
-- shared list (seeded below, the same list as frontend/src/lib/foodList.ts); a
-- coach's own foods are visible to the coach and their clients, like coach
-- exercises (0018).
--
-- meal_items (0021) gains the food it came from and the serving name. Calories
-- and macros on meal_items stay as saved, so history doesn't change if a food is
-- edited later.

-- Servings: up to 8 of {name: 1–40 characters, amount: above 0 and up to 2000 (g or ml)}.
create function public.valid_servings(s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(s) = 'array'
     and jsonb_array_length(s) <= 8
     and not exists (
       select 1 from jsonb_array_elements(s) x
       where jsonb_typeof(x) <> 'object'
          or char_length(btrim(coalesce(x->>'name', ''))) not between 1 and 40
          or case when jsonb_typeof(x->'amount') = 'number'
                  then (x->>'amount')::numeric <= 0 or (x->>'amount')::numeric > 2000
                  else true end
     );
$$;

create table public.foods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  basis      text not null default 'g' check (basis in ('g', 'ml')),
  kcal       numeric(6, 1) not null check (kcal between 0 and 900),
  protein_g  numeric(5, 1) not null check (protein_g between 0 and 100),
  carbs_g    numeric(5, 1) not null check (carbs_g between 0 and 100),
  fat_g      numeric(5, 1) not null check (fat_g between 0 and 100),
  servings   jsonb not null default '[]'::jsonb check (public.valid_servings(servings)),
  created_by uuid references public.users (id) on delete cascade, -- null = the shared list
  created_at timestamptz not null default now()
);

create unique index foods_shared_name_idx on public.foods (lower(name)) where created_by is null;
create unique index foods_coach_name_idx on public.foods (created_by, lower(name)) where created_by is not null;

alter table public.foods enable row level security;

create policy "foods: shared, mine, my coach's" on public.foods
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()) or created_by = public.my_coach_id());

create policy "foods: coach writes own" on public.foods
  for all to authenticated
  using (created_by = (select auth.uid()) and public.is_coach())
  with check (created_by = (select auth.uid()) and public.is_coach());

-- Foods in a logged meal: which food, and the serving if one was used.
alter table public.meal_items
  add column food_id uuid references public.foods (id) on delete set null,
  add column serving text check (serving is null or char_length(serving) between 1 and 40);

create index meal_items_food_idx on public.meal_items (food_id);

-- Same rule as 0021 (the client writes the foods in their own meals), and the
-- food, if any, must be one they can see.
drop policy "meal_items: client writes own" on public.meal_items;
create policy "meal_items: client writes own" on public.meal_items
  for all to authenticated
  using (exists (select 1 from public.meal_logs m where m.id = meal_log_id and m.client_id = (select auth.uid())))
  with check (
    exists (select 1 from public.meal_logs m where m.id = meal_log_id and m.client_id = (select auth.uid()))
    and (food_id is null or exists (select 1 from public.foods f where f.id = food_id))
  );

-- The shared list.
insert into public.foods (name, basis, kcal, protein_g, carbs_g, fat_g, servings)
values
  ('Chicken breast, grilled', 'g', 165, 31, 0, 3.6, '[{"name":"1 breast","amount":170}]'::jsonb),
  ('Chicken curry', 'g', 150, 14, 4, 9, '[{"name":"1 bowl","amount":200}]'::jsonb),
  ('Turkey breast, roasted', 'g', 135, 30, 0, 1, '[{"name":"1 slice","amount":28}]'::jsonb),
  ('Lean beef mince, cooked', 'g', 217, 26, 0, 12, '[]'::jsonb),
  ('Salmon fillet, cooked', 'g', 208, 20, 0, 13, '[{"name":"1 fillet","amount":150}]'::jsonb),
  ('Tuna, canned in water', 'g', 116, 26, 0, 1, '[{"name":"1 can, drained","amount":120}]'::jsonb),
  ('Egg', 'g', 143, 12.6, 0.7, 9.5, '[{"name":"1 large egg","amount":50}]'::jsonb),
  ('Egg white', 'g', 52, 11, 0.7, 0.2, '[{"name":"1 egg white","amount":33}]'::jsonb),
  ('Tofu, firm', 'g', 144, 17, 3, 8.7, '[]'::jsonb),
  ('Paneer', 'g', 296, 18, 3.6, 23, '[{"name":"1 slice","amount":30}]'::jsonb),
  ('Paneer tikka', 'g', 260, 18, 6, 18, '[{"name":"1 portion","amount":150}]'::jsonb),
  ('Whey protein', 'g', 400, 80, 10, 3.3, '[{"name":"1 scoop","amount":30}]'::jsonb),
  ('Protein bar', 'g', 350, 30, 40, 9, '[{"name":"1 bar","amount":60}]'::jsonb),
  ('Greek yogurt 2%', 'g', 73, 10, 4, 2, '[{"name":"1 pot","amount":170}]'::jsonb),
  ('Plain yogurt (curd)', 'g', 61, 3.5, 4.7, 3.3, '[{"name":"1 bowl","amount":150}]'::jsonb),
  ('Cottage cheese, low fat', 'g', 82, 11, 3.4, 2.3, '[{"name":"1/2 cup","amount":113}]'::jsonb),
  ('Cheddar cheese', 'g', 403, 25, 1.3, 33, '[{"name":"1 slice","amount":20}]'::jsonb),
  ('Milk, semi-skimmed', 'ml', 47, 3.4, 4.8, 1.7, '[{"name":"1 glass","amount":250}]'::jsonb),
  ('Rice, white, cooked', 'g', 130, 2.7, 28, 0.3, '[{"name":"1 cup","amount":158}]'::jsonb),
  ('Rice, brown, cooked', 'g', 123, 2.7, 26, 1, '[{"name":"1 cup","amount":195}]'::jsonb),
  ('Quinoa, cooked', 'g', 120, 4.4, 21, 1.9, '[{"name":"1 cup","amount":185}]'::jsonb),
  ('Oats', 'g', 380, 13, 67, 7, '[{"name":"1/2 cup","amount":40}]'::jsonb),
  ('Granola', 'g', 471, 10, 64, 20, '[{"name":"1/2 cup","amount":60}]'::jsonb),
  ('Bread, wholemeal', 'g', 247, 13, 41, 3.4, '[{"name":"1 slice","amount":36}]'::jsonb),
  ('Pasta, cooked', 'g', 158, 5.8, 31, 0.9, '[{"name":"1 cup","amount":140}]'::jsonb),
  ('Potato, boiled', 'g', 87, 1.9, 20, 0.1, '[{"name":"1 medium","amount":170}]'::jsonb),
  ('Sweet potato, baked', 'g', 90, 2, 21, 0.2, '[{"name":"1 medium","amount":150}]'::jsonb),
  ('Roti (chapati)', 'g', 300, 8, 46, 9, '[{"name":"1 roti","amount":40}]'::jsonb),
  ('Idli', 'g', 146, 4.5, 30, 0.6, '[{"name":"1 idli","amount":40}]'::jsonb),
  ('Dosa, plain', 'g', 168, 3.9, 29, 3.7, '[{"name":"1 dosa","amount":80}]'::jsonb),
  ('Poha', 'g', 158, 3, 27, 4, '[{"name":"1 plate","amount":150}]'::jsonb),
  ('Dal (cooked lentils)', 'g', 116, 7, 17, 2, '[{"name":"1 bowl","amount":200}]'::jsonb),
  ('Chickpeas, cooked', 'g', 164, 8.9, 27, 2.6, '[{"name":"1 cup","amount":164}]'::jsonb),
  ('Rajma (kidney beans), cooked', 'g', 127, 8.7, 23, 0.5, '[{"name":"1 bowl","amount":200}]'::jsonb),
  ('Hummus', 'g', 166, 8, 14, 9.6, '[{"name":"2 tbsp","amount":30}]'::jsonb),
  ('Banana', 'g', 89, 1.1, 23, 0.3, '[{"name":"1 medium","amount":118}]'::jsonb),
  ('Apple', 'g', 52, 0.3, 14, 0.2, '[{"name":"1 medium","amount":182}]'::jsonb),
  ('Orange', 'g', 47, 0.9, 12, 0.1, '[{"name":"1 medium","amount":130}]'::jsonb),
  ('Berries, mixed', 'g', 57, 0.7, 14, 0.3, '[{"name":"1 cup","amount":145}]'::jsonb),
  ('Avocado', 'g', 160, 2, 9, 15, '[{"name":"1/2 avocado","amount":70}]'::jsonb),
  ('Broccoli, cooked', 'g', 35, 2.4, 7, 0.4, '[{"name":"1 cup","amount":156}]'::jsonb),
  ('Spinach, cooked', 'g', 23, 3, 3.8, 0.3, '[{"name":"1 cup","amount":180}]'::jsonb),
  ('Mixed salad', 'g', 17, 1.2, 3.3, 0.2, '[{"name":"1 bowl","amount":85}]'::jsonb),
  ('Orange juice', 'ml', 45, 0.7, 10.4, 0.2, '[{"name":"1 glass","amount":250}]'::jsonb),
  ('Almonds', 'g', 579, 21, 22, 50, '[{"name":"1 handful","amount":28}]'::jsonb),
  ('Peanut butter', 'g', 588, 25, 20, 50, '[{"name":"1 tbsp","amount":16}]'::jsonb),
  ('Olive oil', 'g', 884, 0, 0, 100, '[{"name":"1 tbsp","amount":14}]'::jsonb),
  ('Butter', 'g', 717, 0.9, 0.1, 81, '[{"name":"1 tsp","amount":5}]'::jsonb),
  ('Dark chocolate 70%', 'g', 598, 7.8, 46, 43, '[{"name":"2 squares","amount":20}]'::jsonb)
on conflict do nothing;
