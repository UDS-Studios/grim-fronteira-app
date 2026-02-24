from __future__ import annotations

from dataclasses import replace

from backend.engine.grimdeck.deck_ops import play
from backend.engine.state.game_state import GameState
from backend.engine.state.zone_ops import claim_from_in_play
from backend.engine.state.validators import validate_unique_cards

RANK_VALUE = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
    "J": 10, "Q": 10, "K": 10, "A": 11,
}


def _rank(card_id: str) -> str:
    # Card IDs like "10H", "AS", "RJ", "BJ"
    if card_id in ("RJ", "BJ"):
        raise ValueError("Jokers are not supported in blackjack scoring.")
    return card_id[:-1]  # strip suit


def hand_value(cards: list[str]) -> int:
    # Aces count as 11, but can drop to 1 if bust
    ranks = [_rank(c) for c in cards]
    total = sum(RANK_VALUE[r] for r in ranks)
    aces = sum(1 for r in ranks if r == "A")
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1
    return total


def is_bust(cards: list[str]) -> bool:
    return hand_value(cards) > 21


def _draw_to_zone(game: GameState, zone: str) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    # 1) play -> card goes to deck.in_play
    new_deck = play(game.deck)
    game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)

    # 2) claim from in_play -> into zone
    card = game.deck.in_play[-1]
    game = claim_from_in_play(game, card, zone)

    validate_unique_cards(game)
    return game


def deal(game: GameState) -> GameState:
    """
    Deal 2 cards to player and 2 to dealer (alternating, like a real deal).
    Creates zones if missing.
    """
    game = GameState(
        deck=game.deck,
        zones=game.zones,
        meta={**game.meta, "game": "blackjack", "phase": "player_turn"},
    )

    for zone in ("hands.player", "hands.dealer", "hands.player", "hands.dealer"):
        game = _draw_to_zone(game, zone)

    return game


def hit(game: GameState, who: str = "player") -> GameState:
    if game.meta.get("phase") != "player_turn":
        raise ValueError("Cannot hit: not in player_turn phase.")

    zone = f"hands.{who}"

    if who == "player" and hand_value(game.zones.get(zone, [])) >= 21:
        raise ValueError("Cannot hit: player already has 21 (or bust).")

    game = _draw_to_zone(game, zone)

    if who == "player" and is_bust(game.zones.get(zone, [])):
        game = GameState(deck=game.deck, zones=game.zones, meta={**game.meta, "phase": "done", "outcome": "player_bust"})

    return game


def stand(game: GameState) -> GameState:
    if game.meta.get("phase") != "player_turn":
        raise ValueError("Cannot stand: not in player_turn phase.")

    game = GameState(deck=game.deck, zones=game.zones, meta={**game.meta, "phase": "dealer_turn"})

    dealer_zone = "hands.dealer"
    player_zone = "hands.player"

    while hand_value(game.zones.get(dealer_zone, [])) < 17:
        game = _draw_to_zone(game, dealer_zone)

    p = hand_value(game.zones.get(player_zone, []))
    d = hand_value(game.zones.get(dealer_zone, []))

    if d > 21:
        outcome = "dealer_bust"
    elif p > d:
        outcome = "player_win"
    elif p < d:
        outcome = "dealer_win"
    else:
        outcome = "push"

    game = GameState(deck=game.deck, zones=game.zones, meta={**game.meta, "phase": "done", "outcome": outcome})
    return game