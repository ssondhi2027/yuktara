"""Programs (0015): a coach builds, edits and assigns programs for their own
clients; clients read their assigned program and never write it; editing a
running program never rewrites logged sessions or sets.

Runs as the `authenticated` role with each user's claims, like the apps'
supabase-js calls. Needs TEST_DATABASE_URL.
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


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    return ids


def exercise(name: str) -> str:
    return str(admin("select id from public.exercises where name = $1 and created_by is null", name)[0][0])


def utc_today() -> date:
    return admin("select (now() at time zone 'UTC')::date")[0][0]


def body(client: uuid.UUID | None, **over) -> dict:
    b = {
        "client_id": str(client) if client else None,
        "name": "Strength block",
        "weeks": 8,
        "goal": "muscle_gain",
        "level": "intermediate",
        "days_per_week": 2,
        "workouts": [
            {
                "name": "Upper",
                "day_of_week": 1,
                "exercises": [
                    {
                        "exercise_id": exercise("Dumbbell bench press"),
                        "target_sets": 3,
                        "target_reps": "8-10",
                        "target_rpe": 8,
                        "rest_seconds": 120,
                        "notes": "Pause on the chest",
                    },
                    {"exercise_id": exercise("Lat pulldown"), "target_sets": 3, "target_reps": "10-12"},
                ],
            },
            {
                "name": "Lower",
                "day_of_week": 4,
                "exercises": [{"exercise_id": exercise("Back squat"), "target_sets": 4, "target_reps": "6-8"}],
            },
        ],
    }
    b.update(over)
    return b


def save(user: uuid.UUID, b: dict) -> uuid.UUID:
    return as_user(user, "select public.save_program($1::jsonb)", json.dumps(b))[0][0]


def load(program: uuid.UUID) -> dict:
    """The saved program as the builder would read it back (admin, live rows only)."""
    rows = admin(
        "select t.id, t.name, t.day_of_week, x.id, x.exercise_id, x.target_sets, x.target_reps"
        " from public.workout_templates t left join public.template_exercises x"
        "   on x.workout_template_id = t.id and x.removed_at is null"
        " where t.program_id = $1 and t.removed_at is null order by t.position, x.position",
        program,
    )
    out: dict = {}
    for wid, name, dow, xid, ex, sets, reps in rows:
        w = out.setdefault(str(wid), {"id": str(wid), "name": name, "day_of_week": dow, "exercises": []})
        if xid:
            w["exercises"].append({"id": str(xid), "exercise_id": str(ex), "target_sets": sets, "target_reps": reps})
    return {"workouts": list(out.values())}


def assign(user: uuid.UUID, program: uuid.UUID, start: date) -> None:
    as_user(user, "select public.assign_program($1, $2)", program, start)


def client_programs(client: uuid.UUID) -> list:
    return as_user(client, "select id, start_date from public.programs order by start_date nulls first")


# ---------- The coach builds and assigns ----------


def test_coach_creates_edits_and_assigns_for_their_client(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], draft_start=str(utc_today())))
    # A draft is invisible to the client: no program, no workouts.
    assert client_programs(ids["client_a"]) == []
    assert as_user(ids["client_a"], "select id from public.workout_templates where program_id = $1", pid) == []

    # Edit: rename, change sets, drop an exercise, add a workout.
    b = body(ids["client_a"], id=str(pid), name="Strength block v2", **load(pid))
    b["workouts"][0]["exercises"][0]["target_sets"] = 4
    b["workouts"][0]["exercises"].pop(1)
    b["workouts"].append({"name": "Full body", "day_of_week": 6, "exercises": []})
    assert save(ids["coach_a"], b) == pid
    saved = load(pid)
    assert [w["name"] for w in saved["workouts"]] == ["Upper", "Lower", "Full body"]
    assert [x["target_sets"] for x in saved["workouts"][0]["exercises"]] == [4]

    assign(ids["coach_a"], pid, utc_today())
    assert [r[0] for r in client_programs(ids["client_a"])] == [pid]
    assert len(as_user(ids["client_a"], "select id from public.workout_templates where program_id = $1", pid)) == 3


def test_builder_values_are_checked(ids):
    for bad in ({"target_sets": 11}, {"target_sets": 0}, {"target_rpe": 11}, {"target_reps": " "}):
        b = body(ids["client_a"])
        b["workouts"][0]["exercises"][0].update(bad)
        with pytest.raises(asyncpg.PostgresError):
            save(ids["coach_a"], b)


def test_assigning_a_new_program_ends_the_previous_one(ids):
    old = save(ids["coach_a"], body(ids["client_a"], name="Old"))
    assign(ids["coach_a"], old, utc_today())
    new = save(ids["coach_a"], body(ids["client_a"], name="New"))
    assign(ids["coach_a"], new, utc_today())
    # Both started this week: the old one is unscheduled, the new one is the client's current program.
    current = as_user(
        ids["client_a"],
        "select id from public.programs where start_date <= $1 order by start_date desc limit 1",
        utc_today(),
    )
    assert current[0][0] == new
    assert admin("select start_date from public.programs where id = $1", old)[0][0] is None


# ---------- Nobody else ----------


def test_another_coach_cannot_read_edit_or_assign(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], name="Private plan"))
    other = ids["coach_b"]
    assert as_user(other, "select id from public.programs where id = $1", pid) == []
    with pytest.raises(asyncpg.PostgresError) as e:
        save(other, body(ids["client_a"], id=str(pid), **load(pid)))
    assert e.value.sqlstate == "PT404"
    with pytest.raises(asyncpg.PostgresError):
        assign(other, pid, utc_today())
    with pytest.raises(asyncpg.PostgresError):
        as_user(other, "select public.copy_program($1, null)", pid)
    with pytest.raises(asyncpg.PostgresError):
        save(other, body(ids["client_a"]))  # a program for someone else's client
    assert as_user(other, "delete from public.programs where id = $1 returning id", pid) == []


def test_client_reads_their_program_but_cannot_change_it(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], name="Read only"))
    assign(ids["coach_a"], pid, utc_today())
    me = ids["client_a"]
    assert as_user(me, "select name from public.programs where id = $1", pid)[0][0] == "Read only"
    assert as_user(me, "update public.programs set weeks = 2 where id = $1 returning id", pid) == []
    assert as_user(me, "delete from public.programs where id = $1 returning id", pid) == []
    assert as_user(me, "update public.template_exercises set target_sets = 9 returning id") == []
    with pytest.raises(asyncpg.PostgresError):
        save(me, body(me))
    with pytest.raises(asyncpg.PostgresError):
        save(me, body(me, id=str(pid), **load(pid)))
    with pytest.raises(asyncpg.PostgresError):
        assign(me, pid, utc_today())
    # Another client sees nothing of it.
    assert as_user(ids["client_b"], "select id from public.programs where id = $1", pid) == []


def test_only_drafts_and_templates_can_be_deleted(ids):
    draft = save(ids["coach_a"], body(ids["client_a"], name="Throwaway"))
    assert as_user(ids["coach_a"], "delete from public.programs where id = $1 returning id", draft)
    live = save(ids["coach_a"], body(ids["client_a"], name="Live"))
    assign(ids["coach_a"], live, utc_today())
    assert as_user(ids["coach_a"], "delete from public.programs where id = $1 returning id", live) == []


# ---------- Templates ----------


def test_save_as_template_and_use_it_for_a_client(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], name="Template me"))
    tpl = as_user(ids["coach_a"], "select public.copy_program($1, null)", pid)[0][0]
    row = admin("select is_template, client_id, assigned_at, goal::text from public.programs where id = $1", tpl)[0]
    assert tuple(row) == (True, None, None, "muscle_gain")
    assert len(load(tpl)["workouts"]) == 2
    assert as_user(ids["client_a"], "select id from public.programs where id = $1", tpl) == []
    assert as_user(ids["coach_b"], "select id from public.programs where id = $1", tpl) == []
    copy = as_user(ids["coach_a"], "select public.copy_program($1, $2)", tpl, ids["client_a"])[0][0]
    row = admin("select is_template, client_id, assigned_at from public.programs where id = $1", copy)[0]
    assert tuple(row) == (False, ids["client_a"], None)  # a draft for the client


# ---------- History is never rewritten ----------


def test_editing_a_running_program_keeps_logged_sessions_and_sets(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], name="Running"))
    assign(ids["coach_a"], pid, utc_today())
    plan = load(pid)
    upper, lower = plan["workouts"]
    bench_slot = upper["exercises"][0]["id"]
    session = as_user(
        ids["client_a"],
        "insert into public.workout_sessions (client_id, workout_template_id, performed_on, status)"
        " values (auth.uid(), $1, current_date, 'done') returning id",
        uuid.UUID(upper["id"]),
    )[0][0]
    set_id = as_user(
        ids["client_a"],
        "insert into public.set_logs (session_id, exercise_id, template_exercise_id, set_number, reps, weight_kg)"
        " values ($1, $2, $3, 1, 8, 24) returning id",
        session,
        uuid.UUID(exercise("Dumbbell bench press")),
        uuid.UUID(bench_slot),
    )[0][0]
    lower_session = as_user(
        ids["client_a"],
        "insert into public.workout_sessions (client_id, workout_template_id, performed_on, status)"
        " values (auth.uid(), $1, current_date, 'done') returning id",
        uuid.UUID(lower["id"]),
    )[0][0]

    # The coach swaps the bench press for push-ups and drops the Lower workout.
    b = body(ids["client_a"], id=str(pid), name="Running", **plan)
    b["workouts"][0]["exercises"][0]["exercise_id"] = exercise("Push-up")
    b["workouts"].pop(1)
    save(ids["coach_a"], b)

    # The logged set is untouched and still points at the old slot, which is kept (marked removed).
    s = admin("select exercise_id, template_exercise_id, reps from public.set_logs where id = $1", set_id)[0]
    assert (str(s[0]), str(s[1]), s[2]) == (exercise("Dumbbell bench press"), bench_slot, 8)
    assert admin("select removed_at is not null from public.template_exercises where id = $1", uuid.UUID(bench_slot))[
        0
    ][0]
    # The plan now has a new Push-up slot, and no Lower.
    now = load(pid)["workouts"]
    assert [w["name"] for w in now] == ["Upper"]
    assert now[0]["exercises"][0]["exercise_id"] == exercise("Push-up") and now[0]["exercises"][0]["id"] != bench_slot
    # Both sessions still point at their workouts (Lower is kept, marked removed).
    assert admin("select workout_template_id from public.workout_sessions where id = $1", session)[0][0] == uuid.UUID(
        upper["id"]
    )
    kept = admin(
        "select t.name, t.removed_at is not null from public.workout_sessions s"
        " join public.workout_templates t on t.id = s.workout_template_id where s.id = $1",
        lower_session,
    )[0]
    assert tuple(kept) == ("Lower", True)


def test_summaries_count_only_live_dated_workouts(ids):
    pid = save(ids["coach_b"], body(ids["client_b"], name="Counted"))
    assign(ids["coach_b"], pid, utc_today())
    admin("select public.refresh_summaries()")
    monday = admin("select date_trunc('week', (now() at time zone 'UTC'))::date")[0][0]
    planned = admin(
        "select workouts_planned from analytics.weekly_summaries where client_id = $1 and week_start = $2",
        ids["client_b"],
        monday,
    )
    assert planned and planned[0][0] == 2


def test_saving_again_keeps_ids(ids):
    pid = save(ids["coach_a"], body(ids["client_a"], name="Stable"))
    first = load(pid)
    save(ids["coach_a"], body(ids["client_a"], id=str(pid), name="Stable", **first))
    assert load(pid) == first  # same workouts and exercises, same ids, nothing re-inserted
    assert (
        admin(
            "select count(*) from public.template_exercises x join public.workout_templates t"
            " on t.id = x.workout_template_id where t.program_id = $1",
            pid,
        )[0][0]
        == 3
    )
