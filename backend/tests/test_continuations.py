from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from threading import Barrier

import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.pending_interactions import DEBUG_BEGIN, DEBUG_RESOLVE, RECLAIM
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.store import GAMES
from backend.engine.state.continuations import complete_pending_interaction
from backend.engine.state.pending_interaction import normalize_pending_interaction


@pytest.fixture
def game_id():
    GAMES.clear()
    game_id = main.new_game(NewGameRequest(creator_id="host")).game_id
    dispatch(game_id, DEBUG_BEGIN)
    yield game_id
    GAMES.clear()


def dispatch(game_id, name):
    actor = "host" if name == RECLAIM else "p1"
    return main.action(ActionRequest(game_id=game_id, action=name, params={"actor_id": actor}))


@pytest.mark.parametrize("first,second", [
    (DEBUG_RESOLVE, DEBUG_RESOLVE), (RECLAIM, RECLAIM),
    (DEBUG_RESOLVE, RECLAIM), (RECLAIM, DEBUG_RESOLVE),
])
def test_completion_and_replay(game_id, first, second):
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    response = dispatch(game_id, first)
    completed = GAMES[game_id].state
    marker = "resolved" if first == DEBUG_RESOLVE else "reclaimed"
    assert completed.meta["pending_interaction"] is None
    assert completed.meta["debug_continuation_trace"] == [marker]
    assert response.revision == original.meta["revision"] + 1
    assert original == snapshot
    with pytest.raises(HTTPException, match="No pending interaction"):
        dispatch(game_id, second)
    assert GAMES[game_id].state is completed
    assert completed.meta["debug_continuation_trace"] == [marker]
    assert completed.meta["revision"] == response.revision


@pytest.mark.parametrize("name,branch", [(DEBUG_RESOLVE, "on_resolve"), (RECLAIM, "on_reclaim")])
def test_failed_continuation_keeps_original_and_can_retry(game_id, name, branch):
    game = GAMES[game_id].state
    pending = deepcopy(game.meta["pending_interaction"])
    pending["continuation"][branch] = {"kind": "debug_raise", "payload": {}}
    original = replace(game, meta={**game.meta, "pending_interaction": pending})
    GAMES[game_id].state = original
    snapshot = deepcopy(original)
    for _ in range(2):
        with pytest.raises(ValueError, match="debug continuation failure"):
            dispatch(game_id, name)
        assert GAMES[game_id].state is original
        assert original == snapshot
    # The other branch remains usable after a failed completion.
    dispatch(game_id, RECLAIM if name == DEBUG_RESOLVE else DEBUG_RESOLVE)
    assert GAMES[game_id].state.meta["revision"] == original.meta["revision"] + 1


@pytest.mark.parametrize("continuation", [
    {"action": "gf.join_lobby", "params": {"player_id": "unexpected"}},
    {"opaque_debug_data": ["inert", 1]},
    {"on_resolve": {"kind": "gf.join_lobby", "payload": {}}, "on_reclaim": None},
    {"on_resolve": {"kind": "debug_resume_marker", "payload": {}}, "on_reclaim": None},
    {"on_resolve": {"kind": "debug_resume_marker", "payload": {"marker": 3}}, "on_reclaim": None},
    {"on_resolve": {"kind": "debug_raise", "payload": {"unexpected": True}}, "on_reclaim": None},
    {"on_resolve": None, "on_reclaim": {"kind": "unknown", "payload": {}}},
    {"on_resolve": None},
    {"on_resolve": {"kind": "debug_raise", "payload": []}, "on_reclaim": None},
])
def test_invalid_schema_is_never_executable(game_id, continuation):
    original = GAMES[game_id].state
    pending = {**original.meta["pending_interaction"], "continuation": continuation}
    with pytest.raises(ValueError):
        normalize_pending_interaction(pending)
    assert GAMES[game_id].state is original


@pytest.mark.parametrize("continuation", [None, {"on_resolve": None, "on_reclaim": None}])
def test_empty_continuation_is_valid(game_id, continuation):
    game = GAMES[game_id].state
    pending = {**game.meta["pending_interaction"], "continuation": continuation}
    derived = replace(game, meta={**game.meta, "pending_interaction": pending})
    result = complete_pending_interaction(derived, outcome="resolve")
    assert result.meta["pending_interaction"] is None
    assert "debug_continuation_trace" not in result.meta


def test_internal_completion_never_dispatches_http_or_bumps_revision(game_id, monkeypatch):
    original = GAMES[game_id].state
    def forbidden(*args, **kwargs):
        pytest.fail("Internal continuation entered external action dispatch")
    monkeypatch.setattr(main, "action", forbidden)
    result = complete_pending_interaction(original, outcome="resolve")
    assert result.meta["debug_continuation_trace"] == ["resolved"]
    assert result.meta["revision"] == original.meta["revision"]
    assert GAMES[game_id].state is original
    with pytest.raises(ValueError, match="No pending interaction"):
        complete_pending_interaction(result, outcome="resolve")


@pytest.mark.parametrize("names", [(DEBUG_RESOLVE, DEBUG_RESOLVE), (RECLAIM, RECLAIM), (DEBUG_RESOLVE, RECLAIM)])
def test_concurrent_requests_execute_handler_once(game_id, monkeypatch, names):
    from backend.engine.state import continuations
    original = GAMES[game_id].state
    calls = []
    handler = continuations._dispatch_continuation
    def tracked(game, destination):
        calls.append(destination)
        return handler(game, destination)
    monkeypatch.setattr(continuations, "_dispatch_continuation", tracked)
    barrier = Barrier(2)
    def attempt(name):
        barrier.wait(timeout=5)
        try:
            dispatch(game_id, name)
            return True
        except HTTPException:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, names))
    assert sorted(results) == [False, True]
    assert len(calls) == 1
    assert len(GAMES[game_id].state.meta["debug_continuation_trace"]) == 1
    assert GAMES[game_id].state.meta["revision"] == original.meta["revision"] + 1


def test_wrong_actor_is_rejected_before_continuation(game_id, monkeypatch):
    from backend.engine.state import continuations
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    def forbidden(*args, **kwargs):
        pytest.fail("Unauthorized request reached continuation")
    monkeypatch.setattr(continuations, "_dispatch_continuation", forbidden)
    with pytest.raises(HTTPException, match="Wrong actor"):
        main.action(ActionRequest(game_id=game_id, action=DEBUG_RESOLVE,
                                  params={"actor_id": "host"}))
    assert GAMES[game_id].state is original
    assert original == snapshot
