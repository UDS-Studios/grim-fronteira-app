"""Dark checkpoints: declaration, hidden hand, reveal, and canonical consequences."""
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
    scene_dark_draw, scene_dark_discard_last, scene_dark_reveal, _discard_scene_play_zones,
)
from backend.engine.state.validators import validate_game_state
from backend.engine.state.game_state_io import save_game_state, load_game_state
from backend.tests.test_gf_scene import _with_exact_draw_pile

from backend.tests.test_gf_scene import _replace_zone_cards
from backend.engine.rules.grim_fronteira.scene import (
    _refresh_scene_resolution_preview, _must_discard_rewards,
)


pytestmark = pytest.mark.usefixtures("enabled_debug_api")


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
            assert game.zones.get(zone, []) == before.zones.get(zone, []) + ([] if declared else [drawn])


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
    assert game.meta["scene"]["status"] == "active"
    game, _ = scene_dark_reveal(game, actor_id="host1")
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


@pytest.mark.parametrize("cards,total", [(["AH", "AC"], 12), (["BJ", "AS"], 21)])
def test_dark_total_soft_aces_and_initial_joker(game_id, cards, total):
    prepare_hand(game_id, cards)
    hand_action(game_id)
    assert _dark_marshal_total(GAMES[game_id].state) == total


@pytest.mark.parametrize("joker,bonus", [("RJ", "scum"), ("BJ", "vengeance")])
def test_dark_joker_defers_bonus_for_all_eligible_players(game_id, joker, bonus):
    before = deepcopy(prepare_hand(game_id, ["4H", joker, "5H", "6C"]))
    response = hand_action(game_id)
    game = GAMES[game_id].state
    assert game.zones[DARK_HAND] == [joker]
    assert response.result["marshal_total"] == 14
    assert game.meta["scene"]["dark_mode"] is True
    for pid, card in [("p1", "5H"), ("p2", "6C")]:
        zone = f"players.{pid}.{bonus}"
        assert game.zones.get(zone, []) == before.zones.get(zone, [])
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
    assert data["zones"]["scene.difficulty"] == {"count": 1}
    assert data["zones"][DARK_HAND] == {"count": 1}
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


def test_hidden_joker_draw_does_not_require_bonus_cards(game_id):
    prepare_hand(game_id, ["2H"])
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["RJ", "3C"])
    hand_action(game_id)
    assert GAMES[game_id].state.deck.draw_pile == ["3C"]

# Checkpoint 3: completion defers resolution until an explicit Marshal reveal.
def prepare_waiting(game_id, *, difficulty="2H", extras=("3C", "4D"), player_card="8S"):
    prepare_hand(game_id, [difficulty, *extras, player_card])
    for _ in extras:
        hand_action(game_id)
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    return GAMES[game_id].state


def assert_waiting(game):
    scene = game.meta["scene"]
    assert scene["status"] == "active"
    assert scene["dark"]["revealed"] is False
    assert scene["resolution"]["completed"] is False
    assert all(p["standing"] or p["busted"] for p in scene["players"].values())


def test_final_stand_waits_and_player_actions_are_locked(game_id):
    game = prepare_waiting(game_id)
    assert_waiting(game)
    assert game.zones[DARK_HAND] == ["3C", "4D"]
    assert game.meta["scene"]["players"]["p1"]["resolved"] is False
    reject(game_id, "scene_draw_card", player_id="p1")
    reject(game_id, "scene_stand", player_id="p1")
    reject(game_id, "scene_resolve", match="revealed")


def test_ordinary_final_stand_still_resolves(game_id):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "8S"])
    dispatch(game_id, "scene_roll_difficulty")
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    scene = GAMES[game_id].state.meta["scene"]
    assert scene["status"] == "awaiting_ack"
    assert scene["resolution"]["completed"] is True


@pytest.mark.parametrize("view", ["public", "player", "debug"])
@pytest.mark.parametrize("player_card,outcome", [("8S", "failure"), ("9S", "success")])
def test_real_reveal_visibility_total_and_conservation(game_id, view, player_card, outcome):
    game = prepare_waiting(game_id, player_card=player_card)
    before = deepcopy(game)
    hidden = game_state_to_dict(game, view="player", viewer_id="host1")
    assert hidden["zones"][DARK_HAND] == {"count": 2}
    assert hidden["meta"]["scene"]["difficulty"]["value"] is None
    response = hand_action(game_id, "scene_dark_reveal", view, "p1")
    assert response.result == {"ok": True, "action": "gf.scene_dark_reveal", "marshal_total": 19}
    game = GAMES[game_id].state
    scene = game.meta["scene"]
    assert scene["dark"]["revealed"] is True
    assert scene["status"] == "awaiting_ack"
    assert scene["resolution"]["completed"] is True
    assert scene["players"]["p1"]["result"] == outcome
    assert scene["players"]["p1"]["wounds_gained"] == int(outcome == "failure")
    assert game.deck == before.deck and game.zones == before.zones
    assert response.state["zones"][DARK_HAND] == ["3C", "4D"]
    assert response.state["zones"]["scene.difficulty"] == ["2H"]
    assert response.state["meta"]["scene"]["difficulty"]["value"] == 12
    assert response.state["deck"]["discard_pile"] == game.deck.discard_pile
    reject(game_id, "scene_dark_reveal")
    reject(game_id, "scene_dark_draw")
    reject(game_id, "scene_dark_discard_last")


def test_waiting_draw_discard_reveal_and_save_load(game_id, tmp_path):
    game = prepare_waiting(game_id)
    path = tmp_path / "waiting.json"
    save_game_state(game, path)
    loaded = load_game_state(path)
    assert loaded == game == ensure_scene_state(loaded)
    GAMES[game_id].state = _with_draw_order(loaded, ["AC", "8D"])
    hand_action(game_id)
    assert_waiting(GAMES[game_id].state)
    hand_action(game_id)
    assert_waiting(GAMES[game_id].state)
    assert GAMES[game_id].state.meta["scene"]["dark"]["must_discard_last"] is True
    reject(game_id, "scene_dark_reveal")
    hand_action(game_id, "scene_dark_discard_last")
    response = hand_action(game_id, "scene_dark_reveal")
    assert response.result["marshal_total"] == 20


@pytest.mark.parametrize("invalid", ["unfinished", "actor", "setup", "awaiting_ack", "resolved", "closed", "pvp", "ordinary", "victory", "no_difficulty", "revealed", "flag", "total"])
def test_reveal_guards_atomic(game_id, invalid):
    prepare_waiting(game_id)
    game = GAMES[game_id].state
    scene = game.meta["scene"]
    params = {}
    if invalid == "unfinished":
        scene["players"]["p1"]["standing"] = False
    elif invalid == "actor":
        params["actor_id"] = "p1"
    elif invalid == "pvp":
        scene.update(mode="duel", duel={"subtype": "pvp"})
    elif invalid == "ordinary":
        scene["dark_mode"] = False
    elif invalid == "victory":
        game.meta["phase"] = "victory"
    elif invalid == "no_difficulty":
        scene["difficulty"]["card_id"] = None
    elif invalid == "revealed":
        scene["dark"]["revealed"] = True
    elif invalid == "flag":
        scene["dark"]["must_discard_last"] = True
    elif invalid == "total":
        GAMES[game_id].state = _with_draw_order(game, ["8D"])
        hand_action(game_id)
        GAMES[game_id].state.meta["scene"]["dark"]["must_discard_last"] = False
    else:
        scene["status"] = invalid
    reject(game_id, "scene_dark_reveal", **params)


def test_reveal_pending_gate_before_engine(game_id, monkeypatch):
    import backend.app.main as main
    prepare_waiting(game_id)
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_resolve_pending"],
        "payload": {}, "continuation": None,
    })
    def unexpected(*args, **kwargs):
        pytest.fail("Reveal must not bypass the gate")
    monkeypatch.setattr(main, "scene_dark_reveal", unexpected)
    reject(game_id, "scene_dark_reveal", match="Action not permitted")


def test_reveal_resolution_failure_is_atomic(game_id, monkeypatch):
    import backend.engine.rules.grim_fronteira.scene as engine
    prepare_waiting(game_id)
    def fail(game, *, actor_id):
        assert game.meta["scene"]["dark"]["revealed"] is True
        assert GAMES[game_id].state.meta["scene"]["dark"]["revealed"] is False
        raise ValueError("forced resolution failure")
    monkeypatch.setattr(engine, "scene_resolve", fail)
    reject(game_id, "scene_dark_reveal", match="forced resolution failure")
    assert_waiting(GAMES[game_id].state)


@pytest.mark.parametrize("kind", ["ace", "joker"])
def test_reveal_uses_scene_card_values(game_id, kind):
    if kind == "ace":
        prepare_waiting(game_id, difficulty="AH", extras=("AC",), player_card="2S")
        total = 12
    else:
        prepare_hand(game_id, ["2H", "RJ", "2S", "3C", "4D"])
        hand_action(game_id)
        dispatch(game_id, "scene_start")
        dispatch(game_id, "scene_stand", player_id="p1")
        total = 12
    response = hand_action(game_id, "scene_dark_reveal")
    assert response.result["marshal_total"] == total
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["result"] == "success"


def test_reactions_recompute_against_revealed_total(game_id):
    from backend.tests.test_gf_scene import _replace_zone_cards
    prepare_waiting(game_id, player_card="9S")
    game = _replace_zone_cards(GAMES[game_id].state, "players.p2.scum", ["5H"])
    game = _replace_zone_cards(game, "players.p1.vengeance", ["6H"])
    GAMES[game_id].state = game
    hand_action(game_id, "scene_dark_reveal")
    dispatch(game_id, "scene_play_scum", player_id="p2", target_player_id="p1")
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["hand_value"] == 18
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["result"] == "failure"
    dispatch(game_id, "scene_play_vengeance", player_id="p1")
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["hand_value"] == 19
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["result"] == "success"
    validate_game_state(GAMES[game_id].state)


def test_final_bust_chichimeca_reaction_then_wait_and_no_duplicate_wound(game_id):
    prepare_hand(game_id, ["2H", "9S", "8D"])
    dispatch(game_id, "scene_start")
    wounds_before = GAMES[game_id].state.meta["players"]["p1"]["wounds"]
    dispatch(game_id, "scene_draw_card", player_id="p1")
    game = GAMES[game_id].state
    assert game.meta["scene"]["status"] == "active"
    assert game.meta["scene"]["resolution"]["completed"] is False
    assert game.meta["pending_interaction"]["kind"] == "chichimeca_choose_target"
    assert game.meta["players"]["p1"]["wounds"] == wounds_before + 1
    reject(game_id, "scene_dark_reveal", match="Action not permitted")
    dispatch(game_id, "pending_reclaim")
    assert_waiting(GAMES[game_id].state)
    reject(game_id, "scene_draw_card", player_id="p1")
    reject(game_id, "scene_stand", player_id="p1")
    hand_action(game_id, "scene_dark_reveal")
    game = GAMES[game_id].state
    assert game.meta["players"]["p1"]["wounds"] == wounds_before + 1
    assert game.meta.get("pending_interaction") is None
    assert game.meta["scene"]["players"]["p1"]["wounds_applied"] == 1
    assert game.meta["scene"]["players"]["p1"]["wounds_gained"] == 0
    assert game.meta["scene"]["status"] == "resolved"

# Checkpoint 4: canonical consequences stay provisional until acknowledgement.


def set_rewards(game_id, cards, player_id="p1"):
    GAMES[game_id].state = _replace_zone_cards(GAMES[game_id].state, f"players.{player_id}.rewards", cards)


def finish_acknowledgements(game_id):
    for pid in list(GAMES[game_id].state.meta["scene"]["participants"]):
        game = GAMES[game_id].state
        if game.meta["scene"]["status"] == "awaiting_ack" and not game.meta["scene"]["players"][pid]["acknowledged"]:
            hand_action(game_id, "scene_acknowledge_resolution", player_id=pid)
        if GAMES[game_id].state.meta.get("pending_interaction"):
            hand_action(game_id, "pending_reclaim")
    assert GAMES[game_id].state.meta["scene"]["status"] == "resolved"


def closed_loser(game_id, rewards=("5D", "6H", "7D")):
    prepare_waiting(game_id)
    set_rewards(game_id, list(rewards))
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    return GAMES[game_id].state


def test_dark_success_two_real_rewards_in_order(game_id):
    prepare_waiting(game_id, player_card="9S")
    set_rewards(game_id, ["2D"])
    hand_action(game_id, "scene_dark_reveal")
    p = GAMES[game_id].state.meta["scene"]["players"]["p1"]
    assert p["reward_cards_gained"] == 2 and p["reward_gained"] is True
    assert not p["dark_reward_loss_pending"] and p["wounds_gained"] == 0
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["5D", "6H"])
    before = deepcopy(GAMES[game_id].state)
    hand_action(game_id, "scene_close")
    game = GAMES[game_id].state
    assert game.zones["players.p1.rewards"] == ["2D", "5D", "6H"]
    assert game.deck.draw_pile == before.deck.draw_pile[:-2]


def test_multiple_dark_winners_each_receive_two(game_id):
    dispatch(game_id, "scene_set_participants", participant_ids=["p1", "p2"])
    prepare_hand(game_id, ["2H", "8S", "9S", "3D", "4D", "5D", "6D"])
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    dispatch(game_id, "scene_stand", player_id="p2")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    order = GAMES[game_id].state.meta["scene"]["participants"]
    hand_action(game_id, "scene_close")
    game = GAMES[game_id].state
    for pid, cards in zip(order, [["3D", "4D"], ["5D", "6D"]]):
        assert game.zones[f"players.{pid}.rewards"] == cards
        assert game.meta["scene"]["players"][pid]["reward_cards_gained"] == 2


@pytest.mark.parametrize("player_card,count,wound", [("9S", 1, 0), ("2S", 0, 0)])
def test_ordinary_reward_and_nonbust_failure_unchanged(game_id, player_card, count, wound):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["8H", player_card, "5D"])
    dispatch(game_id, "scene_roll_difficulty")
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    p = GAMES[game_id].state.meta["scene"]["players"]["p1"]
    assert p["reward_cards_gained"] == count
    assert p["reward_gained"] is bool(count)
    assert p["wounds_gained"] == wound
    assert not p["dark_reward_loss_pending"]
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.zones.get("players.p1.rewards", []) == (["5D"] if count else [])
    assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 0


def test_failure_wound_provisional_then_chichimeca_save_load(game_id, tmp_path):
    prepare_waiting(game_id)
    hand_action(game_id, "scene_dark_reveal")
    game = GAMES[game_id].state
    assert game.meta["players"]["p1"]["wounds"] == 0
    assert game.meta["scene"]["players"]["p1"]["wounds_gained"] == 1
    assert not game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    assert game.meta.get("pending_interaction") is None
    hand_action(game_id, "scene_acknowledge_resolution", player_id="p1")
    game = GAMES[game_id].state
    assert game.meta["players"]["p1"]["wounds"] == 1
    assert game.meta["pending_interaction"]["kind"] == "chichimeca_choose_target"
    path = tmp_path / "dark-wound.json"
    save_game_state(game, path)
    GAMES[game_id].state = load_game_state(path)
    assert GAMES[game_id].state == game
    reject(game_id, "scene_close", match="Action not permitted")
    hand_action(game_id, "pending_reclaim")
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 1
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["wounds_applied"] == 1
    assert not GAMES[game_id].state.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    hand_action(game_id, "scene_new")


def test_failure_to_success_cancels_penalties(game_id):
    prepare_waiting(game_id)
    set_rewards(game_id, ["5D"])
    GAMES[game_id].state = _replace_zone_cards(GAMES[game_id].state, "players.p1.vengeance", ["6H"])
    hand_action(game_id, "scene_dark_reveal")
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    hand_action(game_id, "scene_play_vengeance", player_id="p1")
    game = GAMES[game_id].state
    p = game.meta["scene"]["players"]["p1"]
    assert p["result"] == "success" and p["reward_cards_gained"] == 2
    assert p["wounds_gained"] == 0 and not p["dark_reward_loss_pending"]
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2D", "3D"])
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 0
    assert GAMES[game_id].state.zones["players.p1.rewards"] == ["5D", "2D", "3D"]


def test_success_to_failure_and_preview_idempotence(game_id):
    prepare_waiting(game_id, player_card="9S")
    set_rewards(game_id, ["5D"])
    GAMES[game_id].state = _replace_zone_cards(GAMES[game_id].state, "players.p2.scum", ["6H"])
    GAMES[game_id].state = _replace_zone_cards(GAMES[game_id].state, "players.p1.vengeance", ["6D"])
    hand_action(game_id, "scene_dark_reveal")
    hand_action(game_id, "scene_play_scum", player_id="p2", target_player_id="p1")
    game = GAMES[game_id].state
    for _ in range(3):
        updated = _refresh_scene_resolution_preview(game, reset_acknowledgements=False)
        assert updated == game
        game = updated
    p = game.meta["scene"]["players"]["p1"]
    assert p["result"] == "failure" and p["reward_cards_gained"] == 0
    assert not p["reward_gained"] and p["dark_reward_loss_pending"]
    assert p["wounds_gained"] == 1 and game.meta["players"]["p1"]["wounds"] == 0
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 1
    assert GAMES[game_id].state.zones["players.p1.rewards"] == ["5D"]


def test_chosen_middle_reward_loss_persistence_and_gate(game_id, tmp_path):
    game = closed_loser(game_id)
    assert game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    hand_action(game_id, "scene_skip_heal", player_id="p1")
    reject(game_id, "scene_new")
    path = tmp_path / "dark-loss.json"
    save_game_state(GAMES[game_id].state, path)
    GAMES[game_id].state = load_game_state(path)
    before = deepcopy(GAMES[game_id].state)
    response = hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="6H")
    game = GAMES[game_id].state
    assert game.zones["players.p1.rewards"] == ["5D", "7D"]
    assert game.deck.discard_pile == before.deck.discard_pile + ["6H"]
    assert response.result["remaining_reward_points"] == 12
    assert not game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    for zone in ("players.p1.scum", "players.p1.vengeance"):
        assert game.zones[zone] == before.zones[zone]
    reject(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="5D")
    hand_action(game_id, "scene_new")


@pytest.mark.parametrize("choice", ["", "AS", "10D"])
def test_bad_dark_reward_choice_atomic(game_id, choice):
    closed_loser(game_id, ["5D"])
    set_rewards(game_id, ["10D"], player_id="p2")
    reject(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id=choice)
    reject(game_id, "scene_discard_dark_reward", player_id="p2", reward_card_id="10D")


@pytest.mark.parametrize("status", ["active", "awaiting_ack", "resolved"])
def test_penalty_requires_closed(game_id, status):
    closed_loser(game_id, ["5D"])
    GAMES[game_id].state.meta["scene"]["status"] = status
    reject(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="5D")


def test_penalty_pending_gate_before_engine(game_id, monkeypatch):
    import backend.app.main as main
    closed_loser(game_id, ["5D"])
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_resolve_pending"],
        "payload": {}, "continuation": None,
    })
    def fail(*args, **kwargs):
        pytest.fail("Penalty engine must not bypass the pending gate")
    monkeypatch.setattr(main, "scene_discard_dark_reward", fail)
    reject(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="5D", match="Action not permitted")


@pytest.mark.parametrize("first", ["dark", "overflow"])
def test_dark_loss_and_overflow_independent(game_id, first):
    closed_loser(game_id, ["10D", "9D", "6H", "4H"])
    hand_action(game_id, "scene_skip_heal", player_id="p1")
    if first == "dark":
        hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="4H")
        assert _must_discard_rewards(GAMES[game_id].state, "p1")
        assert not GAMES[game_id].state.meta["scene"]["players"]["p1"]["reward_discard_started"]
        reject(game_id, "scene_new")
        hand_action(game_id, "scene_discard_reward", player_id="p1", reward_card_id="6H")
    else:
        hand_action(game_id, "scene_discard_reward", player_id="p1", reward_card_id="10D")
        assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
        reject(game_id, "scene_new")
        hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="4H")
    hand_action(game_id, "scene_new")


@pytest.mark.parametrize("awards,phase", [(["AH", "4H"], "table"), (["5H", "6H"], "victory")])
def test_two_rewards_evaluate_final_total_only(game_id, awards, phase):
    prepare_waiting(game_id, player_card="9S")
    set_rewards(game_id, ["10D"])
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, awards)
    hand_action(game_id, "scene_close")
    game = GAMES[game_id].state
    assert game.zones["players.p1.rewards"] == ["10D", *awards]
    assert game.meta["phase"] == phase
    if phase == "table":
        assert not game.meta.get("victory") and _must_discard_rewards(game, "p1")
        reject(game_id, "scene_new")
    else:
        assert game.meta["victory"]["winner"] == "p1"


def test_two_reward_short_deck_close_is_atomic(game_id):
    prepare_waiting(game_id, player_card="9S")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["5D"])
    reject(game_id, "scene_close", match="draw_pile is empty")
    assert GAMES[game_id].state.meta["scene"]["status"] == "resolved"
    assert GAMES[game_id].state.deck.draw_pile == ["5D"]
    validate_game_state(GAMES[game_id].state)


def test_legacy_reward_count_normalization(game_id):
    game = GAMES[game_id].state
    p = game.meta["scene"]["players"]["p1"]
    p.pop("reward_cards_gained")
    p.pop("dark_reward_loss_pending")
    p["reward_gained"] = True
    normalized = ensure_scene_state(game)
    assert normalized.meta["scene"]["players"]["p1"]["reward_cards_gained"] == 1
    assert not normalized.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    assert normalized.deck == game.deck and normalized.zones == game.zones


def test_dark_penalty_cannot_be_spent_as_healing(game_id):
    closed_loser(game_id, ["5D", "7D"])
    reject(game_id, "scene_heal_wound", player_id="p1", reward_card_ids=["5D", "7D"], match="Dark Reward loss")
    hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="5D")
    assert GAMES[game_id].state.zones["players.p1.rewards"] == ["7D"]
    hand_action(game_id, "scene_new")


def test_dark_loss_blocks_endgame_and_new_scene_even_in_sudden_death(game_id):
    closed_loser(game_id, ["5D"])
    GAMES[game_id].state.meta["endgame"] = {"active": True}
    reject(game_id, "scene_new")


def test_pending_loss_defers_victory_until_loss_paid(game_id):
    prepare_waiting(game_id)
    set_rewards(game_id, ["5D"])
    set_rewards(game_id, ["10H", "AH"], player_id="p2")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.meta["phase"] == "table"
    hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="5D")
    assert GAMES[game_id].state.meta["phase"] == "victory"
    assert GAMES[game_id].state.meta["victory"]["winner"] == "p2"


def test_pvp_reward_count_remains_one(game_id):
    dispatch(game_id, "scene_set_participants", participant_ids=["p1", "p2"])
    dispatch(game_id, "scene_set_mode", mode="duel", duel_subtype="pvp")
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["9S", "8H", "5D"])
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    dispatch(game_id, "scene_stand", player_id="p2")
    scene = GAMES[game_id].state.meta["scene"]
    assert scene["players"]["p1"]["reward_cards_gained"] == 1
    assert scene["players"]["p2"]["reward_cards_gained"] == 0
    assert not any(p["dark_reward_loss_pending"] for p in scene["players"].values())
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.zones["players.p1.rewards"] == ["5D"]


def test_two_reward_grant_can_exhaust_deck_after_second_card(game_id):
    prepare_waiting(game_id, player_card="9S")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["5D", "6H"])
    hand_action(game_id, "scene_close")
    game = GAMES[game_id].state
    assert game.zones["players.p1.rewards"] == ["5D", "6H"]
    assert game.deck.draw_pile == []
    assert game.meta["scene"]["deck_exhausted"] is True
    assert game.meta["scene"]["deck_exhausted_participants"] == ["p1"]
    assert game.meta["phase"] == "victory"
    assert game.meta["victory"]["winner"] == "p1"
    assert game.meta["victory"]["reason"] == "Won with the most reward points after the deck was exhausted."


def test_dark_discard_does_not_cancel_started_overflow_at_21(game_id):
    closed_loser(game_id, ["10D", "9D", "8H", "4H", "2D"])
    hand_action(game_id, "scene_skip_heal", player_id="p1")
    hand_action(game_id, "scene_discard_reward", player_id="p1", reward_card_id="10D")
    assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["reward_discard_started"]
    hand_action(game_id, "scene_discard_dark_reward", player_id="p1", reward_card_id="2D")
    assert GAMES[game_id].state.meta["phase"] == "table"
    assert _must_discard_rewards(GAMES[game_id].state, "p1")
    reject(game_id, "scene_new")
    hand_action(game_id, "scene_discard_reward", player_id="p1", reward_card_id="4H")
    hand_action(game_id, "scene_new")


@pytest.mark.parametrize("joker,bonus", [("RJ", "scum"), ("BJ", "vengeance")])
@pytest.mark.parametrize("source", ["difficulty", "extra"])
@pytest.mark.parametrize("view,viewer", [("public", None), ("player", "p1"), ("player", "host1")])
def test_hidden_joker_privacy_and_reveal(game_id, joker, bonus, source, view, viewer):
    dispatch(game_id)
    if source == "extra":
        GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H"])
        hand_action(game_id, "scene_roll_difficulty")
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, [joker, "8S", "5H", "6C"])
    before = deepcopy(GAMES[game_id].state)
    response = hand_action(game_id, "scene_roll_difficulty" if source == "difficulty" else "scene_dark_draw",
                           view=view, viewer_id=viewer)
    game = GAMES[game_id].state
    assert game.zones["scene.difficulty" if source == "difficulty" else DARK_HAND] == [joker]
    assert joker not in str(response.result)
    assert response.state["meta"]["scene"]["difficulty"]["card_id"] is None
    assert response.state["zones"][DARK_HAND] == {"count": int(source == "extra")}
    assert game.meta["scene"]["dark"] == {"revealed": False, "must_discard_last": False}
    for pid in ["p1", "p2"]:
        for resource in ["scum", "vengeance"]:
            zone = f"players.{pid}.{resource}"
            assert game.zones.get(zone, []) == before.zones.get(zone, [])
            prior_view = game_state_to_dict(before, view=view, viewer_id=viewer)
            assert response.state["zones"].get(zone) == prior_view["zones"].get(zone)
    hand_action(game_id, "scene_start")
    hand_action(game_id, "scene_stand", player_id="p1")
    hand_action(game_id, "scene_dark_reveal")
    game = GAMES[game_id].state
    for pid, card in [("p1", "5H"), ("p2", "6C")]:
        zone = f"players.{pid}.{bonus}"
        assert game.zones[zone] == before.zones.get(zone, []) + [card]
    assert game.meta["scene"]["status"] == "awaiting_ack"
    reject(game_id, "scene_dark_reveal")


@pytest.mark.parametrize("available", [1, 3])
def test_multiple_jokers_atomic_failure_retry_and_reload(game_id, tmp_path, available):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["RJ", "BJ", "8S"])
    initial = deepcopy(GAMES[game_id].state)
    prepare_waiting(game_id, difficulty="RJ", extras=("BJ",), player_card="8S")
    before = deepcopy(GAMES[game_id].state)
    path = tmp_path / "jokers.json"
    save_game_state(before, path)
    GAMES[game_id].state = load_game_state(path)
    assert GAMES[game_id].state == before
    for pid in ["p1", "p2"]:
        for bonus in ["scum", "vengeance"]:
            zone = f"players.{pid}.{bonus}"
            assert before.zones.get(zone, []) == initial.zones.get(zone, [])
    cards = ["2D", "3D", "4D", "5D"]
    GAMES[game_id].state = _with_exact_draw_pile(before, cards[:available])
    reject(game_id, "scene_dark_reveal", match="draw_pile is empty")
    failed = GAMES[game_id].state
    assert failed.meta["scene"]["dark"]["revealed"] is False
    assert failed.meta["scene"]["status"] == "active"
    assert not failed.meta["scene"]["resolution"]["completed"]
    validate_game_state(failed)
    GAMES[game_id].state = _with_draw_order(failed, cards)
    hand_action(game_id, "scene_dark_reveal")
    game = GAMES[game_id].state
    for pid, scum, vengeance in [("p1", "2D", "4D"), ("p2", "3D", "5D")]:
        assert game.zones[f"players.{pid}.scum"] == before.zones.get(f"players.{pid}.scum", []) + [scum]
        assert game.zones[f"players.{pid}.vengeance"] == before.zones.get(f"players.{pid}.vengeance", []) + [vengeance]
    save_game_state(game, path)
    GAMES[game_id].state = load_game_state(path)
    assert GAMES[game_id].state == game
    reject(game_id, "scene_dark_reveal")
    validate_game_state(GAMES[game_id].state)


@pytest.mark.parametrize("joker", ["RJ", "BJ"])
def test_discarded_dark_joker_has_no_reveal_effect(game_id, joker):
    prepare_waiting(game_id, extras=(joker,))
    # A zero-value Joker cannot naturally bust. Construct the discard-required
    # flag to exercise physical-hand exclusion without changing the legal rules.
    GAMES[game_id].state.meta["scene"]["dark"]["must_discard_last"] = True
    hand_action(game_id, "scene_dark_discard_last")
    before = deepcopy(GAMES[game_id].state)
    assert joker in before.deck.discard_pile
    hand_action(game_id, "scene_dark_reveal")
    assert GAMES[game_id].state.zones == before.zones
    assert GAMES[game_id].state.deck == before.deck


@pytest.mark.parametrize("eligibility", ["dead", "no_character"])
def test_reveal_preserves_joker_eligibility(game_id, eligibility):
    prepare_waiting(game_id, difficulty="RJ", extras=())
    game = GAMES[game_id].state
    if eligibility == "dead":
        game.meta["players"]["p2"]["wounds"] = 2
    else:
        game = _replace_zone_cards(game, "players.p2.character", [])
    before = deepcopy(game)
    GAMES[game_id].state = _with_draw_order(game, ["5H", "6C"])
    hand_action(game_id, "scene_dark_reveal")
    assert GAMES[game_id].state.zones["players.p1.scum"] == before.zones["players.p1.scum"] + ["5H"]
    assert GAMES[game_id].state.zones["players.p2.scum"] == before.zones["players.p2.scum"]


@pytest.mark.parametrize("joker,bonus", [("RJ", "scum"), ("BJ", "vengeance")])
@pytest.mark.parametrize("initial", [True, False])
def test_player_joker_stays_immediate_in_unrevealed_dark(game_id, joker, bonus, initial):
    prepare_hand(game_id, ["2H", *([joker] if initial else ["3S", joker]), "5H"])
    before = deepcopy(GAMES[game_id].state)
    hand_action(game_id, "scene_start")
    if not initial:
        hand_action(game_id, "scene_draw_card", player_id="p1")
    game = GAMES[game_id].state
    assert joker in game.zones["scene.hand.p1"]
    assert not game.meta["scene"]["dark"]["revealed"]
    assert game.zones[f"players.p1.{bonus}"] == before.zones[f"players.p1.{bonus}"] + ["5H"]
    assert game.zones[f"players.p2.{bonus}"] == before.zones[f"players.p2.{bonus}"]


def test_resolution_failure_rolls_back_reveal_bonus_grants(game_id, monkeypatch):
    import backend.engine.rules.grim_fronteira.scene as engine

    prepare_waiting(game_id, difficulty="RJ", extras=("BJ",))
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2D", "3D", "4D", "5D"])
    def fail(game, **kwargs):
        assert game.meta["scene"]["dark"]["revealed"]
        assert game.zones["players.p1.scum"][-1] == "2D"
        assert game.zones["players.p2.vengeance"][-1] == "5D"
        raise ValueError("forced resolution failure after grants")
    monkeypatch.setattr(engine, "scene_resolve", fail)
    reject(game_id, "scene_dark_reveal", match="forced resolution failure after grants")
    validate_game_state(GAMES[game_id].state)


@pytest.mark.parametrize("rewards,chosen,remaining", [
    (["7D", "5D", "6H"], "5D", ["7D", "6H"]),
    (["6H", "5D", "5H", "7D"], "5D", ["6H", "5H", "7D"]),
    (["6H", "5H", "5D", "7D"], "5H", ["6H", "5D", "7D"]),
])
def test_force_dark_loss_selection_conservation_and_progression(game_id, rewards, chosen, remaining):
    from backend.engine.state.validators import validate_unique_cards, validate_card_conservation
    closed_loser(game_id, rewards)
    hand_action(game_id, "scene_skip_heal", player_id="p1")
    reject(game_id, "scene_new")
    before = deepcopy(GAMES[game_id].state)
    response = dispatch(game_id, "scene_force_discard_dark_reward", player_id="p1")
    game = GAMES[game_id].state
    assert response.result == {"ok": True, "action": "gf.scene_force_discard_dark_reward",
                               "player_id": "p1", "reward_card_id": chosen,
                               "remaining_reward_points": sum(int(c[:-1]) for c in remaining)}
    assert game.zones["players.p1.rewards"] == remaining
    assert game.deck.discard_pile == before.deck.discard_pile + [chosen]
    assert not game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    validate_card_conservation(game)
    validate_unique_cards(game)
    hand_action(game_id, "scene_new")


@pytest.mark.parametrize("case", ["actor", "phase", "active", "awaiting_ack", "resolved", "participant", "pending", "empty", "interaction", "actor_type", "player_type"])
def test_force_dark_loss_rejects_atomically(game_id, case):
    closed_loser(game_id, ["5D"])
    game = GAMES[game_id].state
    params = {"player_id": "p1"}
    if case == "actor": params["actor_id"] = "p2"
    elif case == "phase": game.meta["phase"] = "lobby"
    elif case in {"active", "awaiting_ack", "resolved"}: game.meta["scene"]["status"] = case
    elif case == "participant": params["player_id"] = "p2"
    elif case == "pending": game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"] = False
    elif case == "empty": set_rewards(game_id, [])
    elif case == "actor_type": params["actor_id"] = 1
    elif case == "player_type": params["player_id"] = 1
    elif case == "interaction":
        GAMES[game_id].state = begin_pending_interaction(game, {
            "kind": "test", "actor_id": "p1", "allowed_actions": ["gf.debug_resolve_pending"],
            "payload": {}, "continuation": None,
        })
    reject(game_id, "scene_force_discard_dark_reward", **params)


def test_force_dark_loss_rechecks_victory(game_id):
    prepare_waiting(game_id)
    set_rewards(game_id, ["5D"])
    set_rewards(game_id, ["10H", "AH"], player_id="p2")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    assert GAMES[game_id].state.meta["phase"] == "table"
    dispatch(game_id, "scene_force_discard_dark_reward", player_id="p1")
    assert GAMES[game_id].state.meta["phase"] == "victory"
    assert GAMES[game_id].state.meta["victory"]["winner"] == "p2"


def test_reward_exhaustion_waits_for_dark_loss_and_survives_reload(game_id, tmp_path):
    dispatch(game_id, "scene_set_participants", participant_ids=["p1", "p2"])
    prepare_hand(game_id, ["2H", "3C", "4D", "9S", "8S"])
    hand_action(game_id)
    hand_action(game_id)
    dispatch(game_id, "scene_start")
    dispatch(game_id, "scene_stand", player_id="p1")
    dispatch(game_id, "scene_stand", player_id="p2")
    set_rewards(game_id, ["10C", "10D"], player_id="p2")
    hand_action(game_id, "scene_dark_reveal")
    finish_acknowledgements(game_id)
    GAMES[game_id].state = _with_exact_draw_pile(GAMES[game_id].state, ["10H", "7H"])
    hand_action(game_id, "scene_close")
    game = GAMES[game_id].state
    assert game.deck.draw_pile == []
    assert game.meta["scene"]["deck_exhausted"] is True
    assert game.meta["scene"]["deck_exhausted_participants"] == ["p1", "p2"]
    assert game.zones["players.p1.rewards"] == ["10H", "7H"]
    assert game.meta["scene"]["players"]["p2"]["dark_reward_loss_pending"]
    assert game.meta["phase"] == "table"
    assert "victory" not in game.meta
    reject(game_id, "scene_new")
    path = tmp_path / "exhausted-dark-loss.json"
    save_game_state(game, path)
    GAMES[game_id].state = load_game_state(path)
    hand_action(game_id, "scene_discard_dark_reward", player_id="p2", reward_card_id="10D")
    game = GAMES[game_id].state
    assert not game.meta["scene"]["players"]["p2"]["dark_reward_loss_pending"]
    assert game.meta["phase"] == "victory"
    assert game.meta["victory"]["winner"] == "p1"
    assert game.meta["victory"]["reason"] == "Won with the most reward points after the deck was exhausted."
