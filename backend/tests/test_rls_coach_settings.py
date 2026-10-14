"""Clients, Nutrition and Settings pages (0017): who may change which client
profile fields, targets, check-in questions and the coach's defaults.

Runs as the `authenticated` role with each user's claims. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

import json
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


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    return ids


def profile(client: uuid.UUID, cols: str):
    return tuple(admin(f"select {cols} from public.client_profiles where user_id = $1", client)[0])  # noqa: S608


# ---------- Coach-owned fields ----------


def test_coach_pauses_reactivates_and_moves_the_check_in_day(ids):
    coach, client = ids["coach_a"], ids["client_a"]
    sql = "update public.client_profiles set status = $2 where user_id = $1 returning user_id"
    assert as_user(coach, sql, client, "paused")
    assert as_user(coach, sql, client, "archived")
    assert as_user(coach, sql, client, "active")
    assert as_user(
        coach, "update public.client_profiles set check_in_day = 3 where user_id = $1 returning user_id", client
    )
    assert profile(client, "status::text, check_in_day") == ("active", 3)


def test_coach_cannot_change_another_coachs_client(ids):
    sql = "update public.client_profiles set status = 'paused' where user_id = $1 returning user_id"
    assert as_user(ids["coach_b"], sql, ids["client_a"]) == []
    assert profile(ids["client_a"], "status::text") == ("active",)


def test_coach_cannot_change_the_clients_own_answers(ids):
    for col, value in (("diet", "'vegan'"), ("height_cm", "199"), ("goal_weight_kg", "50"), ("goal", "'health'")):
        with pytest.raises(asyncpg.PostgresError):
            sql = f"update public.client_profiles set {col} = {value} where user_id = $1"  # noqa: S608
            as_user(ids["coach_a"], sql, ids["client_a"])


def test_coach_sets_targets_from_a_future_date_but_not_for_others(ids):
    monday = date.today() + timedelta(days=7 - date.today().weekday())
    insert = (
        "insert into public.nutrition_targets (client_id, effective_from, calories, protein_g, carbs_g, fat_g, set_by)"
        " values ($1, $2, 2000, 150, 200, 67, auth.uid())"
        " on conflict (client_id, effective_from) do update set calories = excluded.calories returning effective_from"
    )
    assert as_user(ids["coach_a"], insert, ids["client_a"], monday)[0][0] == monday
    # The client reads it (the Food tab's "From Mon …"), another coach can't write theirs.
    assert as_user(ids["client_a"], "select calories from public.nutrition_targets where effective_from = $1", monday)
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["coach_b"], insert, ids["client_a"], monday)
    with pytest.raises(asyncpg.PostgresError):
        as_user(ids["client_a"], insert, ids["client_a"], monday)


# ---------- Client-owned fields ----------


def test_client_edits_their_own_setup_answers(ids):
    me = ids["client_a"]
    as_user(
        me,
        "update public.client_profiles set diet = 'vegetarian', foods_to_avoid = 'Peanuts', meals_per_day = 4,"
        " training_days = 5, train_location = 'home', injuries = 'Sore wrist', height_cm = 170.5,"
        " goal_weight_kg = 66.5 where user_id = auth.uid()",
    )
    row = profile(me, "diet::text, foods_to_avoid, meals_per_day, training_days, train_location::text, height_cm")
    assert row[:5] == ("vegetarian", "Peanuts", 4, 5, "home")
    as_user(me, "update public.users set full_name = 'Renamed Client', unit_system = 'metric' where id = auth.uid()")
    assert admin("select full_name from public.users where id = $1", me)[0][0] == "Renamed Client"


def test_client_cannot_change_coach_owned_fields(ids):
    me = ids["client_a"]
    for change in ("status = 'paused'", "check_in_day = 5", "goal = 'performance'", f"coach_id = '{ids['coach_b']}'"):
        with pytest.raises(asyncpg.PostgresError):
            as_user(me, f"update public.client_profiles set {change} where user_id = auth.uid()")  # noqa: S608
    # Not another client's profile, either.
    sql = "update public.client_profiles set diet = 'vegan' where user_id = $1 returning user_id"
    assert as_user(me, sql, ids["client_b"]) == []


# ---------- Defaults ----------


def test_new_clients_start_on_the_coachs_default_check_in_day(ids):
    as_user(ids["coach_a"], "update public.users set default_check_in_day = 2 where id = auth.uid()")
    code = admin("select invite_code::text from public.users where id = $1", ids["coach_a"])[0][0]
    new = uuid.uuid4()
    admin(
        "insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)"
        " values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3::jsonb,"
        " now(), now())",
        new,
        f"default-{new.hex[:6]}@example.test",
        json.dumps({"full_name": "New Client", "invite_code": code, "timezone": "UTC"}),
    )
    assert profile(new, "coach_id, check_in_day") == (ids["coach_a"], 2)


# ---------- Check-in questions ----------


def add_question(coach: uuid.UUID, prompt: str, position: int = 0) -> uuid.UUID:
    return as_user(
        coach,
        "insert into public.checkin_questions (coach_id, prompt, answer_type, position)"
        " values (auth.uid(), $1, 'scale', $2) returning id",
        prompt,
        position,
    )[0][0]


def test_coach_manages_only_their_own_questions(ids):
    q = add_question(ids["coach_a"], "How were your energy levels?")
    assert as_user(
        ids["coach_a"],
        "update public.checkin_questions set position = 5, prompt = 'Energy?' where id = $1 returning id",
        q,
    )
    other = ids["coach_b"]
    assert as_user(other, "select id from public.checkin_questions where id = $1", q) == []
    assert as_user(other, "update public.checkin_questions set prompt = 'x' where id = $1 returning id", q) == []
    assert as_user(other, "delete from public.checkin_questions where id = $1 returning id", q) == []
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            other,
            "insert into public.checkin_questions (coach_id, prompt, answer_type) values ($1, 'Mine now', 'text')",
            ids["coach_a"],
        )
    with pytest.raises(asyncpg.PostgresError):
        add_question(ids["client_a"], "Clients don't write questions")


def test_answered_questions_are_turned_off_not_deleted(ids):
    q = add_question(ids["coach_a"], "Sleep quality?")
    unanswered = add_question(ids["coach_a"], "Throwaway")
    monday = date.today() - timedelta(days=date.today().weekday() + 14)
    ci = admin(
        "insert into public.check_ins (client_id, week_start, status) values ($1, $2, 'submitted') returning id",
        ids["client_a"],
        monday,
    )[0][0]
    admin("insert into public.checkin_answers (check_in_id, question_id, value_number) values ($1, $2, 4)", ci, q)
    assert as_user(ids["coach_a"], "delete from public.checkin_questions where id = $1 returning id", q) == []
    assert as_user(ids["coach_a"], "delete from public.checkin_questions where id = $1 returning id", unanswered)
    assert as_user(
        ids["coach_a"], "update public.checkin_questions set is_active = false where id = $1 returning id", q
    )
    # The client no longer gets it, but the old answer is still there for the coach.
    assert as_user(ids["client_a"], "select id from public.checkin_questions where id = $1", q) == []
    answers = as_user(ids["coach_a"], "select value_number from public.checkin_answers where question_id = $1", q)
    assert float(answers[0][0]) == 4
