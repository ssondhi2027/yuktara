"""The kg/lb setting (0016): each user changes their own users.unit_system,
nobody else's; new accounts default to pounds; body weights keep two decimals.

Runs as the `authenticated` role with each user's claims. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from tests.conftest import TEST_DATABASE_URL
from tests.test_rls_live import _seed, admin, as_user, run

pytestmark = [
    pytest.mark.db,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to a local Supabase database"),
]


@pytest.fixture(scope="module")
def ids():
    return run(_seed())


def units(user) -> str:
    return admin("select unit_system::text from public.users where id = $1", user)[0][0]


def test_new_accounts_default_to_pounds(ids):
    assert units(ids["client_a"]) == "imperial"
    assert units(ids["coach_a"]) == "imperial"


def test_users_change_their_own_units(ids):
    for user in (ids["client_a"], ids["coach_a"]):
        sql = "update public.users set unit_system = $1 where id = auth.uid() returning id"
        assert as_user(user, sql, "metric")
        assert units(user) == "metric"
        assert as_user(user, sql, "imperial")
        assert units(user) == "imperial"


def test_nobody_changes_someone_elses_units(ids):
    sql = "update public.users set unit_system = 'metric' where id = $1 returning id"
    # The client can see their coach's row, but not change it; other users aren't visible at all.
    assert as_user(ids["client_a"], sql, ids["coach_a"]) == []
    assert as_user(ids["coach_a"], sql, ids["client_a"]) == []
    assert as_user(ids["client_b"], sql, ids["client_a"]) == []
    assert units(ids["coach_a"]) == "imperial"
    assert units(ids["client_a"]) == "imperial"


def test_body_weight_keeps_two_decimals(ids):
    # 160.0 lb = 72.57 kg; with one decimal it would come back as 160.1 lb.
    as_user(
        ids["client_a"],
        "insert into public.daily_logs (client_id, log_date, weight_kg) values (auth.uid(), current_date, 72.57)"
        " on conflict (client_id, log_date) do update set weight_kg = excluded.weight_kg",
    )
    stored = admin("select weight_kg from public.daily_logs where client_id = $1", ids["client_a"])[0][0]
    assert stored == Decimal("72.57")
