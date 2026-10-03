"""Reconnect replacement, privacy, and rollback without gameplay enforcement."""
from copy import deepcopy
from dataclasses import asdict, replace
import json

import pytest

from backend.app import main, session_authority
from backend.app.schemas import ActionRequest, NewGameRequest, ReconnectRequest
from backend.app.serializers import game_state_to_dict
from backend.app.session_authority import ReconnectInvalid, hash_credential, resolve_reconnect_seat
from backend.app.store import GAMES
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_gf_scene import _ready_table_game
from backend.tests.test_yankees import http_request


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    GAMES.clear()
    yield
    GAMES.clear()


@pytest.fixture
def seats():
    created = main.new_game(NewGameRequest(creator_id="host1"))
    credentials = {"host1": created.result["session"]}
    for player in ("p1", "p2"):
        joined = main.action(ActionRequest(game_id=created.game_id, action="gf.join_lobby", params={"player_id": player}))
        credentials[player] = joined.result["session"]
    return created.game_id, credentials


def reconnect(game_id, token):
    return http_request("/api/gf/reconnect", method="POST", body={"game_id": game_id, "reconnect_token": token})


@pytest.mark.parametrize("player,role", [("host1", "marshal"), ("p1", "player")])
def test_private_reconnect_rotates_only_active_session(seats, player, role):
    game_id, credentials = seats
    stored = GAMES[game_id]
    original, snapshot = stored.state, deepcopy(stored.state)
    records = dict(stored.sessions)
    previous = records[player]
    token = credentials[player]["reconnect_token"]
    status, response = reconnect(game_id, token)
    assert status == 200
    payload = response["result"]["session"]
    assert set(payload) == {"player_id", "role", "active_session"}
    assert (payload["player_id"], payload["role"]) == (player, role)
    assert response["result"]["reconnected"] is True
    assert response["state"] == game_state_to_dict(original, view=role, viewer_id=player)
    assert response["revision"] == original.meta["revision"]
    assert stored.state is original
    assert stored.state == snapshot
    current = stored.sessions[player]
    assert current.active_session_hash == hash_credential(payload["active_session"])
    assert current.active_session_hash != previous.active_session_hash
    assert current.superseded_session_hashes == frozenset({previous.active_session_hash})
    assert current.reconnect_token_hash == previous.reconnect_token_hash
    assert all(stored.sessions[p] is record for p, record in records.items() if p != player)
    assert token not in json.dumps(response)
    assert payload["active_session"] not in json.dumps([response["state"], response["events"], asdict(original)])
    assert payload["active_session"] not in repr(current)
    for view, viewer in [("public", None), ("player", player), ("marshal", "host1"), ("debug", None)]:
        projection = json.dumps(game_state_to_dict(original, view=view, viewer_id=viewer))
        assert token not in projection
        assert payload["active_session"] not in projection


def test_repeated_reconnect_keeps_token_and_all_superseded_hashes(seats):
    game_id, credentials = seats
    record = GAMES[game_id].sessions["p1"]
    history = {record.active_session_hash}
    for _ in range(3):
        status, response = reconnect(game_id, credentials["p1"]["reconnect_token"])
        assert status == 200
        current = GAMES[game_id].sessions["p1"]
        assert current.reconnect_token_hash == record.reconnect_token_hash
        assert current.superseded_session_hashes == frozenset(history)
        assert current.active_session_hash not in history
        history.add(current.active_session_hash)


@pytest.mark.parametrize("token", ["invalid-random-token", "", " ", None, 12, {}, [], "\ud800"])
def test_invalid_or_malformed_token_is_private_and_atomic(seats, token):
    game_id, _ = seats
    stored = GAMES[game_id]
    original, records = stored.state, dict(stored.sessions)
    status, response = reconnect(game_id, token)
    assert status == 401
    assert response["error"] == {"code": "RECONNECT_INVALID", "message": "Invalid reconnect credential", "details": None}
    assert response["state"] == response["result"] == {}
    assert response["events"] == []
    assert stored.state is original
    assert stored.sessions == records
    if token == "invalid-random-token":
        assert token not in json.dumps(response)


def test_missing_token_and_forbidden_authority_fields_do_not_echo_secret(seats):
    game_id, credentials = seats
    stored = GAMES[game_id]
    records = dict(stored.sessions)
    for body in [
        {"game_id": game_id},
        {"game_id": game_id, "reconnect_token": credentials["p1"]["reconnect_token"], "view": "debug"},
        {"reconnect_token": credentials["p1"]["reconnect_token"]},
        {"game_id": game_id, "reconnect_token": credentials["p1"]["reconnect_token"], "player_id": "host1"},
    ]:
        status, response = http_request("/api/gf/reconnect", method="POST", body=body)
        assert status == 401
        assert response["error"]["code"] == "RECONNECT_INVALID"
        assert credentials["p1"]["reconnect_token"] not in json.dumps(response)
        assert stored.sessions == records


def test_cross_game_isolation(seats):
    first, credentials = seats
    other = main.new_game(NewGameRequest(creator_id="host1")).game_id
    snapshots = {g: (GAMES[g].state, dict(GAMES[g].sessions)) for g in (first, other)}
    status, response = reconnect(other, credentials["host1"]["reconnect_token"])
    assert status == 401
    assert response["error"]["code"] == "RECONNECT_INVALID"
    for game_id, (state, records) in snapshots.items():
        assert GAMES[game_id].state is state
        assert GAMES[game_id].sessions == records


def test_ambiguous_hash_match_fails_closed(seats):
    game_id, credentials = seats
    records = dict(GAMES[game_id].sessions)
    records["p2"] = replace(records["p2"], reconnect_token_hash=records["p1"].reconnect_token_hash)
    with pytest.raises(ReconnectInvalid):
        resolve_reconnect_seat(records, credentials["p1"]["reconnect_token"])


def test_dark_and_yankee_projection_with_pending_gate_bypassed(seats):
    game_id, credentials = seats
    stored = GAMES[game_id]
    stored.state = _ready_table_game()
    main.action(ActionRequest(game_id=game_id, action="gf.scene_set_participants",
                              params={"actor_id": "host1", "participant_ids": ["p1", "p2"]}))
    for action in ("gf.scene_declare_dark", "gf.scene_roll_difficulty", "gf.scene_dark_draw"):
        main.action(ActionRequest(game_id=game_id, action=action, params={"actor_id": "host1"}, view="marshal", viewer_id="host1"))
    # Reproduce the canonical private inspection payload while gameplay is gated.
    stored.state = begin_pending_interaction(stored.state, {
        "kind": "yankee_inspect_top_card", "actor_id": "p1",
        "allowed_actions": ["gf.faction_yankee_choose_top_card"],
        "payload": {"inspected_card_id": stored.state.deck.draw_pile[-1]}, "continuation": None,
    })
    original, before = stored.state, deepcopy(stored.state)
    for player in ("host1", "p1", "p2"):
        status, response = reconnect(game_id, credentials[player]["reconnect_token"])
        assert status == 200
        state = response["state"]
        assert state["meta"]["pending_interaction"]["payload"] == (before.meta["pending_interaction"]["payload"] if player == "p1" else {})
        assert bool(state["meta"]["scene"]["difficulty"]["card_id"]) == (player == "host1")
        assert isinstance(state["zones"]["scene.dark.marshal_hand"], list if player == "host1" else dict)
        assert stored.state is original
        assert stored.state == before


@pytest.mark.parametrize("failure", ["generation", "response"])
def test_replacement_failure_preserves_all_records(seats, monkeypatch, failure):
    game_id, credentials = seats
    stored = GAMES[game_id]
    original, records = stored.state, dict(stored.sessions)

    def fail(*args, **kwargs):
        raise RuntimeError("Injected staging failure")

    if failure == "generation":
        monkeypatch.setattr(session_authority.secrets, "token_urlsafe", fail)
    else:
        monkeypatch.setattr(main, "ActionResponse", fail)
    with pytest.raises(RuntimeError, match="staging failure"):
        main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credentials["p1"]["reconnect_token"]))
    assert stored.state is original
    assert stored.sessions == records


def test_reconnect_rotation_runs_inside_game_lock(seats, monkeypatch):
    game_id, credentials = seats
    stored = GAMES[game_id]
    real_replace = main.replace_active_session

    def checked_replace(record):
        assert stored.lock.locked()
        return real_replace(record)

    monkeypatch.setattr(main, "replace_active_session", checked_replace)
    main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credentials["p1"]["reconnect_token"]))


def test_normal_private_requests_still_need_no_session(seats):
    game_id, credentials = seats
    reconnect(game_id, credentials["p1"]["reconnect_token"])
    status, response = http_request(f"/api/game/{game_id}", query="view=player&viewer_id=p1")
    assert status == 200
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.claim_character", "params": {"player_id": "p1", "card_id": "JS"},
        "view": "player", "viewer_id": "p1",
    })
    assert status == 200
