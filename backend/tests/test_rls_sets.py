"""Drop sets and supersets (0024): the rules on set_logs, hard-set counting, and
superset labels kept by save_program and copy_program.

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

SET = (
    "insert into public.set_logs (session_id, exercise_id, set_number, reps, weight_kg, is_warmup, set_kind, drop_of)"
    " values ($1, $2, $3, $4, $5, $6, $7, $8) returning id"
)


def exercise(name: str) -> uuid.UUID:
    return admin("select id from public.exercises where name = $1 and created_by is null", name)[0][0]


def session(user: uuid.UUID) -> uuid.UUID:
    # A finished workout of the client's own (so the open-workout rule doesn't get in the way).
    return as_user(
        user,
        "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
        " values (auth.uid(), current_date, now(), now(), 'done') returning id",
    )[0][0]


def log(user, sid, ex, n, kg, reps=8, *, warmup=False, drop_of=None):
    return as_user(user, SET, sid, ex, n, reps, kg, warmup, "drop" if drop_of else "normal", drop_of)


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    return ids


# ---------- drop sets ----------


def test_drops_follow_a_working_set_and_several_can_chain(ids):
    me, bench = ids["client_a"], exercise("Dumbbell bench press")
    sid = session(me)
    log(me, sid, bench, 1, 20)
    assert log(me, sid, bench, 2, 15, 10, drop_of=1)
    assert log(me, sid, bench, 3, 10, 12, drop_of=1)
    rows = as_user(
        me, "select set_number, set_kind, drop_of from public.set_logs where session_id = $1 order by 1", sid
    )
    assert [tuple(r) for r in rows] == [(1, "normal", None), (2, "drop", 1), (3, "drop", 1)]


def test_a_drop_needs_its_working_set_and_never_on_a_warm_up(ids):
    me, bench = ids["client_a"], exercise("Dumbbell bench press")
    sid = session(me)
    with pytest.raises(asyncpg.PostgresError, match="Tick that set first"):
        log(me, sid, bench, 2, 15, drop_of=1)  # no set 1
    log(me, sid, bench, 1, 10, 12, warmup=True)
    with pytest.raises(asyncpg.PostgresError, match="Tick that set first"):
        log(me, sid, bench, 2, 8, drop_of=1)  # set 1 is a warm-up
    with pytest.raises(asyncpg.CheckViolationError):
        log(me, sid, bench, 3, 8, warmup=True, drop_of=1)  # a warm-up drop
    other = exercise("Seated cable row")
    log(me, sid, other, 5, 40)
    with pytest.raises(asyncpg.PostgresError, match="Tick that set first"):
        log(me, sid, bench, 6, 30, drop_of=5)  # set 5 is another exercise's


def test_a_set_with_drops_cant_become_a_warm_up_and_unticking_it_takes_the_drops(ids):
    me, bench = ids["client_a"], exercise("Dumbbell bench press")
    sid = session(me)
    log(me, sid, bench, 1, 20)
    log(me, sid, bench, 2, 15, drop_of=1)
    with pytest.raises(asyncpg.PostgresError, match="has drops"):
        as_user(me, "update public.set_logs set is_warmup = true where session_id = $1 and set_number = 1", sid)
    as_user(me, "delete from public.set_logs where session_id = $1 and set_number = 1", sid)
    assert as_user(me, "select count(*) from public.set_logs where session_id = $1", sid)[0][0] == 0


def test_another_user_cant_write_drops_into_my_workout(ids):
    me, bench = ids["client_a"], exercise("Dumbbell bench press")
    sid = session(me)
    log(me, sid, bench, 1, 20)
    for intruder in ("client_b", "coach_a"):
        # Refused either by RLS or by the drop check (which can't see someone else's set).
        with pytest.raises((asyncpg.InsufficientPrivilegeError, asyncpg.CheckViolationError)):
            log(ids[intruder], sid, bench, 2, 15, drop_of=1)
    assert admin("select count(*) from public.set_logs where session_id = $1", sid)[0][0] == 1


def test_the_body_map_counts_a_set_with_drops_once(ids):
    me = ids["client_b"]
    lunge = exercise("Walking lunge")  # quads and glutes
    week = admin("select date_trunc('week', current_date)::date")[0][0]
    count = "select hard_sets from public.muscle_sets_for_week(auth.uid(), $1) where muscle = 'quads'"
    before = (as_user(me, count, week) or [[0]])[0][0]
    sid = session(me)
    log(me, sid, lunge, 1, 20, 10)
    log(me, sid, lunge, 2, 14, 12, drop_of=1)
    log(me, sid, lunge, 3, 8, 15, drop_of=1)
    log(me, sid, lunge, 4, 20, 10)
    assert as_user(me, count, week)[0][0] == before + 2


# ---------- supersets ----------


def program_json(client: uuid.UUID | None, items: list[tuple[str, str | None]]) -> str:
    return json.dumps(
        {
            "client_id": str(client) if client else None,
            "name": "Superset test",
            "weeks": 4,
            "workouts": [
                {
                    "name": "Upper",
                    "day_of_week": 1,
                    "notes": "",
                    "exercises": [
                        {
                            "exercise_id": str(exercise(name)),
                            "target_sets": 3,
                            "target_reps": "12",
                            "target_rpe": 8,
                            "rest_seconds": None if group else 90,
                            "notes": "",
                            "superset_group": group,
                        }
                        for name, group in items
                    ],
                }
            ],
        }
    )


def groups(program: uuid.UUID) -> list[tuple[str, str | None]]:
    rows = admin(
        "select e.name, te.superset_group from public.template_exercises te"
        " join public.workout_templates wt on wt.id = te.workout_template_id"
        " join public.exercises e on e.id = te.exercise_id"
        " where wt.program_id = $1 and te.removed_at is null order by te.position",
        program,
    )
    return [tuple(r) for r in rows]


def test_superset_labels_survive_save_and_copy(ids):
    coach = ids["coach_a"]
    items = [("Dumbbell bench press", None), ("Lateral raise", "a"), ("Face pull", "A"), ("Dumbbell curl", None)]
    pid = as_user(coach, "select public.save_program($1::jsonb)", program_json(ids["client_a"], items))[0][0]
    expected = [("Dumbbell bench press", None), ("Lateral raise", "A"), ("Face pull", "A"), ("Dumbbell curl", None)]
    assert groups(pid) == expected  # labels upper-cased
    template = as_user(coach, "select public.copy_program($1, null)", pid)[0][0]
    assert groups(template) == expected
    copy = as_user(coach, "select public.copy_program($1, $2)", template, ids["client_a"])[0][0]
    assert groups(copy) == expected
    # Saving again with the pair undone clears it.
    as_user(
        coach,
        "select public.save_program($1::jsonb)",
        json.dumps({**json.loads(program_json(ids["client_a"], [(n, None) for n, _ in items])), "id": str(pid)}),
    )
    assert all(g is None for _, g in groups(pid))


def test_superset_labels_are_one_or_two_letters_and_only_the_coach_writes_them(ids):
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(
            ids["coach_a"],
            "select public.save_program($1::jsonb)",
            program_json(ids["client_a"], [("Lateral raise", "A1"), ("Face pull", "A1")]),
        )
    pid = as_user(
        ids["coach_a"],
        "select public.save_program($1::jsonb)",
        program_json(ids["client_a"], [("Lateral raise", None), ("Face pull", None)]),
    )[0][0]
    rows = as_user(
        ids["client_a"],
        "update public.template_exercises set superset_group = 'Z' where workout_template_id in"
        " (select id from public.workout_templates where program_id = $1) returning id",
        pid,
    )
    assert rows == []
