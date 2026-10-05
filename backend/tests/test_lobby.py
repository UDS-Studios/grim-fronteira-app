"""Start-game player-count and readiness regressions."""
from copy import deepcopy

import pytest

from backend.app.store import GAMES
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.rules.grim_fronteira.lobby import (
    claim_character,
    initialize_lobby,
    join_lobby,
    start_game,
    submit_character_feature,
    submit_character_name,
)
from backend.engine.state.game_state import GameState
from backend.tests.test_yankees import http_request


@pytest.fixture
def lobby():
    return initialize_lobby(GameState(
        deck=load_deck("data/templates/standard_54.json"),
        meta={"game": "grim_fronteira", "revision": 1},
    ), "host")


def ready_player(game, player_id, card_id):
    game = join_lobby(game, player_id)
    game = claim_character(game, player_id, card_id)
    game = submit_character_name(game, player_id, player_id, seed=123)
    return submit_character_feature(game, player_id, "scarred")


def test_marshal_only_lobby_cannot_start(lobby):
    before = deepcopy(lobby)
    with pytest.raises(ValueError) as exc:
        start_game(lobby, "host", seed=123)
    assert str(exc.value) == "Cannot start game: at least one player is required."
    assert lobby == before
    assert lobby.meta["revision"] == 1
    assert lobby.meta["phase"] == "lobby"
    assert lobby.meta["lobby"]["game_started"] is False


@pytest.mark.parametrize("with_ready_player", [False, True])
def test_joined_unready_player_prevents_start(lobby, with_ready_player):
    if with_ready_player:
        lobby = ready_player(lobby, "p1", "JS")
    lobby = join_lobby(lobby, "unready")
    before = deepcopy(lobby)
    with pytest.raises(ValueError, match="^Cannot start game: players not ready: unready$"):
        start_game(lobby, "host", seed=123)
    assert lobby == before


@pytest.mark.parametrize("player_count", [1, 2])
def test_fully_ready_players_can_start(lobby, player_count):
    for index, card_id in enumerate(["JS", "QH"][:player_count], 1):
        lobby = ready_player(lobby, f"p{index}", card_id)
    started = start_game(lobby, "host", seed=123)
    assert started.meta["phase"] == "hook_selection"
    assert started.meta["lobby"]["game_started"] is True
    assert started.meta["lobby"]["registration_open"] is False


def test_http_marshal_only_start_preserves_state_and_snapshot(file_repository):
    status, created = http_request("/api/gf/new", method="POST", body={"creator_id": "host"})
    assert status == 200
    game_id = created["game_id"]
    stored = GAMES[game_id]
    original, before = stored.state, deepcopy(stored.state)
    snapshot_path = file_repository.directory / f"{game_id}.json"
    snapshot = snapshot_path.read_bytes()

    status, response = http_request("/api/gf/action", method="POST",
        headers={"X-GF-Session": created["result"]["session"]["active_session"]},
        body={"game_id": game_id, "action": "gf.start_game", "params": {"actor_id": "host"}})

    assert status == 400
    assert response["error"]["code"] == "BAD_REQUEST"
    assert "at least one player is required" in response["error"]["message"]
    assert response["revision"] == created["revision"]
    assert stored.state is original
    assert stored.state == before
    assert stored.state.meta["revision"] == created["revision"]
    assert stored.state.meta["phase"] == "lobby"
    assert stored.state.meta["lobby"]["game_started"] is False
    assert snapshot_path.read_bytes() == snapshot
