from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
import random

from backend.engine.grimdeck.models import CardID, DeckState
from backend.engine.grimdeck.deck_ops import play
from backend.engine.state.game_state import GameState
from backend.engine.state.zone_ops import claim_from_in_play
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


def _zones_copy(zones: dict[str, list[CardID]]) -> dict[str, list[CardID]]:
    return {k: v.copy() for k, v in zones.items()}


def _ensure_zone(zones: dict[str, list[CardID]], name: str) -> None:
    if name not in zones:
        zones[name] = []


def _bump_scene_meta(game: GameState, *, base: int, value: int, rule_id: str, dark_mode: bool) -> GameState:
    meta = dict(game.meta or {})
    scene = dict(meta.get("scene") or {})
    scene.update(
        {
            "difficulty_rule": rule_id,
            "difficulty_base": base,
            "difficulty_value": value,
            "dark_mode": bool(dark_mode),
        }
    )
    meta["scene"] = scene

    # Back-compat: keep old flat keys if you already used them
    meta["scene.difficulty_rule"] = rule_id
    meta["scene.difficulty_base"] = base
    meta["scene.difficulty_value"] = value
    meta["scene.dark_mode"] = bool(dark_mode)

    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def _reshuffle_discard_into_draw(game: GameState, rng: random.Random) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    if not game.deck.discard_pile:
        return game

    merged = game.deck.draw_pile + game.deck.discard_pile
    rng.shuffle(merged)

    new_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=merged,
        in_play=game.deck.in_play,
        discard_pile=[],  # moved out
        removed=game.deck.removed,
    )

    new_game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)
    validate_unique_cards(new_game)
    return new_game


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
      - RJ -> reshuffle discard into draw (deterministic via seed)
      - BJ -> meta.scene.dark_mode = true
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    rng = random.Random(seed)

    # 1) play -> card to deck.in_play
    new_deck = play(game.deck)
    game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)

    # 2) move that card into difficulty zone
    card_id = game.deck.in_play[-1]
    new_zones = _zones_copy(game.zones)
    _ensure_zone(new_zones, zone_name)
    game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)
    game = claim_from_in_play(game, card_id, zone_name)

    points = _difficulty_card_points(card_id)
    value = base + points

    effects: list[DifficultyEffect] = []
    dark_mode = False

    # Joker effects
    if card_id == "RJ":
        effects.append(DifficultyEffect(kind="RESHUFFLE_DISCARD"))
        game = _reshuffle_discard_into_draw(game, rng)
    elif card_id == "BJ":
        effects.append(DifficultyEffect(kind="DARK_MODE"))
        dark_mode = True

    # Write scene meta (both structured + legacy keys)
    game = _bump_scene_meta(game, base=base, value=value, rule_id=RULE_ID, dark_mode=dark_mode)

    validate_unique_cards(game)

    return game, DifficultyResult(
        rule_id=RULE_ID,
        base=base,
        value=value,
        drawn_cards=[card_id],
        effects=effects,
    )