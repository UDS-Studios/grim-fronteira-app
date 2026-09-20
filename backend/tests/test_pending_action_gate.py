from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi import HTTPException

from backend.app.main import action, get_state, new_game
from backend.app.pending_interactions import (
    DEBUG_BEGIN, DEBUG_RESOLVE, RECLAIM, effective_actor, enforce_pending_action_gate,
)
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.store import GAMES
from backend.engine.state.pending_interaction import begin_pending_interaction


@pytest.fixture
def game_id():
    GAMES.clear()
    result = new_game(NewGameRequest(creator_id="host"))
    yield result.game_id
    GAMES.clear()


def dispatch(game_id, name, params=None, view="debug"):
    return action(ActionRequest(game_id=game_id, action=name, params=params or {}, view=view, viewer_id="p1"))


def begin(game_id, actor="p1"):
    return dispatch(game_id, DEBUG_BEGIN, {"actor_id": actor})


def assert_rejected(game_id, name, params, message, view="debug", status=403):
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    with pytest.raises(HTTPException) as exc:
        dispatch(game_id, name, params, view)
    assert exc.value.status_code == status
    assert message in exc.value.detail
    assert GAMES[game_id].state is original
    assert GAMES[game_id].state == snapshot


@pytest.mark.parametrize("params,expected", [
    ({"player_id": "p1"}, "p1"),
    ({"actor_id": "host"}, "host"),
    ({"actor_id": "host", "player_id": "p1"}, "host"),
    ({"actor_id": None, "player_id": "p1"}, None),
    ({"actor_id": "", "player_id": "p1"}, None),
    ({"actor_id": 1, "player_id": "p1"}, None),
    ({"actor_id": "  "}, None), ({"player_id": []}, None), ({}, None),
])
def test_effective_actor(params, expected):
    assert effective_actor(params) == expected


def test_no_pending_retains_existing_dispatch(game_id):
    before = GAMES[game_id].state.meta["revision"]
    response = dispatch(game_id, "gf.join_lobby", {"player_id": "p1"})
    assert response.revision == before + 1
    card = GAMES[game_id].state.deck.draw_pile[0]
    response = dispatch(game_id, "gf.debug_stack_top_card", {"card_id": card})
    assert response.revision == before + 2
    assert response.result["top_of_draw_pile"] == card


@pytest.mark.parametrize("view", ["public", "player", "debug"])
def test_read_only_routes_remain_available_without_mutation(game_id, view):
    begin(game_id)
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    for response in (dispatch(game_id, "gf.get_state", view=view), get_state(game_id, view, viewer_id="p1")):
        assert response.revision == original.meta["revision"]
        assert response.state["meta"]["pending_interaction"] == original.meta["pending_interaction"]
    assert GAMES[game_id].state is original
    assert original == snapshot


@pytest.mark.parametrize("name,params", [
    ("gf.join_lobby", {"player_id": "p2"}),
    ("gf.join_lobby", {"player_id": "p1"}),
    ("gf.scene_new", {"actor_id": "host"}),
    ("gf.debug_stack_top_card", {"card_id": "AS"}),
    ("gf.setup_players", {"player_ids": ["p1"]}),
    (DEBUG_BEGIN, {"actor_id": "p1"}),
])
def test_unrelated_mutations_blocked(game_id, name, params):
    begin(game_id)
    assert_rejected(game_id, name, params, "Action not permitted")


@pytest.mark.parametrize("params,message", [
    ({"player_id": "p2"}, "Wrong actor"),
    ({"actor_id": "host"}, "Wrong actor"),
    ({"actor_id": "host", "player_id": "p1"}, "Wrong actor"),
    ({}, "effective actor required"),
    ({"actor_id": None, "player_id": "p1"}, "effective actor required"),
])
def test_allowed_action_requires_owner(game_id, params, message):
    begin(game_id)
    assert_rejected(game_id, DEBUG_RESOLVE, params, message)


@pytest.mark.parametrize("owner,params", [
    ("p1", {"player_id": "p1"}),
    ("p1", {"actor_id": "p1"}),
    ("host", {"actor_id": "host", "player_id": "p1"}),
])
def test_synthetic_begin_and_resolve_preserve_scene_flow(game_id, owner, params):
    original = deepcopy(GAMES[game_id].state)
    response = begin(game_id, owner)
    pending = GAMES[game_id].state
    assert response.revision == original.meta["revision"] + 1
    assert pending.meta["pending_interaction"] == {
        "kind": "debug_test", "actor_id": owner, "allowed_actions": [DEBUG_RESOLVE],
        "payload": {"test": True}, "continuation": {
            "on_resolve": {"kind": "debug_resume_marker", "payload": {"marker": "resolved"}},
            "on_reclaim": {"kind": "debug_resume_marker", "payload": {"marker": "reclaimed"}},
        },
    }
    assert pending == replace(original, meta={**original.meta,
        "pending_interaction": pending.meta["pending_interaction"], "revision": response.revision})
    response = dispatch(game_id, DEBUG_RESOLVE, params)
    assert response.result["resolved"] is True
    assert response.result["actor_id"] == owner
    assert GAMES[game_id].state == replace(original, meta={**original.meta,
        "revision": original.meta["revision"] + 2, "debug_continuation_trace": ["resolved"]})


@pytest.mark.parametrize("view", ["public", "player"])
def test_synthetic_actions_are_debug_only(game_id, view):
    assert_rejected(game_id, DEBUG_BEGIN, {"actor_id": "p1"}, "debug-only", view)
    begin(game_id)
    assert_rejected(game_id, DEBUG_RESOLVE, {"player_id": "p1"}, "debug-only", view)


@pytest.mark.parametrize("name", [RECLAIM, DEBUG_RESOLVE])
def test_clear_requires_pending(game_id, name):
    assert_rejected(game_id, name, {"actor_id": "host"}, "No pending interaction", status=400)


@pytest.mark.parametrize("params", [
    {"actor_id": "p1"}, {"player_id": "p2"}, {},
    {"actor_id": "p1", "player_id": "host"},
])
def test_reclaim_requires_current_marshal(game_id, params):
    begin(game_id)
    assert_rejected(game_id, RECLAIM, params, "Only the current Marshal")


@pytest.mark.parametrize("name,params,view", [
    (RECLAIM, {"actor_id": "host"}, "public"),
    (RECLAIM, {"player_id": "host"}, "player"),
    (DEBUG_RESOLVE, {"player_id": "p1"}, "debug"),
])
def test_completion_without_continuation_preserves_everything_else(game_id, name, params, view):
    original = GAMES[game_id].state
    pending = begin_pending_interaction(original, {
        "kind": "test_opaque", "actor_id": "p1", "allowed_actions": [DEBUG_RESOLVE],
        "payload": {"nested": [1, 2]},
        "continuation": None,
    })
    GAMES[game_id].state = pending
    response = dispatch(game_id, name, params, view)
    assert response.revision == original.meta["revision"] + 1
    assert response.result["kind"] == "test_opaque"
    assert response.result["actor_id"] == "p1"
    assert response.result["reclaimed" if name == RECLAIM else "resolved"] is True
    assert GAMES[game_id].state == replace(original, meta={**original.meta,
        "revision": original.meta["revision"] + 1})


def test_current_marshal_identity_is_authoritative(game_id):
    begin(game_id)
    current = GAMES[game_id].state
    GAMES[game_id].state = replace(current, meta={**current.meta, "marshal_id": "new_host"})
    assert_rejected(game_id, RECLAIM, {"actor_id": "host"}, "Only the current Marshal")
    dispatch(game_id, RECLAIM, {"actor_id": "new_host"})


def test_gate_uses_actor_not_target_for_marshal_action(game_id):
    game = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "host", "allowed_actions": ["gf.scene_force_skip_heal"],
        "payload": {}, "continuation": None,
    })
    enforce_pending_action_gate(game, "gf.scene_force_skip_heal", {"actor_id": "host", "player_id": "p1"})
    with pytest.raises(HTTPException, match="Wrong actor"):
        enforce_pending_action_gate(game, "gf.scene_force_skip_heal", {"actor_id": "p1", "player_id": "host"})


def test_specifically_permitted_debug_mutation_still_requires_actor(game_id):
    game = GAMES[game_id].state
    GAMES[game_id].state = begin_pending_interaction(game, {
        "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_stack_top_card"],
        "payload": {}, "continuation": None,
    })
    card = game.deck.draw_pile[0]
    assert_rejected(game_id, "gf.debug_stack_top_card", {"card_id": card}, "effective actor required")
    response = dispatch(game_id, "gf.debug_stack_top_card", {"actor_id": "p1", "card_id": card})
    assert response.result["top_of_draw_pile"] == card
    assert response.revision == game.meta["revision"] + 1
