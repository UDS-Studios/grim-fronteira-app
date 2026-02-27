# backend/engine/rules/grim_fronteira/scene_difficulty.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Protocol, Tuple

from backend.engine.grimdeck.deck_ops import play
from backend.engine.grimdeck.models import CardID
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_unique_cards
from backend.engine.state.zone_ops import claim_from_in_play


DIFFICULTY_CARDS_ZONE = "scene.difficulty.cards"


# ----------------------------
# Data model
# ----------------------------

@dataclass(frozen=True)
class DifficultyEffect:
    """
    A minimal effect model for difficulty side-effects.
    For now, only supports granting Scum/Vengeance to all listed players.
    """
    kind: str  # "grant_scum_all" | "grant_vengeance_all"
    amount: int = 1


@dataclass(frozen=True)
class DifficultyResult:
    rule_id: str
    base: int
    value: int
    drawn_cards: List[CardID]
    effects: List[DifficultyEffect]


class DifficultyPolicy(Protocol):
    rule_id: str

    def roll(
        self,
        game: GameState,
        *,
        player_ids: List[str],
        seed: int | None = None,
        difficulty_cards_zone: str = DIFFICULTY_CARDS_ZONE,
    ) -> Tuple[GameState, DifficultyResult]:
        ...


# ----------------------------
# Internal helpers
# ----------------------------

def _zones_copy(zones: Dict[str, List[CardID]]) -> Dict[str, List[CardID]]:
    return {k: v.copy() for k, v in zones.items()}


def _ensure_zone(zones: Dict[str, List[CardID]], zone_name: str) -> None:
    if zone_name not in zones:
        zones[zone_name] = []


def _rank(card_id: CardID) -> str:
    # Card IDs like "10H", "AS", "RJ", "BJ"
    if card_id in ("RJ", "BJ"):
        return card_id
    return card_id[:-1]


def _difficulty_card_value(card_id: CardID) -> int:
    """
    Value mapping for difficulty (website rule):
    - Numbered cards: face value
    - Face cards J/Q/K: 10
    - Ace: 11
    - Jokers: handled by policy (special case)
    """
    r = _rank(card_id)

    if r in ("RJ", "BJ"):
        raise ValueError("Jokers are not valued here; policy must handle jokers explicitly.")

    if r in ("J", "Q", "K"):
        return 10
    if r == "A":
        return 11
    # numeric ranks
    return int(r)


def _draw_1_to_zone(game: GameState, dest_zone: str) -> GameState:
    """
    Draw 1 card from main deck top to a zone via staging:
    play() -> deck.in_play
    claim_from_in_play() -> zone
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    # play top card into deck.in_play
    new_deck = play(game.deck)
    game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)

    # move that card into destination zone
    card_id = game.deck.in_play[-1]
    game = claim_from_in_play(game, card_id, dest_zone)

    validate_unique_cards(game)
    return game


def _draw_n_to_zone(game: GameState, dest_zone: str, n: int) -> GameState:
    if n < 0:
        raise ValueError("n must be >= 0")
    for _ in range(n):
        game = _draw_1_to_zone(game, dest_zone)
    return game


def _apply_effects(game: GameState, player_ids: List[str], effects: List[DifficultyEffect]) -> GameState:
    """
    Applies difficulty side-effects by drawing normal cards into player piles.
    Assumption (consistent with your engine): Scum/Vengeance are *piles* of normal cards drawn from the deck.
    """
    if not effects:
        return game

    new_zones = _zones_copy(game.zones)
    for pid in player_ids:
        _ensure_zone(new_zones, f"players.{pid}.scum")
        _ensure_zone(new_zones, f"players.{pid}.vengeance")
        _ensure_zone(new_zones, f"players.{pid}.rewards")
    game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)

    for eff in effects:
        if eff.amount <= 0:
            continue

        if eff.kind == "grant_scum_all":
            for pid in player_ids:
                game = _draw_n_to_zone(game, f"players.{pid}.scum", eff.amount)

        elif eff.kind == "grant_vengeance_all":
            for pid in player_ids:
                game = _draw_n_to_zone(game, f"players.{pid}.vengeance", eff.amount)

        else:
            raise ValueError(f"Unknown DifficultyEffect kind: {eff.kind}")

    validate_unique_cards(game)
    return game


# ----------------------------
# Default policy (easy to swap)
# ----------------------------

@dataclass(frozen=True)
class Base10PlusOneCardPolicy:
    """
    Website rule:
      difficulty = 10 + value(one drawn card)
      if Joker drawn -> difficulty becomes 17 and ALL players gain:
        - Red Joker: +1 Scum
        - Black Joker: +1 Vengeance
    """
    rule_id: str = "base10_plus_1card_v1"
    base: int = 10
    joker_difficulty: int = 17
    joker_grant_amount: int = 1

    def roll(
        self,
        game: GameState,
        *,
        player_ids: List[str],
        seed: int | None = None,  # reserved for future variants; not used here
        difficulty_cards_zone: str = DIFFICULTY_CARDS_ZONE,
    ) -> Tuple[GameState, DifficultyResult]:
        if game.deck is None:
            raise ValueError("GameState has no deck.")
        if not player_ids:
            raise ValueError("player_ids must contain at least one player.")
        if len(set(player_ids)) != len(player_ids):
            raise ValueError("player_ids contains duplicates.")

        # Ensure difficulty zone exists/empty (fresh roll)
        new_zones = _zones_copy(game.zones)
        if difficulty_cards_zone in new_zones and len(new_zones[difficulty_cards_zone]) > 0:
            raise ValueError(f"Difficulty zone '{difficulty_cards_zone}' is not empty.")
        new_zones[difficulty_cards_zone] = []
        game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)

        # Draw 1 card into difficulty zone
        game = _draw_1_to_zone(game, difficulty_cards_zone)
        card = game.zones[difficulty_cards_zone][-1]

        effects: List[DifficultyEffect] = []

        # Joker special case
        if card == "RJ":
            value = self.joker_difficulty
            effects.append(DifficultyEffect(kind="grant_scum_all", amount=self.joker_grant_amount))
        elif card == "BJ":
            value = self.joker_difficulty
            effects.append(DifficultyEffect(kind="grant_vengeance_all", amount=self.joker_grant_amount))
        else:
            value = self.base + _difficulty_card_value(card)

        # Apply effects (draw normal cards into piles)
        game = _apply_effects(game, player_ids, effects)

        # Stamp meta (optional but handy for UI/debug)
        meta = {
            **game.meta,
            "scene.difficulty_rule": self.rule_id,
            "scene.difficulty_value": value,
            "scene.difficulty_base": self.base,
        }
        game = GameState(deck=game.deck, zones=game.zones, meta=meta)
        validate_unique_cards(game)

        result = DifficultyResult(
            rule_id=self.rule_id,
            base=self.base,
            value=value,
            drawn_cards=[card],
            effects=effects,
        )
        return game, result


# ----------------------------
# Marshal-facing helper
# ----------------------------

def marshal_roll_difficulty(
    game: GameState,
    *,
    player_ids: List[str],
    policy: DifficultyPolicy | None = None,
    seed: int | None = None,
    difficulty_cards_zone: str = DIFFICULTY_CARDS_ZONE,
) -> Tuple[GameState, DifficultyResult]:
    """
    Main entry point the Marshal uses.
    Swap `policy` later if UDS changes the rule.
    """
    pol = policy or Base10PlusOneCardPolicy()
    return pol.roll(game, player_ids=player_ids, seed=seed, difficulty_cards_zone=difficulty_cards_zone)