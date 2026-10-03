"""Observation-only runtime presence; callers hold StoredGame.lock.

Private GET polling (currently every 1.5 seconds) is the heartbeat substrate.
No presence data is written to gameplay state or used to gate gameplay.
"""
from collections.abc import Mapping, MutableMapping
from dataclasses import replace
from time import monotonic
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from backend.app.session_authority import SeatSessionRecord

PRESENCE_TIMEOUT_SECONDS = 15


def now() -> float:
    """Process-local monotonic clock; monkeypatchable for deterministic tests."""
    return monotonic()


def is_seat_online(record: "SeatSessionRecord", at: float) -> bool:
    return record.last_seen is not None and 0 <= at - record.last_seen <= PRESENCE_TIMEOUT_SECONDS


def refresh_presence(sessions: MutableMapping[str, "SeatSessionRecord"], seat: "SeatSessionRecord") -> None:
    """Refresh only the proven current session, never a superseded record."""
    if sessions.get(seat.player_id) is seat:
        sessions[seat.player_id] = replace(seat, last_seen=now())


def presence_snapshot(sessions: Mapping[str, "SeatSessionRecord"], at: float | None = None) -> dict[str, dict[str, bool]]:
    at = now() if at is None else at
    return {player: {"online": is_seat_online(record, at)} for player, record in sessions.items()}


def enrich_presence(projected: dict[str, Any], sessions: Mapping[str, "SeatSessionRecord"]) -> dict[str, Any]:
    """Copy projected metadata; never mutate authoritative GameState."""
    return {**projected, "meta": {**projected.get("meta", {}), "presence": presence_snapshot(sessions)}}
