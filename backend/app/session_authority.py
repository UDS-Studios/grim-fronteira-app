"""Application-only issuance and reconnect; gameplay authentication comes later."""
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, replace
from hashlib import sha256
from hmac import compare_digest
import secrets
from typing import Literal

from backend.engine.state.game_state import GameState


class SessionIssuanceError(RuntimeError):
    """Invalid issuance request; distinct from engine gameplay errors."""


class ReconnectInvalid(RuntimeError):
    """Uniform failure without credential or seat details."""

    def __init__(self):
        super().__init__("Invalid reconnect credential")


@dataclass(frozen=True)
class SeatSessionRecord:
    player_id: str
    reconnect_token_hash: str
    active_session_hash: str
    superseded_session_hashes: frozenset[str] = frozenset()


def hash_credential(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def resolve_reconnect_seat(
    sessions: Mapping[str, SeatSessionRecord], reconnect_token: str,
) -> SeatSessionRecord:
    if not isinstance(reconnect_token, str) or not reconnect_token.strip():
        raise ReconnectInvalid()
    try:
        supplied_hash = hash_credential(reconnect_token)
    except UnicodeError:
        raise ReconnectInvalid() from None
    matches = [record for record in sessions.values()
               if compare_digest(supplied_hash, record.reconnect_token_hash)]
    if len(matches) != 1:
        raise ReconnectInvalid()
    return matches[0]


def replace_active_session(record: SeatSessionRecord) -> tuple[SeatSessionRecord, str]:
    """Stage an immutable replacement; caller commits only after response creation."""
    active_session = secrets.token_urlsafe(32)
    replacement = replace(
        record, active_session_hash=hash_credential(active_session),
        superseded_session_hashes=record.superseded_session_hashes | {record.active_session_hash},
    )
    return replacement, active_session


def role_for_seat(game: GameState, player_id: str) -> Literal["marshal", "player"]:
    if not isinstance(player_id, str) or not player_id.strip():
        raise SessionIssuanceError("Credential issuance requires a valid seat")
    if player_id == game.meta.get("marshal_id"):
        return "marshal"
    if player_id in (game.meta.get("players_order") or []):
        return "player"
    raise SessionIssuanceError("Credential issuance requires a registered seat")


def issue_seat_credentials(
    game: GameState,
    sessions: MutableMapping[str, SeatSessionRecord],
    player_id: str,
) -> dict[str, str]:
    """Issue once into a caller-owned registry, which may be staged for commit.

    Never mutate gameplay state. Callers serialize access through StoredGame.lock
    or issue against a newly created, unpublished game. Raw secrets are returned
    only here and cannot be recovered from the stored record.
    """
    role = role_for_seat(game, player_id)
    if player_id in sessions:
        raise SessionIssuanceError("Seat credentials have already been issued")
    reconnect_token = secrets.token_urlsafe(32)
    active_session = secrets.token_urlsafe(32)
    record = SeatSessionRecord(
        player_id=player_id,
        reconnect_token_hash=hash_credential(reconnect_token),
        active_session_hash=hash_credential(active_session),
    )
    sessions[player_id] = record
    return {
        "player_id": player_id,
        "role": role,
        "reconnect_token": reconnect_token,
        "active_session": active_session,
    }
