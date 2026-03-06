from __future__ import annotations

from backend.engine.state.game_state import GameState
from backend.engine.rules.grim_fronteira.reward_points import compute_reward_points, infer_player_ids
from backend.engine.rules.grim_fronteira.lobby import FIGURE_POOL_ZONE


def enrich_meta_for_ui(game: GameState) -> GameState:
    """
    Ensures:
      meta.scene exists with expected keys
      meta.players.<pid>.reward_points exists
      meta.lobby.claimed_figures exists (derived, not duplicated in zones)
    """
    meta = dict(game.meta or {})

    # scene structure
    scene = dict(meta.get("scene") or {})
    scene.setdefault("difficulty_rule", meta.get("scene.difficulty_rule"))
    scene.setdefault("difficulty_base", meta.get("scene.difficulty_base"))
    scene.setdefault("difficulty_value", meta.get("scene.difficulty_value"))
    scene.setdefault("dark_mode", bool(meta.get("scene.dark_mode", False)))
    meta["scene"] = scene

    # players reward points
    players = dict(meta.get("players") or {})
    rp = compute_reward_points(game)
    for pid in infer_player_ids(game):
        pdata = dict(players.get(pid) or {})
        pdata["reward_points"] = int(rp.get(pid, 0))
        players[pid] = pdata
    meta["players"] = players

    # lobby derived state
    lobby = dict(meta.get("lobby") or {})
    claimed = {}
    for pid in infer_player_ids(game):
        cards = game.zones.get(f"players.{pid}.character", [])
        if isinstance(cards, list) and len(cards) == 1:
            claimed[pid] = cards[0]

    lobby["claimed_figures"] = claimed
    lobby["available_figures_count"] = len(game.zones.get(FIGURE_POOL_ZONE, []))
    meta["lobby"] = lobby

    return GameState(deck=game.deck, zones=game.zones, meta=meta)