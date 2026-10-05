from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from backend.engine.grimdeck.models import CardID
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_unique_cards


DIFFICULTY_ZONE = "scene.difficulty.cards"
RULE_ID = "base10_plus_1card_v1"


@dataclass(frozen=True)
class DifficultyEffect:
    # Keep it simple: frontend wants strings
    kind: str


@dataclass(frozen=True)
class DifficultyResult:
    rule_id: str
    base: int
    value: int
    drawn_cards: List[CardID]
    effects: List[DifficultyEffect]


def _rank(card_id: CardID) -> str:
    # "10H" -> "10", "AS" -> "A", "QH" -> "Q", "RJ" -> "RJ"
    if card_id in ("RJ", "BJ"):
        return card_id
    return card_id[:-1]


def _difficulty_card_points(card_id: CardID) -> int:
    """
    v1.2 rule alignment:
      base difficulty = 10
      numbered card -> add face value
      J/Q/K -> add 10  (so total is 20)
      Joker -> add 10  (so total is 20)
      Ace -> add 11    (so total is 21)
    """
    r = _rank(card_id)
    if r in ("RJ", "BJ"):
        return 10
    if r in ("J", "Q", "K"):
        return 10
    if r == "A":
        return 11
    # number card
    return int(r)


def _bump_scene_meta(game: GameState, *, base: int, value: int, rule_id: str) -> GameState:
    meta = dict(game.meta or {})
    scene = dict(meta.get("scene") or {})
    scene.update(
        {
            "difficulty_rule": rule_id,
            "difficulty_base": base,
            "difficulty_value": value,
        }
    )
    meta["scene"] = scene

    # Back-compat: keep old flat keys if you already used them
    meta["scene.difficulty_rule"] = rule_id
    meta["scene.difficulty_base"] = base
    meta["scene.difficulty_value"] = value

    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def marshal_roll_difficulty(
    game: GameState,
    *,
    player_ids: Optional[list[str]] = None,  # kept for signature compatibility
    seed: int | None = None,
    base: int = 10,
    zone_name: str = DIFFICULTY_ZONE,
) -> tuple[GameState, DifficultyResult]:
    """
    Draw 1 card for scene difficulty and store it in `scene.difficulty.cards`.

    v1.2 updates:
      - Joker difficulty = 20 (base 10 + 10)
      - Joker bonuses are handled by the scene action.
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    # Import locally because scene actions also import this difficulty helper.
    from .scene import _draw_to_zone

    game, card_id = _draw_to_zone(game, zone_name)

    points = _difficulty_card_points(card_id)
    value = base + points

    effects: list[DifficultyEffect] = []
    # Only difficulty metadata belongs to this draw; Dark is explicitly declared.
    game = _bump_scene_meta(game, base=base, value=value, rule_id=RULE_ID)

    validate_unique_cards(game)

    return game, DifficultyResult(
        rule_id=RULE_ID,
        base=base,
        value=value,
        drawn_cards=[card_id],
        effects=effects,
    )
