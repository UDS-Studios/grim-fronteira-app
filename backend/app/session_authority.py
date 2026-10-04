"""Application-only seat credential issuance, reconnect, and authentication."""
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, replace
from hashlib import sha256
from hmac import compare_digest
import secrets
from typing import Literal

from backend.engine.state.game_state import GameState
from backend.app import presence


class SessionIssuanceError(RuntimeError):
    """Invalid issuance request; distinct from engine gameplay errors."""


class ReconnectInvalid(RuntimeError):
    """Uniform failure without credential or seat details."""

    def __init__(self):
        super().__init__("Invalid reconnect credential")


class TakeoverRequiredError(RuntimeError):
    """Valid recovery credential conflicts with an online controller."""

    def __init__(self):
        super().__init__("Explicit takeover required for an online controller")


class AuthorityError(RuntimeError):
    ERRORS = {
        "SESSION_REQUIRED": (401, "Active session credential required"),
        "SESSION_INVALID": (401, "Invalid active session credential"),
        "SESSION_REPLACED": (401, "Active session has been replaced"),
        "ACTOR_MISMATCH": (403, "Session does not control the requested actor"),
        "VIEWER_MISMATCH": (403, "Session does not control the requested private view"),
    }

    def __init__(self, code: str):
        self.code = code
        self.status, message = self.ERRORS[code]
        super().__init__(message)


@dataclass(frozen=True)
class SeatSessionRecord:
    player_id: str
    reconnect_token_hash: str
    active_session_hash: str
    superseded_session_hashes: frozenset[str] = frozenset()
    # Monotonic runtime timestamp belongs to active_session_hash on this record.
    last_seen: float | None = None


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
        record, active_session_hash=hash_credential(active_session), last_seen=presence.now(),
        superseded_session_hashes=record.superseded_session_hashes | ({record.active_session_hash} if record.active_session_hash else set()),
    )
    return replacement, active_session


def resolve_active_session(
    sessions: Mapping[str, SeatSessionRecord], token: str | None,
) -> SeatSessionRecord:
    if token is None or token == "":
        raise AuthorityError("SESSION_REQUIRED")
    try:
        digest = hash_credential(token)
    except (UnicodeError, AttributeError):
        raise AuthorityError("SESSION_INVALID") from None
    current = [r for r in sessions.values() if compare_digest(digest, r.active_session_hash)]
    if len(current) == 1:
        return current[0]
    if not current and any(compare_digest(digest, old) for r in sessions.values()
                           for old in r.superseded_session_hashes):
        raise AuthorityError("SESSION_REPLACED")
    raise AuthorityError("SESSION_INVALID")


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
        last_seen=presence.now(),
    )
    sessions[player_id] = record
    return {
        "player_id": player_id,
        "role": role,
        "reconnect_token": reconnect_token,
        "active_session": active_session,
    }
