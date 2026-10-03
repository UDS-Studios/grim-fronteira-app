"""Runtime presence contracts with a controlled clock and real HTTP authority."""
import json

import pytest

from backend.app import main, presence
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.session_authority import hash_credential
from backend.app.store import GAMES
from backend.tests.test_yankees import http_request


@pytest.fixture
def seats(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    clock = [100.0]
    monkeypatch.setattr(presence, "now", lambda: clock[0])
    GAMES.clear()
    created = main.new_game(NewGameRequest(creator_id="host"))
    assert created.state["meta"]["presence"] == {"host": {"online": True}}
    joined = main.action(ActionRequest(game_id=created.game_id, action="gf.join_lobby", params={"player_id": "p1"}))
    assert joined.state["meta"]["presence"] == {"host": {"online": True}, "p1": {"online": True}}
    yield created.game_id, {"host": created.result["session"], "p1": joined.result["session"]}, clock
    GAMES.clear()


def get(seats, view="public", player=None, token=None):
    game_id, credentials, _ = seats
    if player and token is None:
        token = credentials[player]["active_session"]
    return http_request(f"/api/game/{game_id}", query=f"view={view}" + (f"&viewer_id={player}" if player else ""),
                        headers={"X-GF-Session": token} if token else None)


def test_timeout_private_refresh_and_revision(seats):
    game_id, credentials, clock = seats
    stored = GAMES[game_id]
    original = stored.state
    assert all(record.last_seen == 100 for record in stored.sessions.values())
    assert stored.sessions["host"].active_session_hash == hash_credential(credentials["host"]["active_session"])
    clock[0] += presence.PRESENCE_TIMEOUT_SECONDS
    assert all(item["online"] for item in presence.presence_snapshot(stored.sessions).values())
    clock[0] += 0.01
    status, body = get(seats)
    assert status == 200 and not any(item["online"] for item in body["state"]["meta"]["presence"].values())
    status, body = get(seats, "player", "p1")
    assert status == 200
    assert body["state"]["meta"]["presence"] == {"host": {"online": False}, "p1": {"online": True}}
    assert stored.sessions["p1"].last_seen == clock[0]
    status, body = get(seats, "marshal", "host")
    assert status == 200 and body["state"]["meta"]["presence"]["host"]["online"]
    assert stored.state is original and body["revision"] == original.meta["revision"]
    assert "presence" not in original.meta
    clock[0] += 1
    status, body = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": credentials["p1"]["active_session"]},
                                body={"game_id": game_id, "action": "gf.get_state", "view": "player", "viewer_id": "p1"})
    assert status == 200 and body["revision"] == original.meta["revision"]
    assert stored.sessions["p1"].last_seen == clock[0]
    assert stored.state is original


@pytest.mark.parametrize("view", ["public", "debug"])
def test_non_authenticated_reads_and_actions_do_not_refresh(seats, monkeypatch, view):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    game_id, credentials, clock = seats
    stored = GAMES[game_id]
    records = dict(stored.sessions)
    clock[0] += 20
    assert get(seats, view, token=credentials["host"]["active_session"])[0] == 200
    status, _ = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": credentials["host"]["active_session"]},
                            body={"game_id": game_id, "action": "gf.get_state", "view": view})
    assert status == 200 and stored.sessions == records


@pytest.mark.parametrize("token", [None, "invalid"])
def test_failed_authentication_does_not_refresh(seats, token):
    game_id, _, clock = seats
    records = dict(GAMES[game_id].sessions)
    clock[0] += 20
    status, _ = http_request(f"/api/game/{game_id}", query="view=player&viewer_id=p1",
                            headers={"X-GF-Session": token} if token else None)
    assert status == 401 and GAMES[game_id].sessions == records


def test_reconnect_and_superseded_traffic(seats):
    game_id, credentials, clock = seats
    stored = GAMES[game_id]
    original = stored.state
    clock[0] += 20
    status, body = http_request("/api/gf/reconnect", method="POST", body={"game_id": game_id, "reconnect_token": credentials["p1"]["reconnect_token"]})
    assert status == 200 and body["state"]["meta"]["presence"]["p1"]["online"]
    replacement = stored.sessions["p1"]
    assert replacement.last_seen == clock[0]
    assert replacement.active_session_hash == hash_credential(body["result"]["session"]["active_session"])
    assert stored.state is original and body["revision"] == original.meta["revision"]
    clock[0] += 20
    assert get(seats, "player", "p1")[0] == 401
    status, _ = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": credentials["p1"]["active_session"]},
                            body={"game_id": game_id, "action": "gf.claim_character", "params": {"player_id": "p1", "card_id": "JS"}})
    assert status == 401 and stored.sessions["p1"] is replacement
    presence.refresh_presence(stored.sessions, replacement.__class__("p1", "old", "old", last_seen=clock[0]))
    assert stored.sessions["p1"] is replacement
    assert not presence.presence_snapshot(stored.sessions)["p1"]["online"]
    assert get(seats, "player", "p1", body["result"]["session"]["active_session"])[0] == 200
    public = json.dumps(get(seats)[1])
    for digest in replacement.superseded_session_hashes | {replacement.active_session_hash, replacement.reconnect_token_hash}:
        assert digest not in public


def test_offline_marshal_does_not_block_player_gameplay(seats):
    game_id, credentials, clock = seats
    clock[0] += 20
    status, body = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": credentials["p1"]["active_session"]},
                               body={"game_id": game_id, "action": "gf.claim_character", "params": {"player_id": "p1", "card_id": "JS"}})
    assert status == 200
    assert body["state"]["meta"]["presence"] == {"host": {"online": False}, "p1": {"online": True}}
    assert GAMES[game_id].sessions["p1"].last_seen == clock[0]


@pytest.mark.parametrize("view,player", [("public", None), ("player", "p1"), ("marshal", "host"), ("debug", None)])
def test_projection_is_boolean_only_and_secret_free(seats, monkeypatch, view, player):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    status, body = get(seats, view, player)
    assert status == 200
    assert body["state"]["meta"]["presence"] == {"host": {"online": True}, "p1": {"online": True}}
    encoded = json.dumps(body)
    for credential in seats[1].values():
        for field in ("active_session", "reconnect_token"):
            assert credential[field] not in encoded and hash_credential(credential[field]) not in encoded
    for field in ("last_seen", "active_session_hash", "superseded_session_hashes", "reconnect_token_hash"):
        assert field not in encoded


def test_refresh_and_snapshot_hold_game_lock(seats, monkeypatch):
    stored = GAMES[seats[0]]
    refresh, enrich = main.refresh_presence, main.enrich_presence
    def checked_refresh(*args):
        assert stored.lock.locked()
        return refresh(*args)
    def checked_enrich(*args):
        assert stored.lock.locked()
        return enrich(*args)
    monkeypatch.setattr(main, "refresh_presence", checked_refresh)
    monkeypatch.setattr(main, "enrich_presence", checked_enrich)
    assert get(seats, "player", "p1")[0] == 200
    assert get(seats)[0] == 200
    status, _ = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": seats[1]["host"]["active_session"]},
                            body={"game_id": seats[0], "action": "gf.set_registration_open", "params": {"actor_id": "host", "is_open": False}})
    assert status == 200
    status, _ = http_request("/api/gf/reconnect", method="POST", body={"game_id": seats[0], "reconnect_token": seats[1]["p1"]["reconnect_token"]})
    assert status == 200
