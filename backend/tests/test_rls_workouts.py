"""RLS for workout logging (0013): the client writes their own sessions and
sets, their coach reads them, nobody else sees them.

Runs as the `authenticated` role with each user's claims, like the app's
supabase-js calls. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import asyncpg
import pytest

from tests.conftest import TEST_DATABASE_URL
from tests.test_rls_live import _seed, admin, as_user, finish_setup, run

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to a local Supabase database"),
]


def exercise(name: str) -> uuid.UUID:
    return admin("select id from public.exercises where name = $1 and created_by is null", name)[0][0]


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    # The coach assigns client_a a program with one workout: back squat, 3 sets of 6-8 at RPE 8.
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
    slot = as_user(
        ids["coach_a"],
        "insert into public.template_exercises"
        " (workout_template_id, exercise_id, position, target_sets, target_reps, target_rpe, rest_seconds)"
        " values ($1, $2, 0, 3, '6–8', 8, 120) returning id",
        template,
        exercise("Back squat"),
    )[0][0]
    return {**ids, "template": template, "slot": slot}


def start(user: uuid.UUID, template: uuid.UUID | None = None) -> uuid.UUID:
    return as_user(
        user,
        "insert into public.workout_sessions"
        " (client_id, workout_template_id, performed_on, started_at, finished_at, status)"
        " values (auth.uid(), $1, current_date, now(), null, 'partial') returning id",
        template,
    )[0][0]


def log_set(user: uuid.UUID, session: uuid.UUID, ex: uuid.UUID, n: int, *, slot=None, reps=8, kg=60, rpe=None):
    return as_user(
        user,
        "insert into public.set_logs (session_id, exercise_id, template_exercise_id, set_number, reps, weight_kg, rpe)"
        " values ($1, $2, $3, $4, $5, $6, $7)"
        " on conflict (session_id, exercise_id, set_number)"
        " do update set reps = excluded.reps, weight_kg = excluded.weight_kg, rpe = excluded.rpe returning id",
        session,
        ex,
        slot,
        n,
        reps,
        kg,
        rpe,
    )


def finish(user: uuid.UUID, session: uuid.UUID) -> None:
    as_user(
        user,
        "update public.workout_sessions"
        " set finished_at = now(), duration_min = 45, status = 'done', notes = 'Felt good' where id = $1",
        session,
    )


# ---------- The client logs ----------


def test_client_logs_a_planned_session_with_a_swap_and_rpe(ids):
    session = start(ids["client_a"], ids["template"])
    # Planned back squat swapped for goblet squat, for this session only.
    log_set(ids["client_a"], session, exercise("Goblet squat"), 1, slot=ids["slot"], reps=10, kg=24, rpe=7.5)
    log_set(ids["client_a"], session, exercise("Goblet squat"), 2, slot=ids["slot"], reps=10, kg=24, rpe=8)
    # Editing a ticked set re-saves it.
    log_set(ids["client_a"], session, exercise("Goblet squat"), 2, slot=ids["slot"], reps=9, kg=24, rpe=8.5)
    finish(ids["client_a"], session)
    rows = admin(
        "select set_number, reps, rpe, template_exercise_id from public.set_logs where session_id = $1 order by 1",
        session,
    )
    assert [(r[0], r[1], float(r[2])) for r in rows] == [(1, 10, 7.5), (2, 9, 8.5)]
    assert all(r[3] == ids["slot"] for r in rows)
    s = admin(
        "select status::text, finished_at is not null, duration_min from public.workout_sessions where id = $1", session
    )
    assert tuple(s[0]) == ("done", True, 45)
    # The program itself is unchanged: the swap lives on the sets.
    planned = admin("select exercise_id from public.template_exercises where id = $1", ids["slot"])[0][0]
    assert planned == exercise("Back squat")


def test_client_logs_their_own_workout_and_can_remove_sets(ids):
    session = start(ids["client_a"])
    set_id = log_set(ids["client_a"], session, exercise("Push-up"), 1, reps=15, kg=None)[0][0]  # bodyweight: no weight
    assert as_user(ids["client_a"], "delete from public.set_logs where id = $1 returning id", set_id)
    assert as_user(ids["client_a"], "delete from public.workout_sessions where id = $1 returning id", session)


def test_only_one_open_session_at_a_time(ids):
    session = start(ids["client_a"])
    with pytest.raises(asyncpg.UniqueViolationError):
        start(ids["client_a"])
    as_user(ids["client_a"], "delete from public.workout_sessions where id = $1", session)


def test_logged_values_are_checked(ids):
    session = start(ids["client_a"])
    squat = exercise("Back squat")
    for kwargs in ({"reps": 101}, {"kg": 1000.5}, {"rpe": 8.3}, {"rpe": 0.5}):
        with pytest.raises(asyncpg.CheckViolationError):
            log_set(ids["client_a"], session, squat, 1, **kwargs)
    log_set(ids["client_a"], session, squat, 1, reps=0, kg=0, rpe=10)  # the edges are fine
    as_user(ids["client_a"], "delete from public.workout_sessions where id = $1", session)


# ---------- Nobody else writes ----------


def test_client_cannot_log_for_or_read_another_client(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_b"],
            "insert into public.workout_sessions (client_id, performed_on) values ($1, current_date)",
            ids["client_a"],
        )
    theirs = start(ids["client_a"])
    log_set(ids["client_a"], theirs, exercise("Back squat"), 1)
    with pytest.raises(asyncpg.PostgresError):
        log_set(ids["client_b"], theirs, exercise("Back squat"), 2)
    other = ids["client_b"]
    assert as_user(other, "select id from public.workout_sessions where client_id = $1", ids["client_a"]) == []
    assert as_user(other, "select id from public.set_logs where session_id = $1", theirs) == []
    assert as_user(other, "update public.set_logs set reps = 1 where session_id = $1 returning id", theirs) == []
    assert as_user(other, "delete from public.workout_sessions where id = $1 returning id", theirs) == []
    as_user(ids["client_a"], "delete from public.workout_sessions where id = $1", theirs)


def test_client_cannot_use_another_clients_program(ids):
    with pytest.raises(asyncpg.PostgresError):
        start(ids["client_b"], ids["template"])
    own = start(ids["client_b"])
    with pytest.raises(asyncpg.PostgresError):
        log_set(ids["client_b"], own, exercise("Back squat"), 1, slot=ids["slot"])
    as_user(ids["client_b"], "delete from public.workout_sessions where id = $1", own)


def test_coach_reads_but_cannot_write(ids):
    session = start(ids["client_a"], ids["template"])
    log_set(ids["client_a"], session, exercise("Back squat"), 1, slot=ids["slot"], reps=6, kg=80)
    coach = ids["coach_a"]
    assert as_user(coach, "select id from public.workout_sessions where id = $1", session)
    assert as_user(coach, "select reps from public.set_logs where session_id = $1", session)[0][0] == 6

    with pytest.raises(asyncpg.PostgresError):
        as_user(
            coach,
            "insert into public.workout_sessions (client_id, performed_on) values ($1, current_date)",
            ids["client_a"],
        )
    with pytest.raises(asyncpg.PostgresError):
        log_set(coach, session, exercise("Back squat"), 2)
    assert as_user(coach, "update public.set_logs set reps = 12 where session_id = $1 returning id", session) == []
    assert as_user(coach, "update public.workout_sessions set notes = 'x' where id = $1 returning id", session) == []
    assert as_user(coach, "delete from public.set_logs where session_id = $1 returning id", session) == []
    assert as_user(coach, "delete from public.workout_sessions where id = $1 returning id", session) == []
    assert admin("select reps from public.set_logs where session_id = $1", session)[0][0] == 6
    as_user(ids["client_a"], "delete from public.workout_sessions where id = $1", session)


def test_another_coach_cannot_read(ids):
    session = start(ids["client_a"])
    log_set(ids["client_a"], session, exercise("Back squat"), 1)
    assert as_user(ids["coach_b"], "select id from public.workout_sessions where client_id = $1", ids["client_a"]) == []
    assert as_user(ids["coach_b"], "select id from public.set_logs where session_id = $1", session) == []
    as_user(ids["client_a"], "delete from public.workout_sessions where id = $1", session)


# ---------- Body map ----------


def test_logged_sets_count_on_the_body_map_while_the_session_is_open(ids):
    monday = date.today() - timedelta(days=date.today().weekday())
    sql = "select muscle::text, hard_sets from public.muscle_sets_for_week($1, $2)"
    before = dict((r[0], r[1]) for r in as_user(ids["client_b"], sql, ids["client_b"], monday))
    session = start(ids["client_b"])
    for n in (1, 2):
        log_set(ids["client_b"], session, exercise("Lat pulldown"), n, reps=10, kg=40, rpe=8)
    after = dict((r[0], r[1]) for r in as_user(ids["client_b"], sql, ids["client_b"], monday))
    assert after.get("lats", 0) == before.get("lats", 0) + 2
    assert after.get("upper_back", 0) == before.get("upper_back", 0) + 2
    finish(ids["client_b"], session)
    done = dict((r[0], r[1]) for r in as_user(ids["client_b"], sql, ids["client_b"], monday))
    assert done == after
