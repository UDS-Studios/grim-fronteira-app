"""Pause policy through real HTTP authority, with controlled time and no sleeps."""
from copy import deepcopy
from dataclasses import replace

import pytest

from backend.app import main, presence
from backend.app.pause import pause_state
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.store import GAMES
from backend.engine.rules.grim_fronteira.scene import scene_set_participants, scene_roll_difficulty, scene_start
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_gf_scene import _ready_table_game
from backend.tests.test_yankees import http_request


@pytest.fixture
def seats(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    clock = [100.0]
    monkeypatch.setattr(presence, "now", lambda: clock[0])
    GAMES.clear()
    created = main.new_game(NewGameRequest(creator_id="host1"))
    credentials = {"host1": created.result["session"]}
    for player in ["p1", "p2"]:
        joined = main.action(ActionRequest(game_id=created.game_id, action="gf.join_lobby", params={"player_id": player}))
        credentials[player] = joined.result["session"]
    yield created.game_id, credentials, clock
    GAMES.clear()


def action(seats, name, params=None, player="p1", view="public", token=None):
    game_id, credentials, _ = seats
    return http_request("/api/gf/action", method="POST", headers={"X-GF-Session": token or credentials[player]["active_session"]},
                        body={"game_id": game_id, "action": name, "params": params or {}, "view": view,
                              "viewer_id": player if view in {"player", "marshal"} else None})


def table(seats):
    game = _ready_table_game()
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _ = scene_roll_difficulty(game, actor_id="host1", seed=123)
    game = scene_start(game, actor_id="host1")
    game = replace(game, meta={**game.meta, "revision": 10})
    GAMES[seats[0]].state = game
    return GAMES[seats[0]]


def reconnect(seats, player):
    return http_request("/api/gf/reconnect", method="POST", body={"game_id": seats[0], "reconnect_token": seats[1][player]["reconnect_token"]})


@pytest.mark.parametrize("assignment", ["choice", "random"])
def test_offline_lobby_acquisition_character_creation_and_start(seats, assignment):
    assert action(seats, "gf.set_character_assignment_mode", {"actor_id": "host1", "mode": assignment}, player="host1")[0] == 200
    seats[2][0] += 20
    assert action(seats, "gf.join_lobby", {"player_id": "p3"})[0] == 200
    for player, name, card in [("p1", "Ash", "JS"), ("p2", "Mae", "QD")]:
        figure_action = ("gf.claim_character", {"card_id": card}) if assignment == "choice" else ("gf.draw_character", {})
        for command, params in [figure_action, ("gf.submit_character_name", {"name": name}),
                                ("gf.submit_character_feature", {"feature": "scarred"})]:
            status, body = action(seats, command, {"player_id": player, **params}, player=player)
            assert status == 200 and body["state"]["meta"]["session_pause"] == {"paused": False, "reason": None}
    # Remove the extra unready seat from this start-transition fixture.
    stored = GAMES[seats[0]]
    stored.state = replace(stored.state, meta={**stored.state.meta, "players_order": ["host1", "p1", "p2"]})
    assert action(seats, "gf.start_game", {"actor_id": "host1"}, player="host1")[0] == 200
    assert stored.state.meta["phase"] == "hook_selection"
    assert not pause_state(stored.state, stored.sessions)["paused"]


def test_online_marshal_allows_player_and_offline_player_does_not_pause(seats):
    stored = table(seats)
    seats[2][0] += 20
    main.get_state(seats[0], "marshal", "host1", seats[1]["host1"]["active_session"])
    assert not presence.presence_snapshot(stored.sessions)["p1"]["online"]
    assert action(seats, "gf.scene_stand", {"player_id": "p1"})[0] == 200


def test_pause_dominates_pending_and_rejection_is_atomic(seats):
    stored = table(seats)
    stored.state = begin_pending_interaction(stored.state, {"kind": "test", "actor_id": "p2", "allowed_actions": [], "payload": {}, "continuation": None})
    original, snapshot = stored.state, deepcopy(stored.state)
    seats[2][0] += 20
    status, body = action(seats, "gf.scene_stand", {"player_id": "p1"})
    assert status == 409 and body["error"] == {"code": "GAME_PAUSED", "message": "The game is paused while the Marshal is offline", "details": {"reason": "marshal_offline"}}
    assert stored.state is original and stored.state == snapshot
    assert body["revision"] == original.meta["revision"]
    assert stored.sessions["p1"].last_seen == seats[2][0]
    # Returning Marshal read lifts only the presence pause; pending obligation remains.
    main.get_state(seats[0], "marshal", "host1", seats[1]["host1"]["active_session"])
    status, body = action(seats, "gf.scene_stand", {"player_id": "p1"})
    assert status != 200 and body["error"]["code"] != "GAME_PAUSED"
    assert stored.state is original


@pytest.mark.parametrize("phase", ["hook_selection", "started", "table", "victory"])
def test_phases_reads_projections_and_revision(seats, phase):
    stored = table(seats)
    stored.state = replace(stored.state, meta={**stored.state.meta, "phase": phase})
    original = stored.state
    seats[2][0] += 20
    for view in ["public", "player"]:
        headers = {"X-GF-Session": seats[1]["p1"]["active_session"]} if view == "player" else {}
        status, body = http_request(f"/api/game/{seats[0]}", query=f"view={view}&viewer_id=p1", headers=headers)
        assert status == 200 and body["state"]["meta"]["session_pause"] == {"paused": True, "reason": "marshal_offline"}
        assert body["revision"] == original.meta["revision"]
        status, body = action(seats, "gf.get_state", view=view)
        assert status == 200 and body["state"]["meta"]["session_pause"]["paused"]
    assert stored.state is original and "session_pause" not in original.meta
    assert action(seats, "gf.scene_stand", {"player_id": "p1"})[0] == 409


def test_returning_marshal_action_and_reconnect_unpause(seats):
    stored = table(seats)
    seats[2][0] += 20
    stored.state = begin_pending_interaction(stored.state, {"kind": "test", "actor_id": "p1", "allowed_actions": [], "payload": {}, "continuation": None})
    assert action(seats, "gf.pending_reclaim", {"actor_id": "host1"}, player="host1")[0] == 200
    assert not pause_state(stored.state, stored.sessions)["paused"]
    seats[2][0] += 20
    original = stored.state
    status, body = reconnect(seats, "p1")
    assert status == 200 and body["state"]["meta"]["session_pause"]["paused"]
    status, body = reconnect(seats, "host1")
    assert status == 200 and body["state"]["meta"]["session_pause"] == {"paused": False, "reason": None}
    assert stored.state is original and body["revision"] == original.meta["revision"]


def test_session_errors_precede_pause_and_debug_policy_is_independent(seats, monkeypatch):
    table(seats)
    old = seats[1]["p1"]["active_session"]
    reconnect(seats, "p1")
    seats[2][0] += 20
    for token, code in [("invalid", "SESSION_INVALID"), (old, "SESSION_REPLACED")]:
        status, body = action(seats, "gf.scene_stand", {"player_id": "p1"}, token=token)
        assert status == 401 and body["error"]["code"] == code
    status, body = http_request("/api/gf/action", method="POST", body={"game_id": seats[0], "action": "gf.scene_stand", "params": {"player_id": "p1"}})
    assert status == 401 and body["error"]["code"] == "SESSION_REQUIRED"
    assert action(seats, "gf.scene_stand", {"player_id": "p1"}, view="debug")[0] == 403
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    assert action(seats, "gf.scene_stand", {"player_id": "p1"}, view="debug")[0] == 200
    assert action(seats, "gf.debug_stack_top_card", {"card_id": "BJ"}, view="public")[0] == 403
    assert action(seats, "gf.debug_stack_top_card", {"card_id": "BJ"}, view="debug")[0] == 200
