from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from .models import DeckState


def load_deck(path: str | Path) -> DeckState:
    p = Path(path)
    data: Dict[str, Any] = json.loads(p.read_text(encoding="utf-8"))

    # Minimal required keys
    for key in ("draw_pile", "in_play", "discard_pile", "removed"):
        if key not in data:
            raise ValueError(f"Invalid deck file: missing key '{key}'")

    return DeckState(
        version=int(data.get("version", 1)),
        schema=str(data.get("schema", "grimfronteira.deckstate")),
        created_utc=data.get("created_utc"),
        notes=str(data.get("notes", "")),
        settings=data.get("settings"),
        draw_pile=list(data["draw_pile"]),
        in_play=list(data["in_play"]),
        discard_pile=list(data["discard_pile"]),
        removed=list(data["removed"]),
    )


def save_deck(state: DeckState, path: str | Path) -> None:
    p = Path(path)

    data = {
        "version": state.version,
        "schema": state.schema,
        "created_utc": state.created_utc,
        "notes": state.notes,
        "settings": state.settings,
        "draw_pile": state.draw_pile,
        "in_play": state.in_play,
        "discard_pile": state.discard_pile,
        "removed": state.removed,
    }

    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")