"""RLS for messaging (0014): a client and their coach share one conversation;
nobody else can read it, write into it, or speak for someone else.

Runs as the `authenticated` role with each user's claims, like the apps'
supabase-js calls. Needs TEST_DATABASE_URL.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import asyncpg
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


def send(sender: uuid.UUID, client: uuid.UUID, body: str = "Hi", **extra) -> uuid.UUID:
    cols = ["client_id", "sender_id", "body", *extra]
    values = [client, sender, body, *extra.values()]
    marks = ", ".join(f"${i}" for i in range(1, len(values) + 1))
    sql = f"insert into public.messages ({', '.join(cols)}) values ({marks}) returning id"  # noqa: S608 (fixed column names)
    return as_user(sender, sql, *values)[0][0]


def a_check_in(client: uuid.UUID) -> uuid.UUID:
    monday = date.today() - timedelta(days=date.today().weekday() + 7)
    return admin(
        "insert into public.check_ins (client_id, week_start, status) values ($1, $2, 'submitted')"
        " on conflict do nothing returning id",
        client,
        monday,
    )[0][0]


# ---------- Sending and reading ----------


def test_client_messages_their_coach_and_the_coach_reads_it(ids):
    m = send(ids["client_a"], ids["client_a"], "Can we move my check-in to Monday?")
    assert as_user(ids["coach_a"], "select body from public.messages where id = $1", m)[0][0].startswith("Can we")
    reply = send(ids["coach_a"], ids["client_a"], "Sure, done.")
    assert (
        as_user(ids["client_a"], "select sender_id from public.messages where id = $1", reply)[0][0] == ids["coach_a"]
    )


def test_nobody_outside_the_link_reads_the_thread(ids):
    send(ids["client_a"], ids["client_a"], "Private")
    sql = "select id from public.messages where client_id = $1"
    assert as_user(ids["client_b"], sql, ids["client_a"]) == []
    assert as_user(ids["coach_b"], sql, ids["client_a"]) == []
    assert as_user(ids["loner"], sql, ids["client_a"]) == []


def test_client_cannot_message_another_coach_or_client(ids):
    with pytest.raises(asyncpg.PostgresError):
        send(ids["client_a"], ids["client_b"], "Hello other thread")
    with pytest.raises(asyncpg.PostgresError):
        send(ids["client_a"], ids["coach_b"], "Hello other coach")


def test_client_without_a_coach_cannot_send(ids):
    with pytest.raises(asyncpg.PostgresError):
        send(ids["loner"], ids["loner"], "Anyone there?")


def test_nobody_sends_as_someone_else(ids):
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["client_a"],
            "insert into public.messages (client_id, sender_id, body) values ($1, $2, 'Fake coach')",
            ids["client_a"],
            ids["coach_a"],
        )
    with pytest.raises(asyncpg.PostgresError):
        as_user(
            ids["coach_a"],
            "insert into public.messages (client_id, sender_id, body) values ($1, $1, 'Fake client')",
            ids["client_a"],
        )


def test_coach_cannot_message_or_read_another_coachs_client(ids):
    with pytest.raises(asyncpg.PostgresError):
        send(ids["coach_a"], ids["client_b"], "Want to switch coaches?")
    send(ids["coach_b"], ids["client_b"], "Welcome")
    assert as_user(ids["coach_a"], "select id from public.messages where client_id = $1", ids["client_b"]) == []


def test_only_the_coach_attaches_check_in_feedback(ids):
    ci = a_check_in(ids["client_a"])
    with pytest.raises(asyncpg.PostgresError):
        send(ids["client_a"], ids["client_a"], "Looks like feedback", check_in_id=ci)
    send(ids["coach_a"], ids["client_a"], "x" * 4000, check_in_id=ci)  # feedback may be long
    other = a_check_in(ids["client_b"])
    with pytest.raises(asyncpg.PostgresError):
        send(ids["coach_a"], ids["client_a"], "Wrong check-in", check_in_id=other)


def test_message_rules(ids):
    with pytest.raises(asyncpg.PostgresError):
        send(ids["client_a"], ids["client_a"], "x" * 2001)  # chat is capped at 2000
    with pytest.raises(asyncpg.PostgresError):
        send(ids["client_a"], ids["client_a"], "")
    with pytest.raises(asyncpg.PostgresError):
        send(ids["coach_a"], ids["client_a"], "Pre-read", read_at=date.today())


# ---------- Read state ----------


def test_only_the_recipient_marks_a_message_read(ids):
    from_client = send(ids["client_a"], ids["client_a"], "Read me, coach")
    from_coach = send(ids["coach_a"], ids["client_a"], "Read me, client")
    mark = "update public.messages set read_at = now() where id = $1 returning id"
    # Senders can't mark their own messages; outsiders can't mark anything.
    assert as_user(ids["client_a"], mark, from_client) == []
    assert as_user(ids["coach_a"], mark, from_coach) == []
    assert as_user(ids["client_b"], mark, from_client) == []
    assert as_user(ids["coach_b"], mark, from_coach) == []
    # Recipients can.
    assert as_user(ids["coach_a"], mark, from_client)
    assert as_user(ids["client_a"], mark, from_coach)


def test_nobody_edits_or_deletes_a_message(ids):
    m = send(ids["client_a"], ids["client_a"], "Original")
    for user in (ids["client_a"], ids["coach_a"]):
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            as_user(user, "update public.messages set body = 'Edited' where id = $1", m)
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            as_user(user, "update public.messages set sender_id = $2 where id = $1", m, ids["coach_a"])
        assert as_user(user, "delete from public.messages where id = $1 returning id", m) == []
    assert admin("select body from public.messages where id = $1", m)[0][0] == "Original"


def test_unread_counts_and_the_coachs_conversation_list(ids):
    admin("update public.messages set read_at = now() where client_id = $1", ids["client_a"])
    send(ids["client_a"], ids["client_a"], "One")
    send(ids["client_a"], ids["client_a"], "Two")
    send(ids["coach_a"], ids["client_a"], "Reply")
    assert as_user(ids["coach_a"], "select public.unread_message_count()")[0][0] == 2
    assert as_user(ids["client_a"], "select public.unread_message_count()")[0][0] == 1
    rows = as_user(ids["coach_a"], "select client_id, last_body, unread from public.message_threads()")
    assert [(r[0], r[1], r[2]) for r in rows] == [(ids["client_a"], "Reply", 2)]
    assert as_user(ids["client_a"], "select client_id from public.message_threads()") == []
    assert as_user(ids["coach_b"], "select public.unread_message_count()")[0][0] == 0


# ---------- Rate limit ----------


def test_sending_is_rate_limited(ids):
    refused = None
    for n in range(12):
        try:
            send(ids["coach_b"], ids["client_b"], f"Burst {n}")
        except asyncpg.PostgresError as e:
            refused = e
            break
    assert refused is not None and refused.sqlstate == "PT429"
    sent = admin(
        "select count(*) from public.messages where sender_id = $1 and created_at > now() - interval '1 minute'",
        ids["coach_b"],
    )[0][0]
    assert sent == 10  # the 11th in a minute is refused
