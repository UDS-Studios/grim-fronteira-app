from dataclasses import replace
from functools import wraps
from urllib.parse import parse_qs
import secrets
import sys

import pytest

from backend.app import main, presence, store
from backend.app.persistence import MemoryRepository
from backend.app.action_authority import get_action_authority, get_claimed_actor
from backend.app.session_authority import SeatSessionRecord, hash_credential
from backend.app.store import GAMES


@pytest.fixture(autouse=True)
def isolated_persistence_repository(monkeypatch):
    """Legacy/synthetic tests never touch production persistence or ownership."""
    monkeypatch.setattr(store, "repository", MemoryRepository())


@pytest.fixture
def enabled_debug_api(monkeypatch, authenticated_application_requests):
    """Explicit, function-scoped permission for application debug tests."""
    monkeypatch.setenv("GF_ENABLE_DEBUG_API", "1")


@pytest.fixture
def authenticated_application_requests(monkeypatch):
    """Opt-in compatibility for existing gameplay tests, using real credentials.

    Focused authority tests do not use this fixture. Synthetic engine fixtures
    can install credential records without rewriting their gameplay setup.
    Historical cross-seat projection tests use the trusted internal transition;
    this fixture never changes the ASGI route authority boundary.
    """
    tokens = {}

    def credential(game_id, player):
        if not player or game_id not in GAMES:
            return None
        stored = GAMES[game_id]
        # Synthetic engine fixtures omit session issuance. Model an online
        # Marshal for their pre-existing gameplay scenarios; focused authority,
        # presence and pause tests do not opt into this compatibility fixture.
        marshal = stored.state.meta.get("marshal_id")
        if marshal and marshal not in stored.sessions:
            stored.sessions[marshal] = SeatSessionRecord(
                marshal, hash_credential(secrets.token_urlsafe(32)),
                hash_credential(secrets.token_urlsafe(32)), last_seen=presence.now(),
            )
        key = (game_id, player)
        token = tokens.get(key)
        record = stored.sessions.get(player)
        if token is None or record is None or record.active_session_hash != hash_credential(token):
            token = secrets.token_urlsafe(32)
            tokens[key] = token
            if record is None:
                stored.sessions[player] = SeatSessionRecord(player, hash_credential(secrets.token_urlsafe(32)), hash_credential(token))
            else:
                stored.sessions[player] = replace(record, active_session_hash=hash_credential(token))
        return token

    original_action, original_get = main.action, main.get_state

    @wraps(original_action)
    def action(req, x_gf_session=None):
        if x_gf_session is None and req.view != "debug" and req.action != "gf.join_lobby":
            actor = req.viewer_id if req.view in {"player", "marshal"} else get_claimed_actor(req.params, get_action_authority(req.action))
            x_gf_session = credential(req.game_id, actor)
        spec = get_action_authority(req.action)
        if (req.view == "player" and spec.caller_field is not None
                and get_claimed_actor(req.params, spec) != req.viewer_id):
            # Trusted serializer tests may deliberately project another seat.
            # HTTP ownership is tested without this opt-in fixture.
            with GAMES[req.game_id].lock:
                return main._action_transition(req, GAMES[req.game_id])
        return original_action(req, x_gf_session=x_gf_session)

    @wraps(original_get)
    def get_state(game_id, view="public", viewer_id=None, x_gf_session=None):
        if x_gf_session is None and view in {"player", "marshal"}:
            x_gf_session = credential(game_id, viewer_id)
        return original_get(game_id, view, viewer_id, x_gf_session=x_gf_session)

    from backend.tests.test_yankees import http_request as original_http

    @wraps(original_http)
    def http_request(path, *, method="GET", body=None, query="", headers=None):
        if headers is None and (path == "/api/gf/action" or path.startswith("/api/game/")):
            values = body or {k: v[0] for k, v in parse_qs(query).items()}
            view = values.get("view", "public")
            game_id = values.get("game_id") or path.split("/")[-1]
            actor = values.get("viewer_id") if view in {"player", "marshal"} else (
                get_claimed_actor(values.get("params", {}), get_action_authority(values["action"])) if values.get("action") else None)
            if values.get("action") != "gf.join_lobby" and view != "debug":
                token = credential(game_id, actor)
                if token:
                    headers = {"X-GF-Session": token}
        return original_http(path, method=method, body=body, query=query, headers=headers)

    monkeypatch.setattr(main, "action", action)
    monkeypatch.setattr(main, "get_state", get_state)
    for module in list(sys.modules.values()):
        if module is None or not module.__name__.startswith("backend.tests."):
            continue
        for name, value in list(vars(module).items()):
            for original, replacement in [(original_action, action), (original_get, get_state), (original_http, http_request)]:
                if value is original:
                    monkeypatch.setattr(module, name, replacement)


@pytest.fixture
def file_repository(tmp_path, monkeypatch):
    """Opt-in real disk durability, isolated from the default memory repository."""
    from backend.app.persistence import FileRepository
    repository = FileRepository(tmp_path / "games").open()
    monkeypatch.setattr(store, "repository", repository)
    GAMES.clear()
    yield repository
    GAMES.clear()
    repository.close()
