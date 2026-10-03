"""Production authority contracts, using issued credentials and real HTTP headers."""
from copy import deepcopy
from dataclasses import replace

import pytest

from backend.app import main
from backend.app.request_authority import authorize_request
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.session_authority import AuthorityError
from backend.app.store import GAMES
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_yankees import http_request


@pytest.fixture
def seats(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    GAMES.clear()
    created = main.new_game(NewGameRequest(creator_id="host"))
    credentials = {"host": created.result["session"]}
    for player in ("p1", "p2"):
        response = main.action(ActionRequest(game_id=created.game_id, action="gf.join_lobby", params={"player_id": player}))
        credentials[player] = response.result["session"]
    yield created.game_id, credentials
    GAMES.clear()


def request(seats, action=None, params=None, view="public", viewer=None, token=None):
    game_id, _ = seats
    headers = {"X-GF-Session": token} if token is not None else None
    if action:
        return http_request("/api/gf/action", method="POST", headers=headers, body={
            "game_id": game_id, "action": action, "params": params or {}, "view": view, "viewer_id": viewer})
    return http_request(f"/api/game/{game_id}", headers=headers,
                        query=f"view={view}" + (f"&viewer_id={viewer}" if viewer else ""))


@pytest.mark.parametrize("action", [None, "gf.get_state"])
@pytest.mark.parametrize("view,viewer", [("player", "p1"), ("marshal", "host")])
@pytest.mark.parametrize("token,code", [(None, "SESSION_REQUIRED"), ("invalid", "SESSION_INVALID")])
def test_private_read_errors_are_atomic(seats, action, view, viewer, token, code):
    stored = GAMES[seats[0]]
    original, snapshot, records = stored.state, deepcopy(stored.state), dict(stored.sessions)
    status, body = request(seats, action, view=view, viewer=viewer, token=token)
    assert status == 401 and body["error"]["code"] == code
    assert stored.state is original and stored.state == snapshot and stored.sessions == records
    assert body["error"]["details"] is None


@pytest.mark.parametrize("action", [None, "gf.get_state"])
@pytest.mark.parametrize("view,viewer,seat,code", [
    ("public", None, None, None), ("player", "p1", "p1", None),
    ("marshal", "host", "host", None), ("player", "host", "host", None),
    ("player", "p2", "p1", "VIEWER_MISMATCH"),
    ("marshal", "host", "p1", "VIEWER_MISMATCH"),
    ("marshal", "p1", "p1", "VIEWER_MISMATCH"),
])
def test_projection_ownership(seats, action, view, viewer, seat, code):
    token = seats[1][seat]["active_session"] if seat else None
    status, body = request(seats, action, view=view, viewer=viewer, token=token)
    assert status == (403 if code else 200)
    if code:
        assert body["error"]["code"] == code


@pytest.mark.parametrize("action,params,seat,code", [
    ("gf.set_registration_open", {"actor_id": "host", "is_open": False}, "host", None),
    ("gf.set_registration_open", {"actor_id": "host", "is_open": False}, "p1", "ACTOR_MISMATCH"),
    ("gf.submit_character_name", {"player_id": "p1", "name": "Ash"}, "p2", "ACTOR_MISMATCH"),
    ("gf.submit_character_name", {"player_id": "p1", "name": "Ash"}, None, "SESSION_REQUIRED"),
])
def test_mutation_authority_precedes_gameplay(seats, action, params, seat, code):
    stored = GAMES[seats[0]]
    original, snapshot, records = stored.state, deepcopy(stored.state), dict(stored.sessions)
    token = seats[1][seat]["active_session"] if seat else None
    status, body = request(seats, action, params, token=token)
    assert status == (401 if code == "SESSION_REQUIRED" else 403 if code else 200)
    if code:
        assert body["error"]["code"] == code
        assert stored.state is original and stored.state == snapshot and stored.sessions == records


@pytest.mark.parametrize("action,params,seat", [
    ("gf.scene_stand", {"player_id": "p1"}, "p1"),
    ("gf.scene_play_scum", {"player_id": "p1", "target_player_id": "p2"}, "p1"),
    ("gf.scene_force_acknowledge_resolution", {"actor_id": "host", "player_id": "p1"}, "host"),
    ("gf.scene_set_participants", {"actor_id": "host", "participant_ids": ["p1", "p2"]}, "host"),
    ("gf.pending_reclaim", {"player_id": "host"}, "host"),
])
def test_registry_caller_and_references(seats, action, params, seat):
    stored = GAMES[seats[0]]
    authorize_request(stored.state, stored.sessions, seats[1][seat]["active_session"],
                      action=action, params=params, view="public", viewer_id=None)
    other = "p2" if seat == "p1" else "p1"
    with pytest.raises(AuthorityError) as error:
        authorize_request(stored.state, stored.sessions, seats[1][other]["active_session"],
                          action=action, params=params, view="public", viewer_id=None)
    assert error.value.code == "ACTOR_MISMATCH"


def test_wrong_projection_rejected_before_mutation_and_pending(seats):
    stored = GAMES[seats[0]]
    stored.state = begin_pending_interaction(stored.state, {
        "kind": "test", "actor_id": "p2", "allowed_actions": [], "payload": {}, "continuation": None})
    original, snapshot, records = stored.state, deepcopy(stored.state), dict(stored.sessions)
    for action, params, seat in [
        ("gf.submit_character_name", {"player_id": "p1", "name": "Ash"}, "p1"),
        ("gf.set_registration_open", {"actor_id": "host", "is_open": False}, "host")]:
        status, body = request(seats, action, params, view="player", viewer="p2", token=seats[1][seat]["active_session"])
        assert status == 403 and body["error"]["code"] == "VIEWER_MISMATCH"
    status, body = request(seats, "gf.scene_stand", {"player_id": "p1"}, token=seats[1]["p2"]["active_session"])
    assert status == 403 and body["error"]["code"] == "ACTOR_MISMATCH"
    assert stored.state is original and stored.state == snapshot and stored.sessions == records


def test_reconnect_replacement_and_cross_game(seats):
    game_id, credentials = seats
    old = credentials["p1"]["active_session"]
    status, response = http_request("/api/gf/reconnect", method="POST", body={
        "game_id": game_id, "reconnect_token": credentials["p1"]["reconnect_token"]})
    assert status == 200
    new = response["result"]["session"]["active_session"]
    stored = GAMES[game_id]
    original, snapshot, records = stored.state, deepcopy(stored.state), dict(stored.sessions)
    for action in [None, "gf.get_state", "gf.scene_stand"]:
        status, response = request(seats, action, {"player_id": "p1"}, view="player", viewer="p1", token=old)
        assert status == 401 and response["error"]["code"] == "SESSION_REPLACED"
    assert stored.state is original and stored.state == snapshot and stored.sessions == records
    assert request(seats, view="player", viewer="p1", token=new)[0] == 200
    foreign = main.new_game(NewGameRequest(creator_id="other")).result["session"]["active_session"]
    for token in [foreign, credentials["p1"]["reconnect_token"]]:
        status, response = request(seats, view="player", viewer="p1", token=token)
        assert status == 401 and response["error"]["code"] == "SESSION_INVALID"


def test_debug_is_separate_permission(seats, monkeypatch):
    token = seats[1]["host"]["active_session"]
    assert request(seats, view="debug", token=token)[0] == 403
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    assert request(seats, view="debug")[0] == 200
    assert request(seats, "gf.set_registration_open", {"actor_id": "host", "is_open": False}, view="debug")[0] == 200
    assert request(seats, view="player", viewer="p1")[0] == 401


def test_join_cannot_reacquire_seat(seats):
    records = dict(GAMES[seats[0]].sessions)
    status, _ = request(seats, "gf.join_lobby", {"player_id": "p1"})
    assert status != 200 and GAMES[seats[0]].sessions == records


def test_read_and_action_authentication_hold_shared_lock(seats, monkeypatch):
    stored = GAMES[seats[0]]
    class CheckedLock:
        held = False
        def __enter__(self):
            self.held = True
        def __exit__(self, *args):
            self.held = False
    lock = CheckedLock()
    stored.lock = lock
    original = main.authorize_request
    calls = []
    def checked(*args, **kwargs):
        assert lock.held
        calls.append(kwargs.get("action"))
        return original(*args, **kwargs)
    monkeypatch.setattr(main, "authorize_request", checked)
    token = seats[1]["host"]["active_session"]
    assert request(seats, view="marshal", viewer="host", token=token)[0] == 200
    assert request(seats, "gf.set_registration_open", {"actor_id": "host", "is_open": False}, token=token)[0] == 200
    assert calls == [None, "gf.set_registration_open"]
    original_reconnect = main.resolve_reconnect_seat
    def checked_reconnect(*args):
        assert lock.held
        return original_reconnect(*args)
    monkeypatch.setattr(main, "resolve_reconnect_seat", checked_reconnect)
    status, _ = http_request("/api/gf/reconnect", method="POST", body={
        "game_id": seats[0], "reconnect_token": seats[1]["host"]["reconnect_token"]})
    assert status == 200


def test_authenticated_player_mutation(seats):
    token = seats[1]["p1"]["active_session"]
    status, _ = request(seats, "gf.claim_character", {"player_id": "p1", "card_id": "JS"}, token=token)
    assert status == 200
    status, response = request(seats, "gf.submit_character_name", {"player_id": "p1", "name": "Ash"},
                               view="player", viewer="p1", token=token)
    assert status == 200 and response["error"] is None


def test_authenticated_yankee_privacy(seats):
    stored = GAMES[seats[0]]
    stored.state = begin_pending_interaction(stored.state, {
        "kind": "yankee_inspect_top_card", "actor_id": "p1", "allowed_actions": ["gf.yankee_choose_top_card"],
        "payload": {"inspected_card_id": "9C"}, "continuation": None})
    status, response = request(seats, view="player", viewer="p1", token=seats[1]["p1"]["active_session"])
    assert status == 200
    assert response["state"]["meta"]["pending_interaction"]["payload"]["inspected_card_id"] == "9C"
    status, response = request(seats, view="player", viewer="p2", token=seats[1]["p2"]["active_session"])
    assert status == 200 and response["state"]["meta"]["pending_interaction"]["payload"] == {}
    status, response = request(seats, view="player", viewer="p1", token=seats[1]["p2"]["active_session"])
    assert status == 403 and response["error"]["code"] == "VIEWER_MISMATCH"


def test_authenticated_dark_privacy(seats):
    from backend.tests.test_gf_scene import _ready_table_game
    from backend.engine.rules.grim_fronteira.scene import (
        scene_set_participants, scene_declare_dark, scene_roll_difficulty, scene_dark_draw,
        SCENE_DARK_MARSHAL_HAND_ZONE,
    )
    game = _ready_table_game()
    game = replace(game, meta={**game.meta, "marshal_id": "host"})
    game = scene_set_participants(game, actor_id="host", participant_ids=["p1"])
    game = scene_declare_dark(game, actor_id="host")
    game, _ = scene_roll_difficulty(game, actor_id="host")
    game, _ = scene_dark_draw(game, actor_id="host")
    GAMES[seats[0]].state = game
    status, response = request(seats, view="marshal", viewer="host", token=seats[1]["host"]["active_session"])
    assert status == 200 and response["state"]["zones"][SCENE_DARK_MARSHAL_HAND_ZONE] == game.zones[SCENE_DARK_MARSHAL_HAND_ZONE]
    status, response = request(seats, view="player", viewer="p1", token=seats[1]["p1"]["active_session"])
    assert status == 200 and response["state"]["zones"][SCENE_DARK_MARSHAL_HAND_ZONE] == {"count": 1}
    status, response = request(seats, view="marshal", viewer="host", token=seats[1]["p1"]["active_session"])
    assert status == 403 and response["error"]["code"] == "VIEWER_MISMATCH"


def test_stale_record_for_removed_seat_fails_closed(seats):
    stored = GAMES[seats[0]]
    stored.state = replace(stored.state, meta={**stored.state.meta,
        "players_order": [p for p in stored.state.meta["players_order"] if p != "p1"]})
    original, records = stored.state, dict(stored.sessions)
    for action in [None, "gf.get_state", "gf.scene_stand"]:
        status, response = request(seats, action, {"player_id": "p1"}, view="player", viewer="p1",
                                   token=seats[1]["p1"]["active_session"])
        assert status == 401 and response["error"]["code"] == "SESSION_INVALID"
    assert stored.state is original and stored.sessions == records


def test_malformed_header_is_generic_and_secret_free(seats):
    for token in [" ", "Bearer secret-do-not-echo", "not-a-valid-token"]:
        status, response = request(seats, view="player", viewer="p1", token=token)
        assert status == 401 and response["error"]["code"] == "SESSION_INVALID"
        assert response["error"]["details"] is None
        if token.strip():
            assert token not in str(response)
