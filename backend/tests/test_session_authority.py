"""Issuance, private runtime storage, and atomic application commits."""
from copy import deepcopy
from dataclasses import asdict, FrozenInstanceError
import json

import pytest

from backend.app import main, session_authority
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.serializers import game_state_to_dict
from backend.app.session_authority import (
    SeatSessionRecord, SessionIssuanceError, hash_credential,
    issue_seat_credentials, role_for_seat,
)
from backend.app.store import GAMES, StoredGame
from backend.engine.state.game_state import GameState
from backend.engine.state.game_state_io import load_game_state, save_game_state
from backend.tests.test_yankees import http_request


pytestmark = pytest.mark.usefixtures("authenticated_application_requests")


@pytest.fixture(autouse=True)
def isolated_store(monkeypatch):
    monkeypatch.delenv("GF_ENABLE_DEBUG_API", raising=False)
    GAMES.clear()
    yield
    GAMES.clear()


@pytest.fixture
def created():
    return main.new_game(NewGameRequest(creator_id="host"))


def join(game_id, player_id):
    return main.action(ActionRequest(
        game_id=game_id, action="gf.join_lobby", params={"player_id": player_id},
    ))


def assert_private_storage(response):
    stored = GAMES[response.game_id]
    payload = response.result["session"]
    assert set(payload) == {"player_id", "role", "reconnect_token", "active_session"}
    record = stored.sessions[payload["player_id"]]
    raw = [payload["reconnect_token"], payload["active_session"]]
    assert all(isinstance(token, str) and token for token in raw)
    assert raw[0] != raw[1]
    assert record.reconnect_token_hash == hash_credential(raw[0])
    assert record.active_session_hash == hash_credential(raw[1])
    assert record.reconnect_token_hash != record.active_session_hash
    assert record.superseded_session_hashes == frozenset()
    projected = [
        game_state_to_dict(stored.state, view=view, viewer_id=viewer)
        for view, viewer in [
            ("public", None), ("player", payload["player_id"]),
            ("marshal", stored.state.meta["marshal_id"]), ("debug", None),
        ]
    ]
    public_data = json.dumps([asdict(stored.state), response.state, response.events, *projected])
    record_data = json.dumps(asdict(record), default=list)
    for token in raw:
        assert token not in public_data
        assert token not in record_data
        assert token not in repr(stored)
        assert token not in repr(record)
    for digest in (record.reconnect_token_hash, record.active_session_hash):
        assert digest not in public_data
    return payload


def test_stored_game_defaults_and_registry_independence():
    game = GameState()
    first, second = StoredGame(state=game), StoredGame(state=game)
    assert first.sessions == second.sessions == {}
    assert first.sessions is not second.sessions


def test_marshal_issuance_and_revision(created):
    stored = GAMES[created.game_id]
    assert set(stored.sessions) == {stored.state.meta["marshal_id"]} == {"host"}
    payload = assert_private_storage(created)
    assert payload["role"] == "marshal"
    assert payload["player_id"] == "host"
    assert created.result["created"] is True
    assert created.revision == stored.state.meta["revision"] == 1


def test_multiple_player_issuance_and_revisions(created):
    payloads = [assert_private_storage(created)]
    for index, player in enumerate(["p1", "p2"], 2):
        response = join(created.game_id, player)
        payload = assert_private_storage(response)
        assert payload["player_id"] == player
        assert payload["role"] == "player"
        assert response.revision == index
        payloads.append(payload)
    assert set(GAMES[created.game_id].sessions) == {"host", "p1", "p2"}
    assert len({p[key] for p in payloads for key in ("reconnect_token", "active_session")}) == 6


def test_role_resolution_and_duplicate_issuance_are_nonmutating(created):
    join(created.game_id, "p1")
    stored = GAMES[created.game_id]
    original, sessions = stored.state, dict(stored.sessions)
    assert role_for_seat(original, "host") == "marshal"
    assert role_for_seat(original, "p1") == "player"
    for player in ("outsider", "", " "):
        with pytest.raises(SessionIssuanceError, match="seat"):
            issue_seat_credentials(original, stored.sessions, player)
    with pytest.raises(SessionIssuanceError, match="already been issued"):
        issue_seat_credentials(original, stored.sessions, "p1")
    assert stored.state is original
    assert stored.sessions == sessions
    with pytest.raises(FrozenInstanceError):
        stored.sessions["p1"].active_session_hash = "replacement"


def test_issuance_alone_does_not_change_state_or_revision(created):
    join(created.game_id, "p1")
    game = GAMES[created.game_id].state
    before = deepcopy(game)
    staged = {}
    issue_seat_credentials(game, staged, "p1")
    assert game == before
    assert game.meta["revision"] == 2
    assert set(staged) == {"p1"}


@pytest.mark.parametrize("failure", ["duplicate", "closed", "empty"])
def test_failed_join_has_no_credentials_or_mutation(created, failure):
    join(created.game_id, "p1")
    if failure == "closed":
        main.action(ActionRequest(game_id=created.game_id, action="gf.set_registration_open",
                                params={"actor_id": "host", "is_open": False}))
    stored = GAMES[created.game_id]
    original, snapshot, sessions = stored.state, deepcopy(stored.state), dict(stored.sessions)
    player = "p1" if failure == "duplicate" else "" if failure == "empty" else "p2"
    status, response = http_request("/api/gf/action", method="POST", body={
        "game_id": created.game_id, "action": "gf.join_lobby", "params": {"player_id": player},
    })
    assert status == 400
    assert response["result"] == {}
    assert stored.state is original
    assert stored.state == snapshot
    assert stored.sessions == sessions


@pytest.mark.parametrize("operation", ["new", "join"])
def test_issuance_failure_rolls_back_even_after_staging(created, monkeypatch, operation):
    stored = GAMES[created.game_id]
    original, snapshot, sessions = stored.state, deepcopy(stored.state), dict(stored.sessions)
    keys = set(GAMES)
    real_issue = main.issue_seat_credentials

    def fail_after_staging(*args):
        real_issue(*args)
        raise SessionIssuanceError("Injected issuance failure")

    monkeypatch.setattr(main, "issue_seat_credentials", fail_after_staging)
    with pytest.raises(SessionIssuanceError, match="Injected issuance failure"):
        if operation == "new":
            main.new_game(NewGameRequest(creator_id="other-host"))
        else:
            join(created.game_id, "p2")
    assert set(GAMES) == keys
    assert stored.state is original
    assert stored.state == snapshot
    assert stored.sessions == sessions


def test_generator_failure_does_not_store_partial_record(created, monkeypatch):
    calls = []

    def fail_second_generation(size):
        calls.append(size)
        if len(calls) == 2:
            raise RuntimeError("Injected generator failure")
        return "test-only-first-secret"

    monkeypatch.setattr(session_authority.secrets, "token_urlsafe", fail_second_generation)
    original = GAMES[created.game_id].state
    with pytest.raises(RuntimeError, match="generator failure"):
        join(created.game_id, "p1")
    assert calls == [32, 32]
    assert GAMES[created.game_id].state is original
    assert set(GAMES[created.game_id].sessions) == {"host"}


def test_engine_save_load_excludes_session_records(created, tmp_path):
    player = join(created.game_id, "p1")
    stored = GAMES[created.game_id]
    path = tmp_path / "game.json"
    save_game_state(stored.state, path)
    contents = path.read_text()
    for response in (created, player):
        for key in ("reconnect_token", "active_session"):
            token = response.result["session"][key]
            assert token not in contents
            assert hash_credential(token) not in contents
    assert load_game_state(path) == stored.state
    assert StoredGame(state=load_game_state(path)).sessions == {}


def test_http_issuance_and_existing_requests_need_no_credentials():
    status, response = http_request("/api/gf/new", method="POST", body={"creator_id": "host"})
    assert status == 200
    assert response["result"]["session"]["role"] == "marshal"
    game_id = response["game_id"]
    status, joined = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.join_lobby", "params": {"player_id": "p1"},
        "view": "player", "viewer_id": "p1",
    })
    assert status == 200
    assert joined["result"]["session"]["role"] == "player"
    for view, viewer in [("public", ""), ("player", "p1"), ("marshal", "host")]:
        status, polled = http_request(f"/api/game/{game_id}", query=f"view={view}&viewer_id={viewer}")
        assert status == 200
        assert polled["result"] == {}
    status, polled = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.get_state", "view": "player", "viewer_id": "p1",
    })
    assert status == 200
    assert "session" not in polled["result"]
