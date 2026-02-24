from __future__ import annotations
import random
from .models import DeckState


def play(state: DeckState) -> DeckState:
    if not state.draw_pile:
        raise ValueError("Cannot play: draw_pile is empty.")

    card = state.draw_pile[-1]

    return DeckState(
        version=state.version,
        schema=state.schema,
        created_utc=state.created_utc,
        notes=state.notes,
        settings=state.settings,
        draw_pile=state.draw_pile[:-1],
        in_play=state.in_play + [card],
        discard_pile=state.discard_pile,
        removed=state.removed,
    )

def discard(state: DeckState, card_id: str) -> DeckState:
    if card_id not in state.in_play:
        raise ValueError(f"Card {card_id} is not in play.")

    new_in_play = state.in_play.copy()
    new_in_play.remove(card_id)

    return DeckState(
        version=state.version,
        schema=state.schema,
        created_utc=state.created_utc,
        notes=state.notes,
        settings=state.settings,
        draw_pile=state.draw_pile,
        in_play=new_in_play,
        discard_pile=state.discard_pile + [card_id],
        removed=state.removed,
    )

def shuffle(state: DeckState, seed: int | None = None) -> DeckState:
    rng = random.Random(seed)
    new_draw = state.draw_pile.copy()
    rng.shuffle(new_draw)

    return DeckState(
        version=state.version,
        schema=state.schema,
        created_utc=state.created_utc,
        notes=state.notes,
        settings=state.settings,
        draw_pile=new_draw,
        in_play=state.in_play,
        discard_pile=state.discard_pile,
        removed=state.removed,
    )

def reset(state: DeckState, seed: int | None = None) -> DeckState:
    combined = (
        state.draw_pile +
        state.in_play +
        state.discard_pile
    )

    rng = random.Random(seed)
    rng.shuffle(combined)

    return DeckState(
        version=state.version,
        schema=state.schema,
        created_utc=state.created_utc,
        notes=state.notes,
        settings=state.settings,
        draw_pile=combined,
        in_play=[],
        discard_pile=[],
        removed=state.removed,
    )