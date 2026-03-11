from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "characters.json"


def _load_data() -> Dict[str, Any]:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_DATA = _load_data()


def figure_to_character(card_id: str) -> Dict[str, str]:
    """
    Convert a figure card into character info.

    Example:
        "KC" -> Paisà Boss
    """

    rank = card_id[:-1]
    suit = card_id[-1]

    if rank not in _DATA["ranks"]:
        raise ValueError(f"{card_id} is not a figure card")

    faction = _DATA["factions"][suit]

    return {
        "faction": faction["name"],
        "role": _DATA["ranks"][rank],
        "ability_name": faction["ability_name"],
        "ability_text": faction["ability_text"],
    }


def character_label(card_id: str) -> str:
    """
    Human readable label.

    Example:
        "JC" -> "Paisà Kid"
    """

    info = figure_to_character(card_id)
    return f'{info["faction"]} {info["role"]}'