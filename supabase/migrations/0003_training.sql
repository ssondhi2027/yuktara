-- Yuktara schema, part 3: training plan and training log.

-- ---------- Exercise library ----------
create table public.exercises (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  level      public.exercise_level not null default 'beginner',
  equipment  text,
  cue        text,
  video_url  text,
  created_by uuid references public.users (id) on delete set null -- null = shared library
);

create unique index exercises_library_name_idx on public.exercises (lower(name)) where created_by is null;

create table public.exercise_muscles (
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  muscle      public.muscle_group not null,
  role        public.muscle_role not null,
  note_kind   public.note_kind, -- null = no note
  note        text,             -- shown on the muscle page
  source_url  text,
  primary key (exercise_id, muscle)
);

create index exercise_muscles_muscle_idx on public.exercise_muscles (muscle, role);

-- ---------- Training plan ----------
create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  coach_id    uuid not null references public.users (id),
  client_id   uuid references public.users (id) on delete cascade, -- null = template
  name        text not null,
  start_date  date,
  weeks       smallint not null default 12 check (weeks between 1 and 52),
  is_template boolean not null default false,
  check (is_template = (client_id is null))
);

create index programs_client_idx on public.programs (client_id, start_date desc);
create index programs_coach_idx on public.programs (coach_id);

create table public.workout_templates (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs (id) on delete cascade,
  name        text not null, -- e.g. Upper A
  day_of_week smallint check (day_of_week between 0 and 6),
  position    smallint not null default 0,
  notes       text
);

create index workout_templates_program_idx on public.workout_templates (program_id, position);

create table public.template_exercises (
  id                  uuid primary key default gen_random_uuid(),
  workout_template_id uuid not null references public.workout_templates (id) on delete cascade,
  exercise_id         uuid not null references public.exercises (id),
  position            smallint not null default 0,
  target_sets         smallint not null check (target_sets > 0),
  target_reps         text not null, -- e.g. 6–8
  target_rpe          numeric(3, 1),
  rest_seconds        smallint
);

create index template_exercises_template_idx on public.template_exercises (workout_template_id, position);

-- ---------- Training log ----------
create table public.workout_sessions (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.users (id) on delete cascade,
  workout_template_id uuid references public.workout_templates (id) on delete set null,
  performed_on        date not null,
  started_at          timestamptz,
  duration_min        smallint,
  status              public.session_status not null default 'done',
  effort              smallint check (effort between 1 and 10),
  notes               text
);

create index workout_sessions_client_idx on public.workout_sessions (client_id, performed_on desc);

create table public.set_logs (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  set_number  smallint not null,
  reps        smallint,
  weight_kg   numeric(6, 2),
  rpe         numeric(3, 1),
  is_warmup   boolean not null default false,
  unique (session_id, exercise_id, set_number)
);

create index set_logs_session_idx on public.set_logs (session_id);
create index set_logs_exercise_idx on public.set_logs (exercise_id);
