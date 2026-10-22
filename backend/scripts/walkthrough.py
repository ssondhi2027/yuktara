"""End-to-end walkthrough against the local stack (no browser).

Runs the launch-to-review flow with real sessions, exactly the calls the
apps make: Supabase Auth (sign-up, Mailpit confirmation, password log-in),
PostgREST as each user (RLS), and the FastAPI backend.

Needs: `npx supabase start` + `npx supabase db reset`, and the API running
on http://127.0.0.1:8000 with SUPABASE_SERVICE_ROLE_KEY set (for photos).

    python scripts/walkthrough.py

Test values only: every account is made up for this run.
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import httpx

SUPABASE = "http://127.0.0.1:54321"
MAILPIT = "http://127.0.0.1:54324"
API = "http://127.0.0.1:8000"
DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
SITE = "http://localhost:5173/login"


def anon_key() -> str:
    # Local dev tool, fixed command, no user input.
    out = subprocess.run("npx supabase status -o json", shell=True, capture_output=True, text=True, cwd="..")  # noqa: S602, S607
    return json.loads(out.stdout[out.stdout.index("{") :])["ANON_KEY"]


ANON = anon_key()
TAG = uuid.uuid4().hex[:6]
PASSWORD = f"Walkthrough-{uuid.uuid4().hex[:10]}"
http = httpx.Client(timeout=20)
step_no = 0


def step(text: str) -> None:
    global step_no
    step_no += 1
    print(f"\n[{step_no}] {text}")


def ok(text: str) -> None:
    print(f"    ok  {text}")


def check(cond: bool, text: str) -> None:
    if not cond:
        print(f"    FAIL {text}")
        sys.exit(1)
    ok(text)


def sql(query: str, *args):
    async def run():
        conn = await asyncpg.connect(DB)
        try:
            return await conn.fetch(query, *args)
        finally:
            await conn.close()

    return asyncio.run(run())


# ---------- Auth, as the app does it ----------


def sign_up(email: str, name: str, invite: str | None = None) -> None:
    r = http.post(
        f"{SUPABASE}/auth/v1/signup",
        params={"redirect_to": SITE},
        headers={"apikey": ANON},
        json={
            "email": email,
            "password": PASSWORD,
            "data": {"full_name": name, "invite_code": invite, "timezone": "UTC"},
        },
    )
    r.raise_for_status()
    check(r.json().get("access_token") is None, f"{email}: no session until the email is confirmed")


def log_in(email: str) -> httpx.Response:
    return http.post(
        f"{SUPABASE}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": ANON},
        json={"email": email, "password": PASSWORD},
    )


def confirm_via_mailpit(email: str) -> None:
    for _ in range(30):
        msgs = http.get(f"{MAILPIT}/api/v1/search", params={"query": f"to:{email}"}).json().get("messages", [])
        if msgs:
            break
        time.sleep(0.5)
    check(bool(msgs), f"{email}: confirmation email arrived in Mailpit")
    body = http.get(f"{MAILPIT}/api/v1/message/{msgs[0]['ID']}").json()["Text"]
    link = re.search(r"https?://\S+/auth/v1/verify\?\S+", body).group(0).rstrip(")")
    r = http.get(link, follow_redirects=False)
    location = r.headers.get("location", "")
    check(
        location.startswith(SITE) and "access_token=" in location,
        "confirm link lands on /login with the session in the URL",
    )


def session(email: str) -> dict:
    r = log_in(email)
    r.raise_for_status()
    s = r.json()
    return {"token": s["access_token"], "id": s["user"]["id"]}


class As:
    """PostgREST and backend calls as one signed-in user."""

    def __init__(self, s: dict):
        self.id = s["id"]
        self.h = {"apikey": ANON, "Authorization": f"Bearer {s['token']}"}

    def get(self, table: str, **params) -> list:
        r = http.get(f"{SUPABASE}/rest/v1/{table}", headers=self.h, params=params)
        r.raise_for_status()
        return r.json()

    def write(self, method: str, table: str, body, prefer: str = "return=representation", **params) -> httpx.Response:
        return http.request(
            method, f"{SUPABASE}/rest/v1/{table}", headers={**self.h, "Prefer": prefer}, params=params, json=body
        )

    def rpc(self, fn: str, body: dict) -> httpx.Response:
        return http.post(f"{SUPABASE}/rest/v1/rpc/{fn}", headers=self.h, json=body)

    def api(self, method: str, path: str, body=None) -> httpx.Response:
        return http.request(method, f"{API}{path}", headers={"Authorization": self.h["Authorization"]}, json=body)


# ---------- Walkthrough ----------

# The test accounts sign up with timezone UTC, and the server's jobs work in each client's timezone,
# so "today" is the UTC date (the local date differs in the evening, west of UTC).
today = sql("select (now() at time zone 'UTC')::date")[0][0]
coach_email = f"coach-{TAG}@example.test"
client_email = f"client-{TAG}@example.test"
other_email = f"other-{TAG}@example.test"
code = f"WALK-{TAG.upper()[:4]}"

step("Coach signs up, confirms the email, and becomes the coach (docs/schema.md SQL)")
sign_up(coach_email, "Walk Coach")
check(log_in(coach_email).status_code == 400, "log in before confirming is refused (email not confirmed)")
confirm_via_mailpit(coach_email)
sql("update public.users set role = 'coach', invite_code = $2 where email = $1", coach_email, code)
sql("delete from public.client_profiles where user_id = (select id from public.users where email = $1)", coach_email)
coach = As(session(coach_email))
check(coach.get("users", select="role", id=f"eq.{coach.id}")[0]["role"] == "coach", "role is coach in public.users")
check(coach.get("client_profiles", select="user_id", coach_id=f"eq.{coach.id}") == [], "coach dashboard starts empty")

step("Client signs up with the invite code, confirms, finishes setup")
sign_up(client_email, "Walk Client", code)
confirm_via_mailpit(client_email)
client = As(session(client_email))
r = client.write(
    "PATCH",
    "client_profiles",
    {
        "goal": "fat_loss",
        "start_date": today.isoformat(),
        "start_weight_kg": 74.6,
        "goal_weight_kg": 68,
        "check_in_day": 0,
        "body_model": "female",
        "experience": "intermediate",
        "training_days": 4,
        "train_location": "gym",
        "diet": "none",
        "meals_per_day": 3,
        "cleared_to_exercise": True,
        "setup_completed_at": f"{today.isoformat()}T12:00:00Z",
    },
    user_id=f"eq.{client.id}",
    select="user_id",
)  # the app names its columns: coach_notes is private
check(r.status_code == 200 and len(r.json()) == 1, "setup answers saved to the client's own client_profiles row")
p = client.get("client_profiles", select="coach_id,start_date", user_id=f"eq.{client.id}")[0]
check(p["coach_id"] == coach.id, "invite code linked the client to the coach")
check(p["start_date"] == today.isoformat(), "day 1 = today")
check(client.get("nutrition_targets", select="id") == [], "no targets yet (app shows 'waiting for your coach')")
check(client.get("check_ins", select="id") == [], "no check-in yet (first one waits for 3 days in the program)")

step("Coach sees the new client straight away and sets first targets")
rows = coach.get("client_profiles", select="user_id,goal,training_days,setup_completed_at", coach_id=f"eq.{coach.id}")
check([x["user_id"] for x in rows] == [client.id], "new client listed from client_profiles")
check(rows[0]["training_days"] == 4, "coach can read the setup answers")
check(
    any(s["client_id"] == client.id for s in coach.get("weekly_summaries", select="client_id")),
    "weekly_summaries refreshed on Finish setup",
)
r = coach.write(
    "POST",
    "nutrition_targets",
    {
        "client_id": client.id,
        "effective_from": today.isoformat(),
        "calories": 2100,
        "protein_g": 140,
        "carbs_g": 210,
        "fat_g": 70,
        "water_ml": 2500,
        "steps": 9000,
        "sleep_hours": 7.5,
        "set_by": coach.id,
    },
    prefer="resolution=merge-duplicates,return=representation",
    on_conflict="client_id,effective_from",
)
check(r.status_code in (200, 201), "coach saved targets")
check(client.get("nutrition_targets", select="calories")[0]["calories"] == 2100, "client sees 2100 kcal")
r = client.write(
    "POST",
    "nutrition_targets",
    {
        "client_id": client.id,
        "effective_from": today.isoformat(),
        "calories": 4000,
        "protein_g": 1,
        "carbs_g": 1,
        "fat_g": 1,
        "set_by": client.id,
    },
    prefer="resolution=merge-duplicates",
    on_conflict="client_id,effective_from",
)
check(r.status_code in (401, 403), "client can't write their own targets")

step("Client logs a meal, steps, water, sleep and weight; coach sees them")
r = client.write(
    "POST",
    "meal_logs",
    {
        "client_id": client.id,
        "meal_type": "lunch",
        "title": "Chicken rice bowl",
        "calories": 610,
        "protein_g": 48,
        "carbs_g": 72,
        "fat_g": 14,
        "on_plan": "yes",
    },
)
check(r.status_code == 201, "meal logged")
r = client.write(
    "POST",
    "daily_logs",
    {
        "client_id": client.id,
        "log_date": today.isoformat(),
        "steps": 6420,
        "water_ml": 1500,
        "sleep_hours": 7.2,
        "weight_kg": 74.1,
        "day_rating": "yes",
    },
    prefer="resolution=merge-duplicates,return=representation",
    on_conflict="client_id,log_date",
)
check(r.status_code in (200, 201), "steps, water, sleep, weight and day rating logged")
check(len(coach.get("meal_logs", select="title", client_id=f"eq.{client.id}")) == 1, "coach sees the meal")
d = coach.get("daily_logs", select="steps,weight_kg", client_id=f"eq.{client.id}")[0]
check(d["steps"] == 6420 and float(d["weight_kg"]) == 74.1, "coach sees steps and weight")

step("Units: new accounts start in lb; each user switches kg/lb on their own row; weights stay in kg")
check(
    client.get("users", select="unit_system", id=f"eq.{client.id}")[0]["unit_system"] == "imperial"
    and coach.get("users", select="unit_system", id=f"eq.{coach.id}")[0]["unit_system"] == "imperial",
    "client and coach start in pounds",
)
r = client.write("PATCH", "users", {"unit_system": "metric"}, id=f"eq.{client.id}")
check(r.status_code == 200 and r.json()[0]["unit_system"] == "metric", "client switches to kg (the avatar menu)")
r = client.write("PATCH", "users", {"unit_system": "imperial"}, id=f"eq.{client.id}")
check(r.status_code == 200 and r.json()[0]["unit_system"] == "imperial", "and back to lb")
r = client.write("PATCH", "users", {"unit_system": "metric"}, id=f"eq.{coach.id}")
check(r.status_code == 200 and r.json() == [], "client can't change the coach's setting")
# The app converts 160.0 lb to kg with two decimals (lib/units.ts kgFromInput) and stores that.
r = client.write(
    "POST",
    "daily_logs",
    {"client_id": client.id, "log_date": str(today), "weight_kg": 72.57},
    prefer="resolution=merge-duplicates,return=representation",
    on_conflict="client_id,log_date",
)
stored = float(r.json()[0]["weight_kg"])
check(
    stored == 72.57 and round(stored / 0.45359237, 1) == 160.0,
    "160.0 lb is stored as 72.57 kg and reads back as 160.0 lb",
)

step("Coach pages: status, targets from next Monday, a check-in question, a new invite code; the client's Profile")
# Clients page: pause and reactivate; the coach can't touch the client's own answers.
for status in ("paused", "active"):
    r = coach.write("PATCH", "client_profiles", {"status": status}, user_id=f"eq.{client.id}", select="user_id,status")
    check(r.status_code == 200 and r.json()[0]["status"] == status, f"coach sets the client {status}")
r = coach.write("PATCH", "client_profiles", {"diet": "vegan"}, user_id=f"eq.{client.id}", select="user_id")
check(r.status_code >= 400, "coach can't change the client's own answers")

# Nutrition plans: targets that start next Monday.
upcoming_monday = today + timedelta(days=7 - today.weekday())
r = coach.write(
    "POST",
    "nutrition_targets",
    {
        "client_id": client.id,
        "effective_from": str(upcoming_monday),
        "calories": 1950,
        "protein_g": 150,
        "carbs_g": 190,
        "fat_g": 65,
        "set_by": coach.id,
    },
    prefer="resolution=merge-duplicates,return=representation",
    on_conflict="client_id,effective_from",
)
check(r.status_code in (200, 201), f"coach sets targets from Monday {upcoming_monday}")

# Settings: a check-in question, then a new invite code (the old one stops working).
r = coach.write(
    "POST",
    "checkin_questions",
    {"coach_id": coach.id, "prompt": "How many workouts felt hard this week?", "answer_type": "number", "position": 0},
)
check(r.status_code == 201, "coach adds a check-in question")
question_id = r.json()[0]["id"]
r = coach.api("POST", "/coach/invite-code", {})
check(
    r.status_code == 200 and r.json()["invite_code"] != code,
    f"coach rotates the invite code ({code} -> {r.json()['invite_code']})",
)
check(not client.rpc("invite_code_valid", {"code": code}).json(), "the old code no longer works")
check(client.rpc("invite_code_valid", {"code": r.json()["invite_code"]}).json(), "the new one does")
code = r.json()["invite_code"]

# Client: the Food tab's upcoming targets, the new question, and their own Profile page.
nxt = client.get(
    "nutrition_targets",
    select="calories,effective_from",
    client_id=f"eq.{client.id}",
    effective_from=f"gt.{today}",
    order="effective_from",
    limit="1",
)
check(nxt == [{"calories": 1950, "effective_from": str(upcoming_monday)}], "client sees the targets that start Monday")
asked = client.get("checkin_questions", select="id,prompt,answer_type", is_active="eq.true", order="position")
check(any(q["id"] == question_id for q in asked), "client's check-in gets the new question")
r = client.write(
    "PATCH",
    "client_profiles",
    {"diet": "vegetarian", "meals_per_day": 4, "training_days": 5, "injuries": "Sore left knee", "height_cm": 168.5},
    user_id=f"eq.{client.id}",
    select="diet,meals_per_day,training_days",
)
check(r.status_code == 200 and r.json()[0]["diet"] == "vegetarian", "client edits their own profile answers")
r = client.write("PATCH", "users", {"full_name": "Client Renamed"}, id=f"eq.{client.id}")
check(r.status_code == 200, "client changes their name")
for change in ({"status": "paused"}, {"check_in_day": 4}):
    r = client.write("PATCH", "client_profiles", change, user_id=f"eq.{client.id}", select="user_id")
    check(r.status_code >= 400, f"client can't change {next(iter(change))}")

step("Check-in opens on the check-in day, client submits it with a photo")
# Pretend the client started 10 days ago and today is their check-in day, then run the hourly job.
dow = (today.isoweekday()) % 7
sql(
    "update public.client_profiles set start_date = current_date - 10, check_in_day = $2 where user_id = $1",
    uuid.UUID(client.id),
    dow,
)
sql("select public.roll_check_ins()")
open_ci = client.get("check_ins", select="id,week_start,status", status="eq.due")
check(len(open_ci) == 1, f"check-in opened for the week of {open_ci[0]['week_start'] if open_ci else '?'}")
ci = open_ci[0]["id"]
up = client.api("POST", "/photos/upload-url", {"kind": "progress", "content_type": "image/jpeg", "size_bytes": 200})
check(up.status_code == 200, "backend signed a photo upload link")
put = http.put(up.json()["signed_url"], content=b"\xff\xd8\xff\xe0walkthrough", headers={"content-type": "image/jpeg"})
check(put.status_code == 200, "photo uploaded to the client's own folder")
r = client.api(
    "POST",
    f"/checkins/{ci}/submit",
    {
        "avg_weight_kg": 74.1,
        "waist_cm": 80,
        "energy": 4,
        "sleep": 3,
        "stress": 2,
        "hunger": 3,
        "wins": "Logged every meal",
        "struggles": "Late nights",
        "question": "Can I swap RDLs for hip thrusts?",
        "answers": [{"question_id": question_id, "value_number": 2}],
        "photos": [{"pose": "front", "path": up.json()["path"]}],
    },
)
check(r.status_code == 200 and r.json()["status"] == "submitted", "check-in submitted")
answer = coach.get(
    "checkin_answers",
    select="value_number,checkin_questions(prompt)",
    check_in_id=f"eq.{ci}",
    question_id=f"eq.{question_id}",
)
check(answer and float(answer[0]["value_number"]) == 2, "the coach reads the answer to the new question")

step("It appears in the coach's review queue; coach reviews with a message and new targets")
queue = coach.get("check_ins", select="id,client_id", status="eq.submitted")
check(any(q["id"] == ci for q in queue), "in the review queue")
photos = coach.get("progress_photos", select="photo_url", check_in_id=f"eq.{ci}")
signed = http.post(
    f"{SUPABASE}/storage/v1/object/sign/progress-photos/{photos[0]['photo_url']}",
    headers=coach.h,
    json={"expiresIn": 3600},
)
check(signed.status_code == 200, "coach can open the client's photo (signed URL)")
r = coach.api(
    "POST",
    f"/checkins/{ci}/review",
    {
        "message": "Great first week. Yes to hip thrusts.",
        "mark_reviewed": True,
        "targets": {
            "calories": 2000,
            "protein_g": 145,
            "carbs_g": 190,
            "fat_g": 65,
            "water_ml": 2500,
            "steps": 10000,
            "sleep_h": 7.5,
        },
    },
)
check(r.status_code == 200, "review sent")
check(client.get("check_ins", select="status", id=f"eq.{ci}")[0]["status"] == "reviewed", "check-in marked reviewed")
msg = client.get("messages", select="body,sender_id", client_id=f"eq.{client.id}")
check(
    any(m["body"].startswith("Great first week") and m["sender_id"] == coach.id for m in msg),
    "client sees the feedback",
)
next_monday = today + timedelta(days=7 - today.weekday())
targets = client.get("nutrition_targets", select="effective_from,calories", order="effective_from")
check(
    targets[-1] == {"effective_from": next_monday.isoformat(), "calories": 2000},
    f"new targets start Monday {next_monday}",
)

step("Coach generates a program from the client's answers, edits it, assigns it; client logs today's workout")
names = ["Back squat", "Goblet squat", "Romanian deadlift", "Push-up", "Lat pulldown"]
ex = {
    r["name"]: r["id"]
    for r in client.get("exercises", select="id,name", name="in.(" + ",".join(f'"{n}"' for n in names) + ")")
}
check(len(ex) == len(names), "client sees the shared exercise library")
dow = today.isoweekday() % 7  # Postgres numbering, Sunday = 0
monday = (today - timedelta(days=today.weekday())).isoformat()

# The builder's "Create program": the same generator (frontend/src/lib/programGen.ts), run with Node.
answers = coach.get(
    "client_profiles", select="goal,experience,training_days,train_location", user_id=f"eq.{client.id}"
)[0]
library = [
    {
        "id": r["id"],
        "name": r["name"],
        "level": r["level"],
        "equipment": r["equipment"] or "",
        "primary": [m["muscle"] for m in r["exercise_muscles"] if m["role"] == "primary"],
        "secondary": [m["muscle"] for m in r["exercise_muscles"] if m["role"] == "secondary"],
    }
    for r in coach.get("exercises", select="id,name,level,equipment,exercise_muscles(muscle,role)")
]
# Local dev tool, fixed command, no user input.
gen = json.loads(
    subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "scripts/generate-program.mts"],  # noqa: S607
        input=json.dumps({"input": answers, "library": library}),
        capture_output=True,
        text=True,
        cwd="../frontend",
        check=True,
    ).stdout
)
library_ids = {e["id"] for e in library}
check(
    len(gen["workouts"]) == answers["training_days"]
    and all(x["exercise_id"] in library_ids for w in gen["workouts"] for x in w["exercises"]),
    f'generated "{gen["name"]}" from {answers["goal"]}, {answers["experience"]}, {answers["training_days"]} days, '
    f"{answers['train_location']} ({sum(len(w['exercises']) for w in gen['workouts'])} library exercises)",
)
lower = next(w for w in gen["workouts"] if w["name"] == "Lower A")
lower["day_of_week"] = dow  # the coach moves Lower A to today
lower["exercises"][1].update(sets=2, reps="10", rpe=7, notes="Keep the RDLs light.")  # and edits one exercise
body = {
    "client_id": client.id,
    "name": gen["name"],
    "weeks": gen["weeks"],
    "goal": gen["goal"],
    "level": gen["level"],
    "days_per_week": gen["days_per_week"],
    "draft_start": str(today),
    "workouts": [
        {
            "name": w["name"],
            "day_of_week": w["day_of_week"],
            "notes": w["notes"],
            "exercises": [
                {
                    "exercise_id": x["exercise_id"],
                    "target_sets": x["sets"],
                    "target_reps": x["reps"],
                    "target_rpe": x["rpe"],
                    "rest_seconds": x["rest_seconds"],
                    "notes": x["notes"],
                }
                for x in w["exercises"]
            ],
        }
        for w in gen["workouts"]
    ],
}
r = coach.rpc("save_program", {"p": body})
check(r.status_code == 200, "coach saves the draft (save_program)")
program_id = r.json()
check(client.get("programs", select="id", id=f"eq.{program_id}") == [], "the client can't see the draft")
r = coach.rpc("assign_program", {"program": program_id, "start": str(today)})
check(r.status_code in (200, 204), "coach assigns it from today")

# The client's Train tab: latest started program, removed workouts and exercises left out (as lib/live/client.ts).
plan = client.get(
    "programs",
    select="id,name,workout_templates(id,name,day_of_week,template_exercises(id,exercise_id,position,target_sets,"
    "target_reps,target_rpe,notes))",
    client_id=f"eq.{client.id}",
    start_date=f"lte.{today}",
    order="start_date.desc",
    limit="1",
    **{"workout_templates.removed_at": "is.null", "workout_templates.template_exercises.removed_at": "is.null"},
)
check(plan and plan[0]["id"] == program_id, f'client\'s current program is "{plan[0]["name"]}"')
template = next(w for w in plan[0]["workout_templates"] if w["day_of_week"] == dow and w["name"] == "Lower A")
slots = sorted(template["template_exercises"], key=lambda x: x["position"])
check(
    slots[0]["exercise_id"] == ex["Back squat"]
    and slots[1]["exercise_id"] == ex["Romanian deadlift"]
    and slots[1]["target_sets"] == 2
    and slots[1]["notes"] == "Keep the RDLs light.",
    "client sees today's workout (Lower A: back squat, then the edited RDL, 2 x 10)",
)
squat_slot, rdl_slot = slots[0]["id"], slots[1]["id"]


def start_session(template_id: str | None) -> httpx.Response:
    return client.write(
        "POST",
        "workout_sessions",
        {
            "client_id": client.id,
            "workout_template_id": template_id,
            "performed_on": str(today),
            "started_at": f"{today}T17:00:00Z",
            "finished_at": None,
            "status": "partial",
        },
    )


def tick(
    session_id: str, exercise: str, n: int, reps: int, kg: float | None, rpe: float | None, slot=None, warmup=False
) -> None:
    r = client.write(
        "POST",
        "set_logs",
        {
            "session_id": session_id,
            "exercise_id": ex[exercise],
            "template_exercise_id": slot,
            "set_number": n,
            "reps": reps,
            "weight_kg": kg,
            "rpe": rpe,
            "is_warmup": warmup,
        },
        prefer="resolution=merge-duplicates,return=minimal",
        on_conflict="session_id,exercise_id,set_number",
    )
    kind = "warm-up" if warmup else "set"
    check(r.status_code in (200, 201), f"{kind} saved as it's ticked: {exercise} #{n} {reps} reps @ {kg} kg, RPE {rpe}")


planned = start_session(template["id"]).json()[0]["id"]
check(start_session(None).status_code == 409, "only one open workout at a time (a second start is refused)")
tick(planned, "Goblet squat", 1, 10, 24, 7.5, slot=squat_slot)  # swapped for back squat, this session only
tick(planned, "Goblet squat", 2, 10, 24, 8, slot=squat_slot)
tick(planned, "Goblet squat", 2, 9, 24, 8.5, slot=squat_slot)  # edited after ticking
tick(planned, "Romanian deadlift", 1, 10, 50, 7, slot=rdl_slot)
sets_now = {
    r["muscle"]: r["hard_sets"]
    for r in client.rpc("muscle_sets_for_week", {"client": client.id, "week_start": monday}).json()
}
check(
    sets_now.get("quads", 0) >= 2, f"body map counts the sets while the workout is open (quads {sets_now.get('quads')})"
)
tick(planned, "Goblet squat", 3, 8, 12, None, slot=squat_slot, warmup=True)  # marked W in the logger
warm = {
    r["muscle"]: r["hard_sets"]
    for r in client.rpc("muscle_sets_for_week", {"client": client.id, "week_start": monday}).json()
}
check(warm.get("quads") == sets_now.get("quads"), "a warm-up set is saved but left out of the body map count")
check(
    client.get("set_logs", select="is_warmup", session_id=f"eq.{planned}", set_number="eq.3")[0]["is_warmup"] is True,
    "the warm-up flag is stored on the set",
)
r = client.write(
    "PATCH",
    "workout_sessions",
    {
        "finished_at": f"{today}T17:45:00Z",
        "duration_min": 45,
        "status": "done",
        "notes": "Goblet squats today, gym was busy",
        "effort": 7,
    },
    id=f"eq.{planned}",
)
check(
    r.status_code == 200 and r.json()[0]["status"] == "done" and r.json()[0]["effort"] == 7,
    "Finish workout sets finished_at, duration, status and effort",
)
check(
    client.get("template_exercises", select="exercise_id", id=f"eq.{squat_slot}")[0]["exercise_id"] == ex["Back squat"],
    "the swap didn't change the coach's program",
)

own = start_session(None).json()[0]["id"]
tick(own, "Push-up", 1, 15, None, None)  # bodyweight: no weight
tick(own, "Push-up", 2, 12, None, 9)
tick(own, "Lat pulldown", 1, 10, 40, 8)
r = client.write(
    "PATCH",
    "workout_sessions",
    {"finished_at": f"{today}T19:20:00Z", "duration_min": 20, "status": "done"},
    id=f"eq.{own}",
)
check(r.status_code == 200, "client finishes an extra workout of their own")

# The app's (lib/live/shared.ts SESSION_SUMMARY_COLS).
SESSION_SUMMARY_COLS = (
    "id, performed_on, finished_at, duration_min, notes, effort, status, workout_templates(name), set_logs(set_number,"
    " reps, weight_kg, rpe, is_warmup, drop_of, duration_s, distance_m, level, avg_hr, exercise_id,"
    " exercises(name, kind, exercise_muscles(muscle, role)), template_exercises(superset_group))"
).replace(" ", "")
seen = coach.get(
    "workout_sessions", select=SESSION_SUMMARY_COLS, client_id=f"eq.{client.id}", order="performed_on.desc"
)
check(len(seen) == 2 and all(x["finished_at"] for x in seen), "coach sees both sessions")
coach_planned = next(x for x in seen if x["id"] == planned)
check(
    coach_planned["workout_templates"]["name"] == "Lower A"
    and {x["exercises"]["name"] for x in coach_planned["set_logs"]} == {"Goblet squat", "Romanian deadlift"}
    and any(x["rpe"] == 8.5 for x in coach_planned["set_logs"]),
    "coach sees the planned session with the swap and the RPE",
)
check(
    next(x for x in seen if x["id"] == own)["workout_templates"] is None,
    "coach sees the own workout (no template)",
)
r = coach.write("PATCH", "set_logs", {"reps": 1}, session_id=f"eq.{planned}")
check(r.status_code == 200 and r.json() == [], "coach can't change the client's sets (0 rows)")
r = coach.write("POST", "workout_sessions", {"client_id": client.id, "performed_on": str(today)})
check(r.status_code >= 400, "coach can't log a workout for the client")
done_this_week = coach.get(
    "workout_sessions", select="status", client_id=f"eq.{client.id}", performed_on=f"gte.{monday}", status="eq.done"
)
check(len(done_this_week) == 2, "dashboard's 'done this week' count comes from the real logs")
r = coach.rpc("copy_program", {"source": program_id, "client": None})
check(r.status_code == 200, "coach saves the program as a template")
tpl = coach.get("programs", select="id,is_template,client_id,goal,workout_templates(count)", id=f"eq.{r.json()}")[0]
check(
    tpl["is_template"] and tpl["client_id"] is None and tpl["workout_templates"][0]["count"] == len(gen["workouts"]),
    f"the template has all {len(gen['workouts'])} workouts and the goal ({tpl['goal']})",
)
check(client.get("programs", select="id", id=f"eq.{tpl['id']}") == [], "the client can't see the coach's templates")

step("Client and coach message each other; unread counts and read state; feedback is in the same thread")
MESSAGE_COLS = "id,body,created_at,sender_id,check_in_id,read_at,check_ins(week_start)"


def unread(who: As) -> int:
    return who.rpc("unread_message_count", {}).json()


check(unread(client) >= 1, "client has the check-in feedback unread")
r = client.write(
    "POST",
    "messages",
    {"client_id": client.id, "sender_id": client.id, "body": "Thanks! Can I swap the Friday session?"},
)
check(r.status_code == 201, "client sends a message to their coach")
check(unread(coach) == 1, "coach sees it unread (badge 1)")
threads = coach.rpc("message_threads", {}).json()
row = next(t for t in threads if t["client_id"] == client.id)
check(
    row["unread"] == 1 and row["last_body"].startswith("Thanks!"),
    "coach's conversation list shows the preview and 1 unread",
)
r = coach.write(
    "PATCH",
    "messages",
    {"read_at": datetime.now(UTC).isoformat()},
    client_id=f"eq.{client.id}",
    sender_id=f"eq.{client.id}",
    read_at="is.null",
)
check(r.status_code == 200 and len(r.json()) == 1, "opening the thread marks the client's message read")
check(unread(coach) == 0, "coach's unread count is back to 0")
r = coach.write("POST", "messages", {"client_id": client.id, "sender_id": coach.id, "body": "Yes, Saturday works too."})
check(r.status_code == 201, "coach replies")
thread = client.get("messages", select=MESSAGE_COLS, client_id=f"eq.{client.id}", order="created_at")
bodies = [m["body"] for m in thread]
feedback = [m for m in thread if m["check_in_id"] == ci]
check(
    len(feedback) == 1 and feedback[0]["check_ins"]["week_start"] and bodies[-1] == "Yes, Saturday works too.",
    f"client's thread has the check-in feedback (week of {feedback[0]['check_ins']['week_start']}) and the reply",
)
check(unread(client) >= 1, "client sees the reply unread")
r = client.write(
    "PATCH",
    "messages",
    {"read_at": datetime.now(UTC).isoformat()},
    client_id=f"eq.{client.id}",
    sender_id=f"neq.{client.id}",
    read_at="is.null",
)
check(r.status_code == 200 and unread(client) == 0, "client opens the thread and it's marked read")
r = client.write(
    "POST", "messages", {"client_id": client.id, "sender_id": coach.id, "body": "Pretending to be the coach"}
)
check(r.status_code >= 400, "client can't send as the coach")
r = client.write("PATCH", "messages", {"body": "Edited"}, client_id=f"eq.{client.id}")
check(r.status_code >= 400, "nobody can edit a message")
statuses = [
    client.write("POST", "messages", {"client_id": client.id, "sender_id": client.id, "body": f"Spam {n}"}).status_code
    for n in range(12)
]
check(429 in statuses, f"sending is rate-limited (HTTP 429 after {statuses.index(429)} quick messages)")

step("A second client (no invite code) can't see the first client; clients can't use coach endpoints")
sign_up(other_email, "Other Client")
confirm_via_mailpit(other_email)
other = As(session(other_email))
check(other.get("client_profiles", select="user_id,coach_id")[0]["coach_id"] is None, "no coach linked without a code")
for table in (
    "client_profiles",
    "meal_logs",
    "daily_logs",
    "check_ins",
    "messages",
    "nutrition_targets",
    "workout_sessions",
):
    rows = other.get(
        table,
        select="client_id" if table != "client_profiles" else "user_id",
        **({"client_id": f"eq.{client.id}"} if table != "client_profiles" else {"user_id": f"eq.{client.id}"}),
    )
    check(rows == [], f"other client sees none of the first client's {table}")
check(other.api("GET", "/coach/invite-code").status_code == 403, "client is refused coach endpoints (403)")
r = other.write("PATCH", "users", {"role": "coach"}, id=f"eq.{other.id}")
check(r.status_code >= 400, "client can't make themselves a coach")
check(
    other.get("set_logs", select="id", session_id=f"eq.{planned}") == [],
    "other client sees none of the first client's set_logs",
)
check(
    coach.get("client_profiles", select="user_id", user_id=f"eq.{other.id}") == [],
    "the coach doesn't see the other client",
)

step("Phone for the coach, the coach's own exercise, a skipped workout, profile pictures, foods in a meal")
# Phone: the client changes it on their Profile; the coach sees it with the setup answers.
# As the Profile page does: no row back (coach_notes isn't readable by clients).
r = client.write(
    "PATCH", "client_profiles", {"phone": "+1 555 0100"}, prefer="return=minimal", user_id=f"eq.{client.id}"
)
check(r.status_code == 204, "client saves a phone number on their Profile")
check(
    coach.get("client_profiles", select="phone", user_id=f"eq.{client.id}")[0]["phone"] == "+1 555 0100",
    "coach sees the phone number",
)

# The coach's own exercise: saved with its muscles in one call; their client sees it, others don't.
r = coach.rpc(
    "save_exercise",
    {
        "e": {
            "name": f"Belt squat {TAG}",
            "level": "beginner",
            "equipment": "machine",
            "primary": ["quads"],
            "secondary": ["glutes"],
        }
    },
)
check(r.status_code == 200, "coach adds their own exercise (save_exercise)")
custom = r.json()
lib = client.get("exercises", select="id,name,created_by,exercise_muscles(muscle,role)", id=f"eq.{custom}")
check(
    len(lib) == 1 and lib[0]["created_by"] == coach.id and len(lib[0]["exercise_muscles"]) == 2,
    "the client's exercise library includes it, with its muscles",
)
check(other.get("exercises", select="id", id=f"eq.{custom}") == [], "another coach's client doesn't see it")
r = client.rpc("save_exercise", {"e": {"name": f"Mine {TAG}", "primary": ["quads"]}})
check(r.status_code >= 400, "clients can't add exercises")
r = coach.write("DELETE", "exercises", None, id=f"eq.{custom}")
check(
    r.status_code in (200, 204) and coach.get("exercises", select="id", id=f"eq.{custom}") == [],
    "coach deletes an unused one",
)

# A skipped workout: no sets, a reason the coach sees, undone by deleting it.
r = client.write(
    "POST",
    "workout_sessions",
    {
        "client_id": client.id,
        "workout_template_id": template["id"],
        "performed_on": str(today + timedelta(days=1)),
        "started_at": None,
        "finished_at": f"{today}T20:00:00Z",
        "duration_min": None,
        "status": "skipped",
        "notes": "Travel",
    },
)
check(r.status_code == 201, "client skips tomorrow's workout with a reason")
skip = r.json()[0]["id"]
seen = coach.get("workout_sessions", select="status,notes", id=f"eq.{skip}")
check(seen == [{"status": "skipped", "notes": "Travel"}], "coach sees the skip and why")
r = client.write(
    "POST",
    "set_logs",
    {"session_id": skip, "exercise_id": ex["Back squat"], "set_number": 1, "reps": 5, "weight_kg": 60},
)
check(r.status_code >= 400, "no sets can be logged in a skipped workout")
r = client.write("DELETE", "workout_sessions", None, id=f"eq.{skip}")
check(r.status_code in (200, 204), "client undoes the skip")

# Profile pictures: upload link from the API, the file in the user's own folder, signed URLs for the coach only.
up = coach.api("POST", "/photos/upload-url", {"kind": "avatar", "content_type": "image/jpeg", "size_bytes": 200})
check(up.status_code == 200 and up.json()["bucket"] == "avatars", "backend signs an upload link for a profile photo")
put = http.put(up.json()["signed_url"], content=b"\xff\xd8\xff\xe0avatar", headers={"content-type": "image/jpeg"})
check(put.status_code == 200, "photo uploaded to the coach's own avatar folder")
avatar = up.json()["path"]
r = coach.write("PATCH", "users", {"avatar_url": avatar}, id=f"eq.{coach.id}")
check(r.status_code == 200, "coach's profile points at the new photo")
r = client.write("PATCH", "users", {"avatar_url": f"{coach.id}/avatar/x.jpg"}, id=f"eq.{client.id}")
check(r.status_code >= 400, "a profile can't point at someone else's photo")
rows = client.get("users", select="id,avatar_url", avatar_url="not.is.null")
check([x["id"] for x in rows] == [coach.id], "the client sees their coach's photo path")


def sign(who, path):
    return http.post(
        f"{SUPABASE}/storage/v1/object/sign/avatars/{path}", headers=who.h, json={"expiresIn": 60}
    ).status_code


check(sign(client, avatar) == 200, "the client gets a signed link to the coach's photo")
check(sign(other, avatar) >= 400, "another coach's client can't")

# Foods in a meal: the client lists them; the coach reads them but can't add any.
r = client.write(
    "POST",
    "meal_logs",
    {"client_id": client.id, "meal_type": "dinner", "title": "Rice, chicken", "calories": 508, "protein_g": 51.9},
)
meal_id = r.json()[0]["id"]
items = [
    {
        "meal_log_id": meal_id,
        "food_name": "Rice, cooked",
        "quantity": 200,
        "unit": "g",
        "calories": 260,
        "protein_g": 5.4,
    },
    {
        "meal_log_id": meal_id,
        "food_name": "Chicken breast",
        "quantity": 150,
        "unit": "g",
        "calories": 248,
        "protein_g": 46.5,
    },
]
check(client.write("POST", "meal_items", items).status_code == 201, "client saves the foods in a meal")
check(len(coach.get("meal_items", select="food_name", meal_log_id=f"eq.{meal_id}")) == 2, "coach reads them")
r = coach.write("POST", "meal_items", {**items[0], "food_name": "Coach adds"})
check(r.status_code >= 400, "coach can't add foods to a client's meal")
check(other.get("meal_items", select="id", meal_log_id=f"eq.{meal_id}") == [], "another client sees none")
r = client.write("POST", "meal_items", {**items[0], "unit": "kg"})
check(r.status_code >= 400, "units outside the list are refused")

step(
    "Meal plans: the coach plans the client's meals; the client logs as planned and something else; the coach compares"
)
FOOD_COLS = "id,name,basis,kcal,protein_g,carbs_g,fat_g,servings,created_by"
foods = {f["name"]: f for f in client.get("foods", select=FOOD_COLS, created_by="is.null")}
check(len(foods) >= 40 and "Roti (chapati)" in foods, f"the client sees the shared food list ({len(foods)} foods)")
r = coach.write(
    "POST",
    "foods",
    {
        "name": f"Coach's protein oats {TAG}",
        "basis": "g",
        "kcal": 390,
        "protein_g": 25,
        "carbs_g": 55,
        "fat_g": 7,
        "servings": [{"name": "1 pot", "amount": 80}],
        "created_by": coach.id,
    },
)
check(r.status_code == 201, "coach adds a food of their own (per 100 g, with a serving)")
own_food = r.json()[0]["id"]
check(client.get("foods", select="id", id=f"eq.{own_food}") != [], "their client sees it")
check(other.get("foods", select="id", id=f"eq.{own_food}") == [], "another coach's client doesn't")


def plan_item(name, meal, qty, unit="g", serving=None, food_id=None):
    return {
        "day_type": "every",
        "meal_type": meal,
        "position": 0,
        "food_id": food_id or foods[name]["id"],
        "quantity": qty,
        "unit": unit,
        "serving": serving,
    }


plan_body = {
    "client_id": client.id,
    "effective_from": str(today),
    "name": "Walkthrough plan",
    "split": False,
    "notes": {"every:lunch": "Or swap rice for quinoa."},
    "items": [
        plan_item(None, "breakfast", 1, "serving", "1 pot", food_id=own_food),
        plan_item("Banana", "breakfast", 1, "serving", "1 medium"),
        plan_item("Chicken breast, grilled", "lunch", 150),
        plan_item("Rice, white, cooked", "lunch", 1, "serving", "1 cup"),
    ],
}
r = coach.rpc("save_meal_plan", {"p": plan_body})
check(r.status_code == 200, "coach saves a meal plan for the client, starting today")
plan_id = r.json()
check(other.get("meal_plans", select="id", id=f"eq.{plan_id}") == [], "another client can't see it")
r = client.write("PATCH", "meal_plans", {"name": "Mine now"}, id=f"eq.{plan_id}")
check(
    r.status_code == 200 and r.json() == [],  # RLS: no row to update
    "the client can't change their plan",
)
check(
    coach.get("meal_plans", select="name", id=f"eq.{plan_id}")[0]["name"] == "Walkthrough plan",
    "the plan is unchanged",
)

PLAN_COLS = (
    "id,client_id,name,effective_from,split,notes,"
    f"meal_plan_items(day_type,meal_type,position,quantity,unit,serving,foods({FOOD_COLS}))"
)
mine = client.get(
    "meal_plans",
    select=PLAN_COLS,
    client_id=f"eq.{client.id}",
    effective_from=f"lte.{today}",
    order="effective_from.desc",
    limit="1",
)
check(
    len(mine) == 1 and len(mine[0]["meal_plan_items"]) == 4 and all(i["foods"] for i in mine[0]["meal_plan_items"]),
    "the client's Food page reads today's plan with every food (including the coach's own)",
)
check(mine[0]["notes"] == {"every:lunch": "Or swap rice for quinoa."}, "and the coach's note for lunch")

# "Log as planned": the planned lunch, then the client changes the rice amount before saving.
chicken, rice = foods["Chicken breast, grilled"], foods["Rice, white, cooked"]


def per(food, grams):
    k = grams / 100
    return {
        "calories": round(float(food["kcal"]) * k),
        "protein_g": round(float(food["protein_g"]) * k, 1),
        "carbs_g": round(float(food["carbs_g"]) * k, 1),
        "fat_g": round(float(food["fat_g"]) * k, 1),
    }


lunch_items = [
    {
        "food_id": chicken["id"],
        "food_name": chicken["name"],
        "quantity": 150,
        "unit": "g",
        "serving": None,
        **per(chicken, 150),
    },
    {
        "food_id": rice["id"],
        "food_name": rice["name"],
        "quantity": 1,
        "unit": "serving",
        "serving": "1 cup",
        **per(rice, 158),
    },
]
totals = {k: sum(i[k] for i in lunch_items) for k in ("calories", "protein_g", "carbs_g", "fat_g")}
r = client.write(
    "POST",
    "meal_logs",
    {
        "client_id": client.id,
        "meal_type": "lunch",
        "title": "Chicken breast, grilled and Rice, white, cooked",
        "on_plan": "yes",
        **totals,
    },
)
lunch = r.json()[0]["id"]
r = client.write("POST", "meal_items", [{"meal_log_id": lunch, **i} for i in lunch_items])
check(r.status_code == 201, "client logs lunch as planned (foods with amounts, from the plan)")
rice_row = client.get("meal_items", select="id", meal_log_id=f"eq.{lunch}", food_id=f"eq.{rice['id']}")[0]["id"]
r = client.write(
    "PATCH", "meal_items", {"quantity": 1.5, **per(rice, 237)}, prefer="return=minimal", id=f"eq.{rice_row}"
)
check(r.status_code == 204, "client changes the rice to 1.5 cups (calories and macros recalculated)")
saved = client.get("meal_items", select="calories,serving", id=f"eq.{rice_row}")[0]
check(saved == {"calories": per(rice, 237)["calories"], "serving": "1 cup"}, "the new amount's numbers are saved")

# Something else: a food typed in by hand (not in the list), as a snack.
r = client.write(
    "POST",
    "meal_logs",
    {
        "client_id": client.id,
        "meal_type": "snack",
        "title": "Mum's laddoo",
        "calories": 180,
        "protein_g": 4,
        "on_plan": "no",
    },
)
snack = r.json()[0]["id"]
r = client.write(
    "POST",
    "meal_items",
    {
        "meal_log_id": snack,
        "food_id": None,
        "food_name": "Mum's laddoo",
        "quantity": 40,
        "unit": "g",
        "calories": 180,
        "protein_g": 4,
    },
)
check(r.status_code == 201, "client logs a snack that isn't in the food list")

# The coach compares the week: plan in force and what was logged, per meal.
week_plans = coach.get(
    "meal_plans",
    select=PLAN_COLS,
    client_id=f"eq.{client.id}",
    effective_from=f"lte.{monday}",
    order="effective_from.desc",
)
week_plans += coach.get(
    "meal_plans",
    select=PLAN_COLS,
    client_id=f"eq.{client.id}",
    effective_from=f"gt.{monday}",
    order="effective_from.desc",
)
logged = coach.get(
    "meal_logs",
    select="eaten_at,meal_type,calories,protein_g,carbs_g,fat_g,on_plan,meal_items(food_id,food_name,quantity,unit,serving)",
    client_id=f"eq.{client.id}",
    eaten_at=f"gte.{monday}T00:00:00Z",
)
lunches = [m for m in logged if m["meal_type"] == "lunch" and m["meal_items"]]
check(any(p["id"] == plan_id for p in week_plans), "coach reads the plan in force this week")
check(
    lunches and {i["food_id"] for i in lunches[0]["meal_items"]} == {chicken["id"], rice["id"]},
    "coach sees the logged lunch next to the planned one (same foods)",
)
check(any(m["meal_type"] == "snack" and m["on_plan"] == "no" for m in logged), "and the off-plan snack")
r = other.rpc("save_meal_plan", {"p": {**plan_body, "effective_from": str(today + timedelta(days=1))}})
check(r.status_code >= 400, "a client can't write meal plans")

RECORD_COLS = (
    "session_id,exercise_id,kind,milestone,value,previous,set_number,weight_kg,reps,rpe,duration_s,distance_m,"
    "achieved_on,exercises(name)"
)

step("Supersets and drop sets: the coach pairs two exercises; the client logs the superset and a drop; both see them")
PROGRAM_SELECT = (
    "id,client_id,is_template,name,weeks,goal,level,days_per_week,start_date,assigned_at,draft_start,"
    "workout_templates(id,name,day_of_week,position,notes,removed_at,"
    "template_exercises(id,exercise_id,position,target_sets,target_reps,target_rpe,rest_seconds,notes,superset_group,"
    "removed_at,exercises(name)))"
)
prog = coach.get("programs", select=PROGRAM_SELECT, id=f"eq.{program_id}")[0]
workouts = sorted([w for w in prog["workout_templates"] if not w["removed_at"]], key=lambda w: w["position"])
lower = next(w for w in workouts if w["id"] == template["id"])
lower_slots = sorted([x for x in lower["template_exercises"] if not x["removed_at"]], key=lambda x: x["position"])
pair = lower_slots[1:3] if len(lower_slots) >= 3 else lower_slots[0:2]
pair_ids = {x["id"] for x in pair}
body = {
    "id": program_id,
    "client_id": client.id,
    "name": prog["name"],
    "weeks": prog["weeks"],
    "goal": prog["goal"],
    "level": prog["level"],
    "draft_start": None,
    "workouts": [
        {
            "id": w["id"],
            "name": w["name"],
            "day_of_week": w["day_of_week"],
            "notes": w["notes"] or "",
            "exercises": [
                {
                    "id": x["id"],
                    "exercise_id": x["exercise_id"],
                    "target_sets": x["target_sets"],
                    "target_reps": x["target_reps"],
                    "target_rpe": x["target_rpe"],
                    # One rest after the round: on the last exercise of the pair.
                    "rest_seconds": None if x["id"] == pair[0]["id"] else x["rest_seconds"],
                    "notes": x["notes"] or "",
                    "superset_group": "A" if x["id"] in pair_ids else None,
                }
                for x in sorted(
                    [x for x in w["template_exercises"] if not x["removed_at"]], key=lambda x: x["position"]
                )
            ],
        }
        for w in workouts
    ],
}
r = coach.rpc("save_program", {"p": body})
check(r.status_code == 200, "coach links two exercises into superset A and saves the assigned program")
mine = client.get(
    "template_exercises", select="id,superset_group,rest_seconds", id=f"in.({','.join(pair_ids)})", order="position"
)
check(
    [x["superset_group"] for x in mine] == ["A", "A"] and mine[0]["rest_seconds"] is None,
    "the client's plan shows A1 + A2, resting after the round",
)

a1, a2 = pair[0], pair[1]
muscles = {
    x["exercise_id"]: [m["muscle"] for m in x["exercise_muscles"] if m["role"] == "primary"]
    for x in client.get(
        "exercises", select="id,exercise_muscles(muscle,role)", id=f"in.({a1['exercise_id']},{a2['exercise_id']})"
    )
    for x in [{"exercise_id": x["id"], "exercise_muscles": x["exercise_muscles"]}]
}


def body_map():
    rows = client.rpc("muscle_sets_for_week", {"client": client.id, "week_start": monday}).json()
    return {r["muscle"]: r["hard_sets"] for r in rows}


before = body_map()
ss = start_session(template["id"])
check(ss.status_code == 201, "client starts the workout again for the superset")
ss = ss.json()[0]["id"]


def put(slot, n, kg, reps, drop_of=None):
    return client.write(
        "POST",
        "set_logs",
        {
            "session_id": ss,
            "exercise_id": slot["exercise_id"],
            "template_exercise_id": slot["id"],
            "set_number": n,
            "reps": reps,
            "weight_kg": kg,
            "rpe": None,
            "is_warmup": False,
            "set_kind": "drop" if drop_of else "normal",
            "drop_of": drop_of,
        },
        prefer="resolution=merge-duplicates,return=minimal",
        on_conflict="session_id,exercise_id,set_number",
    ).status_code


rounds = [put(a1, 1, 40, 10), put(a2, 1, 30, 12), put(a1, 2, 40, 10), put(a2, 2, 30, 12)]
check(all(c in (200, 201) for c in rounds), "client logs two rounds in order: A1, A2, A1, A2")
check(
    put(a1, 3, 30, 12, drop_of=2) in (200, 201), "client adds a drop after A1's second set (40 kg x 10 -> 30 kg x 12)"
)
check(put(a1, 4, 20, 15, drop_of=9) >= 400, "a drop with no working set above it is refused")
after = body_map()
expected = {}
for e, k in ((a1["exercise_id"], 2), (a2["exercise_id"], 2)):  # two hard sets each; the drop isn't one
    for m in muscles[e]:
        expected[m] = expected.get(m, 0) + k
check(
    all(after.get(m, 0) == before.get(m, 0) + k for m, k in expected.items()),
    f"the body map counts A1's set and its drop once ({', '.join(f'{m} +{k}' for m, k in expected.items())})",
)
r = client.write(
    "PATCH",
    "workout_sessions",
    {"finished_at": f"{today}T20:30:00Z", "duration_min": 25, "status": "done", "effort": 8},
    id=f"eq.{ss}",
)
check(r.status_code == 200, "client finishes the workout")

SUMMARY_COLS = (
    "id,performed_on,finished_at,duration_min,notes,effort,status,workout_templates(name),set_logs(set_number,reps,"
    "weight_kg,rpe,is_warmup,drop_of,exercise_id,exercises(name,exercise_muscles(muscle,role)),"
    "template_exercises(superset_group))"
)
for who, name in ((client, "client"), (coach, "coach")):
    row = who.get("workout_sessions", select=SUMMARY_COLS, id=f"eq.{ss}")[0]
    drops = [x for x in row["set_logs"] if x["drop_of"] is not None]
    labels = {x["template_exercises"]["superset_group"] for x in row["set_logs"] if x["template_exercises"]}
    check(
        len(row["set_logs"]) == 5 and len(drops) == 1 and drops[0]["drop_of"] == 2 and labels == {"A"},
        f"the {name}'s summary has the superset and the drop (4 hard sets + 1 drop)",
    )

step("Personal records: the client beats their best, finishes, the app saves the record; client and coach see it")
pr = start_session(None)
check(pr.status_code == 201, "client starts a workout of their own")
pr = pr.json()[0]["id"]
lifted = [
    float(x["weight_kg"])
    for x in client.get(
        "set_logs",
        select="weight_kg,workout_sessions!inner(client_id)",
        **{"workout_sessions.client_id": f"eq.{client.id}"},
        exercise_id=f"eq.{a1['exercise_id']}",
        is_warmup="eq.false",
        set_kind="eq.normal",
    )
    if x["weight_kg"] is not None
]
best = max(lifted)
heavier = best + 2.5
r = client.write(
    "POST",
    "set_logs",
    {
        "session_id": pr,
        "exercise_id": a1["exercise_id"],
        "template_exercise_id": None,
        "set_number": 1,
        "reps": 8,
        "weight_kg": heavier,
        "rpe": 8,
        "is_warmup": False,
        "set_kind": "normal",
        "drop_of": None,
    },
    prefer="return=minimal",
)
check(r.status_code == 201, f"client ticks {heavier} kg x 8 (their best was {best} kg)")
record = {
    "session_id": pr,
    "exercise_id": a1["exercise_id"],
    "kind": "weight",
    "milestone": None,
    "value": heavier,
    "previous": best,
    "set_number": 1,
    "weight_kg": heavier,
    "reps": 8,
    "rpe": 8,
}
r = client.rpc("save_personal_records", {"recs": [record]})
check(r.status_code >= 400, "a record can't be saved while the workout is still open")
r = client.write(
    "PATCH",
    "workout_sessions",
    {"finished_at": f"{today}T21:00:00Z", "duration_min": 20, "status": "done", "effort": 7},
    id=f"eq.{pr}",
)
check(r.status_code == 200, "client finishes the workout")
r = client.rpc("save_personal_records", {"recs": [record]})
check(r.status_code == 200 and r.json() == 1, "the app saves the weight PR (save_personal_records)")
r = client.rpc("save_personal_records", {"recs": [{**record, "value": heavier + 50}]})
check(r.status_code == 200 and r.json() == 0, "saving it again leaves the saved record as it was")
for who, name in ((client, "client"), (coach, "coach")):
    rows = who.get("personal_records", select=RECORD_COLS, client_id=f"eq.{client.id}", session_id=f"in.({pr})")
    check(
        len(rows) == 1
        and float(rows[0]["value"]) == heavier
        and float(rows[0]["previous"]) == best
        and rows[0]["achieved_on"] == str(today)
        and rows[0]["exercises"]["name"],
        f"the {name} sees it: {rows[0]['exercises']['name'] if rows else '?'} {heavier} kg x 8, was {best} kg",
    )
check(
    other.get("personal_records", select="id", client_id=f"eq.{client.id}") == [], "the other client sees none of them"
)
client.write("PATCH", "personal_records", {"value": 999}, session_id=f"eq.{pr}")
client.write("DELETE", "personal_records", None, session_id=f"eq.{pr}")
check(
    [float(x["value"]) for x in client.get("personal_records", select="value", session_id=f"eq.{pr}")] == [heavier],
    "nobody can change or delete a saved record",
)

step("Cardio: the coach plans 20 minutes easy on the bike; the client logs a treadmill run by time and distance")
cardio = {x["name"]: x["id"] for x in client.get("exercises", select="id,name,kind", kind="eq.cardio")}
check(
    {"Treadmill run", "Stationary bike", "Rowing machine"} <= set(cardio),
    f"the cardio library is there ({len(cardio)} exercises)",
)
check(
    client.get("exercise_muscles", select="muscle", exercise_id=f"in.({','.join(cardio.values())})") == [],
    "cardio exercises have no muscles (the body map leaves them out)",
)
lower_body = next(w for w in body["workouts"] if w["id"] == template["id"])
lower_body["exercises"].append(
    {
        "id": None,
        "exercise_id": cardio["Stationary bike"],
        "target_sets": 1,
        "target_reps": "20 min · easy",
        "target_rpe": None,
        "rest_seconds": None,
        "notes": "",
        "superset_group": None,
        "target_minutes": 20,
        "target_distance_m": None,
        "target_zone": "easy",
    }
)
r = coach.rpc("save_program", {"p": body})
check(r.status_code == 200, "coach adds a cardio finisher to the workout and saves")
slot = client.get(
    "template_exercises",
    select="id,target_minutes,target_zone,target_sets",
    exercise_id=f"eq.{cardio['Stationary bike']}",
    workout_template_id=f"eq.{template['id']}",
    removed_at="is.null",
)
check(
    len(slot) == 1 and float(slot[0]["target_minutes"]) == 20 and slot[0]["target_zone"] == "easy",
    "the client's plan has it: 1 round, 20 min, easy",
)
before = body_map()
cs = start_session(None)
check(cs.status_code == 201, "client starts a workout of their own")
cs = cs.json()[0]["id"]


def bout_row(n, seconds, metres, **extra):
    return {
        "session_id": cs,
        "exercise_id": cardio["Treadmill run"],
        "template_exercise_id": None,
        "set_number": n,
        "reps": None,
        "weight_kg": None,
        "rpe": 7,
        "is_warmup": False,
        "set_kind": "normal",
        "drop_of": None,
        "duration_s": seconds,
        "distance_m": metres,
        "level": 1,
        "avg_hr": 152,
        **extra,
    }


r = client.write("POST", "set_logs", bout_row(1, 1800, 5000), prefer="return=minimal")
check(r.status_code == 201, "client logs the run: 30:00, 5 km, level 1, 152 bpm")
check(
    client.write("POST", "set_logs", bout_row(2, None, 1000), prefer="return=minimal").status_code >= 400,
    "a bout without a time is refused",
)
check(
    client.write("POST", "set_logs", bout_row(2, 600, None, weight_kg=20), prefer="return=minimal").status_code >= 400,
    "cardio with a weight is refused",
)
r = client.write(
    "PATCH",
    "workout_sessions",
    {"finished_at": f"{today}T21:30:00Z", "duration_min": 32, "status": "done", "effort": 6},
    id=f"eq.{cs}",
)
check(r.status_code == 200, "client finishes the workout")
check(body_map() == before, "the body map is unchanged by cardio")
APP_SUMMARY_COLS = (
    "id,performed_on,finished_at,duration_min,notes,effort,status,workout_templates(name),set_logs(set_number,reps,"
    "weight_kg,rpe,is_warmup,drop_of,duration_s,distance_m,level,avg_hr,exercise_id,"
    "exercises(name,kind,exercise_muscles(muscle,role)),template_exercises(superset_group))"
)
for who, name in ((client, "client"), (coach, "coach")):
    row = who.get("workout_sessions", select=APP_SUMMARY_COLS, id=f"eq.{cs}")[0]
    b = row["set_logs"][0] if row["set_logs"] else {}
    check(
        len(row["set_logs"]) == 1
        and b["duration_s"] == 1800
        and float(b["distance_m"]) == 5000
        and b["exercises"]["kind"] == "cardio",
        f"the {name} sees the run in the workout summary (time, distance, cardio)",
    )

print("\nWalkthrough passed.")

step("The apps' own queries (same select strings as frontend/src/lib/live) all run under RLS")
PROFILE_COLS = (
    "user_id, status, goal, start_date, start_weight_kg, goal_weight_kg, check_in_day, setup_completed_at,"
    " date_of_birth, phone, height_cm, experience, training_days, train_location, injuries, diet, foods_to_avoid,"
    " meals_per_day"
).replace(" ", "")


def progress_queries(uid):
    """The Progress page's queries (progressRawFor): the client for themselves, or their coach."""
    return [
        ("client_profiles", {"select": "start_date,goal_weight_kg", "user_id": f"eq.{uid}"}),
        (
            "daily_logs",
            {
                "select": "log_date,weight_kg,steps,water_ml,sleep_hours",
                "client_id": f"eq.{uid}",
                "log_date": f"gte.{monday}",
            },
        ),
        ("meal_logs", {"select": "eaten_at,calories,protein_g,on_plan", "client_id": f"eq.{uid}"}),
        (
            "nutrition_targets",
            {"select": "calories,protein_g,water_ml,steps,sleep_hours,effective_from", "client_id": f"eq.{uid}"},
        ),
        (
            "programs",
            {
                "select": "start_date,weeks,workout_templates(day_of_week,removed_at)",
                "client_id": f"eq.{uid}",
                "assigned_at": "not.is.null",
                "start_date": f"lte.{today}",
            },
        ),
        (
            "workout_sessions",
            {
                "select": "performed_on,workout_template_id,set_logs(exercise_id,reps,weight_kg,rpe,is_warmup,drop_of,"
                "duration_s,distance_m,exercises(name,exercise_muscles(muscle,role)))",
                "client_id": f"eq.{uid}",
                "finished_at": "not.is.null",
                "status": "neq.skipped",
            },
        ),
        (
            "check_ins",
            {
                "select": "week_start,waist_cm,hips_cm,energy,sleep,stress,hunger",
                "client_id": f"eq.{uid}",
                "status": "in.(submitted,reviewed)",
            },
        ),
        # Saved records (lib/live/shared.ts recordsOf): also Home (last 7 days), workout summaries, the coach's views.
        (
            "personal_records",
            {"select": RECORD_COLS, "client_id": f"eq.{uid}", "order": "achieved_on.desc", "limit": "1000"},
        ),
    ]


client_queries = [
    (
        "programs",
        {
            "select": "id,name,start_date,weeks,workout_templates(id,name,day_of_week,position,notes,"
            "template_exercises(id,position,target_sets,target_reps,target_rpe,rest_seconds,notes,superset_group,"
            "target_minutes,target_distance_m,target_zone,exercise_id,exercises(name,cue)))",
            "client_id": f"eq.{client.id}",
            "start_date": f"lte.{today}",
            "workout_templates.removed_at": "is.null",
            "workout_templates.template_exercises.removed_at": "is.null",
        },
    ),
    ("programs", {"select": "name,start_date", "client_id": f"eq.{client.id}", "start_date": f"gt.{today}"}),
    (
        "exercise_swaps",
        {
            "select": "template_exercise_id,from_week,to_week,to_exercise_id,"
            "to_exercise:exercises!exercise_swaps_to_exercise_id_fkey(name,cue)"
        },
    ),
    (
        "set_logs",
        {
            "select": "weight_kg,reps,exercise_id,exercises(name),workout_sessions!inner(performed_on,client_id)",
            "workout_sessions.client_id": f"eq.{client.id}",
            "is_warmup": "eq.false",
            "set_kind": "eq.normal",
            "weight_kg": "not.is.null",
        },
    ),
    (
        "workout_sessions",
        {
            "select": "id,performed_on,status,workout_template_id,set_logs(id,is_warmup,set_kind)",
            "client_id": f"eq.{client.id}",
        },
    ),
    (
        "exercise_muscles",
        {
            "select": "role,note_kind,note,source_url,exercises!inner(id,name,level,equipment,cue)",
            "muscle": "eq.glutes",
        },
    ),
    (
        "set_logs",
        {
            "select": "exercise_id,workout_sessions!inner(performed_on,client_id,status)",
            "workout_sessions.client_id": f"eq.{client.id}",
            "workout_sessions.performed_on": f"gte.{monday}",
            "is_warmup": "eq.false",
            "set_kind": "eq.normal",
        },
    ),
    (
        "exercises",
        {"select": "id,name,level,equipment,cue,created_by,kind,exercise_muscles(muscle,role)", "order": "name"},
    ),
    # Food day: meals with their foods (meal_items, 0021)
    (
        "meal_logs",
        {
            "select": "id,eaten_at,meal_type,title,calories,protein_g,carbs_g,fat_g,on_plan,photo_url,"
            "meal_items(food_id,food_name,quantity,unit,serving,calories,protein_g,carbs_g,fat_g)",
            "client_id": f"eq.{client.id}",
        },
    ),
    # Train week: skips (0019)
    (
        "workout_sessions",
        {
            "select": "id,workout_template_id,performed_on,finished_at,status,notes",
            "client_id": f"eq.{client.id}",
            "performed_on": f"gte.{monday}",
        },
    ),
    # Food list and meal plans (0022, 0023): lib/live/mealplans.ts
    ("foods", {"select": "id,name,basis,kcal,protein_g,carbs_g,fat_g,servings,created_by", "order": "name"}),
    (
        "meal_plans",
        {
            "select": PLAN_COLS,
            "client_id": f"eq.{client.id}",
            "effective_from": f"lte.{today}",
            "order": "effective_from.desc",
            "limit": "1",
        },
    ),
    # Profile pictures (0020)
    ("users", {"select": "id,avatar_url", "avatar_url": "not.is.null"}),
    ("users", {"select": "avatar_url", "id": f"eq.{client.id}"}),
    (
        "workout_sessions",
        {
            "select": "id,workout_template_id,performed_on,started_at,workout_templates(name),"
            "set_logs(is_warmup,set_kind)",
            "client_id": f"eq.{client.id}",
            "finished_at": "is.null",
        },
    ),
    (
        "workout_sessions",
        {
            "select": "id,workout_template_id,performed_on,started_at,finished_at,duration_min,notes,effort,"
            "workout_templates(name),set_logs(exercise_id,template_exercise_id,set_number,reps,weight_kg,rpe,is_warmup,drop_of,"
            "duration_s,distance_m,level,avg_hr)",
            "id": f"eq.{planned}",
        },
    ),
    ("workout_sessions", {"select": SESSION_SUMMARY_COLS, "client_id": f"eq.{client.id}", "limit": "5"}),
    (
        "set_logs",
        {
            "select": "exercise_id,set_number,reps,weight_kg,rpe,drop_of,duration_s,distance_m,level,avg_hr,session_id,"
            "workout_sessions!inner(client_id,performed_on,started_at)",
            "workout_sessions.client_id": f"eq.{client.id}",
            "exercise_id": f"in.({ex['Back squat']},{ex['Goblet squat']})",
            "session_id": f"neq.{own}",
        },
    ),
    ("users", {"select": "id,full_name,unit_system", "id": f"eq.{client.id}"}),
    # Record badges and saving records (lib/live/records.ts history and weighIns, paged).
    (
        "workout_sessions",
        {
            "select": "id,performed_on,started_at",
            "client_id": f"eq.{client.id}",
            "finished_at": "not.is.null",
            "status": "neq.skipped",
            "order": "id",
            "offset": "0",
            "limit": "1000",
        },
    ),
    (
        "set_logs",
        {
            "select": "session_id,exercise_id,set_number,reps,weight_kg,rpe,duration_s,distance_m,"
            "exercises(name,equipment,kind),workout_sessions!inner(client_id)",
            "workout_sessions.client_id": f"eq.{client.id}",
            "is_warmup": "eq.false",
            "set_kind": "eq.normal",
            "exercise_id": f"in.({ex['Back squat']},{ex['Goblet squat']})",
            "order": "id",
            "offset": "0",
            "limit": "1000",
        },
    ),
    (
        "daily_logs",
        {
            "select": "log_date,weight_kg",
            "client_id": f"eq.{client.id}",
            "weight_kg": "not.is.null",
            "order": "log_date",
            "offset": "0",
            "limit": "1000",
        },
    ),
    ("client_profiles", {"select": "start_date,start_weight_kg", "user_id": f"eq.{client.id}"}),
    ("personal_records", {"select": "id", "client_id": f"eq.{client.id}", "limit": "1"}),
    # Progress page (lib/live/client.ts progressRawFor): one round of queries for the period.
    *progress_queries(client.id),
    (
        "client_profiles",
        {
            "select": "coach_id,goal,start_date,height_cm,start_weight_kg,goal_weight_kg,check_in_day,experience,"
            "training_days,train_location,injuries,diet,foods_to_avoid,meals_per_day,phone",
            "user_id": f"eq.{client.id}",
        },
    ),
    (
        "nutrition_targets",
        {
            "select": "calories,protein_g,carbs_g,fat_g,water_ml,steps,sleep_hours,effective_from",
            "client_id": f"eq.{client.id}",
            "effective_from": f"gt.{today}",
        },
    ),
    ("messages", {"select": MESSAGE_COLS, "client_id": f"eq.{client.id}", "order": "created_at.desc", "limit": "300"}),
    ("users", {"select": "id,full_name", "id": f"in.({client.id},{coach.id})"}),
    ("client_profiles", {"select": "coach_id", "user_id": f"eq.{client.id}"}),
    (
        "check_ins",
        {
            "select": "id,client_id,week_start,status,submitted_at,avg_weight_kg,waist_cm,hips_cm,energy,sleep,stress,"
            "hunger,wins,struggles,question",
            "id": f"eq.{ci}",
        },
    ),
    ("messages", {"select": MESSAGE_COLS, "check_in_id": f"eq.{ci}", "order": "created_at"}),
    ("checkin_questions", {"select": "id,prompt,answer_type", "is_active": "eq.true", "order": "position"}),
    ("checkin_answers", {"select": "question_id,value_number,value_text", "check_in_id": f"eq.{ci}"}),
    ("progress_photos", {"select": "pose,photo_url", "check_in_id": f"eq.{ci}"}),
    ("weekly_summaries", {"select": "week_start,training_pct,nutrition_pct", "client_id": f"eq.{client.id}"}),
    (
        "client_profiles",
        {
            "select": "coach_id,start_date,start_weight_kg,goal_weight_kg,check_in_day,body_model,meals_per_day",
            "user_id": f"eq.{client.id}",
        },
    ),
    (
        "messages",
        {
            "select": "body,created_at,check_in_id",
            "client_id": f"eq.{client.id}",
            "order": "created_at.desc",
            "limit": "1",
        },
    ),
]
for table, params in client_queries:
    r = http.get(f"{SUPABASE}/rest/v1/{table}", headers=client.h, params=params)
    check(r.status_code == 200, f"client query on {table} ({len(r.json()) if r.status_code == 200 else r.text[:80]})")
lib = client.get("exercise_muscles", select="role,exercises!inner(name)", muscle="eq.glutes")
check(len(lib) >= 5, f"exercise library visible for the body map ({len(lib)} glute exercises)")
r = client.rpc("muscle_sets_for_week", {"client": client.id, "week_start": monday})
check(r.status_code == 200, "body-map function runs for the client")

coach_queries = [
    ("client_profiles", {"select": PROFILE_COLS, "coach_id": f"eq.{coach.id}"}),
    (
        "programs",
        {"select": "client_id,weeks,start_date,workout_templates(id,day_of_week)", "client_id": f"in.({client.id})"},
    ),
    (
        "check_ins",
        {
            "select": "id,client_id,week_start,status,submitted_at,reviewed_at,sleep,question,avg_weight_kg",
            "client_id": f"in.({client.id})",
            "order": "week_start.desc",
        },
    ),
    (
        "checkin_answers",
        {"select": "value_number,value_text,checkin_questions(prompt,answer_type)", "check_in_id": f"eq.{ci}"},
    ),
    ("review_drafts", {"select": "body,updated_at", "check_in_id": f"eq.{ci}"}),
    ("users", {"select": "id,full_name,invite_code", "id": f"eq.{coach.id}"}),
    (
        "client_profiles",
        {
            "select": "user_id,goal,experience,training_days,train_location,injuries,setup_completed_at",
            "coach_id": f"eq.{coach.id}",
        },
    ),
    (
        "programs",
        {"select": "id,client_id,is_template,name,weeks,start_date,assigned_at", "client_id": f"in.({client.id})"},
    ),
    (
        "programs",
        {
            "select": "id,name,goal,level,days_per_week,weeks,workout_templates(count)",
            "coach_id": f"eq.{coach.id}",
            "is_template": "eq.true",
        },
    ),
    (
        "programs",
        {
            "select": "id,client_id,is_template,name,weeks,goal,level,days_per_week,start_date,assigned_at,draft_start,"
            "workout_templates(id,name,day_of_week,position,notes,removed_at,template_exercises(id,exercise_id,position,"
            "target_sets,target_reps,target_rpe,rest_seconds,notes,superset_group,target_minutes,target_distance_m,"
            "target_zone,removed_at,exercises(name)))",
            "id": f"eq.{program_id}",
        },
    ),
    ("client_profiles", {"select": "user_id", "user_id": f"eq.{client.id}", "coach_id": f"eq.{coach.id}"}),
    (
        "client_profiles",
        {"select": "user_id,status,goal,start_date,goal_weight_kg,setup_completed_at", "coach_id": f"eq.{coach.id}"},
    ),
    # Clients list flags (lib/live/manage.ts weighIns): weigh-ins for the last 12 weeks, paged.
    (
        "daily_logs",
        {
            "select": "client_id,log_date,weight_kg",
            "client_id": f"in.({client.id})",
            "log_date": f"gte.{today - timedelta(days=today.weekday(), weeks=11)}",
            "weight_kg": "not.is.null",
            "order": "client_id,log_date",
            "offset": "0",
            "limit": "1000",
        },
    ),
    # The client's Insights card in the client view and check-in review (clientProgress).
    *progress_queries(client.id),
    (
        "nutrition_targets",
        {
            "select": "client_id,calories,protein_g,carbs_g,fat_g,water_ml,steps,sleep_hours,effective_from",
            "client_id": f"in.({client.id})",
            "order": "effective_from.desc",
        },
    ),
    (
        "checkin_questions",
        {"select": "id,prompt,answer_type,position,is_active,checkin_answers(count)", "coach_id": f"eq.{coach.id}"},
    ),
    ("users", {"select": "full_name,invite_code,default_check_in_day", "id": f"eq.{coach.id}"}),
    # Check-in review, Nutrition tab: the client's meals that week, with their foods (lib/live/client.ts clientMeals)
    (
        "meal_logs",
        {
            "select": "id,eaten_at,meal_type,title,calories,protein_g,carbs_g,fat_g,on_plan,photo_url,"
            "meal_items(food_id,food_name,quantity,unit,serving,calories,protein_g,carbs_g,fat_g)",
            "client_id": f"eq.{client.id}",
            "eaten_at": f"gte.{monday}T00:00:00Z",
        },
    ),
    # Meal plans on the Nutrition page and planned vs eaten (lib/live/mealplans.ts)
    (
        "meal_plans",
        {
            "select": PLAN_COLS,
            "client_id": f"eq.{client.id}",
            "order": "effective_from.desc",
        },
    ),
    (
        "meal_plans",
        {
            "select": PLAN_COLS,
            "coach_id": f"eq.{coach.id}",
            "client_id": "is.null",
        },
    ),
    (
        "meal_logs",
        {"select": "eaten_at,meal_type,calories,protein_g,carbs_g,fat_g,on_plan", "client_id": f"eq.{client.id}"},
    ),
    (
        "programs",
        {
            "select": "start_date,weeks,workout_templates(day_of_week,removed_at)",
            "client_id": f"eq.{client.id}",
            "assigned_at": "not.is.null",
        },
    ),
    ("client_profiles", {"select": "meals_per_day", "user_id": f"eq.{client.id}"}),
    ("check_ins", {"select": "id,week_start,status,submitted_at,reviewed_at", "client_id": f"eq.{client.id}"}),
    ("daily_logs", {"select": "log_date,weight_kg", "client_id": f"eq.{client.id}", "weight_kg": "not.is.null"}),
    ("messages", {"select": MESSAGE_COLS, "client_id": f"eq.{client.id}", "order": "created_at.desc", "limit": "300"}),
]
for table, params in coach_queries:
    r = http.get(f"{SUPABASE}/rest/v1/{table}", headers=coach.h, params=params)
    check(r.status_code == 200, f"coach query on {table}")
check(
    coach.get("users", select="invite_code", id=f"eq.{coach.id}")[0]["invite_code"] == code,
    "coach reads their invite code",
)
r = coach.write(
    "POST",
    "review_drafts",
    {"check_in_id": ci, "coach_id": coach.id, "body": "draft"},
    prefer="resolution=merge-duplicates",
    on_conflict="check_in_id",
)
check(r.status_code in (200, 201), "coach saves a review draft")
check(
    coach.rpc("set_coach_notes", {"client": client.id, "notes": "private"}).status_code in (200, 204),
    "coach saves private notes",
)
check(coach.rpc("get_coach_notes", {"client": client.id}).json() == "private", "coach reads private notes")
check(client.rpc("get_coach_notes", {"client": client.id}).json() is None, "client can't read the coach's notes")
check(coach.rpc("get_coach_notes", {"client": client.id}).status_code == 200, "coach reads notes for the Clients page")
for who, name in ((client, "client"), (coach, "coach")):
    for fn in ("unread_message_count", "message_threads"):
        check(who.rpc(fn, {}).status_code == 200, f"{name} runs {fn}")

print("\nApp queries passed.")
