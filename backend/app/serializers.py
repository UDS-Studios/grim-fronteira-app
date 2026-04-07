from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Dict

from backend.engine.state.game_state import GameState


def _serialize_full(game: GameState) -> Dict[str, Any]:
    if is_dataclass(game):
        return asdict(game)

    # fallback
    deck = getattr(game, "deck", None)
    zones = getattr(game, "zones", {})
    meta = getattr(game, "meta", {})

    deck_dict = None
    if deck is not None:
        if is_dataclass(deck):
            deck_dict = asdict(deck)
        else:
            deck_dict = {
                "version": getattr(deck, "version", None),
                "schema": getattr(deck, "schema", None),
                "created_utc": getattr(deck, "created_utc", None),
                "notes": getattr(deck, "notes", None),
                "settings": getattr(deck, "settings", None),
                "draw_pile": list(getattr(deck, "draw_pile", [])),
                "in_play": list(getattr(deck, "in_play", [])),
                "discard_pile": list(getattr(deck, "discard_pile", [])),
                "removed": list(getattr(deck, "removed", [])),
            }

    return {"deck": deck_dict, "zones": zones, "meta": meta}


def game_state_to_dict(game: GameState, *, view: str = "debug") -> Dict[str, Any]:
    data = _serialize_full(game)

    if view == "debug":
        return data

    # --- PUBLIC / PLAYER VIEW ---
    deck = data.get("deck")
    if deck and "draw_pile" in deck:
        draw_pile = deck["draw_pile"]
        deck["draw_pile"] = {
            "count": len(draw_pile)
        }

    meta = data.get("meta") or {}
    scene = meta.get("scene") or {}
    azzardo = scene.get("azzardo") or {}
    if not bool(azzardo.get("revealed", False)):
        azzardo["card_id"] = None
        azzardo["value"] = None
        scene["azzardo"] = azzardo
        meta["scene"] = scene

        zones = data.get("zones") or {}
        if "scene.azzardo" in zones:
            zones["scene.azzardo"] = []

    return data
