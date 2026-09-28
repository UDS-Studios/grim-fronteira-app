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

from backend.app.serializers import game_state_to_dict
from backend.engine.rules.grim_fronteira.scene import (
    SCENE_DARK_MARSHAL_HAND_ZONE as DARK_HAND, _dark_marshal_total,
    scene_dark_draw, scene_dark_discard_last, _discard_scene_play_zones,
)
from backend.engine.state.validators import validate_game_state
from backend.engine.state.game_state_io import save_game_state, load_game_state
from backend.tests.test_gf_scene import _with_exact_draw_pile


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
    assert response.state["meta"]["scene"]["dark"] == {"revealed": False, "must_discard_last": False}
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
    assert game.meta["scene"]["dark"] == {"revealed": False, "must_discard_last": False}
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
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "AC", "8C", "3D"])
    dispatch(game_id)
    game = GAMES[game_id].state
    game, _ = scene_roll_difficulty(game, actor_id="host1")
    game, _ = scene_dark_draw(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    assert game.zones[DARK_HAND] == ["AC"]
    game = scene_stand(game, player_id="p1")
    assert game.meta["scene"]["status"] == "awaiting_ack"
    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_close(game, actor_id="host1")
    assert DARK_HAND not in game.zones
    assert "AC" in game.deck.discard_pile
    validate_game_state(game)
    game = scene_new(game, actor_id="host1")
    assert DARK_HAND not in game.zones
    validate_game_state(game)
    assert game.meta["scene"]["status"] == "setup"
    assert game.meta["scene"]["dark_mode"] is False
    assert game.meta["scene"]["dark"] == {"revealed": False, "must_discard_last": False}


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
    expected["scene"].update(dark_mode=bool(legacy_dark), dark={"revealed": False, "must_discard_last": False})
    assert normalized == replace(game, meta=expected)
    assert game == snapshot
    assert enrich_meta_for_ui(game).meta["scene"]["dark"] == {"revealed": False, "must_discard_last": False}
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

# Checkpoint 2: hidden Marshal hand and privacy.


def prepare_hand(game_id, cards):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, cards)
    dispatch(game_id)
    dispatch(game_id, "scene_roll_difficulty")
    return GAMES[game_id].state


def hand_action(game_id, name="scene_dark_draw", view="debug", viewer_id=None, **params):
    before = GAMES[game_id].state.meta.get("revision", 0)
    response = action(ActionRequest(game_id=game_id, action=f"gf.{name}",
        params={"actor_id": "host1", **params}, view=view, viewer_id=viewer_id))
    assert response.revision == before + 1
    validate_game_state(GAMES[game_id].state)
    return response


def test_order_bust_discard_and_resume(game_id):
    prepare_hand(game_id, ["2H", "3C", "4D", "9S", "AC"])
    for card, total in [("3C", 15), ("4D", 19), ("9S", 28)]:
        before = deepcopy(GAMES[game_id].state)
        response = hand_action(game_id)
        game = GAMES[game_id].state
        assert response.result["card_id"] == card
        assert response.result["marshal_total"] == total == _dark_marshal_total(game)
        assert game.deck.draw_pile == before.deck.draw_pile[:-1]
        assert game.zones[DARK_HAND] == before.zones.get(DARK_HAND, []) + [card]
    assert game.meta["scene"]["dark"]["must_discard_last"] is True
    reject(game_id, "scene_dark_draw")
    previous_discard = list(game.deck.discard_pile)
    response = hand_action(game_id, "scene_dark_discard_last", card_id="3C")
    game = GAMES[game_id].state
    assert response.result["card_id"] == "9S"
    assert game.zones[DARK_HAND] == ["3C", "4D"]
    assert game.zones["scene.difficulty"] == ["2H"]
    assert game.deck.discard_pile == previous_discard + ["9S"]
    assert game.meta["scene"]["dark"]["must_discard_last"] is False
    assert _dark_marshal_total(game) == 19
    reject(game_id, "scene_dark_discard_last")
    assert hand_action(game_id).result["marshal_total"] == 20


@pytest.mark.parametrize("cards,total", [(["AH", "AC"], 12), (["BJ", "2C", "3D", "AS"], 21)])
def test_dark_total_soft_aces_and_initial_joker(game_id, cards, total):
    # Initial Joker consumes two bonus cards before the extra hand draw.
    prepare_hand(game_id, cards)
    hand_action(game_id)
    assert _dark_marshal_total(GAMES[game_id].state) == total


@pytest.mark.parametrize("joker,bonus", [("RJ", "scum"), ("BJ", "vengeance")])
def test_dark_joker_grants_all_eligible_players(game_id, joker, bonus):
    before = deepcopy(prepare_hand(game_id, ["4H", joker, "5H", "6C"]))
    response = hand_action(game_id)
    game = GAMES[game_id].state
    assert game.zones[DARK_HAND] == [joker]
    assert response.result["marshal_total"] == 14
    assert game.meta["scene"]["dark_mode"] is True
    for pid, card in [("p1", "5H"), ("p2", "6C")]:
        zone = f"players.{pid}.{bonus}"
        assert game.zones[zone] == before.zones.get(zone, []) + [card]
    assert game.deck.discard_pile == before.deck.discard_pile


@pytest.mark.parametrize("name", ["scene_dark_draw", "scene_dark_discard_last"])
@pytest.mark.parametrize("invalid", ["ordinary", "actor", "idle", "awaiting_ack", "resolved", "closed", "victory", "revealed", "pvp", "no_difficulty"])
def test_hand_invalid_actions_atomic(game_id, name, invalid):
    prepare_hand(game_id, ["9H", "8C"])
    hand_action(game_id)
    game = GAMES[game_id].state
    scene = game.meta["scene"]
    params = {}
    if invalid == "ordinary":
        scene["dark_mode"] = False
    elif invalid == "actor":
        params["actor_id"] = "p1"
    elif invalid == "victory":
        game.meta["phase"] = "victory"
    elif invalid == "revealed":
        scene["dark"]["revealed"] = True
    elif invalid == "pvp":
        scene.update(mode="duel", duel={"subtype": "pvp"})
    elif invalid == "no_difficulty":
        scene["difficulty"]["card_id"] = None
    else:
        scene["status"] = invalid
    reject(game_id, name, **params)


def test_discard_empty_or_not_required(game_id):
    prepare_hand(game_id, ["2H", "3C"])
    reject(game_id, "scene_dark_discard_last")
    hand_action(game_id)
    reject(game_id, "scene_dark_discard_last")


def test_active_dark_draw_and_discard(game_id):
    prepare_hand(game_id, ["2H", "3C", "9S"])
    GAMES[game_id].state = scene_start(GAMES[game_id].state, actor_id="host1")
    hand_action(game_id)
    assert GAMES[game_id].state.meta["scene"]["status"] == "active"
    # Total 21 is legal; one more known high card requires discard.
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["8D"])
    hand_action(game_id)
    hand_action(game_id, "scene_dark_discard_last")


@pytest.mark.parametrize("name", ["scene_dark_draw", "scene_dark_discard_last"])
def test_hand_pending_gate_precedes_engine(game_id, monkeypatch, name):
    import backend.app.main as main
    prepare_hand(game_id, ["9H", "8C"])
    hand_action(game_id)
    def unexpected(*args, **kwargs):
        pytest.fail("Pending gate must run before the Dark engine action")
    monkeypatch.setattr(main, name, unexpected)
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_resolve_pending"],
        "payload": {}, "continuation": None,
    })
    reject(game_id, name, match="Action not permitted")


@pytest.mark.parametrize("view,viewer", [("public", None), ("player", "p1"), ("player", "host1"), ("player", "other")])
def test_hidden_state_and_action_results(game_id, view, viewer):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["9H", "8C"])
    dispatch(game_id)
    response = hand_action(game_id, "scene_roll_difficulty", view, viewer)
    assert response.result["difficulty"]["card_id"] is None
    assert response.result["difficulty"]["value"] is None
    response = hand_action(game_id, view=view, viewer_id=viewer)
    assert response.result == {"ok": True, "action": "gf.scene_dark_draw"}
    original = deepcopy(GAMES[game_id].state)
    data = game_state_to_dict(GAMES[game_id].state, view=view, viewer_id=viewer)
    assert GAMES[game_id].state == original
    assert data["meta"]["scene"]["difficulty"]["card_id"] is None
    assert data["meta"]["scene"]["difficulty"]["value"] is None
    assert "scene.difficulty_value" not in data["meta"]
    assert data["zones"]["scene.difficulty"] == []
    assert data["zones"][DARK_HAND] == []
    assert "must_discard_last" not in data["meta"]["scene"]["dark"]
    debug = game_state_to_dict(GAMES[game_id].state, view="debug")
    assert debug["zones"][DARK_HAND] == ["8C"]
    assert debug["meta"]["scene"]["difficulty"]["card_id"] == "9H"
    assert debug["meta"]["scene"]["dark"]["must_discard_last"] is True
    response = hand_action(game_id, "scene_dark_discard_last", view, viewer)
    assert response.result == {"ok": True, "action": "gf.scene_dark_discard_last"}
    assert isinstance(response.state["deck"]["discard_pile"], dict)
    assert "8C" not in str(response.state)
    # Prepare the future reveal projection contract without adding a reveal action.
    GAMES[game_id].state.meta["scene"]["dark"]["revealed"] = True
    visible = game_state_to_dict(GAMES[game_id].state, view=view, viewer_id=viewer)
    assert visible["zones"]["scene.difficulty"] == ["9H"]
    assert visible["meta"]["scene"]["difficulty"]["value"] == 19
    assert visible["deck"]["discard_pile"][-1] == "8C"


@pytest.mark.parametrize("joker", ["RJ", "BJ"])
def test_joker_identity_not_in_public_response(game_id, joker):
    prepare_hand(game_id, ["2H", joker, "5H", "6C"])
    response = hand_action(game_id, view="public")
    assert joker not in str(response.model_dump())


def test_dark_save_load_and_cleanup(game_id, tmp_path):
    prepare_hand(game_id, ["2H", "3C", "9S"])
    hand_action(game_id)
    hand_action(game_id)
    path = tmp_path / "dark.json"
    before = GAMES[game_id].state
    save_game_state(before, path)
    loaded = load_game_state(path)
    assert loaded == before
    assert ensure_scene_state(loaded) == before
    GAMES[game_id].state = loaded
    hand_action(game_id, "scene_dark_discard_last")
    game = GAMES[game_id].state
    cleaned = _discard_scene_play_zones(game)
    assert DARK_HAND not in cleaned.zones
    assert "3C" in cleaned.deck.discard_pile
    assert "2H" in cleaned.deck.discard_pile
    validate_game_state(cleaned)
    cleaned.meta["scene"]["status"] = "closed"
    fresh = scene_new(cleaned, actor_id="host1")
    assert DARK_HAND not in fresh.zones
    assert fresh.meta["scene"]["dark"] == {"revealed": False, "must_discard_last": False}
    validate_game_state(fresh)


def test_checkpoint_one_dark_normalization(game_id):
    game = GAMES[game_id].state
    game.meta["scene"]["dark"] = {"revealed": False}
    normalized = ensure_scene_state(game)
    assert normalized.meta["scene"]["dark"]["must_discard_last"] is False
    assert normalized.deck == game.deck and normalized.zones == game.zones


def test_dark_deck_exhaustion(game_id):
    prepare_hand(game_id, ["2H"])
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["3C"])
    hand_action(game_id)
    game = GAMES[game_id].state
    assert game.deck.draw_pile == []
    assert game.meta["scene"]["deck_exhausted"] is True
    assert game.meta["scene"]["deck_exhausted_participants"] == ["p1"]
    reject(game_id, "scene_dark_draw")


def test_joker_bonus_exhaustion_is_atomic(game_id):
    prepare_hand(game_id, ["2H"])
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["RJ", "3C"])
    reject(game_id, "scene_dark_draw")
