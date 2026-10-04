"""Application-only Marshal presence policy; callers hold StoredGame.lock."""
from collections.abc import Mapping
from typing import Any

from backend.app import presence
from backend.app.action_authority import AuthorityKind, get_action_authority
from backend.app.session_authority import SeatSessionRecord
from backend.engine.state.game_state import GameState


class GamePausedError(RuntimeError):
    def __init__(self):
        super().__init__("The game is paused while the Marshal is offline")


def pause_state(game: GameState, sessions: Mapping[str, SeatSessionRecord], at: float | None = None) -> dict[str, Any]:
    at = presence.now() if at is None else at
    marshal = sessions.get(game.meta.get("marshal_id"))
    paused = game.meta.get("phase") != "lobby" and (marshal is None or not presence.is_seat_online(marshal, at))
    return {"paused": paused, "reason": "marshal_offline" if paused else None}


def enrich_pause(projected: dict[str, Any], game: GameState, sessions: Mapping[str, SeatSessionRecord]) -> dict[str, Any]:
    return {**projected, "meta": {**projected.get("meta", {}), "session_pause": pause_state(game, sessions)}}


def enforce_gameplay_pause(game: GameState, sessions: Mapping[str, SeatSessionRecord], action: str, view: str) -> None:
    if view == "debug":
        return  # Route debug policy has already run.
    if get_action_authority(action).kind in {
        AuthorityKind.MARSHAL_ACTOR, AuthorityKind.MARSHAL_WITH_PLAYER_TARGET,
        AuthorityKind.PLAYER_ACTOR, AuthorityKind.PLAYER_WITH_PLAYER_TARGET,
    } and pause_state(game, sessions)["paused"]:
        raise GamePausedError()
