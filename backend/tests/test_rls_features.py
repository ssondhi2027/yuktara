"""Coach exercises (0018), skipped workouts (0019), profile pictures (0020) and
foods inside a meal (0021): who may write what, and the rules each adds.

Runs as the `authenticated` role with each user's claims. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

import json
import uuid
from datetime import date

import asyncpg
import pytest

from tests.conftest import TEST_DATABASE_URL
from tests.test_rls_live import _seed, admin, as_user, finish_setup, run

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to a local Supabase database"),
]

SAVE = "select public.save_exercise($1::jsonb)"


def exercise_json(name: str, **kw) -> str:
    return json.dumps({"name": name, "level": "beginner", "equipment": "machine", "primary": ["quads"], **kw})


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    program = as_user(
        ids["coach_a"],
        "insert into public.programs (coach_id, client_id, name, start_date, weeks)"
        " values (auth.uid(), $1, 'Test block', current_date, 8) returning id",
        ids["client_a"],
    )[0][0]
    template = as_user(
        ids["coach_a"],
        "insert into public.workout_templates (program_id, name, day_of_week) values ($1, 'Lower A', 1) returning id",
        program,
    )[0][0]
    return {**ids, "template": template}


# ---------- 0018: the coach's own exercises ----------


def test_coach_saves_an_exercise_with_muscles_and_their_client_sees_it(ids):
    tag = uuid.uuid4().hex[:6]
    eid = as_user(ids["coach_a"], SAVE, exercise_json(f"Belt squat {tag}", secondary=["glutes"]))[0][0]
    muscles = admin(
        "select muscle::text, role::text from public.exercise_muscles where exercise_id = $1 order by 1", eid
    )
    assert [tuple(m) for m in muscles] == [("glutes", "secondary"), ("quads", "primary")]
    assert admin("select created_by from public.exercises where id = $1", eid)[0][0] == ids["coach_a"]
    seen = "select id from public.exercises where id = $1"
    assert as_user(ids["client_a"], seen, eid)  # their coach's exercise
    assert as_user(ids["client_b"], seen, eid) == []  # another coach's client
    assert as_user(ids["coach_b"], seen, eid) == []


def test_editing_replaces_the_muscles_and_only_the_owner_can(ids):
    tag = uuid.uuid4().hex[:6]
    eid = as_user(ids["coach_a"], SAVE, exercise_json(f"Pendulum squat {tag}"))[0][0]
    as_user(ids["coach_a"], SAVE, exercise_json(f"Pendulum squat {tag}", id=str(eid), primary=["glutes"]))
    assert admin("select array_agg(muscle::text) from public.exercise_muscles where exercise_id = $1", eid)[0][0] == [
        "glutes"
    ]
    with pytest.raises(asyncpg.PostgresError, match="isn't yours"):
        as_user(ids["coach_b"], SAVE, exercise_json(f"Hijack {tag}", id=str(eid)))


def test_clients_cannot_add_exercises(ids):
    with pytest.raises(asyncpg.PostgresError, match="Only coaches"):
        as_user(ids["client_a"], SAVE, exercise_json(f"Mine {uuid.uuid4().hex[:6]}"))


def test_exercise_rules_names_and_muscles(ids):
    coach = ids["coach_a"]
    with pytest.raises(asyncpg.PostgresError, match="main muscle"):
        as_user(coach, SAVE, exercise_json(f"No muscles {uuid.uuid4().hex[:6]}", primary=[]))
    with pytest.raises(asyncpg.PostgresError, match="library already has"):
        as_user(coach, SAVE, exercise_json("back squat"))
    with pytest.raises(asyncpg.PostgresError):
        as_user(coach, SAVE, exercise_json("x"))  # name too short
    name = f"Duplicate {uuid.uuid4().hex[:6]}"
    as_user(coach, SAVE, exercise_json(name))
    with pytest.raises(asyncpg.UniqueViolationError):
        as_user(coach, SAVE, exercise_json(name.upper()))
    # Another coach may use the same name for their own.
    assert as_user(ids["coach_b"], SAVE, exercise_json(name))


def test_an_exercise_in_use_cannot_be_deleted(ids):
    eid = as_user(ids["coach_a"], SAVE, exercise_json(f"In use {uuid.uuid4().hex[:6]}"))[0][0]
    as_user(
        ids["coach_a"],
        "insert into public.template_exercises (workout_template_id, exercise_id, position, target_sets, target_reps)"
        " values ($1, $2, 9, 3, '10')",
        ids["template"],
        eid,
    )
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        as_user(ids["coach_a"], "delete from public.exercises where id = $1", eid)
    unused = as_user(ids["coach_a"], SAVE, exercise_json(f"Unused {uuid.uuid4().hex[:6]}"))[0][0]
    assert as_user(ids["coach_a"], "delete from public.exercises where id = $1 returning id", unused)


# ---------- 0019: skipped workouts ----------

SKIP = (
    "insert into public.workout_sessions (client_id, workout_template_id, performed_on, started_at, finished_at,"
    " status, notes) values (auth.uid(), $1, current_date, null, now(), 'skipped', $2) returning id"
)


def test_client_skips_with_a_reason_once_and_can_undo(ids):
    client, template = ids["client_a"], ids["template"]
    sid = as_user(client, SKIP, template, "Travel")[0][0]
    with pytest.raises(asyncpg.UniqueViolationError):
        as_user(client, SKIP, template, "Again")
    # The coach sees it, reason and all; nobody else does.
    assert as_user(ids["coach_a"], "select notes from public.workout_sessions where id = $1", sid)[0][0] == "Travel"
    assert as_user(ids["coach_b"], "select id from public.workout_sessions where id = $1", sid) == []
    with pytest.raises(asyncpg.PostgresError, match="was skipped"):
        as_user(
            client,
            "insert into public.set_logs (session_id, exercise_id, set_number, reps) values ($1, $2, 1, 8)",
            sid,
            admin("select id from public.exercises where name = 'Back squat' and created_by is null")[0][0],
        )
    assert as_user(client, "delete from public.workout_sessions where id = $1 returning id", sid)


def test_a_skip_has_no_start_or_duration_and_a_workout_with_sets_cant_become_one(ids):
    client = ids["client_a"]
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(
            client,
            "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
            " values (auth.uid(), current_date, now(), now(), 'skipped')",
        )
    sid = as_user(
        client,
        "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
        " values (auth.uid(), current_date - 1, null, now(), 'done') returning id",
    )[0][0]
    squat = admin("select id from public.exercises where name = 'Back squat' and created_by is null")[0][0]
    as_user(
        client,
        "insert into public.set_logs (session_id, exercise_id, set_number, reps) values ($1, $2, 1, 8)",
        sid,
        squat,
    )
    with pytest.raises(asyncpg.PostgresError, match="has sets logged"):
        as_user(client, "update public.workout_sessions set status = 'skipped' where id = $1", sid)


def test_skips_dont_count_as_training_in_the_weekly_summary(ids):
    client = ids["client_b"]
    before = admin(
        "select training_pct from public.weekly_summaries where client_id = $1 order by week_start desc limit 1", client
    )
    as_user(
        client,
        "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
        " values (auth.uid(), current_date, null, now(), 'skipped')",
    )
    after = admin(
        "select training_pct from public.weekly_summaries where client_id = $1 order by week_start desc limit 1", client
    )
    assert before == after


# ---------- 0020: profile pictures ----------


def test_avatar_path_must_be_in_the_users_own_folder(ids):
    me = ids["client_a"]
    sql = "update public.users set avatar_url = $1 where id = auth.uid() returning id"
    assert as_user(me, sql, f"{me}/avatar/2026-10-16-abc.jpg")
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(me, sql, f"{ids['client_b']}/avatar/x.jpg")
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(me, sql, f"{me}/meals/x.jpg")
    assert as_user(me, "update public.users set avatar_url = null where id = auth.uid() returning id")


def test_avatar_files_upload_to_own_folder_and_are_seen_by_coach_and_clients_only(ids):
    coach = ids["coach_a"]
    name = f"{coach}/avatar/{uuid.uuid4().hex}.jpg"
    as_user(coach, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", name)
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            coach,
            "insert into storage.objects (bucket_id, name) values ('avatars', $1)",
            f"{ids['client_a']}/avatar/x.jpg",
        )
    seen = "select name from storage.objects where bucket_id = 'avatars' and name = $1"
    assert as_user(coach, seen, name)
    assert as_user(ids["client_a"], seen, name)  # their coach
    assert as_user(ids["client_b"], seen, name) == []  # another coach's client
    assert as_user(ids["coach_b"], seen, name) == []


# ---------- 0021: foods inside a meal ----------


def meal(client: uuid.UUID) -> uuid.UUID:
    return as_user(
        client,
        "insert into public.meal_logs (client_id, eaten_at, meal_type, title, calories)"
        " values (auth.uid(), now(), 'lunch', 'Bowl', 508) returning id",
    )[0][0]


ITEM = (
    "insert into public.meal_items (meal_log_id, food_name, quantity, unit, calories, protein_g, carbs_g, fat_g)"
    " values ($1, $2, $3, $4, 260, 5, 57, 1) returning id"
)


def test_client_lists_foods_in_their_meal_and_the_coach_reads_them(ids):
    mid = meal(ids["client_a"])
    assert as_user(ids["client_a"], ITEM, mid, "Rice, cooked", 200, "g")
    assert as_user(ids["coach_a"], "select food_name from public.meal_items where meal_log_id = $1", mid)[0][0] == (
        "Rice, cooked"
    )
    assert as_user(ids["coach_b"], "select id from public.meal_items where meal_log_id = $1", mid) == []


def test_only_the_client_writes_their_foods(ids):
    mid = meal(ids["client_a"])
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(ids["coach_a"], ITEM, mid, "Coach adds", 1, "serving")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(ids["client_b"], ITEM, mid, "Someone else", 1, "serving")


def test_food_limits(ids):
    mid = meal(ids["client_a"])
    for name, qty, unit in (("", 100, "g"), ("Rice", 0, "g"), ("Rice", 100, "kg"), ("x" * 121, 1, "g")):
        with pytest.raises(asyncpg.CheckViolationError):
            as_user(ids["client_a"], ITEM, mid, name, qty, unit)
