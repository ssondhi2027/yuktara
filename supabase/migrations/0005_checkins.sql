-- Yuktara schema, part 5: weekly check-in, photos and messages.

create table public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.users (id) on delete cascade,
  week_start    date not null check (extract(isodow from week_start) = 1), -- a Monday
  status        public.checkin_status not null default 'due',
  submitted_at  timestamptz,
  avg_weight_kg numeric(5, 1),
  waist_cm      numeric(5, 1),
  hips_cm       numeric(5, 1),
  energy        smallint check (energy between 1 and 5),
  sleep         smallint check (sleep between 1 and 5),
  stress        smallint check (stress between 1 and 5),
  hunger        smallint check (hunger between 1 and 5),
  wins          text,
  struggles     text,
  question      text,
  reviewed_by   uuid references public.users (id),
  reviewed_at   timestamptz,
  unique (client_id, week_start),
  check (status <> 'reviewed' or (reviewed_by is not null and reviewed_at is not null))
);

-- Coach review queue: submitted, oldest first.
create index check_ins_queue_idx on public.check_ins (status, submitted_at) where status = 'submitted';

-- Coach's own extra questions, asked after the built-in ones.
create table public.checkin_questions (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.users (id) on delete cascade,
  prompt      text not null,
  answer_type public.answer_type not null,
  position    smallint not null default 0,
  is_active   boolean not null default true
);

create table public.checkin_answers (
  id           uuid primary key default gen_random_uuid(),
  check_in_id  uuid not null references public.check_ins (id) on delete cascade,
  question_id  uuid not null references public.checkin_questions (id),
  value_number numeric,
  value_text   text,
  unique (check_in_id, question_id)
);

create table public.progress_photos (
  id          uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references public.check_ins (id) on delete cascade,
  pose        public.photo_pose not null,
  photo_url   text not null, -- path in the private progress-photos bucket
  taken_on    date not null default current_date,
  unique (check_in_id, pose)
);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.users (id) on delete cascade, -- the thread
  sender_id   uuid not null references public.users (id),
  check_in_id uuid references public.check_ins (id) on delete set null, -- null = chat
  body        text not null check (length(body) between 1 and 5000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index messages_thread_idx on public.messages (client_id, created_at desc);

-- Coach's draft reply and private notes while reviewing (the "Draft saved" line).
create table public.review_drafts (
  check_in_id uuid primary key references public.check_ins (id) on delete cascade,
  coach_id    uuid not null references public.users (id),
  body        text not null default '',
  updated_at  timestamptz not null default now()
);

-- Clients may change answers until the coach reviews; review fields are coach-only.
create function public.guard_check_in_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.client_id and not public.is_coach_of(old.client_id) then
    if old.status = 'reviewed' then
      raise exception 'This check-in has already been reviewed';
    end if;
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.status not in ('due', 'submitted') then
      raise exception 'Only the coach can review a check-in';
    end if;
    if new.status = 'submitted' and old.status <> 'submitted' then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger check_ins_guard
  before update on public.check_ins
  for each row execute function public.guard_check_in_update();
