# Schema notes

The migrations in `supabase/migrations` implement the "Database schema" artboard, with the differences below.

## Differences from the artboard

- **`users.password_hash` is dropped.** Supabase Auth stores credentials in `auth.users`. `public.users.id` references `auth.users.id`, and a trigger creates the profile row on sign-up. New users are always clients; promote coaches with the service role.
- **`nutrition_targets.sleep_hours` is added.** "Targets for week N" in the coach review sets sleep alongside calories, protein and steps.
- **`daily_logs.day_rating` is added.** It stores the Food tab's "Today so far, on plan?" answer.
- **`review_drafts` is a new table.** It holds the coach's unsent feedback, shown as "Draft saved 6:52 PM" in the review.
- **Materialized views are moved.** `muscle_week_sets` and `weekly_summaries` live in a private `analytics` schema, because RLS doesn't apply to materialized views. Public views with the same names filter rows to the signed-in client or their coach.

## Access rules

- **Clients:** read and write their own rows only.
- **Coaches:** read and write rows for clients whose `client_profiles.coach_id` is theirs. Adding coaches later needs no schema change. Exception: workout logs (`workout_sessions`, `set_logs`) are read-only for the coach since 0013.
- **Private coach notes:** `client_profiles.coach_notes` is hidden with column grants. Coaches use `get_coach_notes(client)` and `set_coach_notes(client, notes)`. This means `select *` on `client_profiles` fails, so always name the columns.
- **Check-ins:** clients can edit until the coach reviews. Only the coach can set `status = 'reviewed'`. The `check_ins_guard` trigger enforces both.
- **Photos:** stored in the private buckets `progress-photos` and `meal-photos`. Object paths start with the client's id. Clients upload and delete their own; the coach can read them.

## Jobs

| Job                 | Schedule (UTC) | What it does                                                                                                                              |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `roll-check-ins`    | hourly at :05  | Opens a `due` check-in on each client's check-in day, in their timezone. Marks unsubmitted ones `missed` after two days' grace.            |
| `refresh-summaries` | 07:30 daily    | Refreshes both summary views. A trigger on `check_ins` also refreshes them whenever a check-in's status changes (submitted, reviewed, missed). |

## How the summaries are scored

- **Training:** `training_pct` = sessions done ÷ sessions planned in the program that week.
- **Food:** `nutrition_pct` = meals on plan ÷ meals logged. A "partly" meal counts as half.
- **Weight:** `avg_weight_kg` is the average the client confirmed in their check-in. Before they check in, it's the average of that week's daily weigh-ins.
- **Week status:** taken from the mean of the two percentages. 75% or more is `on_track`, 60–75% is `slipping`, and below 60% is `off_track`.

## Roles and access

`public.users.role` decides everything: `client` accounts only ever see the client app, and `coach` accounts land in the coach app (`/coach`).

The app's route guard (`RequireAuth` in `frontend/src/app/auth.tsx`) is only a convenience. These are what actually protect coach data:

- **Clients can't promote themselves.** The `users_guard_role` trigger (0007) refuses any role change made as `authenticated`, which is what the app, Supabase's API and the backend all run as. There's no insert policy on `public.users`, so nobody can create a user row by hand either. Only an admin, in the SQL editor, can change a role.
- **Invite codes are coaches' only.** The `users_invite_code_coach_only` check (0011) stops a client from setting one.
- **Coach-only data is protected by RLS.**
  - Client rows are visible only to the client and to the coach for whom `public.is_coach_of(client)` is true.
  - Coach notes are hidden behind column grants.
  - Programs, check-in questions and review drafts are tied to `coach_id = auth.uid()`.
- **The backend checks the role again.** Every coach endpoint calls `ensure_coach`, which reads `public.users.role` (never the token or the browser) before doing anything.
- **Nothing in the browser decides a role.** With Supabase, the role is read from `public.users`. In demo mode it comes from the fixed demo accounts: `coach@demo.test` is the coach, and any other email is a client.

### Make the real coach account

1. Sign up in the app with the coach's email, then confirm the email from the link.
2. In the Supabase SQL editor (replace both placeholders):

   ```sql
   update public.users set role = 'coach', invite_code = '<CODE>' where email = '<coach email>';
   delete from public.client_profiles where user_id = (select id from public.users where email = '<coach email>');
   ```

   `<CODE>` is the invite code clients will type, 4–20 letters, digits or dashes (for example `NAME-7Q4K`). The coach can replace it later from the app (`POST /coach/invite-code`).
3. Log out and log in again: the coach app opens.

## Units (0016_units.sql)

- **Stored in kg, shown in each user's unit.** `users.unit_system` (`imperial` = lb, `metric` = kg) is the signed-in user's choice: the avatar menu changes it (users update their own row; 0007's policy, no RLS change), and every screen converts for display and input with `frontend/src/lib/units.ts`. Coaches see their clients' weights in the coach's own unit.
- **Defaults.** New accounts default to `imperial`, and profile setup preselects lb. Existing rows are unchanged.
- **Precision.** Body weights (`daily_logs.weight_kg`, `check_ins.avg_weight_kg`, `client_profiles.start_weight_kg` / `goal_weight_kg`) now keep two decimals, like `set_logs.weight_kg`, so a weight typed to 0.1 lb comes back exactly (0.01 kg = 0.022 lb). Widening kept every stored value. Display rounds body weight to 0.1 and loads to 0.1 lb or 0.5 kg; waist and hips stay in inches.
- `weekly_summaries` was recreated unchanged (it reads two of those columns).

## Programs (0015_programs.sql)

- **Drafts.** A client program is a draft until the coach assigns it: `assigned_at` and `start_date` are null, and `draft_start` holds the start date picked in the builder. Clients can't read drafts (RLS) and the summaries ignore them (no `start_date`). Templates are programs with `is_template` and no client, as in 0003; only their coach sees them.
- **Saving.** `save_program(jsonb)` writes a whole program (workouts and exercises in order) in one transaction, as the coach, so RLS applies. Rows without an id are new.
- **History is never rewritten.** A workout that logged sessions point at, or an exercise that logged sets point at, is marked `removed_at` instead of deleted when the coach takes it out; changing the exercise of a slot with logged sets marks the old slot removed and adds a new one. The apps and summaries skip removed rows; past sessions keep their workout's name and their sets keep their slot.
- **Assigning.** `assign_program(program, start)` sets `start_date` (today or later; the builder defaults to the coming Monday). The program it replaces stops at the end of the week before (`weeks` is cut down); one that hadn't reached that week is unscheduled (`start_date` null). The client's current program is the latest assigned one that has started.
- **Copying.** `copy_program(source, client)` saves a program as a template (`client` null) or starts a client draft from a template. Removed rows aren't copied.
- **Access.** A coach creates, edits and copies only their own templates and their own clients' programs, and deletes only drafts and templates. A client reads only programs assigned to them and never writes.
- **New columns.** `programs.goal`, `level`, `days_per_week` (template filters, generator inputs), `assigned_at`, `draft_start`; `template_exercises.notes` (the coach's note to the client); `removed_at` on workouts and exercises. Checks: sets 1–10, RPE 1–10, reps 1–20 characters, rest 0–900 s.
- **Weekly summaries** are recreated: planned = the program's live workouts that have a day; done = distinct planned workouts with a finished session that week (matching the apps).

### The program generator

`frontend/src/lib/programGen.ts` builds the first draft in the browser from the client's setup answers, with only library exercises. The rules are data at the top of the file:

| Answer | Decides |
| --- | --- |
| Goal | The split for each number of days (`SPLITS`), reps, rest, RPE and notes (`GOALS`). Muscle gain: hypertrophy splits, 6–10 / 10–15 reps. Fat loss: full body or upper/lower, short rests. Performance: compound strength, 3–5 reps (5–6 for beginners). Health: full body only, one set fewer, RPE 7. |
| Experience | Exercises per workout (5 / 6 / 7), sets, which levels and equipment (beginners: no barbell), weeks (8 / 10 / 12) and the weekly sets range per major muscle (`LEVELS`). |
| Training days | 2–3 full body, 4 upper/lower, 5–6 push/pull/legs or upper/lower + full body (by goal), on spread-out weekdays (`SCHEDULE`). Outside 2–6 is clamped, with a note. |
| Location | Home: bodyweight and dumbbells only (`LOCATIONS`). |
| Injuries | Not interpreted; the builder shows them prominently. |

Each workout type is a list of slots (muscle + compound/isolation). A slot takes the first matching exercise: staples first (`STAPLES`), then the equipment preference; a repeated day takes the next one, so Upper B differs from Upper A. Weekly hard sets are then counted like `muscle_sets_for_week` and nudged into range (sets first, then dropping or adding an exercise). A major muscle with no eligible exercise in the library (e.g. hamstrings at home) is reported as a warning. Unit tests: `cd frontend && npm test`.

## Messaging (0014_messaging.sql)

- **One conversation per client.** Every message with the same `client_id`; its members are the client and their current coach (`can_see_client`). Check-in feedback from `POST /checkins/{id}/review` is a message with `check_in_id` set, in the same conversation.
- **Sending (RLS).** `sender_id` must be the caller and `read_at` empty. A client writes only into their own conversation, and only once they have a coach; a coach only into their clients' conversations. Only the coach may attach a `check_in_id`, and only for that client's check-in. Chat messages are capped at 2000 characters (feedback keeps the table's 5000).
- **Read state.** Only the recipient sets `read_at`: the client on messages others wrote in their conversation, the coach on messages the client wrote. `read_at` is the only updatable column (0007), and no one can delete a message.
- **Rate limit.** The `messages_rate_limit` trigger refuses a sender's 11th message in a minute or 61st in 10 minutes with SQLSTATE `PT429` (HTTP 429).
- **Reads.** `message_threads()` lists the coach's clients with their latest message and the client messages the coach hasn't read; `unread_message_count()` is the nav badge. Both are security invoker, so RLS applies.
- **Indexes.** `messages_sender_idx (sender_id, created_at desc)` for the rate limit, `messages_unread_idx (client_id, sender_id) where read_at is null` for unread counts. The latest message per client uses `messages_thread_idx` from 0005.

## Workout logging (0013_workout_logging.sql)

The Train tab logs workouts straight into `workout_sessions` and `set_logs`, as the client.

- **Open sessions.** "Start workout" inserts a session with `finished_at` null and `status = 'partial'`. A unique index allows one open session per client, so starting again resumes it. "Finish workout" sets `finished_at`, `duration_min` (null if it was left open over 10 hours) and `status = 'done'`. `finished_at` defaults to `now()`, so rows written any other way count as finished.
- **Sets save one by one.** Each ticked set is upserted on `(session_id, exercise_id, set_number)`; unticking deletes it. Weight is stored in kg (`weight_kg`) and shown in the client's `users.unit_system`.
- **Checks.** Reps 0–100, weight 0–1000 kg, RPE 1–10 in steps of 0.5, set number 1–50. Weight may be null (bodyweight exercises).
- **Swaps for one session.** `set_logs.template_exercise_id` records which planned slot a set was logged against. When its `exercise_id` differs from the slot's, the client swapped it for that session only; the program (and `exercise_swaps`) is unchanged. Null means an exercise the client added.
- **Body map.** Ticked sets count as hard sets straight away (open sessions are `partial`, which `muscle_sets_for_week` and `muscle_week_sets` include), once per primary muscle, warm-ups excluded.
- **"Done" workouts.** The apps count distinct planned workouts with a finished session this week, so an extra workout doesn't make up for a missed one. The nightly `weekly_summaries` view still counts every finished session (capped at 100%).
- **Access.** The client inserts, updates and deletes only their own sessions and sets, with a template from their own program and an exercise they can see. Their coach can read them; no one else can see them.

## Live data (0012_live_data.sql)

**Day 1 and weeks.** A client's `start_date` is their local date when they finish setup. Program week 1 is the Monday–Sunday week containing it; "Week N" and every "since start" number count from there.

**Which week a check-in reviews.** A check-in reviews the Monday–Sunday week that ended most recently on or before the check-in day: `week_start = Monday of (check-in date − 6 days)`. A Sunday check-in covers the week ending that day; a Wednesday check-in covers the week that ended the Sunday before.

**The first, partial week.** `roll_check_ins()` only opens a check-in if that week has at least 3 of the client's days. Someone who joins on a Saturday with a Sunday check-in day has their first check-in the Sunday after next, not the next day. A check-in not sent within 2 days of opening is marked `missed`. The client app shows the same date ("Your first check-in opens …").

**New clients appear at once.**

- The coach dashboard lists clients straight from `client_profiles`, so a client shows up the moment they sign up, marked "Setting up" until they finish setup.
- A trigger refreshes `weekly_summaries` when a client finishes setup.
- This week's numbers on the dashboard are computed from the raw logs, so they're always current. The summary views cover past weeks only.

**Body map.** `muscle_sets_for_week(client, week_start)` counts this week's hard sets live. It's security invoker, so RLS decides whose sets the caller can count. The `muscle_week_sets` materialized view still refreshes nightly for history.

**Targets.** The coach sets a client's first targets from the client sheet on the dashboard; they apply from today. Targets sent with a check-in review apply from next Monday. With no targets, the client app shows "waiting for your coach", never 0 / 0.

## Backend tables (0011_backend.sql)

- **`exercise_swaps`:** "swap X for Y in this workout for weeks 7–8" overrides. Only the coach who owns the program can write them; the client can read their own.
- **Invite codes:** a check makes sure only coaches hold an `invite_code`.

## Sign-up and profile setup (0010_onboarding.sql)

1. The app opens on **Log in**. **Create account** calls `supabase.auth.signUp` and sends `full_name`, `invite_code` and `timezone` as user metadata. Supabase adds the person to `auth.users` and sends a confirm-email link.
2. The `handle_new_user` trigger inserts `public.users` (role `client`) and a `client_profiles` row. If the invite code matches a coach's `users.invite_code`, that row is linked to the coach. The form checks the code first with `invite_code_valid()`.
3. The profile setup window opens right away. **Finish setup** fills in the client's own `client_profiles` row and sets `setup_completed_at`. It also saves `users.unit_system`. Clients who never finished setup see the window again after logging in.
4. **Log in** uses `signInWithPassword`. **Continue with Google** (`signInWithOAuth`) is hidden unless `VITE_ENABLE_GOOGLE=true`, so every account confirms a real email address.

New `client_profiles` columns: `date_of_birth`, `phone`, `experience`, `training_days`, `train_location`, `injuries`, `diet`, `foods_to_avoid`, `meals_per_day`, `cleared_to_exercise` and `setup_completed_at`.

Other changes in this migration:

- `coach_id` and `goal` can now be null, because the row exists before setup.
- Until setup is finished, the client can fill in goal, weights, height and check-in day. After that, only the coach can change goal, start date, height and weights. The client can still change their check-in day, body model and personal details.
- Check-ins only open for clients who have finished setup.

### One-time project setup

- **Make a coach:** see "Roles and access" below.
- **Email confirmation:** see "Email confirmation" below.
- **Google sign-in (off for now):** to bring it back, set `VITE_ENABLE_GOOGLE=true` and turn on the Google provider under Authentication → Sign In / Providers.

## Email confirmation

Every account must confirm a real email address before it can log in.

1. **Create account:** `signUp` returns a user but no session. The setup window still opens; on **Finish setup** the answers are kept on the device (`localStorage`, key `yuktara.pendingSetup`) and the done screen says **Confirm your email**, with a **Resend link** button.
2. **Confirm link:** Supabase sends the person to `/login` with the session in the URL. supabase-js reads it (`detectSessionInUrl`, implicit flow) and `consumeAuthRedirect()` in `lib/auth.ts` removes the auth parameters from the address bar. The implicit flow is used so the link also works when opened in a mail app or another browser. A PKCE `?code=` is exchanged too, if one arrives.
3. **First sign-in:** the waiting answers are saved to `client_profiles` and the client lands on Home. If no answers were waiting (for example, the link was opened on another device), the setup window opens instead.
4. **Not confirmed yet:** Log in shows "Confirm your email first" with **Resend link** (`supabase.auth.resend({ type: 'signup' })`). The button then waits 60 seconds.
5. **Expired or used link:** Log in explains it in plain words and offers **Resend link**.

### Settings

- **Local stack:** `supabase/config.toml` has `[auth.email] enable_confirmations = true`. Local emails aren't really sent; open the test inbox at http://127.0.0.1:54324.
- **Hosted project (dashboard):**
  - Authentication → Sign In / Providers → Email → turn on **Confirm email**.
  - Authentication → URL Configuration → **Site URL**: your live site, e.g. `https://yuktara.app`.
  - Authentication → URL Configuration → **Redirect URLs**: add `https://<your site>/login` and `http://localhost:5173/login`.
- **Email sending:** Supabase's built-in sender only allows a few emails an hour and is meant for testing. For real users, set up custom SMTP under Authentication → Emails → SMTP Settings, with a provider such as Resend or SendGrid, and send from your own domain.
