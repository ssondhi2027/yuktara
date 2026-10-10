-- Yuktara schema, part 16: kg/lb setting.
--
-- Weights stay stored in kg. The apps convert for display and input in each
-- user's users.unit_system. Body weights get a second decimal so a weight
-- typed in pounds (to 0.1 lb) comes back exactly: 0.1 kg is 0.22 lb, too
-- coarse; 0.01 kg is 0.022 lb. Widening keeps every stored value as it is.
--
-- Users already update their own unit_system (0007: "users: update self";
-- the guard trigger only protects role and invite_code), so no RLS change.

-- New accounts default to pounds (profile setup asks, and defaults to lb too).
alter table public.users alter column unit_system set default 'imperial';

-- weekly_summaries reads daily_logs.weight_kg and check_ins.avg_weight_kg, so
-- it's dropped while the columns change and recreated unchanged (from 0015).
drop view public.weekly_summaries;
drop materialized view analytics.weekly_summaries;

alter table public.daily_logs      alter column weight_kg       type numeric(6, 2);
alter table public.check_ins       alter column avg_weight_kg   type numeric(6, 2);
alter table public.client_profiles alter column start_weight_kg type numeric(6, 2),
                                   alter column goal_weight_kg  type numeric(6, 2);

create materialized view analytics.weekly_summaries as
with weeks as (
  select cp.user_id as client_id, gs::date as week_start
  from public.client_profiles cp
  cross join lateral generate_series(
    date_trunc('week', cp.start_date), date_trunc('week', current_date), interval '1 week'
  ) gs
),
planned as (
  select w.client_id, w.week_start, count(wt.id)::int as n
  from weeks w
  join public.programs p
    on p.client_id = w.client_id
   and p.start_date is not null
   and w.week_start >= date_trunc('week', p.start_date)
   and w.week_start < date_trunc('week', p.start_date) + make_interval(weeks => p.weeks)
  join public.workout_templates wt
    on wt.program_id = p.id and wt.removed_at is null and wt.day_of_week is not null
  group by 1, 2
),
done as (
  select client_id, date_trunc('week', performed_on)::date as week_start,
         count(distinct workout_template_id) filter (where status = 'done')::int as n
  from public.workout_sessions
  where workout_template_id is not null
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
  case
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 75 then 'on_track'
    when coalesce((coalesce(j.training_pct, j.nutrition_pct) + coalesce(j.nutrition_pct, j.training_pct)) / 2, 0) >= 60 then 'slipping'
    else 'off_track'
  end::public.week_status as status
from joined j;

create unique index on analytics.weekly_summaries (client_id, week_start);

create view public.weekly_summaries with (security_barrier) as
  select * from analytics.weekly_summaries
  where public.can_see_client(client_id);

grant select on public.weekly_summaries to authenticated;
revoke all on public.weekly_summaries from anon;
