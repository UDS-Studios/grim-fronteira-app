from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from backend.engine.helpers.characters import figure_to_character, character_label

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "character_flavor.json"


def _load_flavor_data() -> dict[str, Any]:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


_FLAVOR = _load_flavor_data()


def build_character_profile(card_id: str, player_id: str, seed: int | None = None) -> dict[str, str]:
    """
    Build one random flavored character profile for a figure card.

    Example:
        build_character_profile("QS", "player-y799nj", seed=42)
    """
    rng = random.Random(seed)

    info = figure_to_character(card_id)
    faction = info["faction"]
    role = info["role"]

    names = _FLAVOR["names"][faction][role]
    feature = rng.choice(_FLAVOR["features"])
    name = rng.choice(names)

    return {
        "player_id": player_id,
        "card": card_id,
        "label": character_label(card_id),
        "ability": info["ability_name"],
        "ability_text": info["ability_text"],
        "name": name,
        "feature": feature,
    }


def suggest_character_profiles(card_id: str, player_id: str, count: int = 3, seed: int | None = None) -> list[dict[str, str]]:
    """
    Produce several distinct suggestions for the frontend to display.

    The player may later pick one or type their own name/feature.
    """
    rng = random.Random(seed)

    info = figure_to_character(card_id)
    faction = info["faction"]
    role = info["role"]

    names = list(_FLAVOR["names"][faction][role])
    features = list(_FLAVOR["features"])

    if count > len(names):
        raise ValueError(f"Not enough names for {faction} {role} to provide {count} suggestions.")
    if count > len(features):
        raise ValueError(f"Not enough features to provide {count} suggestions.")

    rng.shuffle(names)
    rng.shuffle(features)

    suggestions: list[dict[str, str]] = []
    for i in range(count):
        suggestions.append(
            {
                "player_id": player_id,
                "card": card_id,
                "label": character_label(card_id),
                "ability": info["ability_name"],
                "ability_text": info["ability_text"],
                "name": names[i],
                "feature": features[i],
            }
        )

    return suggestions

with open(DATA_PATH, "r", encoding="utf-8") as f:
    _FLAVOR = json.load(f)


def pick_three(kind: str, seed: int | None = None) -> List[str]:
    """
    Return three random suggestions.

    kind can be:
        - a figure card like "KC"
        - the string "feature"

    Examples
    --------
    pick_three("KC")
        -> ["Donald Drunk", "Buck Hardsaddle", "Sheriff Mudwell"]

    pick_three("feature")
        -> ["a large skull ring", "a broken front tooth", "a velvet ribbon around the throat"]
    """

    rng = random.Random(seed)

    # --- Feature suggestions ---
    if kind == "feature":
        features = list(_FLAVOR["features"])
        if len(features) < 3:
            raise ValueError("Need at least three features in data file.")
        return rng.sample(features, 3)

    # --- Name suggestions from figure ---
    info = figure_to_character(kind)

    faction = info["faction"]
    role = info["role"]

    names = list(_FLAVOR["names"][faction][role])

    if len(names) < 3:
        raise ValueError(f"Not enough names for {faction} {role}")

    return rng.sample(names, 3)