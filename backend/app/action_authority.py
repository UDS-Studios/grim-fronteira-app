"""Request identity shapes only; no ownership or gameplay eligibility enforcement.

viewer_id is a projection selector and never supplies an action caller here.
Debug actor fields describe interaction owners, not authenticated seat authority.
"""
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Any, Literal


class AuthorityKind(str, Enum):
    PUBLIC_READ = "public_read"
    MARSHAL_ACTOR = "marshal_actor"
    PLAYER_ACTOR = "player_actor"
    MARSHAL_WITH_PLAYER_TARGET = "marshal_with_player_target"
    PLAYER_WITH_PLAYER_TARGET = "player_with_player_target"
    JOIN_ACQUIRE = "join_acquire"
    DEBUG_ONLY = "debug_only"
    LEGACY_DEBUG_ONLY = "legacy_debug_only"


@dataclass(frozen=True)
class ActionAuthority:
    kind: AuthorityKind
    caller_field: Literal["actor_id", "player_id"] | None = None
    reference_fields: tuple[str, ...] = ()
    # Legacy effective-actor semantics: fallback only when actor_id is absent.
    player_id_fallback: bool = False
    proposed_seat_field: Literal["player_id"] | None = None


_MARSHAL = ActionAuthority(AuthorityKind.MARSHAL_ACTOR, "actor_id")
_PLAYER = ActionAuthority(AuthorityKind.PLAYER_ACTOR, "player_id")
_MARSHAL_TARGET = ActionAuthority(AuthorityKind.MARSHAL_WITH_PLAYER_TARGET, "actor_id", ("player_id",))
_PLAYER_TARGET = ActionAuthority(AuthorityKind.PLAYER_WITH_PLAYER_TARGET, "player_id", ("target_player_id",))
_DEBUG_OWNER = ActionAuthority(AuthorityKind.DEBUG_ONLY, "actor_id", player_id_fallback=True)

# Explicit HTTP action registry. Internal engine continuations are not requests.
ACTION_AUTHORITIES: Mapping[str, ActionAuthority] = MappingProxyType({
    "gf.get_state": ActionAuthority(AuthorityKind.PUBLIC_READ),
    "gf.setup_players": ActionAuthority(AuthorityKind.LEGACY_DEBUG_ONLY, reference_fields=("player_ids",)),
    "gf.debug_stack_top_card": ActionAuthority(AuthorityKind.DEBUG_ONLY),
    "gf.debug_begin_pending_interaction": _DEBUG_OWNER,
    "gf.debug_resolve_pending_interaction": _DEBUG_OWNER,
    "gf.pending_reclaim": ActionAuthority(AuthorityKind.MARSHAL_ACTOR, "actor_id", player_id_fallback=True),
    "gf.roll_difficulty": ActionAuthority(AuthorityKind.LEGACY_DEBUG_ONLY, reference_fields=("player_ids",)),
    "gf.set_character_assignment_mode": _MARSHAL,
    "gf.claim_character": _PLAYER,
    "gf.draw_character": _PLAYER,
    "gf.join_lobby": ActionAuthority(AuthorityKind.JOIN_ACQUIRE, proposed_seat_field="player_id"),
    "gf.set_registration_open": _MARSHAL,
    "gf.submit_character_name": _PLAYER,
    "gf.submit_character_feature": _PLAYER,
    "gf.start_game": _MARSHAL,
    "gf.begin_table": _MARSHAL,
    "gf.scene_set_participants": ActionAuthority(AuthorityKind.MARSHAL_ACTOR, "actor_id", ("participant_ids",)),
    "gf.scene_set_mode": _MARSHAL,
    "gf.scene_roll_difficulty": _MARSHAL,
    "gf.scene_declare_dark": _MARSHAL,
    "gf.scene_dark_draw": _MARSHAL,
    "gf.scene_dark_reveal": _MARSHAL,
    "gf.scene_dark_discard_last": _MARSHAL,
    "gf.scene_draw_azzardo": _MARSHAL,
    "gf.scene_remove_azzardo": _MARSHAL,
    "gf.scene_skip_azzardo": _MARSHAL,
    "gf.scene_start": _MARSHAL,
    "gf.scene_close": _MARSHAL,
    "gf.scene_new": _MARSHAL,
    "gf.scene_resolve": _MARSHAL,
    "gf.scene_draw_card": _PLAYER,
    "gf.scene_stand": _PLAYER,
    "gf.scene_play_scum": _PLAYER_TARGET,
    "gf.scene_play_vengeance": _PLAYER,
    "gf.faction_paisa_claim_reward": _PLAYER,
    "gf.faction_criollo_convert_resource": _PLAYER,
    "gf.faction_chichimeca_choose_target": _PLAYER_TARGET,
    "gf.faction_yankee_choose_top_card": _PLAYER,
    "gf.scene_acknowledge_resolution": _PLAYER,
    "gf.scene_force_acknowledge_resolution": _MARSHAL_TARGET,
    "gf.scene_skip_heal": _PLAYER,
    "gf.scene_force_skip_heal": _MARSHAL_TARGET,
    "gf.scene_heal_wound": _PLAYER,
    "gf.scene_discard_reward": _PLAYER,
    "gf.scene_discard_dark_reward": _PLAYER,
    "gf.scene_force_discard_rewards": _MARSHAL_TARGET,
    "gf.scene_force_discard_dark_reward": _MARSHAL_TARGET,
    "gf.scene_assign_bonus_card": _MARSHAL_TARGET,
})


def get_action_authority(action: str) -> ActionAuthority:
    """Unknown actions fail explicitly rather than acquiring inferred authority."""
    return ACTION_AUTHORITIES[action]


def get_claimed_actor(params: Mapping[str, Any], spec: ActionAuthority) -> str | None:
    """Extract a declared caller without authenticating it or consulting targets."""
    if spec.caller_field is None:
        return None
    field = spec.caller_field
    if spec.player_id_fallback and field == "actor_id" and field not in params:
        field = "player_id"
    actor = params.get(field)
    return actor if isinstance(actor, str) and actor.strip() else None
