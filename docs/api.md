# Yuktara API

FastAPI service on Render, backed by Supabase Postgres. It only handles actions that change several tables at once. Reads and simple writes go from the app straight to Supabase, protected by row-level security (RLS).

Local run: `make dev` (or `cd backend && .venv/Scripts/python -m uvicorn app.main:create_app --factory --reload`). Without a database, `/health` still works and database endpoints answer 503.

## Endpoints

Every endpoint except `/health` needs `Authorization: Bearer <Supabase access token>`. The user id is read from the verified token's `sub` only, never from the body or the path.

Errors always look like `{"error": {"code", "message"}, "request_id"}`. Validation errors add `error.fields` with field names only; submitted values are never echoed back.

| Status | When |
| --- | --- |
| 401 | Missing, expired or invalid token |
| 403 | Wrong role (for example, a client calling a coach endpoint) |
| 404 | Not found, or not yours. The two answers are deliberately the same. |
| 409 | Not allowed in the current state |
| 413 | Body over 64 KB |
| 422 | Invalid input |
| 429 | Rate limited; see `Retry-After` |
| 503 | Database or storage unavailable |

### `GET /health`

- **Who:** anyone, no login. Used by Render's health check and the keep-warm job.
- **Response:** `{"status": "ok"}`

### `POST /checkins/{id}/submit`

- **Who:** the client who owns the check-in, while its status is `due` or `submitted`.
- **Request:**
  - Optional: `avg_weight_kg` (20–400), `waist_cm` and `hips_cm` (30–300), `energy`, `sleep`, `stress` and `hunger` (1–5), `wins` and `struggles` (≤ 2000 characters), `question` (≤ 1000).
  - `answers`: up to 30 of `{question_id, value_number?, value_text?}`. Only the coach's active questions are accepted.
  - `photos`: up to 3 of `{pose: front|side|back, path}`. Each `path` must come from `/photos/upload-url` and sit in the caller's own folder.
  - Any other field (for example `status` or `client_id`) is rejected.
- **Response:** `{id, status: "submitted", submitted_at}`. `submitted_at` is set by the database the first time.
- **Errors:** 404 if not the caller's check-in; 409 if already reviewed or missed; 422 for a foreign question or photo path.
- **One transaction:** the check-in fields, answers (upsert) and photo records (one per pose).

### `POST /checkins/{id}/review`

- **Who:** a coach, for their own client's check-in, once it's `submitted` (or `reviewed` again).
- **Request:** `{message (1–5000), mark_reviewed = true, targets?}`.
  - `targets` has the same fields as `Targets` in `frontend/src/lib/api.ts`: `calories` (800–8000), `protein_g`, `carbs_g`, `fat_g`, and optional `water_ml`, `steps`, `sleep_h`.
- **Response:** `{next_id}`, the coach's next submitted check-in (oldest first), or `null`.
- **Errors:** 403 if not a coach; 404 if not their client; 409 if not submitted yet.
- **One transaction:**
  1. Sends the message.
  2. Marks the check-in reviewed, if asked.
  3. Adds `nutrition_targets` with `effective_from` = next Monday in the client's timezone. Unchanged targets add no row.
  4. Deletes the review draft.
- **Rate limit:** sends a message, so it's in the stricter `messages` limit.

### `POST /programs/swap`

- **Who:** the coach who owns the client program.
- **Request:** `{template_exercise_id, to_exercise_id, from_week, to_week (1–52), check_in_id?}`.
- **Response:** `{ok: true, swap_id}`.
- **What it does:** stores an override in `exercise_swaps` (migration 0011). `template_exercises` has no week column, so a swap for some weeks only lives there.
- **Errors:** 403 if not a coach; 404 if not their client's program; 422 for weeks outside the program, the same exercise, an unknown exercise, or a check-in from another client.

### `GET /programs/exercise-library`

- **Who:** any signed-in user.
- **Response:** `[{id, name, level, equipment, cue, primary[], secondary[]}]`, the shared exercise library. Cached for 24 hours.

### `POST /photos/upload-url`

- **Who:** any signed-in user, for their own folder.
- **Request:** `{kind: progress|meals, content_type: image/jpeg|image/png|image/webp, size_bytes ≤ 5 MB}`.
- **Response:** `{bucket, path, signed_url, token, expires_in}`.
  - `path` is `<user id>/<kind>/<date>-<random>.<ext>`.
  - Upload with `PUT signed_url`. The link lasts 2 hours.
- **Enforcement:** the buckets themselves (0008) enforce the 5 MB limit and image types, so a link can't be reused for anything else.
- **Errors:** 503 if `SUPABASE_SERVICE_ROLE_KEY` isn't set.

### `GET /coach/invite-code` and `POST /coach/invite-code`

- **Who:** coaches only.
- **GET:** returns `{invite_code}`.
- **POST:** makes a new code like `SIMRAN-7Q4K`; the old one stops working immediately. Rate limited to 5 an hour.
- **Making someone a coach:** a manual SQL step (see docs/schema.md); there's no endpoint for it.

## Which calls go where

- **Direct to Supabase** (one table, as the signed-in user, RLS):
  - **Client:** reading every screen, logging meals (`meal_logs`), habits and the day rating (`daily_logs`), saving the check-in draft (`check_ins`), the body model, and workouts (`workout_sessions`, `set_logs`: start, save each set as it's ticked, finish, discard).
  - **Coach:** the dashboard, check-in lists and review screens; first targets (`nutrition_targets`); review drafts (`review_drafts`); private notes (`set_coach_notes`); a client's logged workouts, read-only (client sheet).
- **Through this API** (several tables at once): submitting a check-in, reviewing one, exercise swaps, photo upload links, invite codes.
- **Coach freshness:**
  - Coach screens refetch every 30 s and when the window regains focus (`COACH_REFRESH` in `frontend/src/lib/api.ts`).
  - This was chosen over Supabase Realtime: the coach views combine several tables, so any change would mean a refetch anyway. Polling needs no publication or extra RLS setup, and 30 s is plenty for coaching.
  - The client app refreshes from its own writes.

## How the backend uses the database

- **Connection:** `DATABASE_URL` is the Supabase pooler in session mode (port 5432), with an asyncpg pool (1–5 connections) opened and closed with the app.
- **Run as the user (the default):**
  - Each request runs in one transaction that does `set local role authenticated` and `set_config('request.jwt.claims', <verified claims>, true)`.
  - `auth.uid()` then returns the caller, and every RLS policy and trigger applies, exactly as with Supabase's own API.
  - The services also check permissions in code: ownership, `is_coach_of`, status and the role from `public.users`. Both layers have to agree.
- **Transactions:** opened inside the endpoint, so the commit finishes before the response is sent.
- **Admin access:** `Database.as_admin(reason=...)` bypasses RLS. No endpoint uses it today. Use it only where RLS can't express the rule (for example a data export), and only after a permission check in code.
- **SQL safety:** parameterised SQL only. Every transaction sets `statement_timeout` (8 s) and `idle_in_transaction_session_timeout` (15 s).

## Security

| Area | What's in place |
| --- | --- |
| Tokens | Signature, expiry, audience `authenticated`, issuer `<SUPABASE_URL>/auth/v1` and `role = authenticated` are all checked. Keys come from the project's JWKS (cached 10 min, refetched for unknown key ids at most every 30 s), falling back to the legacy HS256 secret. The algorithm follows the key type, so HS256/asymmetric confusion and `alg: none` are refused. |
| CORS | Only `ALLOWED_ORIGINS` (exact origins, no wildcards); no cookies. |
| Rate limits | Per user, in memory: writes 30/min, messages 20 per 10 min, upload links 30/min, invite rotation 5/hour. Over the limit returns 429 with `Retry-After`. |
| Headers | `nosniff`, `X-Frame-Options: DENY`, `CSP default-src 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and HSTS in production. |
| Size | Request bodies are limited to 64 KB. |
| API browser | `/docs` and `/openapi.json` are off in production. |
| Logs | Request id, method, route template, status and time only. Never tokens, bodies, query strings or health data. Database errors are logged by SQLSTATE, and crashes by error type and line, because messages and tracebacks can contain user data. |
| Container | Runs as a non-root user, with dependencies pinned exactly. CI runs `pip-audit` and `npm audit`. |

### TODO before real users (PIPEDA / GDPR)

Health data (weights, measurements, photos, injuries, check-in answers) is sensitive personal information.

- [ ] **Account deletion:** delete the auth user, which cascades to every table, plus the user's storage folders in both buckets. Keep a deletion log without health data.
- [ ] **Data export:** produce a JSON and zip of the user's rows and photos, through a short-lived signed link.
- [ ] **Coach deletion:** decide what happens to clients first.
- [ ] **Retention:** a policy for missed check-ins, old photos and messages.
- [ ] **Policy:** a privacy policy, a consent record at sign-up, and a breach-response contact.
- [ ] **Storage region:** confirm the Supabase and Render regions meet client expectations (Canada/EU).

## Caching

`app/core/cache.py` defines a cache interface with a time-to-live per entry, plus an in-memory implementation. Today only the exercise library uses it (24 h). It's shared reference data, identical for every user, under a `shared:` key.

Rules:

- Data that belongs to one user is keyed `user:<id>:…`, and any write by or about that user clears `user:<id>:`.
- Never cache tokens, write responses, or one user's data under a key someone else could read.

Planned expiry times, for when each screen moves to the backend:

| Data | TTL |
| --- | --- |
| Coach dashboard | 5–10 min |
| Progress | 10 min |
| Home | 30–60 s |
| Review data | 1–2 min |
| Signed photo links | 50 min |
| User role | 1–5 min |

The upgrade path is Redis (for example Upstash): implement the same `Cache` protocol, and move the rate limiter there too once the API runs on more than one instance.

## Settings and secrets

| Setting | Where | Notes |
| --- | --- | --- |
| `ENV` | Render | `production` |
| `DATABASE_URL` | Render (secret) | Session pooler URI, port 5432 |
| `SUPABASE_URL` | Render | `https://<ref>.supabase.co` |
| `SUPABASE_JWT_SECRET` | Render (secret, optional) | Legacy HS256 projects only |
| `SUPABASE_SERVICE_ROLE_KEY` | Render (secret) | Photo upload links only. Never in the frontend. |
| `ALLOWED_ORIGINS` | Render | `https://<site>.netlify.app,http://localhost:5173` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` | Netlify | Public values only |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` | GitHub secrets (production environment) | For `supabase db push` |
| `RENDER_DEPLOY_HOOK_URL`, `NETLIFY_BUILD_HOOK_URL` | GitHub secrets | Deploy order |
| `RENDER_API_KEY`, `RENDER_SERVICE_ID` | GitHub secrets (optional) | Wait for Render to go live before Netlify builds |
| `API_URL` | GitHub variable | For keep-warm |

## Deploys

`.github/workflows/db-migrate.yml` runs on every push to `main`, in this order:

1. **Database:** `supabase db push --include-seed`, gated by the GitHub `production` environment (manual approval).
2. **API:** triggers the Render deploy hook, then waits until the deploy is live (when `RENDER_API_KEY` is set).
3. **Site:** triggers the Netlify build hook.

Auto-deploy is off in `render.yaml`. Turn off Netlify's automatic builds too, so neither can race a migration.

Keep migrations backward compatible: the old API version keeps serving for a minute or two after the database changes.

`ci.yml` runs on every pull request:

- **frontend:** typecheck and build;
- **backend:** ruff and unit tests;
- **database:** local Supabase, `supabase db reset`, and the RLS and permission tests;
- **audits:** pip-audit and npm audit.
