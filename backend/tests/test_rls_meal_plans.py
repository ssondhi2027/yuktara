"""The food list (0022) and coach meal plans (0023): who reads and writes foods,
plans and the foods in logged meals, and the rules each adds.

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

NEW_FOOD = (
    "insert into public.foods (name, basis, kcal, protein_g, carbs_g, fat_g, servings, created_by)"
    " values ($1, 'g', 120, 10, 10, 4, $2::jsonb, auth.uid()) returning id"
)
SAVE_PLAN = "select public.save_meal_plan($1::jsonb)"


def shared(name: str) -> uuid.UUID:
    return admin("select id from public.foods where name = $1 and created_by is null", name)[0][0]


def plan_json(client: uuid.UUID | None, start: date | None, items: list[dict], **kw) -> str:
    return json.dumps(
        {
            "client_id": str(client) if client else None,
            "effective_from": start.isoformat() if start else None,
            "name": kw.get("name", "Plan"),
            "split": kw.get("split", False),
            "notes": kw.get("notes", {}),
            "items": items,
        }
    )


def item(
    food: uuid.UUID, meal: str = "breakfast", qty: float = 60, unit: str = "g", serving: str | None = None
) -> dict:
    return {
        "day_type": "every",
        "meal_type": meal,
        "position": 0,
        "food_id": str(food),
        "quantity": qty,
        "unit": unit,
        "serving": serving,
    }


@pytest.fixture(scope="module")
def ids():
    ids = run(_seed())
    finish_setup(ids["client_a"], date.today())
    finish_setup(ids["client_b"], date.today())
    return ids


# ---------- 0022: foods ----------


def test_everyone_reads_the_shared_list(ids):
    for who in ("client_a", "loner", "coach_b"):
        rows = as_user(ids[who], "select name, servings from public.foods where name = 'Egg' and created_by is null")
        assert rows and json.loads(rows[0][1]) == [{"name": "1 large egg", "amount": 50}]
    assert as_user(ids["client_a"], "select count(*) from public.foods where created_by is null")[0][0] >= 40


def test_a_coachs_own_food_is_seen_by_their_clients_only(ids):
    name = f"Coach shake {uuid.uuid4().hex[:6]}"
    fid = as_user(ids["coach_a"], NEW_FOOD, name, json.dumps([{"name": "1 bottle", "amount": 330}]))[0][0]
    seen = "select id from public.foods where id = $1"
    assert as_user(ids["client_a"], seen, fid)
    assert as_user(ids["client_b"], seen, fid) == []
    assert as_user(ids["coach_b"], seen, fid) == []
    assert as_user(ids["coach_b"], "update public.foods set kcal = 1 where id = $1 returning id", fid) == []
    assert as_user(ids["coach_a"], "update public.foods set kcal = 130 where id = $1 returning id", fid)


def test_clients_cant_add_foods(ids):
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(ids["client_a"], NEW_FOOD, f"Mine {uuid.uuid4().hex[:6]}", "[]")


def test_food_limits_and_names(ids):
    coach = ids["coach_a"]
    bad = (
        "insert into public.foods (name, basis, kcal, protein_g, carbs_g, fat_g, servings, created_by)"
        " values ($1, $2, $3, 1, 1, 1, $4::jsonb, auth.uid())"
    )
    tag = uuid.uuid4().hex[:6]
    for name, basis, kcal, servings in (
        (f"Too much {tag}", "g", 1000, "[]"),
        (f"Wrong unit {tag}", "oz", 100, "[]"),
        (f"Bad serving {tag}", "g", 100, '[{"name": "", "amount": 30}]'),
        (f"Huge serving {tag}", "g", 100, '[{"name": "1 tub", "amount": 5000}]'),
        (f"Text amount {tag}", "g", 100, '[{"name": "1 cup", "amount": "lots"}]'),
        ("x", "g", 100, "[]"),
    ):
        with pytest.raises(asyncpg.CheckViolationError):
            as_user(coach, bad, name, basis, kcal, servings)
    name = f"Twice {tag}"
    as_user(coach, NEW_FOOD, name, "[]")
    with pytest.raises(asyncpg.UniqueViolationError):
        as_user(coach, NEW_FOOD, name.upper(), "[]")
    assert as_user(ids["coach_b"], NEW_FOOD, name, "[]")  # another coach may use the name


def test_logged_foods_point_at_foods_the_client_can_see(ids):
    meal = as_user(
        ids["client_a"],
        "insert into public.meal_logs (client_id, eaten_at, meal_type, title, calories)"
        " values (auth.uid(), now(), 'breakfast', 'Oats', 228) returning id",
    )[0][0]
    ins = (
        "insert into public.meal_items (meal_log_id, food_id, food_name, quantity, unit, serving, calories, protein_g)"
        " values ($1, $2, $3, $4, $5, $6, 228, 7.8) returning id"
    )
    assert as_user(ids["client_a"], ins, meal, shared("Oats"), "Oats", 60, "g", None)
    assert as_user(ids["client_a"], ins, meal, shared("Egg"), "Egg", 2, "serving", "1 large egg")
    other = as_user(ids["coach_b"], NEW_FOOD, f"Other coach's {uuid.uuid4().hex[:6]}", "[]")[0][0]
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(ids["client_a"], ins, meal, other, "Hidden", 1, "g", None)
    # The coach reads them, with the food.
    rows = as_user(
        ids["coach_a"], "select food_id, serving from public.meal_items where meal_log_id = $1 order by food_name", meal
    )
    assert [tuple(r) for r in rows] == [(shared("Egg"), "1 large egg"), (shared("Oats"), None)]


# ---------- 0023: meal plans ----------


def test_coach_saves_a_plan_and_their_client_reads_it(ids):
    start = date.today() + timedelta(days=1)
    items = [
        item(shared("Oats")),
        item(shared("Egg"), "breakfast", 2, "serving", "1 large egg"),
        item(shared("Dal (cooked lentils)"), "lunch", 1, "serving", "1 bowl"),
    ]
    pid = as_user(
        ids["coach_a"], SAVE_PLAN, plan_json(ids["client_a"], start, items, notes={"every:lunch": "Or rajma"})
    )[0][0]
    rows = as_user(
        ids["client_a"],
        "select p.notes, count(i.id), bool_and(f.id is not null) from public.meal_plans p"
        " join public.meal_plan_items i on i.plan_id = p.id left join public.foods f on f.id = i.food_id"
        " where p.id = $1 group by p.notes",
        pid,
    )
    assert json.loads(rows[0][0]) == {"every:lunch": "Or rajma"} and rows[0][1] == 3 and rows[0][2]
    for who in ("client_b", "coach_b", "loner"):
        assert as_user(ids[who], "select id from public.meal_plans where id = $1", pid) == []
        assert as_user(ids[who], "select id from public.meal_plan_items where plan_id = $1", pid) == []


def test_saving_the_same_date_replaces_that_version(ids):
    start = date.today() + timedelta(days=3)
    first = as_user(ids["coach_a"], SAVE_PLAN, plan_json(ids["client_a"], start, [item(shared("Oats"))]))[0][0]
    again = as_user(
        ids["coach_a"],
        SAVE_PLAN,
        plan_json(ids["client_a"], start, [item(shared("Banana"), "snack", 1, "serving", "1 medium")]),
    )[0][0]
    assert first == again
    items = admin(
        "select f.name from public.meal_plan_items i join public.foods f on f.id = i.food_id where i.plan_id = $1",
        first,
    )
    assert [r[0] for r in items] == ["Banana"]


def test_another_coach_cant_write_my_clients_plan_and_past_dates_are_refused(ids):
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(
            ids["coach_b"],
            SAVE_PLAN,
            plan_json(ids["client_a"], date.today() + timedelta(days=1), [item(shared("Oats"))]),
        )
    with pytest.raises(asyncpg.PostgresError, match="starts today or later"):
        as_user(
            ids["coach_a"],
            SAVE_PLAN,
            plan_json(ids["client_a"], date.today() - timedelta(days=10), [item(shared("Oats"))]),
        )
    with pytest.raises(asyncpg.PostgresError, match="Only coaches"):
        as_user(
            ids["client_a"],
            SAVE_PLAN,
            plan_json(ids["client_a"], date.today() + timedelta(days=1), [item(shared("Oats"))]),
        )


def test_the_client_cant_change_their_plan(ids):
    pid = as_user(
        ids["coach_a"], SAVE_PLAN, plan_json(ids["client_a"], date.today() + timedelta(days=5), [item(shared("Oats"))])
    )[0][0]
    client = ids["client_a"]
    assert as_user(client, "update public.meal_plans set name = 'Mine' where id = $1 returning id", pid) == []
    assert as_user(client, "delete from public.meal_plans where id = $1 returning id", pid) == []
    assert (
        as_user(client, "update public.meal_plan_items set quantity = 500 where plan_id = $1 returning id", pid) == []
    )
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(
            client,
            "insert into public.meal_plan_items (plan_id, meal_type, food_id, quantity, unit)"
            " values ($1, 'snack', $2, 1, 'g')",
            pid,
            shared("Almonds"),
        )
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        as_user(
            client,
            "insert into public.meal_plans (coach_id, client_id, effective_from) values ($1, auth.uid(), current_date)",
            ids["coach_a"],
        )


def test_templates_belong_to_the_coach_and_foods_in_plans_cant_be_deleted(ids):
    food = as_user(ids["coach_a"], NEW_FOOD, f"Plan food {uuid.uuid4().hex[:6]}", "[]")[0][0]
    tid = as_user(ids["coach_a"], SAVE_PLAN, plan_json(None, None, [item(food, "dinner", 200)], name="Template A"))[0][
        0
    ]
    assert as_user(ids["coach_a"], "select name from public.meal_plans where id = $1", tid)[0][0] == "Template A"
    for who in ("coach_b", "client_a"):
        assert as_user(ids[who], "select id from public.meal_plans where id = $1", tid) == []
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        as_user(ids["coach_a"], "delete from public.foods where id = $1", food)
    assert as_user(ids["coach_a"], "delete from public.meal_plans where id = $1 returning id", tid)
    assert as_user(ids["coach_a"], "delete from public.foods where id = $1 returning id", food)


def test_plan_item_rules(ids):
    start = date.today() + timedelta(days=7)
    for bad in (
        item(shared("Oats"), qty=0),
        item(shared("Oats"), unit="cup"),
        item(shared("Egg"), unit="serving", serving=None),
    ):
        with pytest.raises(asyncpg.CheckViolationError):
            as_user(ids["coach_a"], SAVE_PLAN, plan_json(ids["client_a"], start, [bad]))
    with pytest.raises(asyncpg.PostgresError, match="300 characters"):
        as_user(
            ids["coach_a"],
            SAVE_PLAN,
            plan_json(ids["client_a"], start, [item(shared("Oats"))], notes={"every:breakfast": "x" * 301}),
        )
