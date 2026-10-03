"""Server-configured permission for debug projections and development actions."""
import os

from fastapi import HTTPException


DEBUG_ONLY_ACTIONS = frozenset({
    "gf.debug_stack_top_card",
    "gf.debug_begin_pending_interaction",
    "gf.debug_resolve_pending_interaction",
    "gf.setup_players",
    # Legacy HTTP wrapper; gf.scene_roll_difficulty is the production route.
    "gf.roll_difficulty",
})


def debug_api_enabled() -> bool:
    return os.environ.get("GF_ENABLE_DEBUG_API", "").strip().lower() in {"1", "true", "yes", "on"}


def require_debug_api_enabled() -> None:
    if not debug_api_enabled():
        raise HTTPException(status_code=403, detail="Debug API is disabled")


def enforce_debug_api_policy(*, view: str, action: str | None = None) -> None:
    if view == "debug" or action in DEBUG_ONLY_ACTIONS:
        require_debug_api_enabled()
    if action in DEBUG_ONLY_ACTIONS and view != "debug":
        raise HTTPException(status_code=403, detail=f"{action} is debug-only")
