"""Disk-before-memory commit boundaries, including uncertain outcome fencing."""
from copy import deepcopy
from dataclasses import replace
import json
import os

import pytest

from backend.app import main, persistence, store
from backend.app.persistence import PersistenceUnavailable, SessionTopologyInvalid
from backend.app.schemas import ActionRequest, NewGameRequest, ReconnectRequest
from backend.app.store import GAMES, commit_stored_game_candidate
from backend.tests.test_yankees import http_request


@pytest.fixture
def created(file_repository):
    return main.new_game(NewGameRequest(creator_id="host")), file_repository


def join(response, player="p1"):
    return http_request("/api/gf/action", method="POST", body={
        "game_id": response.game_id, "action": "gf.join_lobby", "params": {"player_id": player},
    })


def fail(*args, **kwargs):
    raise OSError("PRIVATE filesystem detail never exposed")


@pytest.mark.parametrize("boundary", ["serialization", "write", "temp_fsync", "replace", "directory_fsync", "replace_then_error", "memory_commit"])
def test_join_failure_never_restores_mixed_generations(created, monkeypatch, caplog, boundary):
    response, repo = created
    game_id = response.game_id
    stored = GAMES[game_id]
    original, snapshot, sessions = stored.state, deepcopy(stored.state), dict(stored.sessions)
    path = repo.directory / f"{game_id}.json"
    previous = path.read_bytes()
    uncertain = boundary in {"directory_fsync", "replace_then_error", "memory_commit"}
    with monkeypatch.context() as patch:
        if boundary == "serialization":
            patch.setattr(persistence.json, "dumps", fail)
            # json.dumps is shared with the HTTP helper: call the route directly.
            with pytest.raises(PersistenceUnavailable):
                main.action(ActionRequest(game_id=game_id, action="gf.join_lobby", params={"player_id": "p1"}))
        else:
            if boundary == "write":
                patch.setattr(repo, "_write_temp", fail)
            elif boundary == "temp_fsync":
                patch.setattr(persistence.os, "fsync", fail)
            elif boundary == "replace":
                patch.setattr(persistence.os, "replace", fail)
            elif boundary == "directory_fsync":
                patch.setattr(repo, "_fsync_directory", fail)
            elif boundary == "replace_then_error":
                real_replace = os.replace
                def replaced_then_error(*args):
                    real_replace(*args)
                    fail()
                patch.setattr(persistence.os, "replace", replaced_then_error)
            elif boundary == "memory_commit":
                # Simulate a partially assigned runtime candidate after disk commit.
                def partial_commit(target, state, new_sessions):
                    target.sessions = new_sessions
                    fail()
                patch.setattr(store, "_install_candidate", partial_commit)
            status, payload = join(response)
            assert status == 503 and payload["error"]["code"] == "PERSISTENCE_UNAVAILABLE"
            assert "PRIVATE" not in json.dumps(payload)
    assert "PRIVATE" not in caplog.text
    assert not list(repo.directory.glob("*.tmp"))
    if uncertain:
        assert game_id in repo.unavailable
        assert path.read_bytes() != previous
        for endpoint, kwargs in [
            (f"/api/game/{game_id}", {}),
            ("/api/gf/action", {"method": "POST", "body": {"game_id": game_id, "action": "gf.join_lobby", "params": {"player_id": "p2"}}}),
            ("/api/gf/reconnect", {"method": "POST", "body": {"game_id": game_id, "reconnect_token": response.result["session"]["reconnect_token"]}}),
        ]:
            status, payload = http_request(endpoint, **kwargs)
            assert status == 503 and payload["error"]["code"] == "GAME_UNAVAILABLE"
    else:
        assert stored.state is original and stored.state == snapshot
        assert stored.sessions == sessions
        assert path.read_bytes() == previous
        assert main.get_state(game_id).error is None
        assert join(response)[0] == 200
    # Actual repository reload yields a complete state/authority generation.
    repo.close()
    reopened = persistence.FileRepository(repo.directory).open()
    try:
        restored = reopened.load_all().games[game_id]
        assert set(restored.sessions) == set(restored.state.meta["players_order"]) == {"host", "p1"}
        assert restored.state.meta["revision"] == original.meta["revision"] + 1
    finally:
        reopened.close()


def test_create_not_published_before_save(file_repository, monkeypatch):
    monkeypatch.setattr(file_repository, "_write_temp", fail)
    with pytest.raises(PersistenceUnavailable):
        main.new_game(NewGameRequest(creator_id="host"))
    assert not GAMES
    assert not list(file_repository.directory.glob("*.json"))


def test_response_failure_precedes_disk_and_memory_commit(created, monkeypatch):
    response, repo = created
    stored = GAMES[response.game_id]
    state, records = stored.state, dict(stored.sessions)
    previous = (repo.directory / f"{response.game_id}.json").read_bytes()
    monkeypatch.setattr(main, "ActionResponse", fail)
    with pytest.raises(OSError):
        main.action(ActionRequest(game_id=response.game_id, action="gf.join_lobby", params={"player_id": "p1"}))
    assert stored.state is state and stored.sessions == records
    assert (repo.directory / f"{response.game_id}.json").read_bytes() == previous


def test_gameplay_candidate_save_failure_preserves_state(created, monkeypatch):
    response, repo = created
    state = GAMES[response.game_id].state
    monkeypatch.setattr(repo, "_write_temp", fail)
    status, payload = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": response.result["session"]["active_session"]},
        body={"game_id": response.game_id, "action": "gf.set_registration_open", "params": {"actor_id": "host", "is_open": False}})
    assert status == 503 and payload["error"]["code"] == "PERSISTENCE_UNAVAILABLE"
    assert GAMES[response.game_id].state is state
    assert state.meta["lobby"]["registration_open"] is True


def test_topology_conflict_leaves_disk_and_state_usable(created):
    response, repo = created
    stored = GAMES[response.game_id]
    original = stored.state
    candidate = replace(original, meta={**original.meta, "players_order": ["host", "missing-authority"]})
    before = (repo.directory / f"{response.game_id}.json").read_bytes()
    with stored.lock, pytest.raises(SessionTopologyInvalid):
        commit_stored_game_candidate(response.game_id, stored, candidate)
    assert stored.state is original
    assert (repo.directory / f"{response.game_id}.json").read_bytes() == before
    assert response.game_id not in repo.unavailable


def test_no_writes_for_presence_read_resume_or_takeover(created, monkeypatch):
    response, repo = created
    game_id = response.game_id
    # Any unintended write fails this test.
    monkeypatch.setattr(repo, "save_snapshot", fail)
    main.get_state(game_id, "public")
    main.get_state(game_id, "marshal", "host", response.result["session"]["active_session"])
    main.action(ActionRequest(game_id=game_id, action="gf.get_state", view="marshal", viewer_id="host"),
                response.result["session"]["active_session"])
    restored = repo.load_snapshot(repo.directory / f"{game_id}.json")
    GAMES[game_id] = restored
    resumed = main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=response.result["session"]["reconnect_token"]))
    assert resumed.result["mode"] == "resume"
    taken = main.reconnect(ReconnectRequest(game_id=game_id, reconnect_token=response.result["session"]["reconnect_token"], takeover=True))
    assert taken.result["mode"] == "takeover"


def test_delete_directory_failure_fences_game(created, monkeypatch):
    response, repo = created
    monkeypatch.setattr(repo, "_fsync_directory", fail)
    with pytest.raises(PersistenceUnavailable):
        repo.delete_snapshot(response.game_id)
    assert response.game_id in repo.unavailable


def test_topology_conflict_has_dedicated_http_error(created, monkeypatch):
    response, repo = created
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")
    stored = GAMES[response.game_id]
    original = stored.state
    before = (repo.directory / f"{response.game_id}.json").read_bytes()
    # Exercise the actual debug action's transaction boundary with invalid topology.
    monkeypatch.setattr(main, "setup_players", lambda game, *args, **kwargs: replace(
        game, meta={**game.meta, "players_order": ["host", "uncredentialed"]}))
    status, payload = http_request("/api/gf/action", method="POST", body={
        "game_id": response.game_id, "action": "gf.setup_players", "view": "debug", "params": {"player_ids": ["uncredentialed"]},
    })
    assert status == 409 and payload["error"]["code"] == "SESSION_TOPOLOGY_INVALID"
    assert stored.state is original
    assert (repo.directory / f"{response.game_id}.json").read_bytes() == before


def test_commit_order_is_response_disk_fsync_then_memory(created, monkeypatch):
    response, repo = created
    game_id = response.game_id
    stored = GAMES[game_id]
    original = stored.state
    order = []
    response_model = main.ActionResponse
    write, directory_sync, install = repo._write_temp, repo._fsync_directory, store._install_candidate
    def response_ready(*args, **kwargs):
        order.append("response")
        return response_model(*args, **kwargs)
    def write_checked(*args):
        assert stored.state is original and "p1" not in stored.sessions
        order.append("write")
        return write(*args)
    def sync_checked():
        assert stored.state is original and "p1" not in stored.sessions
        data = json.loads((repo.directory / f"{game_id}.json").read_text())
        assert "p1" in data["sessions"] and "p1" in data["game_state"]["meta"]["players_order"]
        order.append("directory_fsync")
        return directory_sync()
    def install_checked(*args):
        order.append("memory")
        return install(*args)
    monkeypatch.setattr(main, "ActionResponse", response_ready)
    monkeypatch.setattr(repo, "_write_temp", write_checked)
    monkeypatch.setattr(repo, "_fsync_directory", sync_checked)
    monkeypatch.setattr(store, "_install_candidate", install_checked)
    main.action(ActionRequest(game_id=game_id, action="gf.join_lobby", params={"player_id": "p1"}))
    assert order == ["response", "write", "directory_fsync", "memory"]


def test_partial_temp_write_never_replaces_previous_snapshot(created, monkeypatch):
    response, repo = created
    path = repo.directory / f"{response.game_id}.json"
    previous = path.read_bytes()
    state = GAMES[response.game_id].state
    def partial_write(path, content):
        path.write_text(content[:20])
        fail()
    monkeypatch.setattr(repo, "_write_temp", partial_write)
    assert join(response)[0] == 503
    assert path.read_bytes() == previous
    assert GAMES[response.game_id].state is state
    assert response.game_id not in repo.unavailable
