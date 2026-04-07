from __future__ import annotations

from backend.engine.grimdeck.models import DeckState

from .game_state import GameState
from .validators import validate_game_state


def stack_card_on_top(game: GameState, card_id: str) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    validate_game_state(game)

    draw_pile = list(game.deck.draw_pile)
    in_play = list(game.deck.in_play)
    discard_pile = list(game.deck.discard_pile)
    removed = list(game.deck.removed)
    zones = {name: list(cards) for name, cards in game.zones.items()}

    locations = [
        ("deck.draw_pile", draw_pile),
        ("deck.in_play", in_play),
        ("deck.discard_pile", discard_pile),
        ("deck.removed", removed),
        *((f"zone:{name}", cards) for name, cards in zones.items()),
    ]
    matches = [name for name, cards in locations if card_id in cards]

    if not matches:
        raise ValueError(f"Card {card_id} not found anywhere in game state.")
    if len(matches) > 1:
        raise ValueError(f"Card {card_id} appears multiple times in game state: {matches}")
    if draw_pile and draw_pile[-1] == card_id:
        return game

    for _name, cards in locations:
        if card_id in cards:
            cards.remove(card_id)
            break

    draw_pile.append(card_id)

    new_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=draw_pile,
        in_play=in_play,
        discard_pile=discard_pile,
        removed=removed,
    )
    new_game = GameState(
        version=game.version,
        schema=game.schema,
        deck=new_deck,
        zones=zones,
        meta=game.meta,
    )
    validate_game_state(new_game)
    return new_game
