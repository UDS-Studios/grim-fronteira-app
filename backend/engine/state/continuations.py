"""Finite internal continuations. No HTTP actions or dynamic executable data."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from .game_state import GameState


def normalize_continuation(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping) or set(raw) != {"on_resolve", "on_reclaim"}:
        raise ValueError("continuation must contain exactly on_resolve and on_reclaim.")
    return {branch: _normalize_destination(value) for branch, value in raw.items()}


def _normalize_destination(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping) or set(raw) != {"kind", "payload"}:
        raise ValueError("continuation destination must contain exactly kind and payload.")
    kind, payload = raw["kind"], raw["payload"]
    if not isinstance(kind, str) or kind not in {"debug_resume_marker", "debug_raise", "resume_scene_new", "resume_scene_start", "resume_scene_wounds"}:
        raise ValueError(f"Unknown continuation kind: {kind!r}")
    if not isinstance(payload, Mapping):
        raise ValueError("continuation payload must be a mapping.")
    if kind == "debug_resume_marker":
        if (set(payload) != {"marker"} or not isinstance(payload["marker"], str)
                or not payload["marker"].strip()):
            raise ValueError("debug_resume_marker payload requires exactly a non-empty marker string.")
    elif payload:
        raise ValueError(f"{kind} payload must be empty.")
    return {"kind": kind, "payload": dict(payload)}


def _dispatch_continuation(game: GameState, destination: dict[str, Any] | None) -> GameState:
    if destination is None:
        return game
    if destination["kind"] == "debug_resume_marker":
        trace = game.meta.get("debug_continuation_trace", [])
        if not isinstance(trace, list) or any(not isinstance(item, str) for item in trace):
            raise ValueError("debug_continuation_trace must be a list of strings.")
        return replace(game, meta={**game.meta, "debug_continuation_trace": [
            *trace, destination["payload"]["marker"],
        ]})
    if destination["kind"] == "resume_scene_start":
        from backend.engine.rules.grim_fronteira.scene import resume_scene_start
        return resume_scene_start(game)
    if destination["kind"] == "resume_scene_wounds":
        from backend.engine.rules.grim_fronteira.scene import resume_scene_wounds
        return resume_scene_wounds(game)
    if destination["kind"] == "resume_scene_new":
        from backend.engine.rules.grim_fronteira.scene import resume_scene_new
        return resume_scene_new(game)
    if destination["kind"] == "debug_raise":
        raise ValueError("debug continuation failure")
    raise ValueError(f"Unknown continuation kind: {destination['kind']!r}")


def complete_pending_interaction(
    game: GameState, *, outcome: Literal["resolve", "reclaim"],
) -> GameState:
    """Derive one consumed/resumed state; callers authorize and commit once.

    Never mutate the input or persist here. An exception leaves the caller's
    authoritative state (including both continuation branches) intact.
    """
    from .pending_interaction import clear_pending_interaction, get_pending_interaction
    from .validators import validate_game_state

    if outcome not in {"resolve", "reclaim"}:
        raise ValueError("Completion outcome must be resolve or reclaim.")
    pending = get_pending_interaction(game)
    if pending is None:
        raise ValueError("No pending interaction to complete")
    if outcome == "reclaim" and pending["kind"] == "yankee_inspect_top_card":
        from backend.engine.rules.grim_fronteira.factions import validate_yankee_inspection
        # Reclaim defaults to KEEP, including its protected-top invariant.
        validate_yankee_inspection(game)
    continuation = pending["continuation"]
    destination = continuation[f"on_{outcome}"] if continuation is not None else None
    resumed = _dispatch_continuation(clear_pending_interaction(game), destination)
    validate_game_state(resumed)
    return resumed
