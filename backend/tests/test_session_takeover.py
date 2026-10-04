"""Explicit recovery intent, atomic conflicts and serialized controller changes."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from threading import Barrier

import pytest

from backend.app import main, presence
from backend.app.schemas import ActionRequest, NewGameRequest, ReconnectRequest
from backend.app.session_authority import TakeoverRequiredError, hash_credential
from backend.app.store import GAMES
from backend.tests.test_yankees import http_request


@pytest.fixture
def seats(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(presence, "now", lambda: clock[0])
    GAMES.clear()
    created = main.new_game(NewGameRequest(creator_id="host"))
    joined = main.action(ActionRequest(game_id=created.game_id, action="gf.join_lobby", params={"player_id": "p1"}))
    yield created.game_id, {"host": created.result["session"], "p1": joined.result["session"]}, clock
    GAMES.clear()


def recover(seats, player="p1", takeover=None):
    body = {"game_id": seats[0], "reconnect_token": seats[1][player]["reconnect_token"]}
    if takeover is not None:
        body["takeover"] = takeover
    return http_request("/api/gf/reconnect", method="POST", body=body)


def assert_unchanged(stored, original, snapshot, response):
    assert stored.state is original and stored.state == snapshot
    assert response["revision"] == original.meta["revision"]


@pytest.mark.parametrize("elapsed", [0, presence.PRESENCE_TIMEOUT_SECONDS - 0.001, presence.PRESENCE_TIMEOUT_SECONDS])
def test_online_conflict_is_atomic_including_timeout_boundary(seats, elapsed):
    stored = GAMES[seats[0]]
    original, snapshot, records = stored.state, deepcopy(stored.state), dict(stored.sessions)
    seats[2][0] += elapsed
    status, response = recover(seats)
    assert status == 409
    assert response["error"]["code"] == "TAKEOVER_REQUIRED"
    assert response["error"]["details"] == {"reason": "active_session_online"}
    assert response["state"] == response["result"] == {} and response["events"] == []
    assert stored.sessions == records
    assert all(stored.sessions[p] is r for p, r in records.items())
    assert_unchanged(stored, original, snapshot, response)
    assert seats[1]["p1"]["reconnect_token"] not in json.dumps(response)


@pytest.mark.parametrize("takeover,elapsed", [(False, 15.001), (True, 0), (True, 15.001)])
def test_success_intent_token_privacy_and_old_controller(seats, takeover, elapsed):
    stored = GAMES[seats[0]]
    original, snapshot, previous = stored.state, deepcopy(stored.state), stored.sessions["p1"]
    seats[2][0] += elapsed
    status, response = recover(seats, takeover=takeover)
    assert status == 200 and response["result"]["mode"] == ("takeover" if takeover else "resume")
    session = response["result"]["session"]
    assert set(session) == {"player_id", "role", "active_session"}
    assert session["player_id"] == "p1" and session["role"] == "player"
    current = stored.sessions["p1"]
    assert current.reconnect_token_hash == previous.reconnect_token_hash
    assert current.active_session_hash == hash_credential(session["active_session"])
    assert current.active_session_hash != previous.active_session_hash
    assert current.superseded_session_hashes == {previous.active_session_hash}
    assert current.last_seen == seats[2][0]
    assert response["state"]["meta"]["presence"]["p1"]["online"]
    assert_unchanged(stored, original, snapshot, response)
    assert seats[1]["p1"]["reconnect_token"] not in json.dumps(response)
    status, old = http_request(f"/api/game/{seats[0]}", query="view=player&viewer_id=p1",
                              headers={"X-GF-Session": seats[1]["p1"]["active_session"]})
    assert status == 401 and old["error"]["code"] == "SESSION_REPLACED"
    assert stored.sessions["p1"] is current


def test_resume_then_conflict_then_repeated_takeovers_and_reuse(seats):
    seats[2][0] += 16
    stored = GAMES[seats[0]]
    initial = stored.sessions["p1"]
    status, first = recover(seats)
    assert status == 200 and first["result"]["mode"] == "resume"
    assert recover(seats, takeover=False)[0] == 409
    history = {initial.active_session_hash}
    for _ in range(3):
        history.add(stored.sessions["p1"].active_session_hash)
        status, response = recover(seats, takeover=True)
        assert status == 200 and response["result"]["mode"] == "takeover"
        current = stored.sessions["p1"]
        assert current.superseded_session_hashes == history
        assert current.reconnect_token_hash == initial.reconnect_token_hash
        assert current.active_session_hash == hash_credential(response["result"]["session"]["active_session"])
    seats[2][0] += 16
    assert recover(seats)[0] == 200


@pytest.mark.parametrize("intents", [(False, False), (False, True), (True, True)])
def test_concurrent_requests_serialize(seats, monkeypatch, intents):
    seats[2][0] += 16
    stored = GAMES[seats[0]]
    original = stored.state
    barrier = Barrier(2)
    real_online = presence.is_seat_online
    def checked_online(*args):
        assert stored.lock.locked()
        return real_online(*args)
    monkeypatch.setattr(presence, "is_seat_online", checked_online)
    def run(takeover):
        barrier.wait(timeout=5)
        try:
            return main.reconnect(ReconnectRequest(game_id=seats[0], reconnect_token=seats[1]["p1"]["reconnect_token"], takeover=takeover))
        except TakeoverRequiredError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, intents))
    successes = [r for r in results if r is not None]
    if intents == (False, False):
        assert len(successes) == 1
    elif intents == (True, True):
        assert len(successes) == 2
    else:
        assert len(successes) in {1, 2}
    if intents == (False, True):
        assert results[1] is not None
        assert results[1].result["mode"] == "takeover"
    hashes = {hash_credential(r.result["session"]["active_session"]) for r in successes}
    current = stored.sessions["p1"]
    assert current.active_session_hash in hashes
    assert hashes - {current.active_session_hash} <= current.superseded_session_hashes
    if intents == (False, True):
        assert current.active_session_hash == hash_credential(results[1].result["session"]["active_session"])
    assert stored.state is original


@pytest.mark.parametrize("player,takeover,paused", [("p1", True, True), ("host", False, False), ("host", True, False)])
def test_recovery_bypasses_pause_and_enriches_projection(seats, player, takeover, paused):
    stored = GAMES[seats[0]]
    stored.state.meta["phase"] = "table"
    seats[2][0] += 16
    original, snapshot = stored.state, deepcopy(stored.state)
    if player == "p1":
        # Player is online while the Marshal remains offline.
        main.get_state(seats[0], "player", "p1", seats[1]["p1"]["active_session"])
    status, response = recover(seats, player, takeover)
    assert status == 200
    assert response["state"]["meta"]["session_pause"] == {"paused": paused, "reason": "marshal_offline" if paused else None}
    assert_unchanged(stored, original, snapshot, response)


@pytest.mark.parametrize("takeover", [False, True])
def test_invalid_credential_still_invalid(seats, takeover):
    seats[1]["p1"]["reconnect_token"] = "invalid"
    status, response = recover(seats, takeover=takeover)
    assert status == 401 and response["error"]["code"] == "RECONNECT_INVALID"
