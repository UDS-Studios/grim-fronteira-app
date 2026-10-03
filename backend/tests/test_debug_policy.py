"""HTTP debug permission, safe defaults, and rejection atomicity."""
from copy import deepcopy

import pytest

from backend.app.debug_policy import DEBUG_ONLY_ACTIONS, debug_api_enabled
from backend.app.main import new_game
from backend.app.schemas import ActionRequest, NewGameRequest, ViewRequest
from backend.app.store import GAMES, StoredGame
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.state.game_state import GameState
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_gf_scene import _ready_table_game
from backend.tests.test_yankees import http_request


pytestmark = pytest.mark.usefixtures("authenticated_application_requests")


@pytest.fixture(autouse=True)
def isolated_store_and_policy(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    GAMES.clear()
    yield
    GAMES.clear()


@pytest.fixture
def game_id():
    return new_game(NewGameRequest(creator_id="host")).game_id


def install_pending(game_id):
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "host", "allowed_actions": list(DEBUG_ONLY_ACTIONS),
        "payload": {}, "continuation": None,
    })


def assert_denied_without_mutation(game_id, *, path="/api/gf/action", method="POST", body=None, query="", message="Debug API is disabled"):
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    keys = set(GAMES)
    status, response = http_request(path, method=method, body=body, query=query)
    assert status == 403
    assert response["error"] == {"code": "HTTP_403", "message": message, "details": None}
    assert response["state"] == {}
    assert set(GAMES) == keys
    assert GAMES[game_id].state is original
    assert GAMES[game_id].state == snapshot
    assert GAMES[game_id].state.meta["revision"] == snapshot.meta["revision"]


@pytest.mark.parametrize("route", ["get", "action", "new"])
def test_debug_projection_disabled_by_default(game_id, route):
    install_pending(game_id)
    if route == "get":
        assert_denied_without_mutation(game_id, path=f"/api/game/{game_id}", method="GET", query="view=debug")
    elif route == "new":
        # Invalid path also proves the policy runs before loading the deck.
        assert_denied_without_mutation(game_id, path="/api/gf/new", body={"view": "debug", "template_path": "missing.json"})
    else:
        assert_denied_without_mutation(game_id, body={"game_id": game_id, "action": "gf.get_state", "view": "debug"})


@pytest.mark.parametrize("action", sorted(DEBUG_ONLY_ACTIONS))
@pytest.mark.parametrize("view", ["public", "player", "marshal", "debug"])
def test_debug_and_legacy_actions_require_server_permission(game_id, action, view):
    install_pending(game_id)
    assert_denied_without_mutation(game_id, body={
        "game_id": game_id, "action": action, "view": view, "viewer_id": "host",
        "params": {"actor_id": "host", "player_ids": ["p1"], "card_id": "2C"},
    })


@pytest.mark.parametrize("action", sorted(DEBUG_ONLY_ACTIONS))
@pytest.mark.parametrize("view", ["public", "player", "marshal"])
def test_enabled_debug_actions_still_require_debug_view(game_id, monkeypatch, action, view):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    assert_denied_without_mutation(game_id, body={
        "game_id": game_id, "action": action, "view": view, "viewer_id": "host",
        "params": {"actor_id": "host"},
    }, message=f"{action} is debug-only")


@pytest.mark.parametrize("debug_enabled", [False, True])
def test_omitted_views_are_public(game_id, monkeypatch, debug_enabled):
    if debug_enabled:
        monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    assert ViewRequest().view == "public"
    assert NewGameRequest().view == "public"
    assert ActionRequest(game_id=game_id, action="gf.get_state").view == "public"
    for path, method, body in [
        (f"/api/game/{game_id}", "GET", None),
        ("/api/gf/action", "POST", {"game_id": game_id, "action": "gf.get_state"}),
        ("/api/gf/new", "POST", {"creator_id": "host"}),
    ]:
        status, response = http_request(path, method=method, body=body)
        assert status == 200
        assert isinstance(response["state"]["deck"]["draw_pile"], dict)


@pytest.mark.parametrize("route", ["get", "action", "new"])
def test_explicit_permission_allows_full_debug_projection(game_id, monkeypatch, route):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    if route == "get":
        status, response = http_request(f"/api/game/{game_id}", query="view=debug")
    else:
        body = {"view": "debug"}
        if route == "action":
            body.update(game_id=game_id, action="gf.get_state")
        status, response = http_request(f"/api/gf/{route if route == 'new' else 'action'}", method="POST", body=body)
    assert status == 200
    assert isinstance(response["state"]["deck"]["draw_pile"], list)


@pytest.mark.parametrize("action", sorted(DEBUG_ONLY_ACTIONS))
def test_enabled_debug_and_legacy_actions_keep_behavior(game_id, monkeypatch, action):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    params = {"actor_id": "host", "player_ids": ["p1"], "card_id": "2C"}
    if action == "gf.setup_players":
        # The legacy setup orchestrator expects an unextracted deck.
        GAMES[game_id] = StoredGame(state=GameState(
            deck=load_deck("data/templates/standard_54.json"), meta={"revision": 1},
        ))
    elif action == "gf.debug_resolve_pending_interaction":
        install_pending(game_id)
    before = GAMES[game_id].state.meta["revision"]
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": action, "params": params, "view": "debug",
    })
    assert status == 200
    assert response["revision"] == before + 1
    state = GAMES[game_id].state
    if action == "gf.setup_players":
        assert state.meta["setup.players"] == ["p1"]
        assert len(state.zones["players.p1.character"]) == 1
    elif action == "gf.roll_difficulty":
        assert response["result"]["difficulty"]["drawn_cards"] == state.zones["scene.difficulty.cards"]
    elif action == "gf.debug_stack_top_card":
        assert state.deck.draw_pile[-1] == "2C"
    elif action == "gf.debug_begin_pending_interaction":
        assert state.meta["pending_interaction"]["actor_id"] == "host"
    else:
        assert state.meta["pending_interaction"] is None


def test_production_scene_difficulty_does_not_require_debug(game_id):
    GAMES[game_id].state = _ready_table_game()
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.scene_roll_difficulty",
        "params": {"actor_id": "host1"}, "view": "marshal", "viewer_id": "host1",
    })
    assert status == 200
    assert response["state"]["meta"]["scene"]["difficulty"]["card_id"]


@pytest.mark.parametrize("view,viewer", [("public", None), ("player", "host"), ("marshal", "host")])
def test_production_reclaim_and_reads_do_not_require_debug(game_id, view, viewer):
    install_pending(game_id)
    original = GAMES[game_id].state
    query = f"view={view}" + (f"&viewer_id={viewer}" if viewer else "")
    status, response = http_request(f"/api/game/{game_id}", query=query)
    assert status == 200
    assert GAMES[game_id].state is original
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.get_state", "view": view, "viewer_id": viewer,
    })
    assert status == 200
    assert GAMES[game_id].state is original
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.pending_reclaim", "params": {"actor_id": "host"},
        "view": view, "viewer_id": viewer,
    })
    assert status == 200
    assert response["result"]["reclaimed"] is True
    assert GAMES[game_id].state.meta["pending_interaction"] is None


@pytest.mark.parametrize("value", [None, "", "0", "false", "no", "off", "anything", "1", "true", "yes", "on", " TRUE "])
def test_debug_configuration_is_explicit_and_isolated(monkeypatch, value):
    assert not debug_api_enabled()
    with monkeypatch.context() as scoped:
        if value is not None:
            scoped.setenv("GF_ENABLE_DEBUG_API", value)
        assert debug_api_enabled() == (value in {"1", "true", "yes", "on", " TRUE "})
    assert not debug_api_enabled()
