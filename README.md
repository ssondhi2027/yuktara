# Yuktara

Weekly coaching for training and nutrition. Clients follow the program their coach builds, log workouts, meals and habits, and check in once a week. The coach sees every client on one dashboard, reviews check-ins, sets targets and messages clients.

| Folder      | What                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| `frontend/` | Vite + React + TypeScript PWA (client app and coach app), deployed to Netlify      |
| `supabase/` | Postgres schema, row-level security, storage buckets, cron jobs, exercise library  |
| `backend/`  | FastAPI on Render, for actions that change several tables at once                  |
| `docs/`     | [schema.md](docs/schema.md) (data, access rules, migrations) and [api.md](docs/api.md) (endpoints, security, deploys) |

## What's in the app

**Client app**

| Page | What it does |
| --- | --- |
| Home `/` | The week at a glance: today's workout, food so far, habits (steps, water, sleep, morning weight), weight trend, best lifts, the coach's latest note |
| Train `/train` | 3D body map of this week's hard sets per muscle, today's workout and the week's plan from the coach (start, or skip with a reason), recent workouts |
| Workout `/train/workout/:id` | Log sets (weight, reps, RPE) as you go, marking warm-ups; swap an exercise for today; "last time" for each lift; resumes after a reload; "how hard was it?" (1–10) and a summary when you finish |
| Food `/food` | The coach's meal plan for each meal ("Log as planned" or "Log something else"); meals logged as foods with amounts (calories and macros follow the amount) or as a quick add; totals against the coach's targets, "on plan?" rating, upcoming targets ("From Mon, Oct 19") |
| Check-in `/check-in` | The weekly check-in: weight, waist and hips, scores, photos, wins and struggles, the coach's own questions. Past check-ins at `/check-in/:id` |
| Progress `/progress` | KPIs and charts for 4 weeks, 12 weeks or since start: weight with goal and a forecast range, workouts, volume, muscles, estimated 1RM (RPE-aware, smoothed, with a forecast), calories, protein, habits, check-in measurements and scores; an Insights card with the goal date (an estimate), plateaus and up to three patterns |
| Messages `/messages` | Chat with the coach; check-in feedback appears in the same thread |
| Profile `/settings` | Profile photo, the client's own answers (name, phone, height, goal weight, diet, training days, injuries…), read-only coach settings, units, log out |

**Coach app**

| Page | What it does |
| --- | --- |
| Dashboard `/coach` | Every client this week, the review queue, who needs attention, the invite code |
| Check-ins `/coach/check-ins/:id` | Review a client's check-in with charts and photos, the meal plan vs what was eaten, reply, set new targets, apply a swap |
| Clients `/coach/clients` | Search, filter and sort clients; plateau and goal-date flags on each row; a full view with status (pause, archive), check-in day, the client's Insights card, weight trend, check-in history, meal plan vs eaten, workouts (with effort scores and skips), phone and setup answers, and private notes |
| Programs `/coach/programs` | Generate a program from the client's answers, edit it in the builder, assign it, save and reuse templates; add your own exercises (Exercises tab) |
| Nutrition plans `/coach/nutrition` | Each client's targets and meal plan (foods and amounts per meal, against the targets, with the client's diet and foods to avoid), from today or a later date, version history and templates; add your own foods |
| Messages `/coach/messages` | Conversations with every client, unread counts |
| Settings `/coach/settings` | Profile photo, name, invite code (copy, rotate), weekly check-in questions, default check-in day, units |

The avatar menu in both apps has the theme (light, dark, auto), the **kg / lb** setting, Settings and Log out. Weights are stored in kg and shown in each person's unit; new accounts default to lb. Waist and hips are always in inches.

Layouts follow three sizes:

| Width        | Layout                                    |
| ------------ | ----------------------------------------- |
| under 768 px | phone, with a bottom tab bar              |
| 768–1199 px  | tablet, with an icon rail                 |
| 1200 px up   | desktop, with a full sidebar              |

## Run the app

```sh
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### Demo mode or real data?

The app has two modes, and they never mix:

| | Demo mode | Supabase mode |
| --- | --- | --- |
| When | `frontend/.env` has no `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Both are set |
| How to tell | The Log in page says "Demo: log in as coach@demo.test…" | No demo line on Log in |
| Data | Sample data kept in memory until you reload: Aisha in week 6 of her program, a coach with 18 clients | Your Supabase database. Accounts start empty. |
| Accounts | `coach@demo.test` is the coach; any other email is a client; passwords aren't checked | Real sign-up with email confirmation |

Sample numbers never appear in Supabase mode: a brand-new account sees empty states ("no meals yet", "waiting for your coach") until there's real data.

### Run against the local Supabase stack

Needs Docker.

```sh
npx supabase start && npx supabase db reset     # empty database + exercise library
npx supabase status                             # shows API URL, anon key, service role key
```

Then:

- **`frontend/.env.local`**: set `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=<anon key>` and `VITE_API_URL=http://127.0.0.1:8000`.
- **`backend/.env`**: set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `SUPABASE_URL=http://127.0.0.1:54321` and `SUPABASE_SERVICE_ROLE_KEY=<service role key>`. Start from `backend/.env.example`.
- **Run both:** `make dev` (API) and `cd frontend && npm run dev`.

Confirmation emails land in Mailpit at http://127.0.0.1:54324.

## Roles

Each account is either a client or a coach (`public.users.role`). Clients only see the client app; coaches land in the coach app at `/coach`. New sign-ups are always clients, and a client joins their coach by typing the coach's invite code at sign-up.

- **Demo mode:** log in as `coach@demo.test` for the coach app. Any other email is a client.
- **Real coach account:**

1. Sign up in the app with the coach's email, then confirm the email from the link.
2. In the Supabase SQL editor (replace both placeholders):

   ```sql
   update public.users set role = 'coach', invite_code = '<CODE>' where email = '<coach email>';
   delete from public.client_profiles where user_id = (select id from public.users where email = '<coach email>');
   ```

   `<CODE>` is the invite code clients will type, 4–20 letters, digits or dashes (for example `NAME-7Q4K`). The coach can make a new one later in Settings; the old one stops working.
3. Log out and log in again: the coach app opens.

Who may read and change what (clients, coaches, private coach notes, programs, messages): [docs/schema.md](docs/schema.md#roles-and-access).

## Accounts and email confirmation

Every account confirms a real email address: the app sends a link on sign-up, and Log in refuses unconfirmed accounts and offers **Resend link**. Google sign-in is hidden unless `VITE_ENABLE_GOOGLE=true`.

- **Demo mode:** sign-up emails ending in `@unconfirmed.test` behave as if confirmation is required, so the confirm screens can be tried without Supabase.
- **Local Supabase:** confirmation is on in `supabase/config.toml`. Read the emails at http://127.0.0.1:54324.
- **Hosted Supabase (dashboard):**
  - Turn on Authentication → Sign In / Providers → Email → **Confirm email**.
  - Under Authentication → URL Configuration, set the **Site URL** to your live site, and add `https://<your site>/login` and `http://localhost:5173/login` to **Redirect URLs**.
- **Email sending:** the built-in sender is limited to a few emails an hour. For real users, set up custom SMTP (for example Resend or SendGrid) under Authentication → Emails → SMTP Settings.

Details: [docs/schema.md](docs/schema.md#email-confirmation).

## How it fits together

- **Reads and one-table writes** go from the app straight to Supabase as the signed-in user; row-level security decides what each person can see and change.
- **Several-table actions** that need a server go through the FastAPI backend, which also runs as the signed-in user: submitting and reviewing check-ins, exercise swaps, photo upload links and invite codes.
- **Several-table actions with simple rules** are database functions: saving, assigning and copying programs.
- **Freshness:** coach screens refetch every 30 s, an open conversation every 5 s, unread badges every 15 s. No Realtime setup needed.

Which call goes where, and why: [docs/api.md](docs/api.md#which-calls-go-where).

## Backend API

```sh
make setup      # backend/.venv with pinned dependencies
make dev        # http://127.0.0.1:8000/health
```

Endpoints, security (token checks, rate limits, headers, logging) and caching: [docs/api.md](docs/api.md).

## Database

```sh
npx supabase start          # local stack, needs Docker
npx supabase db reset       # applies every migration and seed.sql (the exercise library)
npx supabase db push        # applies migrations to the linked project
```

Migrations live in `supabase/migrations` (`0001`–`0023`). Never edit one that has been applied; add the next number. What each one adds is in [docs/schema.md](docs/schema.md).

## Tests and checks

```sh
make test            # backend unit tests + frontend unit tests (npm test)
make test-db         # local Supabase, reset, every backend test including row-level security tests
make lint            # ruff (check and format) + TypeScript typecheck
make walkthrough     # the whole flow on the local stack, as real users (needs `make dev` running)
```

- **Frontend:** `npm run typecheck`, `npm test` (Node's built-in test runner: program generator, units, targets, progress calculations, forecasts and insight rules, profile and exercise checks, food amounts and meal plans, skipped workouts), `npm run build`, and `npm run check:progress` (renders the Progress page in Node for phone, tablet and desktop, in kg and lb).
- **Walkthrough** (`backend/scripts/walkthrough.py`): sign-up and confirmation, setup, targets, logging, units, coach pages, check-in and review, a generated program and logged workouts, messages, and every query the apps make, all under RLS.

CI (`.github/workflows/ci.yml`) runs the frontend checks, the backend lint and tests, the database tests and dependency audits on every pull request.

## Deploying

Pushing to `main` runs `.github/workflows/db-migrate.yml`: database migrations (after manual approval in the GitHub `production` environment), then the API on Render, then the site on Netlify. Turn off automatic deploys on Render and Netlify so neither races a migration.

| Where | Settings |
| --- | --- |
| Supabase | Confirm email on; Site URL and Redirect URLs; custom SMTP (see above) |
| Render | `ENV=production`, `DATABASE_URL` (session pooler, port 5432), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS=https://<your site>,http://localhost:5173` |
| Netlify | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (your Render URL) |
| GitHub (`production` environment) | Secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `RENDER_DEPLOY_HOOK_URL`, `NETLIFY_BUILD_HOOK_URL`; variable `API_URL` for the keep-warm ping |

Full list and the deploy order: [docs/api.md](docs/api.md#settings-and-secrets).

## 3D body model

The Train tab loads `frontend/public/models/muscles.glb` and `bones.glb`, about 6 MB together. They come from [lucgrn3/anatomy-models](https://github.com/lucgrn3/anatomy-models), adapted from Z-Anatomy and BodyParts3D, under **CC BY-SA 4.0**.

- **Credit:** the app must keep the credit line under the body map, and the license files in `public/models/` (see its [README](frontend/public/models/README.md)).
- **Edits:** any edited version of the model files must also be published under CC BY-SA 4.0.
- **Muscle mapping:** each mesh is one muscle. [anatomy.ts](frontend/src/features/client/train/anatomy.ts) maps it to a name and to one of the app's 16 muscle groups.
