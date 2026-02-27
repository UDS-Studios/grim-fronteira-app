from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from backend.engine.state.game_state import GameState


@dataclass
class StoredGame:
    state: GameState


# In-memory store (swap with DB later)
GAMES: Dict[str, StoredGame] = {}