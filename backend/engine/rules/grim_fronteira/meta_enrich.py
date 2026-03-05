from __future__ import annotations

from backend.engine.state.game_state import GameState
from backend.engine.rules.grim_fronteira.reward_points import compute_reward_points


def enrich_meta_for_ui(game: GameState) -> GameState:
    """
    Ensures:
      meta.scene exists with expected keys
      meta.players.<pid>.reward_points exists
    """
    meta = dict(game.meta or {})

    # scene structure (do not overwrite if already there)
    scene = dict(meta.get("scene") or {})
    scene.setdefault("difficulty_rule", meta.get("scene.difficulty_rule"))
    scene.setdefault("difficulty_base", meta.get("scene.difficulty_base"))
    scene.setdefault("difficulty_value", meta.get("scene.difficulty_value"))
    scene.setdefault("dark_mode", bool(meta.get("scene.dark_mode", False)))
    meta["scene"] = scene

    # players reward points
    players = dict(meta.get("players") or {})
    rp = compute_reward_points(game)
    for pid, pts in rp.items():
        pdata = dict(players.get(pid) or {})
        pdata["reward_points"] = int(pts)
        players[pid] = pdata
    meta["players"] = players

    return GameState(deck=game.deck, zones=game.zones, meta=meta)