"""RLS for the writes and reads the apps make directly with supabase-js.

Each check runs as the `authenticated` role with the user's claims, exactly
like a browser request through Supabase's API. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, timedelta

import asyncpg
import pytest

from tests.conftest import TEST_DATABASE_URL

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to a local Supabase database"),
]


def run(coro):
    return asyncio.run(coro)


async def _admin(sql: str, *args):
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def admin(sql: str, *args):
    return run(_admin(sql, *args))


async def _as(user_id: uuid.UUID, sql: str, *args):
    """Runs one statement as `user_id` through RLS, then commits."""
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    try:
        async with conn.transaction():
            await conn.execute("set local role authenticated")
            await conn.execute(
                "select set_config('request.jwt.claims', $1, true)",
                json.dumps({"sub": str(user_id), "role": "authenticated"}),
            )
            return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def as_user(user_id: uuid.UUID, sql: str, *args):
    return run(_as(user_id, sql, *args))


async def _seed() -> dict[str, uuid.UUID]:
    conn = await asyncpg.connect(TEST_DATABASE_URL)
    tag = uuid.uuid4().hex[:6].upper()
    ids = {k: uuid.uuid4() for k in ("coach_a", "coach_b", "client_a", "client_b", "loner")}
    try:

        async def sign_up(key: str, invite: str | None = None) -> None:
            await conn.execute(
                """
                insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
                values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2,
                        $3::jsonb, now(), now())
                """,
                ids[key],
                f"{key}-{tag.lower()}@example.test",
                json.dumps({"full_name": f"{key} test", "invite_code": invite, "timezone": "UTC"}),
            )

        for coach, code in (("coach_a", f"RA-{tag}"), ("coach_b", f"RB-{tag}")):
            await sign_up(coach)
            await conn.execute(
                "update public.users set role = 'coach', invite_code = $2 where id = $1", ids[coach], code
            )
            await conn.execute("delete from public.client_profiles where user_id = $1", ids[coach])
        await sign_up("client_a", f"RA-{tag}")
        await sign_up("client_b", f"RB-{tag}")
        await sign_up("loner")  # no invite code: no coach yet
    finally:
        await conn.close()
    return ids


@pytest.fixture(scope="module")
def ids():
    return run(_seed())


def finish_setup(user_id: uuid.UUID, start: date) -> None:
    as_user(
        user_id,
        """
        update public.client_profiles
        set goal = 'fat_loss', start_date = $1, start_weight_kg = 74.6, goal_weight_kg = 68, check_in_day = 0,
            cleared_to_exercise = true, setup_completed_at = now()
        where user_id = auth.uid()
        """,
        start,
    )


# ---------- Roles ----------


def test_client_cannot_promote_themselves(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["client_a"], "update public.users set role = 'coach' where id = auth.uid()")
    assert admin("select role::text from public.users where id = $1", ids["client_a"])[0][0] == "client"


def test_client_cannot_give_themselves_an_invite_code(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["client_a"], "update public.users set invite_code = 'FREE-1234' where id = auth.uid()")


def test_client_cannot_read_coach_notes(ids):
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(ids["client_a"], "select coach_notes from public.client_profiles where user_id = auth.uid()")
    assert as_user(ids["client_a"], "select public.get_coach_notes(auth.uid())")[0][0] is None


# ---------- Setup and the coach dashboard ----------


def test_finishing_setup_puts_the_client_in_the_summaries(ids):
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today() - timedelta(days=10))
    rows = as_user(ids["coach_a"], "select client_id from public.weekly_summaries")
    assert ids["client_a"] in {r[0] for r in rows}


def test_coach_lists_only_their_own_clients(ids):
    mine = as_user(ids["coach_a"], "select user_id from public.client_profiles")
    assert {r[0] for r in mine} == {ids["client_a"]}
    others = as_user(ids["coach_b"], "select user_id from public.client_profiles where user_id = $1", ids["client_a"])
    assert others == []


def test_client_without_a_coach_sees_only_themselves(ids):
    rows = as_user(ids["loner"], "select user_id from public.client_profiles")
    assert [r[0] for r in rows] == [ids["loner"]]


# ---------- Targets ----------


def test_client_cannot_write_targets(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_a"],
            "insert into public.nutrition_targets (client_id, effective_from, calories, protein_g, carbs_g, fat_g,"
            " set_by) values (auth.uid(), current_date, 4000, 50, 600, 200, auth.uid())",
        )


def test_coach_sets_first_targets_and_client_reads_them(ids):
    as_user(
        ids["coach_a"],
        "insert into public.nutrition_targets (client_id, effective_from, calories, protein_g, carbs_g, fat_g,"
        " water_ml, steps, sleep_hours, set_by) values ($1, current_date, 2100, 140, 210, 70, 2500, 9000, 7.5,"
        " auth.uid())",
        ids["client_a"],
    )
    row = as_user(ids["client_a"], "select calories from public.nutrition_targets where client_id = auth.uid()")
    assert row[0][0] == 2100


def test_coach_cannot_set_another_coachs_clients_targets(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["coach_b"],
            "insert into public.nutrition_targets (client_id, effective_from, calories, protein_g, carbs_g, fat_g,"
            " set_by) values ($1, current_date + 1, 1500, 100, 100, 50, auth.uid())",
            ids["client_a"],
        )


# ---------- Client logs ----------


def test_client_logs_habits_and_rates_the_day(ids):
    sql = (
        "insert into public.daily_logs (client_id, log_date, steps, water_ml, sleep_hours, weight_kg, day_rating)"
        " values (auth.uid(), current_date, $1, $2, $3, $4, 'yes') on conflict (client_id, log_date)"
        " do update set steps = excluded.steps, water_ml = excluded.water_ml, sleep_hours = excluded.sleep_hours,"
        " weight_kg = excluded.weight_kg, day_rating = excluded.day_rating"
    )
    as_user(ids["client_a"], sql, 6420, 1500, 7.2, 74.1)
    as_user(ids["client_a"], sql, 8000, 2000, 7.2, 74.0)  # same day again: updates the row
    rows = as_user(
        ids["client_a"], "select steps, day_rating::text from public.daily_logs where client_id = auth.uid()"
    )
    assert [(r[0], r[1]) for r in rows] == [(8000, "yes")]


def test_client_logs_a_meal(ids):
    as_user(
        ids["client_a"],
        "insert into public.meal_logs (client_id, meal_type, title, calories, protein_g, carbs_g, fat_g, on_plan)"
        " values (auth.uid(), 'lunch', 'Chicken rice bowl', 610, 48, 72, 14, 'yes')",
    )
    assert (
        as_user(ids["coach_a"], "select count(*) from public.meal_logs where client_id = $1", ids["client_a"])[0][0]
        == 1
    )


def test_client_cannot_log_for_someone_else(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_b"],
            "insert into public.meal_logs (client_id, meal_type, title) values ($1, 'snack', 'x')",
            ids["client_a"],
        )
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_b"],
            "insert into public.daily_logs (client_id, log_date, steps) values ($1, current_date, 1)",
            ids["client_a"],
        )


def test_clients_and_other_coaches_cannot_see_someone_elses_logs(ids):
    for viewer in ("client_b", "coach_b", "loner"):
        assert (
            as_user(ids[viewer], "select count(*) from public.meal_logs where client_id = $1", ids["client_a"])[0][0]
            == 0
        )
        assert (
            as_user(ids[viewer], "select count(*) from public.daily_logs where client_id = $1", ids["client_a"])[0][0]
            == 0
        )


# ---------- Check-in drafts, review drafts, coach notes ----------


def test_client_saves_their_checkin_draft_but_not_status(ids):
    ci = admin(
        "insert into public.check_ins (client_id, week_start, status) values ($1, $2, 'due') returning id",
        ids["client_a"],
        date.today() - timedelta(days=date.today().weekday()),
    )[0][0]
    as_user(ids["client_a"], "update public.check_ins set waist_cm = 78, energy = 4, wins = 'x' where id = $1", ci)
    assert admin("select energy from public.check_ins where id = $1", ci)[0][0] == 4
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["client_a"], "update public.check_ins set status = 'reviewed' where id = $1", ci)


def test_review_draft_and_notes_belong_to_the_clients_coach(ids):
    ci = admin("select id from public.check_ins where client_id = $1 limit 1", ids["client_a"])[0][0]
    as_user(
        ids["coach_a"],
        "insert into public.review_drafts (check_in_id, coach_id, body) values ($1, auth.uid(), 'draft')"
        " on conflict (check_in_id) do update set body = excluded.body, updated_at = now()",
        ci,
    )
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["coach_b"],
            "insert into public.review_drafts (check_in_id, coach_id, body) values ($1, auth.uid(), 'x')"
            " on conflict (check_in_id) do update set body = excluded.body",
            ci,
        )
    as_user(ids["coach_a"], "select public.set_coach_notes($1, 'lower back tight')", ids["client_a"])
    assert as_user(ids["coach_a"], "select public.get_coach_notes($1)", ids["client_a"])[0][0] == "lower back tight"
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["coach_b"], "select public.set_coach_notes($1, 'mine now')", ids["client_a"])
    assert as_user(ids["coach_b"], "select public.get_coach_notes($1)", ids["client_a"])[0][0] is None


# ---------- Body map ----------


def test_muscle_sets_for_week_respects_rls(ids):
    monday = date.today() - timedelta(days=date.today().weekday())
    squat = admin("select id from public.exercises where name = 'Back squat' and created_by is null")[0][0]
    session = as_user(
        ids["client_a"],
        "insert into public.workout_sessions (client_id, performed_on, status)"
        " values (auth.uid(), current_date, 'done') returning id",
    )[0][0]
    for n in (1, 2, 3):
        as_user(
            ids["client_a"],
            "insert into public.set_logs (session_id, exercise_id, set_number, reps, weight_kg)"
            " values ($1, $2, $3, 6, 80)",
            session,
            squat,
            n,
        )
    sql = "select muscle::text, hard_sets from public.muscle_sets_for_week($1, $2)"
    own = dict((r[0], r[1]) for r in as_user(ids["client_a"], sql, ids["client_a"], monday))
    assert own == {"quads": 3, "glutes": 3}
    assert dict((r[0], r[1]) for r in as_user(ids["coach_a"], sql, ids["client_a"], monday)) == own
    assert as_user(ids["client_b"], sql, ids["client_a"], monday) == []


# ---------- First check-in ----------


def test_first_checkin_waits_for_three_days_in_the_program(ids):
    today = admin("select (now() at time zone 'UTC')::date")[0][0]
    dow = (today.isoweekday()) % 7  # Postgres numbering, Sunday = 0
    week_start = today - timedelta(days=6)
    week_start = week_start - timedelta(days=week_start.weekday())
    # client_b started 10 days ago (≥ 3 days in the reviewed week); client_a started today.
    admin(
        "update public.client_profiles set check_in_day = $1 where user_id = any($2::uuid[])",
        dow,
        [ids["client_a"], ids["client_b"]],
    )
    admin("update public.client_profiles set start_date = current_date where user_id = $1", ids["client_a"])
    admin(
        "delete from public.check_ins where client_id = any($1::uuid[]) and week_start = $2",
        [ids["client_a"], ids["client_b"]],
        week_start,
    )
    admin("select public.roll_check_ins()")
    opened = {r[0] for r in admin("select client_id from public.check_ins where week_start = $1", week_start)}
    assert ids["client_b"] in opened
    assert ids["client_a"] not in opened
