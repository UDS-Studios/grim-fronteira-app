from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "characters.json"


def _load_data() -> Dict[str, Any]:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_DATA = _load_data()


def rank_burden_text(role: str) -> str:
    if role == "Kid":
        return "As a Kid, your initial burden will be 2 Scum Cards"
    if role == "Lady":
        return "As a Lady, your initial burden will be a Vengeance Card and a Scum Card"
    if role == "Boss":
        return "As a Boss, your initial burden will be 2 Vengeance Cards"
    raise ValueError(f"Unknown role: {role}")


def figure_to_character(card_id: str) -> Dict[str, str]:
    """
    Convert a figure card into character info.

    Example:
        "QD" -> Criollo Lady
    """
    rank = card_id[:-1]
    suit = card_id[-1]

    if rank not in _DATA["ranks"]:
        raise ValueError(f"{card_id} is not a figure card")

    faction = _DATA["factions"][suit]
    role = _DATA["ranks"][rank]

    burden = rank_burden_text(role)

    ability_rule = (
        f"As a {faction['name']}, you'll have the ability "
        f"{faction['ability_name']}: {faction['ability_text']}"
    )

    return {
        "faction": faction["name"],
        "role": role,
        "ability_name": faction["ability_name"],
        "ability_text": faction["ability_text"],
        "rank_burden_text": burden,
        "ability_rule_text": ability_rule,
    }


def character_label(card_id: str) -> str:
    info = figure_to_character(card_id)
    return f'{info["faction"]} {info["role"]}'