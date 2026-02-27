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
    
def validate_card_conservation(
    state: GameState,
    *,
    expected_total: int | None = None,
    enforce_unique: bool = True,
) -> None:
    """
    Ensures total number of cards across deck piles + all zones
    equals expected_total.

    This catches lost-card or extra-card bugs.

    If expected_total is None:
        - try state.deck.settings["deck_size"]
        - fallback to 54
    """
    if state.deck is None:
        raise ValueError("GameState has no deck.")

    if enforce_unique:
        validate_unique_cards(state)

    cards = _all_cards(state)
    total = len(cards)

    if expected_total is None:
        settings = state.deck.settings or {}
        if isinstance(settings, dict) and "deck_size" in settings:
            try:
                expected_total = int(settings["deck_size"])
            except Exception:
                expected_total = 54
        else:
            expected_total = 54

    if total == expected_total:
        return

    # helpful breakdown
    breakdown = {
        "draw_pile": len(state.deck.draw_pile),
        "in_play": len(state.deck.in_play),
        "discard_pile": len(state.deck.discard_pile),
        "removed": len(state.deck.removed),
        **{f"zone:{k}": len(v) for k, v in state.zones.items()},
    }

    raise ValueError(
        f"Card conservation failed: expected {expected_total}, found {total}. "
        f"Breakdown: {breakdown}"
    )

def validate_game_state(
    state: GameState,
    *,
    expected_total: int | None = None,
) -> None:
    """
    Convenience wrapper: enforce both invariants.

    - Uniqueness: no card appears in multiple places.
    - Conservation: total cards matches expected_total (or inferred).
    """
    validate_unique_cards(state)
    validate_card_conservation(state, expected_total=expected_total, enforce_unique=False)