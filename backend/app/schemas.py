from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError


class ErrorPayload(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class ViewRequest(BaseModel):
    view: Literal["public", "player", "debug"] = "debug"
    viewer_id: str | None = None

    @model_validator(mode="after")
    def require_player_viewer(self):
        if self.view == "player" and (not self.viewer_id or not self.viewer_id.strip()):
            raise PydanticCustomError("player_viewer_required", "viewer_id is required for player view")
        return self


class NewGameRequest(ViewRequest):
    template_path: str = Field(default="data/templates/standard_54.json")
    meta: Dict[str, Any] = Field(default_factory=dict)
    seed: int | None = None
    creator_id: str = "marshal"


class ActionRequest(ViewRequest):
    game_id: str
    action: Literal[
        "gf.get_state",
        "gf.setup_players",  # legacy/debug only
        "gf.debug_stack_top_card",
        "gf.debug_begin_pending_interaction",
        "gf.debug_resolve_pending_interaction",
        "gf.pending_reclaim",
        "gf.roll_difficulty",
        "gf.set_character_assignment_mode",
        "gf.claim_character",
        "gf.draw_character",
        "gf.join_lobby",
        "gf.set_registration_open",
        "gf.submit_character_name",
        "gf.submit_character_feature",
        "gf.start_game",
        "gf.begin_table",
        "gf.scene_set_participants",
        "gf.scene_set_mode",
        "gf.scene_roll_difficulty",
        "gf.scene_draw_azzardo",
        "gf.scene_remove_azzardo",
        "gf.scene_skip_azzardo",
        "gf.scene_start",
        "gf.scene_close",
        "gf.scene_new",
        "gf.scene_resolve",
        "gf.scene_draw_card",
        "gf.scene_stand",
        "gf.scene_play_scum",
        "gf.scene_play_vengeance",
        "gf.faction_paisa_claim_reward",
        "gf.faction_criollo_convert_resource",
        "gf.faction_chichimeca_choose_target",
        "gf.faction_yankee_choose_top_card",
        "gf.scene_acknowledge_resolution",
        "gf.scene_force_acknowledge_resolution",
        "gf.scene_skip_heal",
        "gf.scene_force_skip_heal",
        "gf.scene_heal_wound",
        "gf.scene_discard_reward",
        "gf.scene_force_discard_rewards",
        "gf.scene_assign_bonus_card",
    ]
    params: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(BaseModel):
    game_id: str
    revision: int
    state: Dict[str, Any]
    events: list[Dict[str, Any]]
    result: Dict[str, Any]
    error: ErrorPayload | None = None
