from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Dict

from backend.engine.state.game_state import GameState


@dataclass
class StoredGame:
    state: GameState
    # Serialize authorization through commit, including concurrent completion attempts.
    lock: object = field(default_factory=Lock, repr=False, compare=False)


# In-memory store (swap with DB later)
GAMES: Dict[str, StoredGame] = {}