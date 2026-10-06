"""Permission and happy-path tests against a real local Supabase database.

Needs `supabase start` + `supabase db reset` (all migrations and the seed)
and TEST_DATABASE_URL. Each test run creates its own users, so runs don't
collide. Users are created in auth.users exactly as sign-up does, so the
sign-up trigger, invite-code link and RLS rules are all exercised.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, timedelta

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import TEST_DATABASE_URL, bearer, make_settings, make_token

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to a local Supabase database"),
]


def run(coro):
    return asyncio.run(coro)


async def _query(sql: str, *args):
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def query(sql: str, *args):
    return run(_query(sql, *args))


def scalar(sql: str, *args):
    rows = query(sql, *args)
    return rows[0][0] if rows else None


async def _seed() -> dict[str, uuid.UUID]:
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    tag = uuid.uuid4().hex[:6].upper()
    ids = {k: uuid.uuid4() for k in ("coach_a", "coach_b", "client_a", "client_b")}
    codes = {"coach_a": f"TA-{tag}", "coach_b": f"TB-{tag}"}
    try:

        async def sign_up(key: str, invite: str | None = None) -> None:
            # What supabase.auth.signUp does; the on_auth_user_created trigger does the rest.
            await conn.execute(
                """
                insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
                values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3::jsonb,
                        now(), now())
                """,
                ids[key],
                f"{key}-{tag.lower()}@example.test",
                json.dumps({"full_name": f"{key.replace('_', ' ').title()} Test", "invite_code": invite}),
            )

        for coach in ("coach_a", "coach_b"):
            await sign_up(coach)
            # Making a coach is a manual SQL step (docs/schema.md).
            await conn.execute(
                "update public.users set role = 'coach', invite_code = $2 where id = $1", ids[coach], codes[coach]
            )
            await conn.execute("delete from public.client_profiles where user_id = $1", ids[coach])
        await sign_up("client_a", codes["coach_a"])
        await sign_up("client_b", codes["coach_b"])
        await conn.execute(
            """
            update public.client_profiles
            set goal = 'fat_loss', cleared_to_exercise = true, setup_completed_at = now()
            where user_id = any($1::uuid[])
            """,
            [ids["client_a"], ids["client_b"]],
        )

        async def check_in(client: str, week: date, status: str, reviewer: str | None = None) -> uuid.UUID:
            return await conn.fetchval(
                """
                insert into public.check_ins (client_id, week_start, status, submitted_at, reviewed_by, reviewed_at)
                values ($1, $2, $3::public.checkin_status,
                        case when $3 <> 'due' then now() end,
                        $4::uuid, case when $4::uuid is not null then now() end)
                returning id
                """,
                ids[client],
                week,
                status,
                ids[reviewer] if reviewer else None,
            )

        monday = date(2026, 9, 28)
        ids["ci_a_due"] = await check_in("client_a", monday, "due")
        ids["ci_a_submitted"] = await check_in("client_a", monday - timedelta(weeks=1), "submitted")
        ids["ci_a_reviewed"] = await check_in("client_a", monday - timedelta(weeks=2), "reviewed", "coach_a")
        ids["ci_b_submitted"] = await check_in("client_b", monday, "submitted")

        ids["question_a"] = await conn.fetchval(
            "insert into public.checkin_questions (coach_id, prompt, answer_type) values ($1, 'Steps a day?', 'number')"
            " returning id",
            ids["coach_a"],
        )

        program = await conn.fetchval(
            "insert into public.programs (coach_id, client_id, name, start_date, weeks)"
            " values ($1, $2, 'Fat loss block', '2026-08-24', 12) returning id",
            ids["coach_a"],
            ids["client_a"],
        )
        template = await conn.fetchval(
            "insert into public.workout_templates (program_id, name, position)"
            " values ($1, 'Full body C', 1) returning id",
            program,
        )
        rdl = await conn.fetchval(
            "select id from public.exercises where name = 'Romanian deadlift' and created_by is null"
        )
        ids["hip_thrust"] = await conn.fetchval(
            "select id from public.exercises where name = 'Hip thrust' and created_by is null"
        )
        ids["te_a"] = await conn.fetchval(
            "insert into public.template_exercises"
            " (workout_template_id, exercise_id, position, target_sets, target_reps)"
            " values ($1, $2, 2, 3, '8') returning id",
            template,
            rdl,
        )
        await conn.execute(
            "insert into public.review_drafts (check_in_id, coach_id, body) values ($1, $2, 'draft')",
            ids["ci_a_submitted"],
            ids["coach_a"],
        )
    finally:
        await conn.close()
    return ids


@pytest.fixture(scope="module")
def ids():
    return run(_seed())


@pytest.fixture(scope="module")
def api():
    app = create_app(make_settings())
    with TestClient(app) as c:
        yield c


def as_(ids, who):
    return bearer(make_token(ids[who]))


SUBMIT = {
    "avg_weight_kg": 71.8,
    "waist_cm": 78,
    "energy": 4,
    "sleep": 3,
    "stress": 2,
    "hunger": 3,
    "wins": "All 4 squat sets",
    "struggles": "Late nights",
    "question": "Swap RDLs?",
}


# ---------- Submit (client) ----------


def test_client_submits_own_checkin_with_answers_and_photos(api, ids):
    photo = f"{ids['client_a']}/progress/2026-10-04-ab12cd34.jpg"
    body = {
        **SUBMIT,
        "answers": [{"question_id": str(ids["question_a"]), "value_number": 8450}],
        "photos": [{"pose": "front", "path": photo}],
    }
    r = api.post(f"/checkins/{ids['ci_a_due']}/submit", json=body, headers=as_(ids, "client_a"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "submitted" and r.json()["submitted_at"]
    row = query("select status::text, avg_weight_kg, energy from public.check_ins where id = $1", ids["ci_a_due"])[0]
    assert (row[0], float(row[1]), row[2]) == ("submitted", 71.8, 4)
    assert scalar("select value_number from public.checkin_answers where check_in_id = $1", ids["ci_a_due"]) == 8450
    assert scalar("select photo_url from public.progress_photos where check_in_id = $1", ids["ci_a_due"]) == photo


def test_client_cannot_submit_another_clients_checkin(api, ids):
    r = api.post(f"/checkins/{ids['ci_b_submitted']}/submit", json=SUBMIT, headers=as_(ids, "client_a"))
    assert r.status_code == 404
    assert scalar("select wins from public.check_ins where id = $1", ids["ci_b_submitted"]) is None


def test_coach_cannot_submit_for_a_client(api, ids):
    r = api.post(f"/checkins/{ids['ci_a_submitted']}/submit", json=SUBMIT, headers=as_(ids, "coach_a"))
    assert r.status_code == 404


def test_reviewed_checkin_is_closed(api, ids):
    r = api.post(f"/checkins/{ids['ci_a_reviewed']}/submit", json=SUBMIT, headers=as_(ids, "client_a"))
    assert r.status_code == 409


def test_client_cannot_send_status(api, ids):
    r = api.post(
        f"/checkins/{ids['ci_a_due']}/submit", json={**SUBMIT, "status": "reviewed"}, headers=as_(ids, "client_a")
    )
    assert r.status_code == 422


def test_photos_must_be_in_the_clients_own_folder(api, ids):
    body = {**SUBMIT, "photos": [{"pose": "side", "path": f"{ids['client_b']}/progress/2026-10-04-ffff0000.jpg"}]}
    r = api.post(f"/checkins/{ids['ci_a_due']}/submit", json=body, headers=as_(ids, "client_a"))
    assert r.status_code == 422


def test_answers_to_another_coachs_question_are_refused(api, ids):
    foreign = scalar(
        "insert into public.checkin_questions (coach_id, prompt, answer_type)"
        " values ($1, 'Mood?', 'scale') returning id",
        ids["coach_b"],
    )
    body = {**SUBMIT, "answers": [{"question_id": str(foreign), "value_number": 3}]}
    r = api.post(f"/checkins/{ids['ci_a_due']}/submit", json=body, headers=as_(ids, "client_a"))
    assert r.status_code == 422


def test_client_cannot_mark_reviewed_directly_in_the_database(ids):
    """Even bypassing the API, RLS + the guard trigger stop a client marking their own check-in reviewed."""

    async def attempt():
        conn = await asyncpg.connect(TEST_DATABASE_URL)
        try:
            async with conn.transaction():
                await conn.execute("set local role authenticated")
                await conn.execute(
                    "select set_config('request.jwt.claims', $1, true)",
                    json.dumps({"sub": str(ids["client_a"]), "role": "authenticated"}),
                )
                await conn.execute(
                    "update public.check_ins set status = 'reviewed', reviewed_by = $2, reviewed_at = now()"
                    " where id = $1",
                    ids["ci_a_submitted"],
                    ids["client_a"],
                )
        finally:
            await conn.close()

    with pytest.raises(asyncpg.PostgresError):
        run(attempt())
    assert scalar("select status::text from public.check_ins where id = $1", ids["ci_a_submitted"]) == "submitted"


# ---------- Review (coach) ----------


def test_client_cannot_review(api, ids):
    r = api.post(f"/checkins/{ids['ci_a_submitted']}/review", json={"message": "hi"}, headers=as_(ids, "client_a"))
    assert r.status_code == 403


def test_coach_cannot_review_another_coachs_client(api, ids):
    r = api.post(f"/checkins/{ids['ci_a_submitted']}/review", json={"message": "hi"}, headers=as_(ids, "coach_b"))
    assert r.status_code == 404
    assert scalar("select status::text from public.check_ins where id = $1", ids["ci_a_submitted"]) == "submitted"
    assert scalar("select count(*) from public.messages where check_in_id = $1", ids["ci_a_submitted"]) == 0


def test_coach_reviews_own_clients_checkin(api, ids):
    targets = {
        "calories": 2100,
        "protein_g": 140,
        "carbs_g": 210,
        "fat_g": 70,
        "water_ml": 2500,
        "steps": 9000,
        "sleep_h": 7.5,
    }
    r = api.post(
        f"/checkins/{ids['ci_a_submitted']}/review",
        json={"message": "Huge week.", "mark_reviewed": True, "targets": targets},
        headers=as_(ids, "coach_a"),
    )
    assert r.status_code == 200, r.text
    assert "next_id" in r.json()
    row = query("select status::text, reviewed_by from public.check_ins where id = $1", ids["ci_a_submitted"])[0]
    assert row[0] == "reviewed" and row[1] == ids["coach_a"]
    assert scalar("select body from public.messages where check_in_id = $1", ids["ci_a_submitted"]) == "Huge week."
    assert scalar("select count(*) from public.review_drafts where check_in_id = $1", ids["ci_a_submitted"]) == 0
    effective = scalar(
        "select effective_from from public.nutrition_targets where client_id = $1 order by effective_from desc",
        ids["client_a"],
    )
    assert effective is not None and effective.isoweekday() == 1 and effective > date.today()


def test_review_needs_a_submitted_checkin(api, ids):
    due = scalar(
        "insert into public.check_ins (client_id, week_start, status) values ($1, '2026-10-05', 'due') returning id",
        ids["client_a"],
    )
    r = api.post(f"/checkins/{due}/review", json={"message": "hi"}, headers=as_(ids, "coach_a"))
    assert r.status_code == 409


# ---------- Programs (coach) ----------


def test_coach_swaps_exercise_for_some_weeks(api, ids):
    body = {
        "template_exercise_id": str(ids["te_a"]),
        "to_exercise_id": str(ids["hip_thrust"]),
        "from_week": 7,
        "to_week": 8,
    }
    r = api.post("/programs/swap", json=body, headers=as_(ids, "coach_a"))
    assert r.status_code == 200, r.text
    swap = query(
        "select from_week, to_week, to_exercise_id from public.exercise_swaps where id = $1",
        uuid.UUID(r.json()["swap_id"]),
    )[0]
    assert (swap[0], swap[1], swap[2]) == (7, 8, ids["hip_thrust"])


def test_other_coach_cannot_swap(api, ids):
    body = {
        "template_exercise_id": str(ids["te_a"]),
        "to_exercise_id": str(ids["hip_thrust"]),
        "from_week": 7,
        "to_week": 8,
    }
    assert api.post("/programs/swap", json=body, headers=as_(ids, "coach_b")).status_code == 404
    assert api.post("/programs/swap", json=body, headers=as_(ids, "client_a")).status_code == 403


def test_swap_weeks_must_fit_the_program(api, ids):
    body = {
        "template_exercise_id": str(ids["te_a"]),
        "to_exercise_id": str(ids["hip_thrust"]),
        "from_week": 11,
        "to_week": 14,
    }
    assert api.post("/programs/swap", json=body, headers=as_(ids, "coach_a")).status_code == 422


def test_exercise_library_is_served(api, ids):
    r = api.get("/programs/exercise-library", headers=as_(ids, "coach_a"))
    assert r.status_code == 200
    names = {e["name"] for e in r.json()}
    assert {"Back squat", "Hip thrust"} <= names


# ---------- Invite codes ----------


def test_coach_views_and_rotates_invite_code(api, ids):
    before = api.get("/coach/invite-code", headers=as_(ids, "coach_a")).json()["invite_code"]
    r = api.post("/coach/invite-code", headers=as_(ids, "coach_a"))
    assert r.status_code == 200
    after = r.json()["invite_code"]
    assert after and after != before
    assert scalar("select public.invite_code_valid($1)", after) is True
    assert scalar("select public.invite_code_valid($1)", before) is False


def test_clients_have_no_invite_code(api, ids):
    assert api.get("/coach/invite-code", headers=as_(ids, "client_a")).status_code == 403
    assert api.post("/coach/invite-code", headers=as_(ids, "client_a")).status_code == 403


def test_signup_linked_clients_to_the_right_coach(ids):
    assert scalar("select coach_id from public.client_profiles where user_id = $1", ids["client_a"]) == ids["coach_a"]
    assert scalar("select coach_id from public.client_profiles where user_id = $1", ids["client_b"]) == ids["coach_b"]
