-- Yuktara schema, part 17: coach Clients, Nutrition and Settings pages, and the
-- client's Profile page.
--
-- Who edits what on client_profiles (both roles share the column grants from
-- 0007/0010, so a trigger decides by who is updating):
--   coach  → status, check_in_day and the private coach_notes only;
--   client → their own setup answers; after setup, never goal, start date,
--            start weight or check-in day (the coach's), and never status,
--            coach or notes.

-- ---------- Coach default check-in day ----------
alter table public.users
  add column default_check_in_day smallint not null default 0 check (default_check_in_day between 0 and 6);

-- A client linked to a coach at sign-up starts on that coach's default day.
create function public.client_profile_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.coach_id is not null then
    select u.default_check_in_day into new.check_in_day from public.users u where u.id = new.coach_id;
  end if;
  return new;
end;
$$;

create trigger client_profiles_defaults
  before insert on public.client_profiles
  for each row execute function public.client_profile_defaults();

-- ---------- Who edits which client_profiles columns ----------
create or replace function public.guard_client_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  changed text[];
begin
  if me is null then
    return new; -- jobs and the service role
  end if;
  select coalesce(array_agg(n.key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n
  where n.value is distinct from (to_jsonb(old) -> n.key);

  if old.coach_id = me and old.user_id <> me then
    if not (changed <@ array['status', 'check_in_day', 'coach_notes']) then
      raise exception 'Coaches change a client''s status, check-in day and notes; the rest is the client''s own.';
    end if;
  elsif old.user_id = me then
    if changed && array['user_id', 'coach_id', 'coach_notes', 'status'] then
      raise exception 'Only your coach can change this';
    end if;
    if old.setup_completed_at is not null
       and changed && array['goal', 'start_date', 'start_weight_kg', 'check_in_day', 'setup_completed_at'] then
      raise exception 'Only your coach can change these settings';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- Check-in questions ----------
-- A question with answers can be turned off (is_active) but not deleted, so
-- old check-ins stay readable. The helper sees answers from every client,
-- including ones RLS hides from the coach now.
create function public.question_has_answers(question uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.checkin_answers a where a.question_id = question);
$$;

grant execute on function public.question_has_answers(uuid) to authenticated;

drop policy "checkin_questions: coach manages" on public.checkin_questions;
create policy "checkin_questions: coach reads own" on public.checkin_questions
  for select to authenticated
  using (coach_id = (select auth.uid()));
create policy "checkin_questions: coach adds own" on public.checkin_questions
  for insert to authenticated
  with check (coach_id = (select auth.uid()) and public.is_coach());
create policy "checkin_questions: coach edits own" on public.checkin_questions
  for update to authenticated
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()) and public.is_coach());
create policy "checkin_questions: coach deletes unanswered" on public.checkin_questions
  for delete to authenticated
  using (coach_id = (select auth.uid()) and not public.question_has_answers(id));

alter table public.checkin_questions
  add constraint checkin_questions_prompt_check check (char_length(btrim(prompt)) between 1 and 200);

create index checkin_questions_coach_idx on public.checkin_questions (coach_id, position);
