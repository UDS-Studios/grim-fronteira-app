from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from backend.engine.grimdeck.models import DeckState, CardID


@dataclass(frozen=True)
class GameState:
    version: int = 1
    schema: str = "grimfronteira.gamestate"

    deck: DeckState | None = None

    zones: Dict[str, List[CardID]] = field(default_factory=dict)

    meta: Dict[str, object] = field(default_factory=dict)