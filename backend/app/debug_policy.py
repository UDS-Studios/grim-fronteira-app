"""Server-configured permission for debug projections and development actions."""
import os

from fastapi import HTTPException

from backend.app.action_authority import ACTION_AUTHORITIES, AuthorityKind


# Legacy difficulty stays quarantined; gf.scene_roll_difficulty is production.
DEBUG_ONLY_ACTIONS = frozenset(
    action for action, spec in ACTION_AUTHORITIES.items()
    if spec.kind in {AuthorityKind.DEBUG_ONLY, AuthorityKind.LEGACY_DEBUG_ONLY}
)


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
