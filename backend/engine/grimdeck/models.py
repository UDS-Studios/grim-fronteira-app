from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, TypedDict

CardID = str
TopOfDeck = Literal["last", "first"]


class DeckSettings(TypedDict):
    top_of_deck: TopOfDeck
    include_jokers: bool
    deck_size: int


@dataclass(frozen=True)
class DeckState:
    version: int = 1
    schema: str = "grimfronteira.deckstate"
    created_utc: str | None = None
    notes: str = ""
    settings: DeckSettings | None = None

    draw_pile: List[CardID] = field(default_factory=list)    # bottom -> top
    in_play: List[CardID] = field(default_factory=list)
    discard_pile: List[CardID] = field(default_factory=list)
    removed: List[CardID] = field(default_factory=list)