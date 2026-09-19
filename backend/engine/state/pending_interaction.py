"""State-only support for a single pending interaction; no action or continuation logic."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
import math
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .game_state import GameState


_FIELDS = {"kind", "actor_id", "allowed_actions", "continuation", "payload"}


def _json_copy(value: Any) -> Any:
    """Copy JSON values without silently coercing keys, tuples, or non-finite numbers."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, list):
        return [_json_copy(item) for item in value]
    if isinstance(value, Mapping) and all(isinstance(key, str) for key in value):
        return {key: _json_copy(item) for key, item in value.items()}
    raise ValueError("pending_interaction must contain only JSON-safe values with string keys.")


def normalize_pending_interaction(raw: Any) -> dict[str, Any] | None:
    """Validate and return a detached canonical dictionary, or None for absent state.

    All five fields are required. Payload and continuation are opaque JSON data;
    mappings become dictionaries, and unknown top-level fields are rejected.
    """
    if raw is None:
        return None
    if not isinstance(raw, Mapping) or set(raw) != _FIELDS:
        raise ValueError("pending_interaction must contain exactly: " + ", ".join(sorted(_FIELDS)))
    for field in ("kind", "actor_id"):
        if not isinstance(raw[field], str) or not raw[field].strip():
            raise ValueError(f"pending_interaction.{field} must be a non-empty string.")
    actions = raw["allowed_actions"]
    if not isinstance(actions, list) or any(not isinstance(a, str) or not a.strip() for a in actions):
        raise ValueError("pending_interaction.allowed_actions must be a list of non-empty strings.")
    if len(actions) != len(set(actions)):
        raise ValueError("pending_interaction.allowed_actions must not contain duplicates.")
    if not isinstance(raw["payload"], Mapping):
        raise ValueError("pending_interaction.payload must be a mapping.")
    try:
        return _json_copy(raw)
    except RecursionError as exc:
        raise ValueError("pending_interaction must be acyclic JSON data within nesting limits.") from exc


def validate_pending_interaction(raw: Any) -> None:
    normalize_pending_interaction(raw)


def get_pending_interaction(game: GameState) -> dict[str, Any] | None:
    return normalize_pending_interaction(game.meta.get("pending_interaction"))


def begin_pending_interaction(game: GameState, interaction: Mapping[str, Any]) -> GameState:
    if get_pending_interaction(game) is not None:
        raise ValueError("A pending interaction already exists.")
    pending = normalize_pending_interaction(interaction)
    if pending is None:
        raise ValueError("Beginning a pending interaction requires an interaction.")
    return replace(game, meta={**game.meta, "pending_interaction": pending})


def clear_pending_interaction(game: GameState) -> GameState:
    return replace(game, meta={**game.meta, "pending_interaction": None})
