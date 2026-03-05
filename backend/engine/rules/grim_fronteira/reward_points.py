from __future__ import annotations

from typing import Dict, List, Set

from backend.engine.grimdeck.models import CardID
from backend.engine.state.game_state import GameState


def _rank(card_id: CardID) -> str:
    if card_id in ("RJ", "BJ"):
        return card_id
    return card_id[:-1]


def reward_card_points(card_id: CardID) -> int:
    """
    v1.2:
      number -> face value
      J/Q/K -> 10
      Ace -> 11
    Jokers shouldn't normally be rewards; treat as 0 to avoid crashes.
    """
    r = _rank(card_id)
    if r in ("RJ", "BJ"):
        return 0
    if r in ("J", "Q", "K"):
        return 10
    if r == "A":
        return 11
    return int(r)


def infer_player_ids(game: GameState) -> List[str]:
    # Prefer explicit setup list if present
    setup_players = (game.meta or {}).get("setup.players")
    if isinstance(setup_players, list) and all(isinstance(x, str) for x in setup_players):
        return setup_players

    # Otherwise infer from zones keys: "players.<pid>."
    pids: Set[str] = set()
    for k in (game.zones or {}).keys():
        if not k.startswith("players."):
            continue
        parts = k.split(".")
        if len(parts) >= 3:
            pids.add(parts[1])

    return sorted(pids)


def compute_reward_points(game: GameState) -> Dict[str, int]:
    points: Dict[str, int] = {}
    for pid in infer_player_ids(game):
        zone = f"players.{pid}.rewards"
        cards = game.zones.get(zone, [])
        if not isinstance(cards, list):
            continue
        points[pid] = sum(reward_card_points(c) for c in cards)
    return points