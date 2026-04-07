from __future__ import annotations

from backend.engine.state.game_state import GameState
from backend.engine.rules.grim_fronteira.reward_points import compute_reward_points, infer_player_ids
from backend.engine.rules.grim_fronteira.lobby import FIGURE_POOL_ZONE
from backend.engine.rules.grim_fronteira.scene import default_scene_state

def _compute_all_players_ready(game: GameState, meta: dict) -> bool:
    marshal_id = meta.get("marshal_id")
    order = meta.get("players_order") or []
    lobby = dict(meta.get("lobby") or {})
    lobby_players = dict(lobby.get("players") or {})

    non_marshal = [pid for pid in order if pid != marshal_id]

    # If no non-marshal players are registered, allow start
    if not non_marshal:
        return True

    for pid in non_marshal:
        pstate = lobby_players.get(pid) or {}
        if not pstate.get("ready", False):
            return False

    return True

def enrich_meta_for_ui(game: GameState) -> GameState:
    """
    Ensures:
      meta.scene exists with expected keys
      meta.players.<pid>.reward_points exists
      meta.lobby.claimed_figures exists (derived, not duplicated in zones)
    """
    meta = dict(game.meta or {})

    # scene structure
    scene = dict(default_scene_state())
    scene_in = dict(meta.get("scene") or {})
    duel_in = dict(scene_in.get("duel") or {})
    difficulty_in = dict(scene_in.get("difficulty") or {})
    azzardo_in = dict(scene_in.get("azzardo") or {})
    resolution_in = dict(scene_in.get("resolution") or {})

    scene["status"] = scene_in.get("status", scene["status"])
    scene["mode"] = scene_in.get("mode", scene["mode"])
    scene["duel"] = {
        "subtype": duel_in.get("subtype", scene["duel"]["subtype"]),
        "sudden_death": bool(duel_in.get("sudden_death", scene["duel"]["sudden_death"])),
    }
    scene["participants"] = [pid for pid in scene_in.get("participants", []) if isinstance(pid, str)]
    scene["deck_exhausted"] = bool(scene_in.get("deck_exhausted", scene["deck_exhausted"]))
    scene["deck_exhausted_participants"] = [
        pid for pid in scene_in.get("deck_exhausted_participants", []) if isinstance(pid, str)
    ]
    scene["dark_mode"] = bool(scene_in.get("dark_mode", scene["dark_mode"]))
    scene["bonus_assignments"] = {
        pid: bonus
        for pid, bonus in dict(scene_in.get("bonus_assignments") or {}).items()
        if isinstance(pid, str) and bonus in {"scum", "vengeance"}
    }
    scene["difficulty"] = {
        "rule_id": difficulty_in.get("rule_id"),
        "base": difficulty_in.get("base"),
        "card_id": difficulty_in.get("card_id"),
        "value": difficulty_in.get("value"),
    }
    scene["azzardo"] = {
        "status": azzardo_in.get("status", scene["azzardo"]["status"]),
        "card_id": azzardo_in.get("card_id"),
        "value": azzardo_in.get("value"),
        "revealed": bool(azzardo_in.get("revealed", scene["azzardo"]["revealed"])),
    }
    scene["players"] = {
        pid: dict(pstate or {})
        for pid, pstate in dict(scene_in.get("players") or {}).items()
        if isinstance(pid, str)
    }
    scene["resolution"] = {
        "completed": bool(resolution_in.get("completed", scene["resolution"]["completed"])),
        "winners": [pid for pid in resolution_in.get("winners", []) if isinstance(pid, str)],
        "losers": [pid for pid in resolution_in.get("losers", []) if isinstance(pid, str)],
        "message": resolution_in.get("message") if isinstance(resolution_in.get("message"), str) else None,
    }
    meta["scene"] = scene

    # players reward points
    players = dict(meta.get("players") or {})
    rp = compute_reward_points(game)
    for pid in infer_player_ids(game):
        pdata = dict(players.get(pid) or {})
        pdata["reward_points"] = int(rp.get(pid, 0))
        pdata["wounds"] = int(pdata.get("wounds", 0) or 0)
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
    lobby["all_players_ready"] = _compute_all_players_ready(game, meta)
    meta["lobby"] = lobby

    return GameState(deck=game.deck, zones=game.zones, meta=meta)
