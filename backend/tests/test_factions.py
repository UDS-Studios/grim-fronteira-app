from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.schemas import ActionRequest
from backend.app.store import GAMES, StoredGame
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.rules.grim_fronteira.factions import player_faction
from backend.engine.rules.grim_fronteira.scene import default_scene_state, ensure_scene_state
from backend.engine.state.game_state import GameState
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.engine.state.validators import validate_game_state

PAISA_ACTION = "gf.faction_paisa_claim_reward"
CRIOLLO_ACTION = "gf.faction_criollo_convert_resource"
SPEND = ["2H", "3H", "4H"]


def make_game(character="QC", status="resolved", rewards=None, top="5D"):
    deck = load_deck("data/templates/standard_54.json")
    zones = {"players.p1.character": [character], "players.p2.character": ["KS"],
             "players.p1.vengeance": [*SPEND, "5H", "6H", "7H"],
             "players.p1.scum": ["8D"], "players.p1.rewards": rewards or []}
    owned = {card for cards in zones.values() for card in cards}
    draw = [card for card in deck.draw_pile if card not in owned and card != top] + [top]
    scene = {**default_scene_state(), "status": status, "participants": ["p1", "p2"]}
    game = GameState(deck=replace(deck, draw_pile=draw), zones=zones, meta={
        "phase": "table", "marshal_id": "host", "players_order": ["host", "p1", "p2"],
        "players": {"p1": {"wounds": 0}, "p2": {"wounds": 0}},
        "scene": scene, "revision": 10,
    })
    validate_game_state(game)
    return game


@pytest.fixture(autouse=True)
def clear_store():
    GAMES.clear()
    yield
    GAMES.clear()


def install(game):
    GAMES["test"] = StoredGame(state=game)
    return game


def dispatch(name=PAISA_ACTION, **params):
    defaults = ({"player_id": "p1", "vengeance_card_ids": SPEND} if name == PAISA_ACTION else
                {"player_id": "p1", "card_id": "8D", "from_resource": "scum"} if name == CRIOLLO_ACTION else {})
    return main.action(ActionRequest(game_id="test", action=name, params={**defaults, **params}))


def rejected(name, **params):
    original = GAMES["test"].state
    snapshot = deepcopy(original)
    with pytest.raises((ValueError, HTTPException)):
        dispatch(name, **params)
    assert GAMES["test"].state is original
    assert original == snapshot


@pytest.mark.parametrize("card,faction", [("QD", "criollo"), ("QC", "paisa"), ("QH", "yankee"), ("QS", "chichimeca")])
def test_faction_from_character(card, faction):
    assert player_faction(make_game(character=card), "p1") == faction


@pytest.mark.parametrize("cards", [[], ["QC", "QD"], [None], ["invalidC"], ["RJ"], "QC"])
def test_malformed_character_rejected(cards):
    game = make_game()
    install(replace(game, zones={**game.zones, "players.p1.character": cards}))
    rejected(PAISA_ACTION)


@pytest.mark.parametrize("player", ["host", "stranger", "", None])
def test_unregistered_marshal_and_invalid_identity(player):
    install(make_game())
    rejected(PAISA_ACTION, player_id=player)


def test_paisa_exchange_selected_cards_and_repeat():
    original = install(make_game())
    snapshot = deepcopy(original)
    selected = ["7H", "2H", "5H"]
    result = dispatch(vengeance_card_ids=selected).result
    game = GAMES["test"].state
    assert result == {"ok": True, "action": PAISA_ACTION, "player_id": "p1",
                      "discarded_vengeance_card_ids": selected, "reward_card_id": "5D", "reward_points_total": 5}
    assert game.zones["players.p1.vengeance"] == ["3H", "4H", "6H"]
    assert game.deck.discard_pile == original.deck.discard_pile + selected
    assert all(game.deck.discard_pile.count(card) == 1 for card in selected)
    assert game.deck.draw_pile == original.deck.draw_pile[:-1]
    assert game.zones["players.p1.rewards"] == ["5D"]
    assert game.meta["revision"] == 11
    assert original == snapshot
    dispatch(vengeance_card_ids=["3H", "4H", "6H"])
    game = GAMES["test"].state
    assert game.zones["players.p1.vengeance"] == []
    assert len(game.zones["players.p1.rewards"]) == 2
    assert game.meta["revision"] == 12
    validate_game_state(game)


@pytest.mark.parametrize("cards", [["2H", "2H", "3H"], [], SPEND[:2], SPEND + ["5H"],
                                   ["2H", "3H", "8D"], ["2H", "3H", ""], [None, "2H", "3H"], None])
def test_invalid_paisa_selection(cards):
    install(make_game())
    rejected(PAISA_ACTION, vengeance_card_ids=cards)


@pytest.mark.parametrize("action,character", [(PAISA_ACTION, "QD"), (PAISA_ACTION, "QH"), (PAISA_ACTION, "QS"),
                                            (CRIOLLO_ACTION, "QC"), (CRIOLLO_ACTION, "QH"), (CRIOLLO_ACTION, "QS")])
def test_wrong_faction_cannot_be_overridden(action, character):
    install(make_game(character=character))
    rejected(action, faction="paisa" if action == PAISA_ACTION else "criollo")


@pytest.mark.parametrize("action,character", [(PAISA_ACTION, "QC"), (CRIOLLO_ACTION, "QD")])
@pytest.mark.parametrize("invalid", ["nonparticipant", "dead", "wrong_phase"])
def test_activation_rejections(action, character, invalid):
    game = make_game(character=character)
    meta = deepcopy(game.meta)
    if invalid == "nonparticipant":
        meta["scene"]["participants"] = ["p2"]
    elif invalid == "dead":
        meta["players"]["p1"]["wounds"] = 2
    else:
        meta["phase"] = "lobby"
    install(replace(game, meta=meta))
    rejected(action)


@pytest.mark.parametrize("status", ["idle", "setup", "active", "awaiting_ack", "closed"])
def test_paisa_wrong_status(status):
    install(make_game(status=status))
    rejected(PAISA_ACTION)


@pytest.mark.parametrize("failure", ["empty_deck", "insufficient"])
def test_paisa_impossible_exchange_is_atomic(failure):
    game = make_game()
    if failure == "empty_deck":
        game = replace(game, deck=replace(game.deck, draw_pile=[], discard_pile=game.deck.draw_pile))
    else:
        cards = game.zones["players.p1.vengeance"]
        game = replace(game, zones={**game.zones, "players.p1.vengeance": cards[:2]},
                       deck=replace(game.deck, discard_pile=cards[2:]))
    validate_game_state(game)
    install(game)
    rejected(PAISA_ACTION)


@pytest.mark.parametrize("source,card", [("scum", "8D"), ("vengeance", "3H")])
@pytest.mark.parametrize("status", ["setup", "active", "awaiting_ack", "resolved"])
def test_criollo_converts_once_without_playing(source, card, status):
    original = install(make_game(character="QD", status=status))
    snapshot = deepcopy(original)
    response = dispatch(CRIOLLO_ACTION, from_resource=source, card_id=card)
    game = GAMES["test"].state
    dest = "vengeance" if source == "scum" else "scum"
    assert response.result["to_resource"] == dest
    assert response.result["card_id"] == card
    assert response.result["from_resource"] == source
    assert response.result["player_id"] == "p1"
    assert card not in game.zones[f"players.p1.{source}"]
    assert game.zones[f"players.p1.{dest}"].count(card) == 1
    assert game.deck == original.deck
    assert game.meta["scene"]["status"] == status
    assert game.meta["scene"]["players"] == original.meta["scene"]["players"]
    assert game.meta["scene"]["faction_power_usage"] == {"p1": {"criollo": True}}
    assert response.revision == 11
    assert original == snapshot
    assert ensure_scene_state(game).meta["scene"]["faction_power_usage"] == {"p1": {"criollo": True}}
    rejected(CRIOLLO_ACTION, from_resource=dest, card_id=card)
    validate_game_state(game)


@pytest.mark.parametrize("status", ["idle", "closed"])
def test_criollo_wrong_status(status):
    install(make_game(character="QD", status=status))
    rejected(CRIOLLO_ACTION)


@pytest.mark.parametrize("params", [{"from_resource": "justice"}, {"from_resource": []}, {"from_resource": None},
                                   {"card_id": "2S"}, {"card_id": "3H"}, {"card_id": ""}, {"card_id": None}])
def test_criollo_invalid_request(params):
    install(make_game(character="QD"))
    rejected(CRIOLLO_ACTION, **params)


@pytest.mark.parametrize("action,character", [(PAISA_ACTION, "QC"), (CRIOLLO_ACTION, "QD")])
def test_pending_gate_blocks_before_engine(action, character, monkeypatch):
    game = begin_pending_interaction(make_game(character=character), {
        "kind": "debug_test", "actor_id": "p1", "allowed_actions": [], "payload": {}, "continuation": None,
    })
    install(game)
    def forbidden(*args, **kwargs):
        pytest.fail("Faction engine must not run while an unrelated interaction is pending")
    monkeypatch.setattr(main, "paisa_claim_reward", forbidden)
    monkeypatch.setattr(main, "criollo_convert_resource", forbidden)
    rejected(action)


def test_criollo_usage_survives_setup_edits_and_resets_with_new_scene():
    install(make_game(character="QD", status="setup"))
    dispatch(CRIOLLO_ACTION)
    dispatch("gf.scene_set_participants", actor_id="host", participant_ids=["p2"])
    dispatch("gf.scene_set_participants", actor_id="host", participant_ids=["p1", "p2"])
    dispatch("gf.scene_set_mode", actor_id="host", mode="standard")
    rejected(CRIOLLO_ACTION, from_resource="vengeance", card_id="8D")
    game = GAMES["test"].state
    install(replace(game, meta={**game.meta, "scene": {**game.meta["scene"], "status": "resolved"}}))
    dispatch("gf.scene_close", actor_id="host")
    dispatch("gf.scene_new", actor_id="host")
    assert GAMES["test"].state.meta["scene"]["faction_power_usage"] == {}
    dispatch("gf.scene_set_participants", actor_id="host", participant_ids=["p1", "p2"])
    dispatch(CRIOLLO_ACTION, from_resource="vengeance", card_id="8D")


def test_paisa_reward_reaches_21_through_normal_close():
    install(make_game(rewards=["10S"], top="AD"))
    response = dispatch()
    assert response.result["reward_points_total"] == 21
    assert GAMES["test"].state.meta["phase"] == "table"
    dispatch("gf.scene_close", actor_id="host")
    assert GAMES["test"].state.meta["victory"]["winner"] == "p1"
    assert GAMES["test"].state.meta["victory"]["reason"] == "Reached exactly 21 reward points."


def test_paisa_above_21_uses_existing_discard_pipeline():
    install(make_game(rewards=["10S", "9S"], top="5D"))
    dispatch()
    dispatch("gf.scene_close", actor_id="host")
    rejected("gf.scene_new", actor_id="host")
    dispatch("gf.scene_discard_reward", player_id="p1", reward_card_id="5D")
    dispatch("gf.scene_new", actor_id="host")
    assert GAMES["test"].state.meta["scene"]["status"] == "setup"


def test_sudden_death_new_scene_has_fresh_usage():
    game = make_game(character="QD", rewards=["10S", "AD"])
    game = replace(game, zones={**game.zones, "players.p2.rewards": ["10C", "AH"]},
                   deck=replace(game.deck, draw_pile=[c for c in game.deck.draw_pile if c not in {"10C", "AH"}]))
    install(game)
    dispatch(CRIOLLO_ACTION)
    dispatch("gf.scene_close", actor_id="host")
    assert GAMES["test"].state.meta["endgame"]["active"] is True
    dispatch("gf.scene_new", actor_id="host")
    assert GAMES["test"].state.meta["scene"]["duel"]["sudden_death"] is True
    assert GAMES["test"].state.meta["scene"]["faction_power_usage"] == {}
    dispatch(CRIOLLO_ACTION, from_resource="vengeance", card_id="8D")


def test_paisa_and_ordinary_scene_reward_combine_at_close():
    game = make_game(rewards=["6S"])
    draw = [c for c in game.deck.draw_pile if c not in {"10S", "5D"}] + ["10S", "5D"]
    scene = {**game.meta["scene"], "players": {"p1": {"reward_gained": True}}}
    install(replace(game, deck=replace(game.deck, draw_pile=draw), meta={**game.meta, "scene": scene}))
    assert dispatch().result["reward_points_total"] == 11
    dispatch("gf.scene_close", actor_id="host")
    game = GAMES["test"].state
    assert game.zones["players.p1.rewards"] == ["6S", "5D", "10S"]
    assert game.meta["victory"]["winner"] == "p1"


def test_criollo_out_of_turn_and_explicit_later_resource_play():
    game = make_game(character="QD", status="active")
    scene = {**game.meta["scene"], "participants": ["p2", "p1"], "players": {
        "p2": {"standing": False}, "p1": {"standing": False, "figure_card_id": "QD", "hand_value": 10},
    }}
    install(ensure_scene_state(replace(game, meta={**game.meta, "scene": scene})))
    dispatch(CRIOLLO_ACTION)
    game = GAMES["test"].state
    assert "scene.mod.vengeance.p1" not in game.zones
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 10
    scene = deepcopy(game.meta["scene"])
    scene["players"]["p2"]["standing"] = True
    install(replace(game, meta={**game.meta, "scene": scene}))
    response = dispatch("gf.scene_play_vengeance", player_id="p1")
    assert response.result["vengeance_card_id"] == "8D"
    assert GAMES["test"].state.zones["scene.mod.vengeance.p1"] == ["8D"]
    rejected(CRIOLLO_ACTION, from_resource="vengeance", card_id="3H")


def test_criollo_awaiting_ack_preserves_existing_acknowledgements():
    game = make_game(character="QD", status="awaiting_ack")
    scene = {**game.meta["scene"], "players": {
        "p1": {"acknowledged": True, "standing": True, "hand_value": 18},
        "p2": {"acknowledged": False, "standing": True, "hand_value": 15},
    }}
    original = install(ensure_scene_state(replace(game, meta={**game.meta, "scene": scene})))
    dispatch(CRIOLLO_ACTION)
    assert GAMES["test"].state.meta["scene"]["players"] == original.meta["scene"]["players"]
    assert GAMES["test"].state.meta["scene"]["status"] == "awaiting_ack"
