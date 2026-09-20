"""Synchronous faction powers, with identity derived only from character ownership."""
from dataclasses import replace
from typing import Any

from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_game_state
from .reward_points import reward_card_points
from .scene import (
    _draw_to_zone, _non_marshal_players, _player_is_dead,
    _require_table_phase, _scene, _replace_scene,
    SCENE_STATUS_SETUP, SCENE_STATUS_ACTIVE, SCENE_STATUS_AWAITING_ACK,
    SCENE_STATUS_RESOLVED,
)

CRIOLLO = "criollo"
PAISA = "paisa"
YANKEE = "yankee"
CHICHIMECA = "chichimeca"
_FACTION_BY_SUIT = {"D": CRIOLLO, "C": PAISA, "H": YANKEE, "S": CHICHIMECA}


def player_faction(game: GameState, player_id: str) -> str:
    if not isinstance(player_id, str) or not player_id.strip() or player_id not in _non_marshal_players(game):
        raise ValueError("Faction powers require a registered non-Marshal player.")
    cards = game.zones.get(f"players.{player_id}.character", [])
    if not isinstance(cards, list) or len(cards) != 1:
        raise ValueError("Player must own exactly one character card.")
    card = cards[0]
    if (not isinstance(card, str) or card[:-1] not in {"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"}
            or card[-1:] not in _FACTION_BY_SUIT):
        raise ValueError("Invalid character card for faction identification.")
    return _FACTION_BY_SUIT[card[-1]]


def require_faction(game: GameState, player_id: str, expected_faction: str) -> None:
    if player_faction(game, player_id) != expected_faction:
        raise ValueError(f"This power requires a {expected_faction} character.")
    if _player_is_dead(game, player_id):
        raise ValueError("Dead characters cannot use faction powers.")


def _activation_scene(game: GameState, player_id: str, faction: str, statuses: set[str]) -> dict[str, Any]:
    _require_table_phase(game)
    require_faction(game, player_id, faction)
    scene = _scene(game)
    if scene["status"] not in statuses:
        raise ValueError("Faction power is unavailable in this scene status.")
    if player_id not in scene["participants"]:
        raise ValueError("Only current scene participants can use faction powers.")
    return scene


def paisa_claim_reward(game: GameState, *, player_id: str, vengeance_card_ids: list[str]) -> tuple[GameState, dict[str, Any]]:
    _activation_scene(game, player_id, PAISA, {SCENE_STATUS_RESOLVED})
    if (not isinstance(vengeance_card_ids, list) or len(vengeance_card_ids) != 3
            or any(not isinstance(card, str) or not card.strip() for card in vengeance_card_ids)
            or len(set(vengeance_card_ids)) != 3):
        raise ValueError("Choose exactly three distinct non-empty Vengeance card IDs.")
    source = f"players.{player_id}.vengeance"
    if any(card not in game.zones.get(source, []) for card in vengeance_card_ids):
        raise ValueError("Selected cards must belong to the player's Vengeance zone.")
    if game.deck is None or not game.deck.draw_pile:
        raise ValueError("Cannot claim Reward: draw_pile is empty.")
    selected = set(vengeance_card_ids)
    zones = {**game.zones, source: [card for card in game.zones[source] if card not in selected]}
    deck = replace(game.deck, discard_pile=[*game.deck.discard_pile, *vengeance_card_ids])
    derived = replace(game, deck=deck, zones=zones)
    derived, reward = _draw_to_zone(derived, f"players.{player_id}.rewards")
    validate_game_state(derived)
    return derived, {
        "player_id": player_id,
        "discarded_vengeance_card_ids": list(vengeance_card_ids),
        "reward_card_id": reward,
        "reward_points_total": sum(reward_card_points(c) for c in derived.zones[f"players.{player_id}.rewards"]),
    }


def criollo_convert_resource(game: GameState, *, player_id: str, card_id: str, from_resource: str) -> tuple[GameState, dict[str, Any]]:
    scene = _activation_scene(game, player_id, CRIOLLO, {
        SCENE_STATUS_SETUP, SCENE_STATUS_ACTIVE, SCENE_STATUS_AWAITING_ACK, SCENE_STATUS_RESOLVED,
    })
    usage = scene["faction_power_usage"]
    if usage.get(player_id, {}).get(CRIOLLO):
        raise ValueError("Criollo power has already been used this scene.")
    if not isinstance(from_resource, str) or from_resource not in {"scum", "vengeance"}:
        raise ValueError("from_resource must be scum or vengeance.")
    if not isinstance(card_id, str) or not card_id.strip():
        raise ValueError("card_id must be a non-empty string.")
    to_resource = "vengeance" if from_resource == "scum" else "scum"
    source, destination = (f"players.{player_id}.{resource}" for resource in (from_resource, to_resource))
    source_cards = list(game.zones.get(source, []))
    if card_id not in source_cards:
        raise ValueError("Card must belong to the player's stated resource zone.")
    source_cards.remove(card_id)
    zones = {**game.zones, source: source_cards, destination: [*game.zones.get(destination, []), card_id]}
    scene["faction_power_usage"] = {**usage, player_id: {**usage.get(player_id, {}), CRIOLLO: True}}
    derived = _replace_scene(game, scene=scene, zones=zones)
    validate_game_state(derived)
    return derived, {"player_id": player_id, "card_id": card_id,
                     "from_resource": from_resource, "to_resource": to_resource}
