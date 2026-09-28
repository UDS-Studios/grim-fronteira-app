"""Checkpoint 1: explicit Dark setup, without later Dark gameplay rules."""
from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi import HTTPException

from backend.app.main import action
from backend.app.schemas import ActionRequest
from backend.app.store import GAMES, StoredGame
from backend.engine.rules.grim_fronteira.meta_enrich import enrich_meta_for_ui
from backend.engine.rules.grim_fronteira.scene import (
    ensure_scene_state, scene_set_participants, scene_set_mode,
    scene_roll_difficulty, scene_draw_azzardo, scene_start, scene_stand,
    scene_acknowledge_resolution, scene_close, scene_new,
)
from backend.engine.rules.grim_fronteira.scene_difficulty import marshal_roll_difficulty
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_gf_scene import _ready_table_game, _with_draw_order


@pytest.fixture
def game_id():
    game = scene_set_participants(_ready_table_game(), actor_id="host1", participant_ids=["p1"])
    GAMES["dark-test"] = StoredGame(state=game)
    yield "dark-test"
    GAMES.pop("dark-test", None)


def dispatch(game_id, name="scene_declare_dark", **params):
    return action(ActionRequest(game_id=game_id, action=f"gf.{name}",
                                params={"actor_id": "host1", **params}, view="debug"))


def reject(game_id, name="scene_declare_dark", match=None, **params):
    original = GAMES[game_id].state
    snapshot = deepcopy(original)
    with pytest.raises((ValueError, HTTPException), match=match):
        dispatch(game_id, name, **params)
    assert GAMES[game_id].state is original
    assert original == snapshot  # Includes revision, deck and every zone.


def test_declaration_bumps_revision_once_and_rejects_repeat(game_id):
    before = GAMES[game_id].state.meta.get("revision", 0)
    response = dispatch(game_id)
    assert response.revision == before + 1
    assert response.result == {"ok": True, "action": "gf.scene_declare_dark", "actor_id": "host1"}
    assert response.state["meta"]["scene"]["dark_mode"] is True
    assert response.state["meta"]["scene"]["dark"] == {"revealed": False}
    reject(game_id, match="already been declared")


@pytest.mark.parametrize("card,bonus", [("4H", None), ("BJ", "vengeance"), ("RJ", "scum")])
@pytest.mark.parametrize("declared", [False, True])
def test_difficulty_preserves_declaration_and_joker_bonuses(game_id, card, bonus, declared):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, [card, "5H", "6C"])
    if declared:
        dispatch(game_id)
    before = deepcopy(GAMES[game_id].state)
    response = dispatch(game_id, "scene_roll_difficulty")
    game = GAMES[game_id].state
    assert game.meta["scene"]["dark_mode"] is declared
    assert game.meta["scene"]["dark"] == {"revealed": False}
    assert response.result["difficulty"]["effects"] == []
    assert response.result["difficulty"]["value"] == (14 if bonus is None else 20)
    assert game.zones["scene.difficulty"] == [card]
    assert game.deck.discard_pile == before.deck.discard_pile
    if bonus:
        for pid, drawn in [("p1", "5H"), ("p2", "6C")]:
            zone = f"players.{pid}.{bonus}"
            assert game.zones[zone] == before.zones.get(zone, []) + [drawn]


def test_wrong_actor_and_phase_are_atomic(game_id):
    reject(game_id, actor_id="p1")
    game = GAMES[game_id].state
    GAMES[game_id].state = replace(game, meta={**game.meta, "phase": "lobby"})
    reject(game_id)


@pytest.mark.parametrize("status", ["idle", "active", "awaiting_ack", "resolved", "closed"])
def test_wrong_status_is_atomic(game_id, status):
    GAMES[game_id].state.meta["scene"]["status"] = status
    reject(game_id, match="setup")


def test_after_difficulty_is_atomic(game_id):
    dispatch(game_id, "scene_roll_difficulty")
    reject(game_id, match="before scene difficulty")


@pytest.mark.parametrize("subtype", ["npc", "pvp"])
def test_duel_applicability(game_id, subtype):
    dispatch(game_id, "scene_set_mode", mode="duel", duel_subtype=subtype)
    if subtype == "pvp":
        reject(game_id, match="PVP")
    else:
        dispatch(game_id)
        assert GAMES[game_id].state.meta["scene"]["dark_mode"] is True


def test_cannot_switch_dark_scene_to_pvp(game_id):
    dispatch(game_id)
    reject(game_id, "scene_set_mode", mode="duel", duel_subtype="pvp", match="PVP")


def test_azzardo_mutual_exclusion_is_atomic(game_id):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["4H", "5H"])
    setup = deepcopy(GAMES[game_id].state)
    dispatch(game_id, "scene_roll_difficulty")
    dispatch(game_id, "scene_draw_azzardo")
    reject(game_id)
    GAMES[game_id].state = setup
    dispatch(game_id)
    dispatch(game_id, "scene_roll_difficulty")
    reject(game_id, "scene_draw_azzardo", match="Dark Mode", seed=123)


@pytest.mark.parametrize("azzardo", [
    {"status": "skipped", "card_id": None},
    {"status": "drawn", "card_id": "5H"},
    {"status": "unavailable", "card_id": "5H"},
])
def test_azzardo_guard_independent_of_difficulty(game_id, azzardo):
    GAMES[game_id].state.meta["scene"]["azzardo"].update(azzardo)
    reject(game_id, match="Azzardo choice")


def test_pending_gate_precedes_engine(game_id, monkeypatch):
    import backend.app.main as main
    def unexpected(*args, **kwargs):
        pytest.fail("Dark engine action must not run behind the pending gate")
    monkeypatch.setattr(main, "scene_declare_dark", unexpected)
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_resolve_pending"],
        "payload": {}, "continuation": None,
    })
    reject(game_id, match="Action not permitted")


def test_new_scene_resets_dark_through_real_lifecycle(game_id):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "8C", "3D"])
    dispatch(game_id)
    game = GAMES[game_id].state
    game, _ = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")
    assert game.meta["scene"]["status"] == "awaiting_ack"
    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_close(game, actor_id="host1")
    game = scene_new(game, actor_id="host1")
    assert game.meta["scene"]["status"] == "setup"
    assert game.meta["scene"]["dark_mode"] is False
    assert game.meta["scene"]["dark"] == {"revealed": False}


@pytest.mark.parametrize("legacy_dark", [None, True, False])
def test_legacy_normalization_preserves_unrelated_state(game_id, legacy_dark):
    game, _ = scene_roll_difficulty(GAMES[game_id].state, actor_id="host1")
    game.meta["scene"].pop("dark")
    if legacy_dark is None:
        game.meta["scene"].pop("dark_mode")
    else:
        game.meta["scene"]["dark_mode"] = legacy_dark
    snapshot = deepcopy(game)
    normalized = ensure_scene_state(game)
    expected = deepcopy(game.meta)
    expected["scene"].update(dark_mode=bool(legacy_dark), dark={"revealed": False})
    assert normalized == replace(game, meta=expected)
    assert game == snapshot
    assert enrich_meta_for_ui(game).meta["scene"]["dark"] == {"revealed": False}
    normalized.meta["scene"]["dark"]["revealed"] = True
    assert enrich_meta_for_ui(normalized).meta["scene"]["dark"]["revealed"] is True


def test_low_level_difficulty_does_not_write_dark_metadata(game_id):
    game = _with_draw_order(GAMES[game_id].state, ["BJ"])
    game.meta["scene"]["dark_mode"] = True
    game.meta["scene.dark_mode"] = True
    result, difficulty = marshal_roll_difficulty(game)
    assert difficulty.effects == []
    assert result.meta["scene"]["dark_mode"] is True
    assert result.meta["scene.dark_mode"] is True
