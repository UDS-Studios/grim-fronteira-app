"""Real lifespan restore and fresh-process recovery, without sleeps."""
import asyncio
from copy import deepcopy
import json
import os
import subprocess
import sys

import pytest

from backend.app import main, presence
from backend.app.schemas import ActionRequest, NewGameRequest, ReconnectRequest
from backend.app.store import GAMES
from backend.tests.test_yankees import http_request


def make_running_game():
    created = main.new_game(NewGameRequest(creator_id="host"))
    game_id = created.game_id
    credentials = {"host": created.result["session"]}
    for player, figure in [("p1", "JS"), ("p2", "QD")]:
        joined = main.action(ActionRequest(game_id=game_id, action="gf.join_lobby", params={"player_id": player}))
        credentials[player] = joined.result["session"]
        for action, params in [
            ("gf.claim_character", {"card_id": figure}),
            ("gf.submit_character_name", {"name": player}),
            ("gf.submit_character_feature", {"feature": "scarred"}),
        ]:
            main.action(ActionRequest(game_id=game_id, action=action, params={"player_id": player, **params}), credentials[player]["active_session"])
    for action, params in [
        ("gf.start_game", {"seed": 7}), ("gf.begin_table", {}),
        ("gf.scene_set_participants", {"participant_ids": ["p1", "p2"]}),
        ("gf.scene_roll_difficulty", {"seed": 9}),
    ]:
        main.action(ActionRequest(game_id=game_id, action=action, params={"actor_id": "host", **params}), credentials["host"]["active_session"])
    main.action(ActionRequest(game_id=game_id, action="gf.debug_begin_pending_interaction", view="debug", params={"actor_id": "p1"}))
    return game_id, credentials


def test_lifespan_restores_real_game_and_recovery(file_repository, monkeypatch):
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    game_id, credentials = make_running_game()
    previous = GAMES[game_id]
    snapshot = deepcopy(previous.state)
    file_repository.close()
    monkeypatch.setenv("GF_PERSISTENCE_DIR", str(file_repository.directory))
    GAMES.clear()
    async def inspect():
        async with main.app.router.lifespan_context(main.app):
            restored = GAMES[game_id]
            assert restored.state == snapshot and restored.lock is not previous.lock
            assert all(r.last_seen is None and r.active_session_hash == "" for r in restored.sessions.values())
            assert not any(v["online"] for v in presence.presence_snapshot(restored.sessions).values())
            public = main.get_state(game_id)
            assert public.state["meta"]["session_pause"] == {"paused": True, "reason": "marshal_offline"}
            from backend.app.session_authority import AuthorityError, TakeoverRequiredError
            with pytest.raises(AuthorityError) as error:
                main.get_state(game_id, "player", "p1", credentials["p1"]["active_session"])
            assert error.value.code == "SESSION_INVALID"
            player = main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credentials["p1"]["reconnect_token"]))
            assert player.result["session"]["player_id"] == "p1"
            assert player.result["session"]["role"] == "player"
            assert player.state["meta"]["session_pause"]["paused"]
            assert restored.sessions["p1"].superseded_session_hashes == frozenset()
            with pytest.raises(TakeoverRequiredError):
                main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credentials["p1"]["reconnect_token"]))
            marshal = main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credentials["host"]["reconnect_token"]))
            assert marshal.result["session"]["role"] == "marshal"
            assert not marshal.state["meta"]["session_pause"]["paused"]
            assert marshal.revision == snapshot.meta["revision"]
            assert restored.state == snapshot
            assert restored.state.meta["pending_interaction"] == snapshot.meta["pending_interaction"]
            main.action(ActionRequest(game_id=game_id, action="gf.debug_resolve_pending_interaction", view="debug", params={"actor_id": "p1"}))
            assert restored.state.meta["pending_interaction"] is None
            assert restored.state.meta["debug_continuation_trace"] == ["resolved"]
    asyncio.run(inspect())
    assert not GAMES
    # Second lifespan restores the completed continuation, without executing it again.
    async def again():
        async with main.app.router.lifespan_context(main.app):
            assert GAMES[game_id].state.meta["debug_continuation_trace"] == ["resolved"]
            assert GAMES[game_id].state.meta["pending_interaction"] is None
    asyncio.run(again())


def test_lifespan_initialization_failure_does_not_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("GF_PERSISTENCE_DIR", "relative")
    async def start():
        async with main.app.router.lifespan_context(main.app):
            pytest.fail("startup must fail")
    with pytest.raises(RuntimeError, match="absolute"):
        asyncio.run(start())


def test_lobby_restores_offline_without_pause(file_repository):
    response = main.new_game(NewGameRequest(creator_id="host"))
    GAMES.clear()
    GAMES.update(file_repository.load_all().games)
    public = main.get_state(response.game_id)
    assert public.state["meta"]["presence"] == {"host": {"online": False}}
    assert public.state["meta"]["session_pause"] == {"paused": False, "reason": None}
    status, payload = http_request(f"/api/game/{response.game_id}", query="view=marshal&viewer_id=host", headers={"X-GF-Session": response.result["session"]["active_session"]})
    assert status == 401 and payload["error"]["code"] == "SESSION_INVALID"


def test_fresh_process_restores_and_recovers(tmp_path):
    directory = tmp_path / "games"
    environment = {**os.environ, "GF_PERSISTENCE_DIR": str(directory), "GF_ENABLE_DEBUG_API": "1"}
    first = '''
import asyncio, json
from backend.app import main
from backend.app.store import GAMES
from backend.tests.test_persistence_restart import make_running_game
from backend.engine.state.game_state_io import game_state_to_data
async def run():
    async with main.app.router.lifespan_context(main.app):
        game_id, credentials = make_running_game()
        print(json.dumps({"game_id": game_id, "credentials": credentials, "state": game_state_to_data(GAMES[game_id].state)}))
asyncio.run(run())
'''
    result = subprocess.run([sys.executable, "-c", first], env=environment, capture_output=True, text=True, check=True)
    saved = json.loads(result.stdout)
    second = '''
import asyncio, json, sys
from backend.app import main, presence
from backend.app.store import GAMES
from backend.app.schemas import ReconnectRequest
from backend.app.session_authority import AuthorityError
from backend.engine.state.game_state_io import game_state_to_data
saved = json.load(sys.stdin)
async def run():
    async with main.app.router.lifespan_context(main.app):
        game_id = saved["game_id"]
        stored = GAMES[game_id]
        assert game_state_to_data(stored.state) == saved["state"]
        assert not any(v["online"] for v in presence.presence_snapshot(stored.sessions).values())
        for seat, credential in saved["credentials"].items():
            try:
                main.get_state(game_id, credential["role"], seat, credential["active_session"])
            except AuthorityError as exc:
                assert exc.code == "SESSION_INVALID"
            else:
                raise AssertionError("old bearer was trusted")
            resumed = main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=credential["reconnect_token"]))
            assert resumed.result["mode"] == "resume"
            assert resumed.result["session"]["player_id"] == seat
            assert resumed.result["session"]["role"] == credential["role"]
            assert resumed.result["session"]["active_session"] != credential["active_session"]
            assert resumed.revision == saved["state"]["meta"]["revision"]
        assert game_state_to_data(stored.state) == saved["state"]
        print("fresh-process recovery verified")
asyncio.run(run())
'''
    result = subprocess.run([sys.executable, "-c", second], input=json.dumps(saved), env=environment, capture_output=True, text=True, check=True)
    assert result.stdout.strip() == "fresh-process recovery verified"


def test_restart_resume_takeover_retains_cp4_runtime_semantics(file_repository):
    created = main.new_game(NewGameRequest(creator_id="host"))
    game_id, token = created.game_id, created.result["session"]["reconnect_token"]
    GAMES.clear()
    GAMES.update(file_repository.load_all().games)
    def reconnect(takeover=False, credential=token):
        return http_request("/api/gf/reconnect", method="POST", body={"game_id": game_id, "reconnect_token": credential, "takeover": takeover})
    status, first = reconnect()
    assert status == 200 and first["result"]["mode"] == "resume"
    state, record = GAMES[game_id].state, GAMES[game_id].sessions["host"]
    status, conflict = reconnect()
    assert status == 409 and conflict["error"]["code"] == "TAKEOVER_REQUIRED"
    assert GAMES[game_id].sessions["host"] is record
    status, explicit = reconnect(True)
    assert status == 200 and explicit["result"]["mode"] == "takeover"
    status, old = http_request(f"/api/game/{game_id}", query="view=marshal&viewer_id=host", headers={"X-GF-Session": first["result"]["session"]["active_session"]})
    assert status == 401 and old["error"]["code"] == "SESSION_REPLACED"
    status, invalid = reconnect(credential="wrong")
    assert status == 401 and invalid["error"]["code"] == "RECONNECT_INVALID"
    assert GAMES[game_id].state is state and explicit["revision"] == state.meta["revision"]


def test_pending_candidate_failure_does_not_consume_continuation(file_repository, monkeypatch):
    from backend.app.persistence import PersistenceUnavailable
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    game_id, credentials = make_running_game()
    original = GAMES[game_id].state
    with monkeypatch.context() as patch:
        def fail(*args):
            raise OSError("injected")
        patch.setattr(file_repository, "_write_temp", fail)
        with pytest.raises(PersistenceUnavailable):
            main.action(ActionRequest(game_id=game_id, action="gf.debug_resolve_pending_interaction", view="debug", params={"actor_id": "p1"}))
    assert GAMES[game_id].state is original
    assert original.meta["pending_interaction"] is not None
    assert "debug_continuation_trace" not in original.meta
    main.action(ActionRequest(game_id=game_id, action="gf.debug_resolve_pending_interaction", view="debug", params={"actor_id": "p1"}))
    assert GAMES[game_id].state.meta["debug_continuation_trace"] == ["resolved"]
    loaded = file_repository.load_snapshot(file_repository.directory / f"{game_id}.json")
    assert loaded.state == GAMES[game_id].state


def test_lifespan_corruption_isolated_and_ownership_released(file_repository, monkeypatch):
    from uuid import uuid4
    from backend.app.persistence import FileRepository, GameUnavailable
    created = main.new_game(NewGameRequest(creator_id="host"))
    corrupt = str(uuid4())
    path = file_repository.directory / f"{corrupt}.json"
    path.write_text("corrupt")
    file_repository.close()
    monkeypatch.setenv("GF_PERSISTENCE_DIR", str(file_repository.directory))
    async def restart():
        async with main.app.router.lifespan_context(main.app):
            assert created.game_id in GAMES and corrupt not in GAMES
            with pytest.raises(GameUnavailable):
                main.get_state(corrupt)
            with pytest.raises(RuntimeError, match="ownership"):
                FileRepository(file_repository.directory).open()
    asyncio.run(restart())
    reopened = FileRepository(file_repository.directory).open()
    reopened.close()
    assert path.read_text() == "corrupt"
