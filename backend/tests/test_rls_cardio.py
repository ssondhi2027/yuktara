"""Cardio (0026): cardio exercises and their logged bouts, coach-made cardio
exercises, planned cardio in programs, and cardio personal records.

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

BOUT = (
    "insert into public.set_logs (session_id, exercise_id, set_number, reps, weight_kg, is_warmup, set_kind,"
    " duration_s, distance_m, level, avg_hr) values ($1, $2, $3, $4, $5, $6, 'normal', $7, $8, $9, $10) returning id"
)


def exercise(name: str) -> uuid.UUID:
    return admin("select id from public.exercises where name = $1 and created_by is null", name)[0][0]


def session(user: uuid.UUID) -> uuid.UUID:
    return as_user(
        user,
        "insert into public.workout_sessions (client_id, performed_on, started_at, finished_at, status)"
        " values (auth.uid(), current_date, now(), now(), 'done') returning id",
    )[0][0]


def bout(user, sid, ex, n, seconds, metres=None, *, reps=None, kg=None, warmup=False, level=None, hr=None):
    return as_user(user, BOUT, sid, ex, n, reps, kg, warmup, seconds, metres, level, hr)


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    return ids


def test_the_cardio_library_has_no_muscles():
    rows = admin(
        "select e.name, count(em.muscle) from public.exercises e left join public.exercise_muscles em"
        " on em.exercise_id = e.id where e.kind = 'cardio' and e.created_by is null group by 1"
    )
    names = {r[0] for r in rows}
    assert {"Treadmill run", "Stationary bike", "Rowing machine", "Elliptical", "Swimming"} <= names
    assert all(r[1] == 0 for r in rows)
    assert (
        admin("select kind from public.exercises where name = 'Back squat' and created_by is null")[0][0] == "strength"
    )


def test_a_cardio_bout_has_a_time_and_no_weight_reps_or_warm_up(ids):
    me, run_ex = ids["client_a"], exercise("Treadmill run")
    sid = session(me)
    assert bout(me, sid, run_ex, 1, 1800, 5000, level=1.5, hr=150)
    assert bout(me, sid, run_ex, 2, 600)  # distance and the rest are optional
    for kwargs, why in (
        ({"seconds": None}, "Enter how long"),
        ({"seconds": 600, "kg": 20}, "without weight"),
        ({"seconds": 600, "reps": 10}, "without weight"),
        ({"seconds": 600, "warmup": True}, "without weight"),
    ):
        seconds = kwargs.pop("seconds")
        with pytest.raises(asyncpg.PostgresError, match=why):
            bout(me, sid, run_ex, 9, seconds, **kwargs)
    with pytest.raises(asyncpg.CheckViolationError):
        bout(me, sid, run_ex, 9, 600, hr=300)
    with pytest.raises(asyncpg.CheckViolationError):
        bout(me, sid, run_ex, 9, 0)


def test_a_strength_set_has_no_cardio_fields(ids):
    me, squat = ids["client_a"], exercise("Back squat")
    sid = session(me)
    assert bout(me, sid, squat, 1, None, reps=5, kg=60)
    with pytest.raises(asyncpg.PostgresError, match="for cardio exercises"):
        bout(me, sid, squat, 2, 600, reps=5, kg=60)
    with pytest.raises(asyncpg.PostgresError, match="for cardio exercises"):
        bout(me, sid, squat, 2, None, 500, reps=5, kg=60)


def test_cardio_isnt_counted_on_the_body_map(ids):
    me = ids["client_a"]
    week = admin("select date_trunc('week', current_date)::date")[0][0]
    count = "select coalesce(sum(hard_sets), 0) from public.muscle_sets_for_week(auth.uid(), $1)"
    before = as_user(me, count, week)[0][0]
    sid = session(me)
    bout(me, sid, exercise("Rowing machine"), 1, 1200, 4000)
    bout(me, sid, exercise("Stationary bike"), 1, 900)
    assert as_user(me, count, week)[0][0] == before


def test_coach_cardio_exercises_have_no_muscles_and_keep_their_kind_once_used(ids):
    coach = ids["coach_a"]
    body = {
        "name": f"Sled push {uuid.uuid4().hex[:6]}",
        "level": "intermediate",
        "equipment": "sled",
        "cue": "",
        "kind": "cardio",
    }
    eid = as_user(coach, "select public.save_exercise($1::jsonb)", json.dumps({**body, "primary": ["quads"]}))[0][0]
    assert admin("select kind from public.exercises where id = $1", eid)[0][0] == "cardio"
    assert admin("select count(*) from public.exercise_muscles where exercise_id = $1", eid)[0][0] == 0
    # A strength exercise still needs a main muscle.
    with pytest.raises(asyncpg.PostgresError, match="at least one main muscle"):
        as_user(
            coach,
            "select public.save_exercise($1::jsonb)",
            json.dumps({**body, "name": "Nope lift", "kind": "strength"}),
        )
    # Unused: it can switch; logged: it can't.
    as_user(
        coach,
        "select public.save_exercise($1::jsonb)",
        json.dumps({**body, "id": str(eid), "kind": "strength", "primary": ["quads"]}),
    )
    as_user(coach, "select public.save_exercise($1::jsonb)", json.dumps({**body, "id": str(eid), "kind": "cardio"}))
    me = ids["client_a"]
    bout(me, session(me), eid, 1, 300, 50)
    with pytest.raises(asyncpg.PostgresError, match="can't switch between strength and cardio"):
        as_user(
            coach,
            "select public.save_exercise($1::jsonb)",
            json.dumps({**body, "id": str(eid), "kind": "strength", "primary": ["quads"]}),
        )
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_a"], "select public.save_exercise($1::jsonb)", json.dumps({**body, "name": "Client cardio"})
        )


def plan(client, items) -> str:
    return json.dumps(
        {
            "client_id": str(client) if client else None,
            "name": "Cardio plan",
            "weeks": 4,
            "workouts": [
                {
                    "name": "Conditioning",
                    "day_of_week": 3,
                    "notes": "",
                    "exercises": [
                        {
                            "exercise_id": str(exercise(name)),
                            "target_sets": sets,
                            "target_reps": reps,
                            "target_rpe": None,
                            "rest_seconds": rest,
                            "notes": "",
                            "target_minutes": minutes,
                            "target_distance_m": metres,
                            "target_zone": zone,
                        }
                        for name, sets, reps, rest, minutes, metres, zone in items
                    ],
                }
            ],
        }
    )


def targets(program):
    rows = admin(
        "select e.name, te.target_sets, te.target_minutes, te.target_distance_m, te.target_zone, te.rest_seconds"
        " from public.template_exercises te join public.workout_templates wt on wt.id = te.workout_template_id"
        " join public.exercises e on e.id = te.exercise_id where wt.program_id = $1 and te.removed_at is null"
        " order by te.position",
        program,
    )
    return [(r[0], r[1], r[2] and float(r[2]), r[3] and float(r[3]), r[4], r[5]) for r in rows]


def test_planned_cardio_survives_save_and_copy(ids):
    coach = ids["coach_a"]
    items = [
        ("Stationary bike", 1, "20 min · easy", None, 20, None, "easy"),
        ("Rowing machine", 5, "1 min hard", 60, 1, None, "hard"),
        ("Treadmill run", 1, "5 km", None, None, 5000, "moderate"),
    ]
    pid = as_user(coach, "select public.save_program($1::jsonb)", plan(ids["client_a"], items))[0][0]
    expected = [
        ("Stationary bike", 1, 20.0, None, "easy", None),
        ("Rowing machine", 5, 1.0, None, "hard", 60),
        ("Treadmill run", 1, None, 5000.0, "moderate", None),
    ]
    assert targets(pid) == expected
    template = as_user(coach, "select public.copy_program($1, null)", pid)[0][0]
    assert targets(template) == expected
    # Saving again changes them in place.
    items[0] = ("Stationary bike", 1, "30 min · easy", None, 30, None, "easy")
    as_user(
        coach,
        "select public.save_program($1::jsonb)",
        json.dumps({**json.loads(plan(ids["client_a"], items)), "id": str(pid)}),
    )
    assert targets(pid)[0][2] == 30.0
    with pytest.raises(asyncpg.CheckViolationError):
        bad = [("Stationary bike", 1, "x", None, 20, None, "warp speed")]
        as_user(coach, "select public.save_program($1::jsonb)", plan(ids["client_a"], bad))


def test_cardio_personal_records(ids):
    me, run_ex = ids["client_a"], exercise("Treadmill run")
    sid = session(me)
    bout(me, sid, run_ex, 1, 1800, 5000)
    recs = [
        {
            "session_id": str(sid),
            "exercise_id": str(run_ex),
            "kind": "distance",
            "milestone": None,
            "value": 5,
            "previous": 4,
            "set_number": 1,
            "weight_kg": None,
            "reps": None,
            "rpe": None,
            "duration_s": 1800,
            "distance_m": 5000,
        },
        {
            "session_id": str(sid),
            "exercise_id": str(run_ex),
            "kind": "pace",
            "milestone": None,
            "value": 360,
            "previous": 375,
            "set_number": 1,
            "weight_kg": None,
            "reps": None,
            "rpe": None,
            "duration_s": 1800,
            "distance_m": 5000,
        },
        {
            "session_id": str(sid),
            "exercise_id": str(run_ex),
            "kind": "milestone",
            "milestone": "dist:run:5",
            "value": 5,
            "previous": None,
            "set_number": 1,
            "weight_kg": None,
            "reps": None,
            "rpe": None,
            "duration_s": 1800,
            "distance_m": 5000,
        },
    ]
    assert as_user(me, "select public.save_personal_records($1::jsonb)", json.dumps(recs))[0][0] == 3
    rows = as_user(
        ids["coach_a"],
        "select kind, value, duration_s, distance_m from public.personal_records where session_id = $1 order by kind",
        sid,
    )
    assert [(r[0], float(r[1]), r[2], float(r[3])) for r in rows] == [
        ("distance", 5.0, 1800, 5000.0),
        ("milestone", 5.0, 1800, 5000.0),
        ("pace", 360.0, 1800, 5000.0),
    ]
    # A cardio record needs its bout's time; a strength record still needs reps.
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(
            me,
            "select public.save_personal_records($1::jsonb)",
            json.dumps([{**recs[0], "kind": "duration", "duration_s": None}]),
        )
    with pytest.raises(asyncpg.CheckViolationError):
        as_user(
            me,
            "select public.save_personal_records($1::jsonb)",
            json.dumps([{**recs[0], "kind": "weight", "set_number": 2}]),
        )
