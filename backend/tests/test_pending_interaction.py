from dataclasses import replace
import json
from types import MappingProxyType

import pytest

from backend.app.serializers import game_state_to_dict
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.state.game_state import GameState
from backend.engine.state.game_state_io import load_game_state, save_game_state
from backend.engine.state.pending_interaction import (
    begin_pending_interaction,
    clear_pending_interaction,
    get_pending_interaction,
    normalize_pending_interaction,
    validate_pending_interaction,
)
from backend.engine.state.validators import validate_game_state


@pytest.fixture
def game():
    return GameState(deck=load_deck("data/templates/standard_54.json"))


@pytest.fixture
def interaction():
    return {
        "kind": "test_choice",
        "actor_id": "p1",
        "allowed_actions": ["choose", "decline"],
        "continuation": {"on_resolve": {"kind": "debug_resume_marker", "payload": {"marker": "resolved"}},
                         "on_reclaim": None},
        "payload": {"choices": ["a", "b"]},
    }


def test_absent_and_legacy_state(game, tmp_path):
    assert game.meta["pending_interaction"] is None
    assert normalize_pending_interaction(None) is None
    game.meta.pop("pending_interaction")  # Simulate legacy metadata.
    validate_game_state(game)
    assert get_pending_interaction(game) is None
    path = tmp_path / "legacy.json"
    save_game_state(game, path)
    loaded = load_game_state(path)
    assert loaded.meta["pending_interaction"] is None
    validate_game_state(loaded)


def test_begin_get_clear_are_immutable_updates(game, interaction):
    game = replace(game, version=7, meta={"unrelated": "preserved"})
    pending = begin_pending_interaction(game, MappingProxyType(interaction))
    assert get_pending_interaction(pending) == interaction
    assert game.meta["pending_interaction"] is None
    interaction["payload"]["choices"].append("c")
    result = get_pending_interaction(pending)
    assert result["payload"]["choices"] == ["a", "b"]
    result["allowed_actions"].clear()
    assert get_pending_interaction(pending)["allowed_actions"] == ["choose", "decline"]
    cleared = clear_pending_interaction(pending)
    assert cleared.meta == {"unrelated": "preserved", "pending_interaction": None}
    assert cleared.version == 7
    assert cleared.deck is game.deck and cleared.zones is game.zones
    assert get_pending_interaction(pending) is not None
    assert clear_pending_interaction(cleared) == cleared
    with pytest.raises(ValueError, match="already exists"):
        begin_pending_interaction(pending, interaction)


@pytest.mark.parametrize("view", ["public", "player", "debug"])
def test_serialization_round_trip(game, interaction, tmp_path, view):
    pending = begin_pending_interaction(game, interaction)
    data = json.loads(json.dumps(game_state_to_dict(pending, view=view)))
    assert data["meta"]["pending_interaction"] == interaction
    path = tmp_path / "pending.json"
    save_game_state(pending, path)
    loaded = load_game_state(path)
    assert loaded == pending
    validate_game_state(loaded)


@pytest.mark.parametrize("field,value", [
    ("kind", ""), ("kind", "  "), ("kind", 1),
    ("actor_id", ""), ("actor_id", None),
    ("allowed_actions", "choose"), ("allowed_actions", ("choose",)),
    ("allowed_actions", [""]), ("allowed_actions", [1]),
    ("allowed_actions", ["choose", "choose"]),
    ("payload", []), ("payload", None), ("payload", {1: "bad key"}),
    ("continuation", object()), ("continuation", {"bad": {1, 2}}),
    ("continuation", float("nan")), ("continuation", float("inf")),
    ("continuation", (1, 2)),
])
def test_invalid_fields_rejected(game, interaction, field, value):
    interaction[field] = value
    with pytest.raises(ValueError):
        begin_pending_interaction(game, interaction)
    with pytest.raises(ValueError):
        GameState(meta={"pending_interaction": interaction})
    game.meta["pending_interaction"] = interaction
    with pytest.raises(ValueError):
        validate_game_state(game)


@pytest.mark.parametrize("raw", [False, [], "bad", {}, {"kind": "choice"}])
def test_invalid_structure(raw):
    with pytest.raises(ValueError):
        validate_pending_interaction(raw)


def test_unknown_fields_and_cycles(interaction):
    with pytest.raises(ValueError):
        validate_pending_interaction({**interaction, "faction_specific": True})
    interaction["continuation"] = interaction
    with pytest.raises(ValueError, match="acyclic"):
        normalize_pending_interaction(interaction)


def test_none_continuation_and_empty_actions(game, interaction):
    interaction.update(continuation=None, allowed_actions=[])
    validate_game_state(begin_pending_interaction(game, interaction))
