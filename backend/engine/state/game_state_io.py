from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.grimdeck.models import DeckState
from .game_state import GameState


def load_game_state(path: str | Path) -> GameState:
    p = Path(path)
    data: Dict[str, Any] = json.loads(p.read_text(encoding="utf-8"))

    deck_data = data.get("deck")
    if deck_data is None:
        raise ValueError("GameState missing 'deck'.")

    # Reconstruct DeckState manually (reuse structure)
    deck = DeckState(
        version=deck_data.get("version", 1),
        schema=deck_data.get("schema"),
        created_utc=deck_data.get("created_utc"),
        notes=deck_data.get("notes", ""),
        settings=deck_data.get("settings"),
        draw_pile=list(deck_data["draw_pile"]),
        in_play=list(deck_data["in_play"]),
        discard_pile=list(deck_data["discard_pile"]),
        removed=list(deck_data["removed"]),
    )

    return GameState(
        version=data.get("version", 1),
        schema=data.get("schema", "grimfronteira.gamestate"),
        deck=deck,
        zones=data.get("zones", {}),
        meta=data.get("meta", {}),
    )


def save_game_state(state: GameState, path: str | Path) -> None:
    p = Path(path)

    data = {
        "version": state.version,
        "schema": state.schema,
        "deck": {
            "version": state.deck.version,
            "schema": state.deck.schema,
            "created_utc": state.deck.created_utc,
            "notes": state.deck.notes,
            "settings": state.deck.settings,
            "draw_pile": state.deck.draw_pile,
            "in_play": state.deck.in_play,
            "discard_pile": state.deck.discard_pile,
            "removed": state.deck.removed,
        },
        "zones": state.zones,
        "meta": state.meta,
    }

    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")