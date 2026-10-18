-- Foods inside a meal: meal_items rows under a meal_logs row (the meal keeps its
-- totals, which the app adds up from the items). The table existed since 0004
-- but nothing used it; this adds limits and replaces its "for all" policy (which
-- let the coach write too) with: the client writes their own, client and coach read.

alter table public.meal_items
  add constraint meal_items_food_name_check check (char_length(btrim(food_name)) between 1 and 120),
  add constraint meal_items_quantity_check check (quantity > 0 and quantity <= 10000),
  add constraint meal_items_unit_check check (unit in ('g', 'ml', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'serving')),
  add constraint meal_items_calories_check check (calories is null or calories between 0 and 5000),
  add constraint meal_items_macros_check check (
    (protein_g is null or protein_g between 0 and 1000)
    and (carbs_g is null or carbs_g between 0 and 1000)
    and (fat_g is null or fat_g between 0 and 1000)
  );

drop policy "meal_items: via meal" on public.meal_items;

create policy "meal_items: client or coach reads" on public.meal_items
  for select to authenticated
  using (exists (select 1 from public.meal_logs m where m.id = meal_log_id and public.can_see_client(m.client_id)));

create policy "meal_items: client writes own" on public.meal_items
  for all to authenticated
  using (exists (select 1 from public.meal_logs m where m.id = meal_log_id and m.client_id = (select auth.uid())))
  with check (exists (select 1 from public.meal_logs m where m.id = meal_log_id and m.client_id = (select auth.uid())));
