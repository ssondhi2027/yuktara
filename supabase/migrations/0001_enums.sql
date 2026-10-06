-- Yuktara schema, part 1: extensions and enum types.
-- See docs/schema.md and the "Database schema" artboard.

create extension if not exists citext with schema extensions;

create type public.user_role      as enum ('coach', 'client');
create type public.unit_system    as enum ('metric', 'imperial');
create type public.client_status  as enum ('active', 'paused', 'archived');
create type public.goal_type      as enum ('fat_loss', 'muscle_gain', 'performance', 'health');
create type public.session_status as enum ('done', 'partial', 'skipped');
create type public.meal_type      as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type public.on_plan        as enum ('yes', 'partly', 'no');
create type public.checkin_status as enum ('due', 'submitted', 'reviewed', 'missed');
create type public.answer_type    as enum ('scale', 'number', 'text', 'yes_no');
create type public.photo_pose     as enum ('front', 'side', 'back');
create type public.week_status    as enum ('on_track', 'slipping', 'off_track');
create type public.body_model     as enum ('female', 'male');
create type public.exercise_level as enum ('beginner', 'intermediate', 'advanced');
create type public.muscle_role    as enum ('primary', 'secondary');
create type public.note_kind      as enum ('research', 'coach_tip');
create type public.muscle_group   as enum (
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'traps',
  'upper_back', 'lats', 'lower_back',
  'glutes', 'quads', 'hamstrings', 'adductors', 'calves'
);
