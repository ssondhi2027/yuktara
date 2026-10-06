-- Yuktara schema, part 9: scheduled jobs (pg_cron). Times are UTC.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

/**
 * Opens this week's check-in for every active client whose check-in day is
 * today in their own timezone, and marks last week's unsubmitted ones missed.
 * Safe to run repeatedly.
 */
create function public.roll_check_ins()
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

revoke execute on function public.roll_check_ins() from public, anon, authenticated;

select cron.schedule('roll-check-ins', '5 * * * *', 'select public.roll_check_ins()');
select cron.schedule('refresh-summaries', '30 7 * * *', 'select public.refresh_summaries()');
