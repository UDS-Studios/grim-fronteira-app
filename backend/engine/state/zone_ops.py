from __future__ import annotations

from typing import List

from backend.engine.grimdeck.models import CardID
from backend.engine.grimdeck.models import DeckState
from .game_state import GameState


def claim_from_in_play(
    state: GameState,
    card_id: CardID,
    zone_name: str,
) -> GameState:

    if state.deck is None:
        raise ValueError("GameState has no deck.")

    if card_id not in state.deck.in_play:
        raise ValueError(f"Card {card_id} not in deck.in_play.")

    # Remove from deck.in_play
    new_in_play = state.deck.in_play.copy()
    new_in_play.remove(card_id)

    new_deck = DeckState(
        version=state.deck.version,
        schema=state.deck.schema,
        created_utc=state.deck.created_utc,
        notes=state.deck.notes,
        settings=state.deck.settings,
        draw_pile=state.deck.draw_pile,
        in_play=new_in_play,
        discard_pile=state.deck.discard_pile,
        removed=state.deck.removed,
    )

    # Add to zone
    new_zones = {k: v.copy() for k, v in state.zones.items()}
    if zone_name not in new_zones:
        new_zones[zone_name] = []

    new_zones[zone_name].append(card_id)

    return GameState(
        version=state.version,
        schema=state.schema,
        deck=new_deck,
        zones=new_zones,
        meta=state.meta,
    )