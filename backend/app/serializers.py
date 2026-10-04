from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict, is_dataclass
from typing import Any, Dict

from fastapi import HTTPException

from backend.engine.rules.grim_fronteira.scene import _dark_marshal_total
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

    return deepcopy({"deck": deck_dict, "zones": zones, "meta": meta})


def can_view_yankee_inspection(*, view: str, viewer_id: str | None, actor_id: str) -> bool:
    return view == "debug" or (
        view == "player" and isinstance(viewer_id, str) and bool(viewer_id.strip()) and viewer_id == actor_id
    )


def validate_marshal_view(game: GameState, *, view: str, viewer_id: str | None) -> None:
    """Validate the requested role against authoritative state, before any mutation."""
    if view != "marshal":
        return
    if not isinstance(viewer_id, str) or not viewer_id.strip():
        raise HTTPException(status_code=422, detail="viewer_id is required for marshal view")
    if viewer_id != (game.meta or {}).get("marshal_id"):
        raise HTTPException(status_code=403, detail="viewer_id must match marshal_id for marshal view")


def game_state_to_dict(game: GameState, *, view: str = "debug", viewer_id: str | None = None) -> Dict[str, Any]:
    validate_marshal_view(game, view=view, viewer_id=viewer_id)
    data = _serialize_full(game)
    meta = data.get("meta") or {}
    scene = meta.get("scene") or {}
    dark = scene.get("dark") or {}
    # Projection-only: use the same physical-hand arithmetic as gameplay.
    dark.pop("marshal_total", None)
    if scene.get("dark_mode"):
        if ((scene.get("difficulty") or {}).get("card_id") is not None
                and (view in {"debug", "marshal"} or dark.get("revealed", False))):
            dark["marshal_total"] = _dark_marshal_total(game)
        scene["dark"] = dark

    if view == "debug":
        return data

    # --- RESTRICTED PUBLIC / PLAYER / MARSHAL VIEWS ---
    deck = data.get("deck")
    if deck and "draw_pile" in deck:
        draw_pile = deck["draw_pile"]
        deck["draw_pile"] = {
            "count": len(draw_pile)
        }

    meta = data.get("meta") or {}
    pending = meta.get("pending_interaction")
    if pending and pending["kind"] == "yankee_inspect_top_card" and not can_view_yankee_inspection(
        view=view, viewer_id=viewer_id, actor_id=pending["actor_id"],
    ):
        # Yankees currently has no public payload fields. Fail closed for previews.
        pending["payload"] = {}
    scene = meta.get("scene") or {}
    if scene.get("dark_mode") and not (scene.get("dark") or {}).get("revealed", False):
        if view != "marshal":
            difficulty = scene.get("difficulty") or {}
            difficulty.update(card_id=None, value=None)
            scene["difficulty"] = difficulty
            # Historical difficulty metadata must not provide an alternate leak path.
            scene.pop("difficulty_value", None)
            meta.pop("scene.difficulty_value", None)
            (scene.get("dark") or {}).pop("must_discard_last", None)
            zones = data.setdefault("zones", {})
            # Counts describe current physical cards, never identities or values.
            # Canonical zones are always present, even before the first draw.
            for name in ("scene.difficulty", "scene.dark.marshal_hand"):
                zones[name] = {"count": len(zones.get(name, []))}
            if "scene.difficulty.cards" in zones:
                zones["scene.difficulty.cards"] = {"count": len(zones["scene.difficulty.cards"])}
        # Discard-last moves a secret card here; hide identities until reveal.
        if deck is not None:
            deck["discard_pile"] = {"count": len(deck.get("discard_pile", []))}
        meta["scene"] = scene

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
