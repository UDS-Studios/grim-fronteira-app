"""Authority contracts for callers, targets, and compatibility extraction."""
from copy import deepcopy
from dataclasses import FrozenInstanceError
from typing import get_args

import pytest

from backend.app.action_authority import (
    ACTION_AUTHORITIES, AuthorityKind, get_action_authority, get_claimed_actor,
)
from backend.app.debug_policy import DEBUG_ONLY_ACTIONS
from backend.app.pending_interactions import effective_actor
from backend.app.schemas import ActionRequest
from backend.app.store import StoredGame
from backend.engine.state.game_state import GameState


def test_every_request_literal_has_exactly_one_spec():
    actions = get_args(ActionRequest.model_fields["action"].annotation)
    assert actions
    assert len(actions) == len(set(actions)) == len(ACTION_AUTHORITIES)
    assert set(actions) == set(ACTION_AUTHORITIES)


@pytest.mark.parametrize("action,kind,caller,references", [
    ("gf.scene_roll_difficulty", AuthorityKind.MARSHAL_ACTOR, "actor_id", ()),
    ("gf.scene_start", AuthorityKind.MARSHAL_ACTOR, "actor_id", ()),
    ("gf.scene_new", AuthorityKind.MARSHAL_ACTOR, "actor_id", ()),
    ("gf.scene_draw_card", AuthorityKind.PLAYER_ACTOR, "player_id", ()),
    ("gf.scene_stand", AuthorityKind.PLAYER_ACTOR, "player_id", ()),
    ("gf.scene_play_vengeance", AuthorityKind.PLAYER_ACTOR, "player_id", ()),
    ("gf.scene_play_scum", AuthorityKind.PLAYER_WITH_PLAYER_TARGET, "player_id", ("target_player_id",)),
    ("gf.faction_chichimeca_choose_target", AuthorityKind.PLAYER_WITH_PLAYER_TARGET, "player_id", ("target_player_id",)),
    ("gf.scene_force_acknowledge_resolution", AuthorityKind.MARSHAL_WITH_PLAYER_TARGET, "actor_id", ("player_id",)),
    ("gf.scene_force_discard_dark_reward", AuthorityKind.MARSHAL_WITH_PLAYER_TARGET, "actor_id", ("player_id",)),
    ("gf.scene_assign_bonus_card", AuthorityKind.MARSHAL_WITH_PLAYER_TARGET, "actor_id", ("player_id",)),
    ("gf.scene_set_participants", AuthorityKind.MARSHAL_ACTOR, "actor_id", ("participant_ids",)),
])
def test_production_identity_shapes(action, kind, caller, references):
    spec = get_action_authority(action)
    assert (spec.kind, spec.caller_field, spec.reference_fields) == (kind, caller, references)
    assert not spec.player_id_fallback
    assert spec.proposed_seat_field is None


def test_join_is_acquisition_and_read_has_no_actor():
    join = get_action_authority("gf.join_lobby")
    assert join.kind == AuthorityKind.JOIN_ACQUIRE
    assert join.proposed_seat_field == "player_id"
    assert join.caller_field is None
    read = get_action_authority("gf.get_state")
    assert read.kind == AuthorityKind.PUBLIC_READ
    assert read.caller_field is None
    for spec in (join, read):
        assert get_claimed_actor({"actor_id": "host", "player_id": "p1", "viewer_id": "p1"}, spec) is None


def test_quarantined_actions_match_debug_policy():
    explicit_debug = {"gf.debug_stack_top_card", "gf.debug_begin_pending_interaction", "gf.debug_resolve_pending_interaction"}
    legacy = {"gf.setup_players", "gf.roll_difficulty"}
    assert DEBUG_ONLY_ACTIONS == explicit_debug | legacy
    assert {a for a, s in ACTION_AUTHORITIES.items() if s.kind == AuthorityKind.DEBUG_ONLY} == explicit_debug
    assert {a for a, s in ACTION_AUTHORITIES.items() if s.kind == AuthorityKind.LEGACY_DEBUG_ONLY} == legacy
    for action in legacy:
        spec = get_action_authority(action)
        assert spec.caller_field is None
        assert spec.reference_fields == ("player_ids",)


@pytest.mark.parametrize("params,expected", [
    ({"actor_id": "host", "player_id": "target"}, "host"),
    ({"player_id": "host"}, "host"),
    ({"actor_id": None, "player_id": "host"}, None),
    ({"actor_id": "", "player_id": "host"}, None),
    ({"actor_id": "  ", "player_id": "host"}, None),
    ({"actor_id": 1, "player_id": "host"}, None),
    ({"player_id": []}, None),
    ({}, None),
])
def test_reclaim_retains_marshal_compatibility_extraction(params, expected):
    spec = get_action_authority("gf.pending_reclaim")
    assert spec.kind == AuthorityKind.MARSHAL_ACTOR
    assert spec.caller_field == "actor_id"
    assert spec.player_id_fallback
    assert spec.reference_fields == ()
    assert get_claimed_actor(params, spec) == effective_actor(params) == expected


@pytest.mark.parametrize("action,params,expected", [
    ("gf.scene_set_participants", {"participant_ids": ["p1"]}, None),
    ("gf.scene_force_acknowledge_resolution", {"player_id": "target"}, None),
    ("gf.scene_force_acknowledge_resolution", {"actor_id": None, "player_id": "target"}, None),
    ("gf.scene_play_scum", {"target_player_id": "target"}, None),
    ("gf.scene_play_scum", {"actor_id": "host", "player_id": "p1", "target_player_id": "p2"}, "p1"),
    ("gf.scene_stand", {"actor_id": "host"}, None),
    ("gf.scene_stand", {"player_id": " "}, None),
    ("gf.scene_start", {"actor_id": "host", "player_id": "p1"}, "host"),
    ("gf.scene_start", {"viewer_id": "host"}, None),
    ("gf.debug_stack_top_card", {"actor_id": "host"}, None),
    ("gf.debug_begin_pending_interaction", {"player_id": "p1"}, "p1"),
])
def test_extraction_uses_declared_caller_only(action, params, expected):
    before = deepcopy(params)
    assert get_claimed_actor(params, get_action_authority(action)) == expected
    assert params == before


def test_generic_pending_extraction_is_intentionally_separate():
    # Existing synthetic pending checks prioritize actor_id. Future per-action
    # ownership checks must instead bind this player action to player_id.
    params = {"actor_id": "host", "player_id": "p1"}
    assert effective_actor(params) == "host"
    assert get_claimed_actor(params, get_action_authority("gf.scene_stand")) == "p1"


def test_lookup_and_extraction_are_pure_and_registry_is_immutable():
    stored = StoredGame(state=GameState(meta={"revision": 7, "marshal_id": "host"}))
    original = stored.state
    snapshot = deepcopy(original)
    lock = stored.lock
    for action in ACTION_AUTHORITIES:
        get_claimed_actor({"actor_id": "host", "player_id": "p1"}, get_action_authority(action))
    assert stored.state is original
    assert stored.state == snapshot
    assert stored.state.meta["revision"] == 7
    assert stored.lock is lock
    with pytest.raises(TypeError):
        ACTION_AUTHORITIES["gf.get_state"] = get_action_authority("gf.scene_start")
    with pytest.raises(FrozenInstanceError):
        get_action_authority("gf.get_state").caller_field = "player_id"
    with pytest.raises(KeyError):
        get_action_authority("gf.unknown")
