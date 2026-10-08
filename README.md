# Yuktara

Weekly coaching for training and nutrition. Clients log workouts and meals and check in once a week. Their coach sees everyone's progress on one dashboard.

| Folder      | What                                                             |
| ----------- | ---------------------------------------------------------------- |
| `frontend/` | Vite + React + TypeScript PWA, deployed to Netlify               |
| `supabase/` | Postgres schema, RLS, storage buckets, cron jobs, seed data      |
| `backend/`  | FastAPI on Render, for writes that span tables (not built yet)   |
| `docs/`     | Schema and API notes                                             |

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
| Data | Sample data from the wireframes (a client in week 6, a coach with 18 clients), kept in memory until you reload | Your Supabase database. Accounts start empty. |
| Accounts | `coach@demo.test` is the coach; any other email is a client; passwords aren't checked | Real sign-up with email confirmation |

Sample numbers never appear in Supabase mode: a brand-new account sees empty states ("no meals yet", "waiting for your coach") until there's real data.

- Client app: `/`, `/train` (and `/train/workout/:id` to log a workout), `/food`, `/check-in` (and `/check-in/:id` for a past one), `/progress`, `/messages`
- Coach app: `/coach`, `/coach/check-ins/:id`, `/coach/messages` (and `/coach/messages/:clientId`)
- Avatar menu: theme (light, dark, auto) and Log out.

### Run against the local Supabase stack

```sh
npx supabase start && npx supabase db reset     # empty database + exercise library
npx supabase status                             # shows API URL, anon key, service role key
```

Then:

- **`frontend/.env.local`**: set `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=<anon key>` and `VITE_API_URL=http://127.0.0.1:8000`.
- **`backend/.env`**: set `SUPABASE_SERVICE_ROLE_KEY=<service role key>`.
- **Run both:** `make dev` (API) and `cd frontend && npm run dev`.

Confirmation emails land in Mailpit at http://127.0.0.1:54324. `make walkthrough` runs the whole flow (coach, client, logs, a program and two logged workouts, check-in, review) against this stack.

Layouts follow the three artboard sizes:

| Width        | Layout                                    |
| ------------ | ----------------------------------------- |
| under 768 px | phone, with a bottom tab bar              |
| 768–1199 px  | iPad, with an icon rail                   |
| 1200 px up   | desktop, with a full sidebar              |

## 3D body model

The Train tab loads `frontend/public/models/muscles.glb` and `bones.glb`, about 6 MB together. They come from [lucgrn3/anatomy-models](https://github.com/lucgrn3/anatomy-models), adapted from Z-Anatomy and BodyParts3D, under **CC BY-SA 4.0**.

- **Credit:** the app must keep the credit line under the body map, and the license files in `public/models/`.
- **Edits:** any edited version of the model files must also be published under CC BY-SA 4.0.
- **Muscle mapping:** each mesh is one muscle. [anatomy.ts](frontend/src/features/client/train/anatomy.ts) maps it to a name and to one of the app's 16 muscle groups.

## Roles

Each account is either a client or a coach (`public.users.role`). Clients only see the client app; coaches land in the coach app at `/coach`. New sign-ups are always clients.

- **Demo mode:** log in as `coach@demo.test` for the coach app. Any other email is a client, and passwords aren't checked.
- **Real coach account:**

1. Sign up in the app with the coach's email, then confirm the email from the link.
2. In the Supabase SQL editor (replace both placeholders):

   ```sql
   update public.users set role = 'coach', invite_code = '<CODE>' where email = '<coach email>';
   delete from public.client_profiles where user_id = (select id from public.users where email = '<coach email>');
   ```

   `<CODE>` is the invite code clients will type, 4–20 letters, digits or dashes (for example `NAME-7Q4K`). The coach can replace it later from the app (`POST /coach/invite-code`).
3. Log out and log in again: the coach app opens.

Why a client can't promote themselves, and how coach data is protected: [docs/schema.md](docs/schema.md#roles-and-access).

## Accounts and email confirmation

Every account confirms a real email address: the app sends a link on sign-up, and Log in refuses unconfirmed accounts and offers **Resend link**. Google sign-in is hidden unless `VITE_ENABLE_GOOGLE=true`.

- **Demo mode:** sign-up emails ending in `@unconfirmed.test` behave as if confirmation is required, so the confirm screens can be tried without Supabase.
- **Local Supabase:** confirmation is on in `supabase/config.toml`. Read the emails at http://127.0.0.1:54324.
- **Hosted Supabase (dashboard):**
  - Turn on Authentication → Sign In / Providers → Email → **Confirm email**.
  - Under Authentication → URL Configuration, set the **Site URL** to your live site, and add `https://<your site>/login` and `http://localhost:5173/login` to **Redirect URLs**.
- **Email sending:** the built-in sender is limited to a few emails an hour. For real users, set up custom SMTP (for example Resend or SendGrid) under Authentication → Emails → SMTP Settings.

Details: [docs/schema.md](docs/schema.md#email-confirmation).

## Backend API

`backend/` is a FastAPI service for actions that change several tables at once: submitting and reviewing check-ins, exercise swaps, photo upload links and coach invite codes. It runs as the signed-in user, so Supabase's row-level security applies to every query. See [docs/api.md](docs/api.md).

```sh
make setup      # backend/.venv with pinned dependencies
make dev        # http://127.0.0.1:8000/health
make test-db    # local Supabase + every backend test, including permission tests
```

## Database

```sh
npx supabase start          # local stack, needs Docker
npx supabase db reset       # applies migrations and seed.sql
npx supabase db push        # applies migrations to the linked project
```

See [docs/schema.md](docs/schema.md) for where the schema differs from the wireframe.
