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
        "photos": [{"pose": "front", "path": up.json()["path"]}],
    },
)
check(r.status_code == 200 and r.json()["status"] == "submitted", "check-in submitted")

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

step("Coach assigns a program; client logs today's workout (one swap, RPE) and one of their own; coach sees both")
names = ["Back squat", "Goblet squat", "Romanian deadlift", "Push-up", "Lat pulldown"]
ex = {
    r["name"]: r["id"]
    for r in client.get("exercises", select="id,name", name="in.(" + ",".join(f'"{n}"' for n in names) + ")")
}
check(len(ex) == len(names), "client sees the shared exercise library")
dow = today.isoweekday() % 7  # Postgres numbering, Sunday = 0
monday = (today - timedelta(days=today.weekday())).isoformat()
program = coach.write(
    "POST",
    "programs",
    {"coach_id": coach.id, "client_id": client.id, "name": "Walkthrough block", "start_date": str(today), "weeks": 8},
).json()[0]
template = coach.write(
    "POST",
    "workout_templates",
    {"program_id": program["id"], "name": "Lower A", "day_of_week": dow, "notes": "Keep the RDLs light."},
).json()[0]
slots = coach.write(
    "POST",
    "template_exercises",
    [
        {
            "workout_template_id": template["id"],
            "exercise_id": ex["Back squat"],
            "position": 0,
            "target_sets": 3,
            "target_reps": "6-8",
            "target_rpe": 8,
            "rest_seconds": 150,
        },
        {
            "workout_template_id": template["id"],
            "exercise_id": ex["Romanian deadlift"],
            "position": 1,
            "target_sets": 2,
            "target_reps": "10",
            "target_rpe": 7,
            "rest_seconds": 120,
        },
    ],
).json()
squat_slot, rdl_slot = slots[0]["id"], slots[1]["id"]
plan = client.get(
    "programs",
    select="id,workout_templates(id,name,day_of_week,template_exercises(id,target_sets,target_reps,target_rpe))",
    client_id=f"eq.{client.id}",
)
check(
    plan[0]["workout_templates"][0]["day_of_week"] == dow
    and len(plan[0]["workout_templates"][0]["template_exercises"]) == 2,
    "client sees today's planned workout with the coach's targets",
)


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


def tick(session_id: str, exercise: str, n: int, reps: int, kg: float | None, rpe: float | None, slot=None) -> None:
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
            "is_warmup": False,
        },
        prefer="resolution=merge-duplicates,return=minimal",
        on_conflict="session_id,exercise_id,set_number",
    )
    check(r.status_code in (200, 201), f"set saved as it's ticked: {exercise} #{n} {reps} reps @ {kg} kg, RPE {rpe}")


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
r = client.write(
    "PATCH",
    "workout_sessions",
    {
        "finished_at": f"{today}T17:45:00Z",
        "duration_min": 45,
        "status": "done",
        "notes": "Goblet squats today, gym was busy",
    },
    id=f"eq.{planned}",
)
check(r.status_code == 200 and r.json()[0]["status"] == "done", "Finish workout sets finished_at, duration and status")
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

SESSION_SUMMARY_COLS = (
    "id, performed_on, finished_at, duration_min, notes, workout_templates(name), set_logs(set_number, reps, weight_kg,"
    " rpe, is_warmup, exercise_id, exercises(name, exercise_muscles(muscle, role)))"
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

print("\nWalkthrough passed.")

step("The apps' own queries (same select strings as frontend/src/lib/live) all run under RLS")
PROFILE_COLS = (
    "user_id, status, goal, start_date, start_weight_kg, goal_weight_kg, check_in_day, setup_completed_at,"
    " date_of_birth, height_cm, experience, training_days, train_location, injuries, diet, foods_to_avoid,"
    " meals_per_day"
).replace(" ", "")
client_queries = [
    (
        "programs",
        {
            "select": "id,name,start_date,weeks,workout_templates(id,name,day_of_week,position,notes,"
            "template_exercises(id,position,target_sets,target_reps,target_rpe,rest_seconds,exercise_id,"
            "exercises(name,cue)))",
            "client_id": f"eq.{client.id}",
            "start_date": f"lte.{today}",
        },
    ),
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
            "weight_kg": "not.is.null",
        },
    ),
    (
        "workout_sessions",
        {"select": "id,performed_on,status,workout_template_id,set_logs(id,is_warmup)", "client_id": f"eq.{client.id}"},
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
        },
    ),
    ("exercises", {"select": "id,name,level,equipment,cue,exercise_muscles(muscle,role)", "order": "name"}),
    (
        "workout_sessions",
        {
            "select": "id,workout_template_id,performed_on,started_at,workout_templates(name),set_logs(count)",
            "client_id": f"eq.{client.id}",
            "finished_at": "is.null",
        },
    ),
    (
        "workout_sessions",
        {
            "select": "id,workout_template_id,performed_on,started_at,finished_at,duration_min,notes,"
            "workout_templates(name),set_logs(exercise_id,template_exercise_id,set_number,reps,weight_kg,rpe)",
            "id": f"eq.{planned}",
        },
    ),
    ("workout_sessions", {"select": SESSION_SUMMARY_COLS, "client_id": f"eq.{client.id}", "limit": "5"}),
    (
        "set_logs",
        {
            "select": "exercise_id,set_number,reps,weight_kg,rpe,session_id,"
            "workout_sessions!inner(client_id,performed_on,started_at)",
            "workout_sessions.client_id": f"eq.{client.id}",
            "exercise_id": f"in.({ex['Back squat']},{ex['Goblet squat']})",
            "session_id": f"neq.{own}",
        },
    ),
    ("users", {"select": "id,full_name,unit_system", "id": f"eq.{client.id}"}),
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
    ("client_profiles", {"select": "user_id", "user_id": f"eq.{client.id}", "coach_id": f"eq.{coach.id}"}),
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
for who, name in ((client, "client"), (coach, "coach")):
    for fn in ("unread_message_count", "message_threads"):
        check(who.rpc(fn, {}).status_code == 200, f"{name} runs {fn}")

print("\nApp queries passed.")
