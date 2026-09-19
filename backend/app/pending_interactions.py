"""Pending-interaction authorization at the action API boundary."""
from collections.abc import Mapping
from typing import Any

from fastapi import HTTPException

from backend.engine.state.game_state import GameState
from backend.engine.state.pending_interaction import get_pending_interaction

DEBUG_BEGIN = "gf.debug_begin_pending_interaction"
DEBUG_RESOLVE = "gf.debug_resolve_pending_interaction"
RECLAIM = "gf.pending_reclaim"
PENDING_STATE_ACTIONS = {DEBUG_BEGIN, DEBUG_RESOLVE, RECLAIM}


def effective_actor(params: Mapping[str, Any]) -> str | None:
    """actor_id is the caller when present; never fall back to a target on invalid input."""
    actor = params.get("actor_id") if "actor_id" in params else params.get("player_id")
    return actor if isinstance(actor, str) and actor.strip() else None


def enforce_pending_action_gate(game: GameState, action: str, params: Mapping[str, Any]) -> None:
    """Authorize before dispatch, without mutating state or interpreting continuation data."""
    if action == "gf.get_state":
        return
    pending = get_pending_interaction(game)
    actor = effective_actor(params)
    if action == RECLAIM:
        if pending is None:
            raise HTTPException(status_code=400, detail="No pending interaction to reclaim")
        if actor is None or actor != game.meta.get("marshal_id"):
            raise HTTPException(status_code=403, detail="Only the current Marshal may reclaim a pending interaction")
        return
    if pending is None:
        return
    if action not in pending["allowed_actions"]:
        raise HTTPException(status_code=403, detail="Action not permitted by pending interaction")
    if actor is None:
        raise HTTPException(status_code=403, detail="Action blocked by pending interaction: effective actor required")
    if actor != pending["actor_id"]:
        raise HTTPException(status_code=403, detail="Wrong actor for pending interaction")
