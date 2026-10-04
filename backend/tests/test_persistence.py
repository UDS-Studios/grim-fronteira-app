"""Strict application envelopes, directory ownership and safe startup discovery."""
from copy import deepcopy
import json
import os
import subprocess
import sys
from uuid import uuid4

import pytest

from backend.app import main
from backend.app.persistence import (
    FileRepository, InvalidSnapshot, SCHEMA,
    configured_directory, decode_envelope, encode_envelope,
)
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.session_authority import hash_credential
from backend.app.store import GAMES
from backend.engine.state.game_state_io import game_state_from_data, game_state_to_data
from backend.tests.test_yankees import http_request


@pytest.fixture
def created(file_repository):
    response = main.new_game(NewGameRequest(creator_id="host"))
    return response, file_repository


def snapshot(created):
    response, _ = created
    stored = GAMES[response.game_id]
    return encode_envelope(response.game_id, stored.state, stored.sessions)


def test_roundtrip_and_credentials_are_private(created):
    response, repo = created
    original = GAMES[response.game_id]
    loaded = repo.load_snapshot(repo.directory / f"{response.game_id}.json")
    assert loaded.state == original.state
    assert loaded.lock is not original.lock
    record = loaded.sessions["host"]
    assert record.active_session_hash == "" and record.last_seen is None
    assert record.superseded_session_hashes == frozenset()
    assert record.reconnect_token_hash == original.sessions["host"].reconnect_token_hash
    assert game_state_from_data(game_state_to_data(original.state)) == original.state
    contents = (repo.directory / f"{response.game_id}.json").read_text()
    credentials = response.result["session"]
    for name in ("reconnect_token", "active_session"):
        assert credentials[name] not in contents
    assert hash_credential(credentials["active_session"]) not in contents
    assert hash_credential(credentials["reconnect_token"]) in contents
    data = json.loads(contents)
    assert set(data) == {"schema", "version", "game_id", "game_state", "sessions"}
    assert data["schema"] == SCHEMA and data["version"] == 1
    assert set(data["sessions"]["host"]) == {"reconnect_token_hash"}
    assert os.stat(repo.directory).st_mode & 0o777 == 0o700
    assert os.stat(repo.directory / f"{response.game_id}.json").st_mode & 0o777 == 0o600
    for view, viewer in [("public", None), ("marshal", "host")]:
        projected = main.get_state(response.game_id, view, viewer, credentials["active_session"])
        assert record.reconnect_token_hash not in json.dumps(projected.model_dump())


@pytest.mark.parametrize("change", [
    lambda d: d.update(schema="other"),
    lambda d: d.update(version=2),
    lambda d: d.update(version=True),
    lambda d: d.update(extra="forbidden"),
    lambda d: d.update(game_id=str(uuid4())),
    lambda d: d.update(game_id=d["game_id"].upper()),
    lambda d: d["game_state"].update(schema="other"),
    lambda d: d["game_state"].update(version=2),
    lambda d: d["game_state"].update(version=True),
    lambda d: d["game_state"]["deck"].update(schema="other"),
    lambda d: d["game_state"]["deck"].update(version=2),
    lambda d: d["game_state"]["deck"].update(draw_pile="cards"),
    lambda d: d["game_state"]["deck"]["draw_pile"].append(d["game_state"]["deck"]["draw_pile"][0]),
    lambda d: d["game_state"]["deck"]["draw_pile"].pop(),
    lambda d: d["game_state"].update(zones={"bad": "not a list"}),
    lambda d: d["game_state"]["meta"].update(revision=True),
    lambda d: d["game_state"]["meta"].update(revision=-1),
    lambda d: d["game_state"]["meta"].update(marshal_id=""),
    lambda d: d["game_state"]["meta"].update(players_order=["host", "host"]),
    lambda d: d["game_state"]["meta"].update(players_order=["other"]),
    lambda d: d["game_state"]["meta"].update(phase=[]),
    lambda d: d["game_state"]["meta"].update(pending_interaction={"kind": "bad"}),
    lambda d: d["game_state"]["meta"].update(session_pause={"paused": False}),
    lambda d: d["game_state"]["meta"].update(presence={}),
    lambda d: d["sessions"].clear(),
    lambda d: d["sessions"].update(extra={"reconnect_token_hash": "a" * 64}),
    lambda d: d["sessions"]["host"].update(reconnect_token_hash="A" * 64),
    lambda d: d["sessions"]["host"].update(reconnect_token_hash="a" * 63),
    lambda d: d["sessions"]["host"].update(active_session_hash="a" * 64),
    lambda d: d["sessions"]["host"].update(last_seen=100),
    lambda d: d["game_state"]["meta"]["lobby"].update(players={}),
])
def test_strict_restore_rejects_whole_game(created, change):
    data = snapshot(created)
    change(data)
    with pytest.raises(InvalidSnapshot):
        decode_envelope(json.dumps(data), created[0].game_id)


@pytest.mark.parametrize("raw", ["{", '{"schema":"a","schema":"b"}', '{"x":NaN}', '{"x":Infinity}', '{"x":1e400}'])
def test_strict_json(created, raw):
    with pytest.raises(InvalidSnapshot):
        decode_envelope(raw, created[0].game_id)


def test_duplicate_hashes_fail_closed(created):
    response, repo = created
    main.action(ActionRequest(game_id=response.game_id, action="gf.join_lobby", params={"player_id": "p1"}))
    data = snapshot(created)
    data["sessions"]["p1"] = deepcopy(data["sessions"]["host"])
    with pytest.raises(InvalidSnapshot, match="authority"):
        decode_envelope(json.dumps(data), response.game_id)


def test_discovery_isolates_corruption_and_diagnostics(created, caplog):
    response, repo = created
    corrupt, unsupported = str(uuid4()), str(uuid4())
    marker = "PRIVATE_CONTENT_NOT_FOR_LOGS"
    corrupt_path = repo.directory / f"{corrupt}.json"
    corrupt_path.write_text(marker)
    data = snapshot(created)
    data.update(game_id=unsupported, version=999)
    unsupported_path = repo.directory / f"{unsupported}.json"
    unsupported_path.write_text(json.dumps(data))
    (repo.directory / "unrelated.json").write_text(marker)
    (repo.directory / f".{uuid4()}.tmp").write_text(marker)
    report = repo.load_all()
    assert set(report.games) == {response.game_id}
    assert report.rejected == {corrupt, unsupported}
    assert corrupt_path.read_text() == marker
    assert unsupported_path.read_text() == json.dumps(data)
    assert marker not in caplog.text
    assert data["sessions"]["host"]["reconnect_token_hash"] not in caplog.text
    for game_id in (corrupt, unsupported):
        status, payload = http_request(f"/api/game/{game_id}")
        assert status == 503 and payload["error"]["code"] == "GAME_UNAVAILABLE"
        assert payload["state"] == {}
    status, payload = http_request(f"/api/game/{uuid4()}")
    assert status == 404 and payload["error"]["code"] == "HTTP_404"


def test_config_is_independent_of_cwd_and_rejects_relative(tmp_path, monkeypatch):
    monkeypatch.delenv("GF_PERSISTENCE_DIR", raising=False)
    expected = configured_directory()
    monkeypatch.chdir(tmp_path)
    assert configured_directory() == expected and expected.is_absolute()
    monkeypatch.setenv("GF_PERSISTENCE_DIR", "relative/games")
    with pytest.raises(RuntimeError, match="absolute"):
        configured_directory()
    monkeypatch.setenv("GF_PERSISTENCE_DIR", str(tmp_path / "absolute"))
    assert configured_directory() == tmp_path / "absolute"


def test_single_writer_process_lifetime_and_release(file_repository):
    directory = file_repository.directory
    with pytest.raises(RuntimeError, match="exclusive"):
        FileRepository(directory).open()
    code = 'from pathlib import Path; from backend.app.persistence import FileRepository; FileRepository(Path(__import__("sys").argv[1])).open()'
    result = subprocess.run([sys.executable, "-c", code, str(directory)], capture_output=True, text=True)
    assert result.returncode != 0 and "exclusive writer ownership" in result.stderr
    file_repository.close()
    reopened = FileRepository(directory).open()
    reopened.close()


def test_unusable_directory_fails_startup(tmp_path):
    path = tmp_path / "not-directory"
    path.write_text("occupied")
    with pytest.raises(RuntimeError, match="Cannot initialize"):
        FileRepository(path).open()


def test_delete_snapshot_is_internal_and_fsyncs(created, monkeypatch):
    response, repo = created
    calls = []
    real = repo._fsync_directory
    monkeypatch.setattr(repo, "_fsync_directory", lambda: (calls.append(True), real()))
    repo.delete_snapshot(response.game_id)
    assert not (repo.directory / f"{response.game_id}.json").exists()
    assert calls == [True]
    assert response.game_id in GAMES  # primitive does not pretend to delete runtime state
    GAMES.clear()
    assert not repo.load_all().games


def test_registry_clear_does_not_delete_disk(created):
    response, repo = created
    GAMES.clear()
    assert response.game_id in repo.load_all().games


def test_directory_permission_and_fsync_failures_are_startup_errors(tmp_path, monkeypatch):
    import backend.app.persistence as persistence
    for operation in ("fchmod", "fsync"):
        with monkeypatch.context() as patch:
            def fail(*args):
                raise PermissionError("private location detail")
            patch.setattr(persistence.os, operation, fail)
            with pytest.raises(RuntimeError, match="Cannot initialize") as error:
                FileRepository(tmp_path / operation).open()
            assert "private" not in str(error.value)
        # A failed initializer releases its lock for a later healthy process.
        repository = FileRepository(tmp_path / operation).open()
        repository.close()


def test_closed_or_uninitialized_repository_never_silently_saves(created):
    from backend.app.persistence import PersistenceUnavailable, UninitializedRepository
    response, repo = created
    stored = GAMES[response.game_id]
    repo.close()
    for repository in (repo, UninitializedRepository()):
        with pytest.raises(PersistenceUnavailable):
            repository.save_snapshot(response.game_id, stored.state, stored.sessions)
