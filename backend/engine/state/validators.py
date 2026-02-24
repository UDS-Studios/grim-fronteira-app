from __future__ import annotations

from collections import Counter
from typing import Iterable

from .game_state import GameState


def _all_cards(state: GameState) -> list[str]:
    if state.deck is None:
        raise ValueError("GameState has no deck.")

    cards: list[str] = []
    cards.extend(state.deck.draw_pile)
    cards.extend(state.deck.in_play)
    cards.extend(state.deck.discard_pile)
    cards.extend(state.deck.removed)

    for zone_name, zone_cards in state.zones.items():
        if not isinstance(zone_cards, list):
            raise ValueError(f"Zone '{zone_name}' must be a list of CardIDs.")
        cards.extend(zone_cards)

    return cards


def validate_unique_cards(state: GameState) -> None:
    """
    Ensures no card appears in more than one place across:
    deck piles + all zones.
    """
    cards = _all_cards(state)
    counts = Counter(cards)
    dupes = [card for card, n in counts.items() if n > 1]

    if dupes:
        # include a small, readable sample in the error
        sample = ", ".join(dupes[:10])
        more = "" if len(dupes) <= 10 else f" (+{len(dupes)-10} more)"
        raise ValueError(f"Duplicate cards detected: {sample}{more}")