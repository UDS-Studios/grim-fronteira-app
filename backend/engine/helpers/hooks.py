from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "narrative_hooks.json"


def _load_hook_data() -> dict[str, Any]:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_HOOK_DATA = _load_hook_data()


def generate_hook_suggestions(seed: int | None = None, count: int = 3) -> list[str]:
    rng = random.Random(seed)

    hooks = _HOOK_DATA.get("hooks", [])
    if not isinstance(hooks, list):
        raise ValueError("Invalid narrative_hooks.json: 'hooks' must be a list.")

    if count > len(hooks):
        raise ValueError(f"Not enough hooks to generate {count} suggestions.")

    selected = rng.sample(hooks, count)

    suggestions: list[str] = []
    for item in selected:
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Invalid hook entry: missing non-empty 'text'.")
        suggestions.append(text)

    return suggestions