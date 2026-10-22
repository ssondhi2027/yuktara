"""Personal records (0025): the client saves their own (save_personal_records),
the client and their coach read them, nobody else does, and nobody changes or
deletes one.

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

SAVE = "select public.save_personal_records($1::jsonb)"
READ = (
    "select kind, value, previous, set_number, milestone from public.personal_records"
    " where session_id = $1 order by kind"
)


def exercise(name: str) -> uuid.UUID:
    return admin("select id from public.exercises where name = $1 and created_by is null", name)[0][0]


def session(user: uuid.UUID, *, finished: bool = True, skipped: bool = False) -> uuid.UUID:
    if skipped:
        sql = (
            "insert into public.workout_sessions (client_id, performed_on, finished_at, status)"
            " values (auth.uid(), current_date, now(), 'skipped') returning id"
        )
    else:
        sql = (
            "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
            " values (auth.uid(), current_date, now(), now(), 'done') returning id"
            if finished
            else "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
            " values (auth.uid(), current_date, now(), null, 'partial') returning id"
        )
    return as_user(user, sql)[0][0]


def rec(sid, ex, kind="weight", value=82.5, previous=80, set_number=1, milestone=None, **extra):
    row = {
        "session_id": str(sid),
        "exercise_id": str(ex) if ex else None,
        "kind": kind,
        "milestone": milestone,
        "value": value,
        "previous": previous,
        "set_number": set_number,
        "weight_kg": 82.5,
        "reps": 6,
        "rpe": 8,
    }
    return {**row, **extra}


def save(user, *recs) -> int:
    return as_user(user, SAVE, json.dumps(list(recs)))[0][0]


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    return ids


def test_client_saves_and_reads_their_own_records_dated_by_the_workout(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    assert save(me, rec(sid, squat), rec(sid, squat, "e1rm", 101.3, 98.7)) == 2
    rows = as_user(me, READ, sid)
    assert [(r["kind"], float(r["value"]), float(r["previous"])) for r in rows] == [
        ("e1rm", 101.3, 98.7),
        ("weight", 82.5, 80.0),
    ]
    day = admin("select performed_on from public.workout_sessions where id = $1", sid)[0][0]
    assert {
        r[0] for r in as_user(me, "select achieved_on from public.personal_records where session_id = $1", sid)
    } == {day}


def test_saving_again_keeps_what_was_saved(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    assert save(me, rec(sid, squat)) == 1
    # The same record again (say the sets were edited since): nothing changes.
    assert save(me, rec(sid, squat, value=90, previous=82.5)) == 0
    assert float(as_user(me, READ, sid)[0]["value"]) == 82.5


def test_each_milestone_is_earned_once(ids):
    me, bench = ids["client_a"], exercise("Barbell bench press")
    a, b = session(me), session(me)
    m = {"kind": "milestone", "previous": None, "milestone": "load:bench:60kg", "value": 60}
    assert save(me, rec(a, bench, **m)) == 1
    assert save(me, rec(b, bench, **m)) == 0
    assert (
        save(
            me,
            rec(
                b,
                None,
                kind="milestone",
                milestone="workouts:10",
                value=10,
                previous=None,
                set_number=None,
                reps=None,
                weight_kg=None,
            ),
        )
        == 1
    )


def test_coach_reads_their_clients_records_and_nobody_else_does(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    save(me, rec(sid, squat))
    assert len(as_user(ids["coach_a"], READ, sid)) == 1
    for other in ("coach_b", "client_b", "loner"):
        assert as_user(ids[other], READ, sid) == []


def test_only_the_client_writes_and_only_into_their_own_finished_workouts(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    for intruder in ("coach_a", "client_b", "coach_b"):
        # Another user's workout isn't visible to them (nothing to save) or RLS refuses it.
        try:
            assert save(ids[intruder], rec(sid, squat)) == 0
        except asyncpg.InsufficientPrivilegeError:
            pass
    assert admin("select count(*) from public.personal_records where session_id = $1", sid)[0][0] == 0
    # Not into an open workout, or a skipped one.
    open_sid = session(ids["client_b"], finished=False)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        save(ids["client_b"], rec(open_sid, squat))
    as_user(ids["client_b"], "delete from public.workout_sessions where id = $1", open_sid)
    skipped = session(ids["client_b"], skipped=True)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        save(ids["client_b"], rec(skipped, squat))
    # Not as another client, even into their own workout.
    mine = session(ids["client_b"])
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(
            ids["client_b"],
            "insert into public.personal_records"
            " (client_id, session_id, exercise_id, kind, value, set_number, reps, achieved_on)"
            " values ($1, $2, $3, 'weight', 80, 1, 5, current_date)",
            me,
            mine,
            squat,
        )


def test_nobody_changes_or_deletes_a_record(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    save(me, rec(sid, squat))
    for user in (me, ids["coach_a"]):
        as_user(user, "update public.personal_records set value = 500 where session_id = $1", sid)
        as_user(user, "delete from public.personal_records where session_id = $1", sid)
    assert [
        float(r["value"]) for r in admin("select value from public.personal_records where session_id = $1", sid)
    ] == [82.5]


def test_bad_rows_are_refused(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    with pytest.raises(asyncpg.CheckViolationError):
        save(me, rec(sid, squat, kind="best"))
    with pytest.raises(asyncpg.CheckViolationError):
        save(me, rec(sid, squat, value=0))
    with pytest.raises(asyncpg.CheckViolationError):
        save(me, rec(sid, squat, kind="milestone"))  # a milestone needs its key
    with pytest.raises(asyncpg.CheckViolationError):
        save(me, rec(sid, squat, kind="milestone", milestone="Not A Key!"))
    with pytest.raises(asyncpg.PostgresError, match="Too many"):
        save(me, *[rec(sid, squat, set_number=i % 90 + 1) for i in range(501)])


def test_deleting_the_workout_takes_its_records(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    save(me, rec(sid, squat))
    as_user(me, "delete from public.workout_sessions where id = $1", sid)
    assert admin("select count(*) from public.personal_records where session_id = $1", sid)[0][0] == 0
