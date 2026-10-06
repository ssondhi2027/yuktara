-- Yuktara schema, part 6: summary views.
--
-- The two materialized views live in a private schema (RLS does not apply to
-- materialized views). Public views with the same names filter them to rows
-- the signed-in user may see. The coach dashboard reads only weekly_summaries.

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

-- ---------- Body map: hard sets per muscle per week ----------
-- Each working (non-warm-up) set counts once for every primary muscle of its exercise.
create materialized view analytics.muscle_week_sets as
select
  ws.client_id,
  date_trunc('week', ws.performed_on)::date as week_start,
  em.muscle,
  count(*)::smallint as hard_sets
from public.set_logs sl
join public.workout_sessions ws on ws.id = sl.session_id
join public.exercise_muscles em on em.exercise_id = sl.exercise_id and em.role = 'primary'
where not sl.is_warmup
  and ws.status in ('done', 'partial')
group by 1, 2, 3;

create unique index on analytics.muscle_week_sets (client_id, week_start, muscle);

-- ---------- Weekly summaries: one row per client per program week ----------
create materialized view analytics.weekly_summaries as
with weeks as (
  select cp.user_id as client_id, gs::date as week_start
  from public.client_profiles cp
  cross join lateral generate_series(
    date_trunc('week', cp.start_date), date_trunc('week', current_date), interval '1 week'
  ) gs
),
planned as (
  -- Sessions planned per week from the client's program(s) running that week.
  select w.client_id, w.week_start, count(wt.id)::int as n
  from weeks w
  join public.programs p
    on p.client_id = w.client_id
   and w.week_start >= date_trunc('week', p.start_date)
   and w.week_start < date_trunc('week', p.start_date) + make_interval(weeks => p.weeks)
  join public.workout_templates wt on wt.program_id = p.id
  group by 1, 2
),
done as (
  select client_id, date_trunc('week', performed_on)::date as week_start,
         count(*) filter (where status = 'done')::int as n
  from public.workout_sessions
  group by 1, 2
),
meals as (
  select ml.client_id,
         date_trunc('week', (ml.eaten_at at time zone u.timezone))::date as week_start,
         count(*)::int as logged,
         count(*) filter (where ml.on_plan = 'yes')::int as on_plan,
         count(*) filter (where ml.on_plan = 'partly')::int as partly
  from public.meal_logs ml
  join public.users u on u.id = ml.client_id
  group by 1, 2
),
daily_food as (
  select ml.client_id, (ml.eaten_at at time zone u.timezone)::date as d,
         sum(ml.calories) as kcal, sum(ml.protein_g) as protein
  from public.meal_logs ml
  join public.users u on u.id = ml.client_id
  group by 1, 2
),
food_avg as (
  select client_id, date_trunc('week', d)::date as week_start,
         round(avg(kcal))::int as avg_calories, round(avg(protein), 1) as avg_protein_g
  from daily_food
  group by 1, 2
),
weight as (
  select client_id, date_trunc('week', log_date)::date as week_start,
         round(avg(weight_kg), 1) as avg_weight_kg
  from public.daily_logs
  where weight_kg is not null
  group by 1, 2
),
checkins as (
  -- The client confirms (or corrects) the week's average weight when checking in.
  select client_id, week_start, avg_weight_kg
  from public.check_ins
  where status in ('submitted', 'reviewed')
),
weight_week as (
  select w.client_id, w.week_start, coalesce(ci.avg_weight_kg, wt.avg_weight_kg) as kg
  from weeks w
  left join checkins ci using (client_id, week_start)
  left join weight wt using (client_id, week_start)
),
joined as (
  select
    w.client_id,
    w.week_start,
    coalesce(p.n, 0) as workouts_planned,
    coalesce(d.n, 0) as workouts_done,
    (case when coalesce(p.n, 0) = 0 then null
          else least(100, 100.0 * coalesce(d.n, 0) / p.n) end)::numeric(5, 2) as training_pct,
    coalesce(m.logged, 0) as meals_logged,
    coalesce(m.on_plan, 0) as meals_on_plan,
    -- "Partly" meals count half.
    (case when coalesce(m.logged, 0) = 0 then null
          else 100.0 * (m.on_plan + 0.5 * m.partly) / m.logged end)::numeric(5, 2) as nutrition_pct,
    f.avg_calories,
    f.avg_protein_g::numeric(6, 1) as avg_protein_g,
    ww.kg::numeric(5, 1) as avg_weight_kg,
    (ww.kg - lag(ww.kg) over (partition by w.client_id order by w.week_start))::numeric(4, 1) as weight_change_kg
  from weeks w
  left join planned p using (client_id, week_start)
  left join done d using (client_id, week_start)
  left join meals m using (client_id, week_start)
  left join food_avg f using (client_id, week_start)
  left join weight_week ww using (client_id, week_start)
)
select
  j.*,
  -- Plan followed = mean of training and food. 75%+ on track, 60–75% slipping.
  case
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 75 then 'on_track'
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 60 then 'slipping'
    else 'off_track'
  end::public.week_status as status
from joined j;

create unique index on analytics.weekly_summaries (client_id, week_start);

-- ---------- Public, filtered views ----------
-- Views run with the owner's rights, so the where clause is the access check.
create view public.muscle_week_sets with (security_barrier) as
  select * from analytics.muscle_week_sets
  where public.can_see_client(client_id);

create view public.weekly_summaries with (security_barrier) as
  select * from analytics.weekly_summaries
  where public.can_see_client(client_id);

grant select on public.muscle_week_sets, public.weekly_summaries to authenticated;
revoke all on public.muscle_week_sets, public.weekly_summaries from anon;

-- Called nightly by pg_cron (0009_cron.sql) and after every check-in is
-- submitted or reviewed (trigger below).
create function public.refresh_summaries()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently analytics.weekly_summaries;
  refresh materialized view concurrently analytics.muscle_week_sets;
end;
$$;

revoke execute on function public.refresh_summaries() from public, anon, authenticated;

-- "weekly_summaries refreshes nightly and after every check-in."
create function public.refresh_summaries_after_check_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_summaries();
  return null;
end;
$$;

create trigger check_ins_refresh_summaries
  after update of status on public.check_ins
  for each statement execute function public.refresh_summaries_after_check_in();
