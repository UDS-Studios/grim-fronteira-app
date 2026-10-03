"""Application ownership checks; callers hold the game's lock throughout dispatch.

Server-enabled debug projections are trusted development requests. They still
pass debug policy at the route boundary, but do not require seat credentials.
"""
from collections.abc import Mapping
from typing import Any

from backend.app.action_authority import AuthorityKind, get_action_authority, get_claimed_actor
from backend.app.session_authority import AuthorityError, SeatSessionRecord, resolve_active_session
from backend.engine.state.game_state import GameState


def authorize_private_view(game: GameState, view: str, viewer_id: str | None, seat: SeatSessionRecord) -> None:
    if view in {"player", "marshal"}:
        if viewer_id != seat.player_id or (view == "marshal" and seat.player_id != game.meta.get("marshal_id")):
            raise AuthorityError("VIEWER_MISMATCH")


def authorize_request(
    game: GameState, sessions: Mapping[str, SeatSessionRecord], token: str | None,
    *, view: str, viewer_id: str | None, action: str | None = None,
    params: Mapping[str, Any] | None = None,
) -> None:
    if view == "debug":
        return  # The route must first enforce the server-side debug policy.
    spec = get_action_authority(action) if action is not None else None
    if spec is not None and spec.kind == AuthorityKind.JOIN_ACQUIRE:
        # The join response may project the new seat before its first credential
        # exists. Preserve pre-session admission/projection behavior for acquisition.
        return
    production_kinds = {
        AuthorityKind.MARSHAL_ACTOR, AuthorityKind.MARSHAL_WITH_PLAYER_TARGET,
        AuthorityKind.PLAYER_ACTOR, AuthorityKind.PLAYER_WITH_PLAYER_TARGET,
    }
    needs_actor = spec is not None and spec.kind in production_kinds
    if not needs_actor and view not in {"player", "marshal"}:
        return
    seat = resolve_active_session(sessions, token)
    authorize_private_view(game, view, viewer_id, seat)
    if needs_actor:
        if get_claimed_actor(params or {}, spec) != seat.player_id:
            raise AuthorityError("ACTOR_MISMATCH")
        if spec.kind in {AuthorityKind.MARSHAL_ACTOR, AuthorityKind.MARSHAL_WITH_PLAYER_TARGET} and seat.player_id != game.meta.get("marshal_id"):
            raise AuthorityError("ACTOR_MISMATCH")
