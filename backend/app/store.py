from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Dict

from backend.engine.state.game_state import GameState
from backend.app.session_authority import SeatSessionRecord
from backend.app.persistence import PersistenceUnavailable, UninitializedRepository


@dataclass
class StoredGame:
    state: GameState
    # Serialize authorization through commit, including concurrent completion attempts.
    lock: object = field(default_factory=Lock, repr=False, compare=False)
    sessions: Dict[str, SeatSessionRecord] = field(default_factory=dict, repr=False, compare=False)


# Runtime registry backed by application snapshots after lifespan startup.
GAMES: Dict[str, StoredGame] = {}


# Explicit tests inject MemoryRepository. Production initializes FileRepository
# in lifespan and refuses durable operations before that initialization.
repository = UninitializedRepository()


def _install_candidate(stored: StoredGame, state: GameState, sessions: Dict[str, SeatSessionRecord]) -> None:
    stored.state = state
    stored.sessions = sessions


def commit_stored_game_candidate(
    game_id: str, stored: StoredGame, state: GameState,
    sessions: Dict[str, SeatSessionRecord] | None = None,
) -> None:
    """Caller holds the game lock: durable snapshot precedes runtime assignment."""
    candidate_sessions = stored.sessions if sessions is None else sessions
    repository.save_snapshot(game_id, state, candidate_sessions)
    try:
        _install_candidate(stored, state, candidate_sessions)
    except Exception:
        # Disk is authoritative now; no rollback may overwrite it with old state.
        repository.fence(game_id)
        raise PersistenceUnavailable() from None


def publish_stored_game(game_id: str, stored: StoredGame) -> None:
    repository.save_snapshot(game_id, stored.state, stored.sessions)
    try:
        GAMES[game_id] = stored
    except Exception:
        repository.fence(game_id)
        raise PersistenceUnavailable() from None
