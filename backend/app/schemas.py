from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


class ErrorPayload(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class NewGameRequest(BaseModel):
    template_path: str = Field(default="data/templates/standard_54.json")
    meta: Dict[str, Any] = Field(default_factory=dict)
    seed: int | None = None
    view: Literal["public", "player", "debug"] = "debug"
    creator_id: str = "marshal"


class ActionRequest(BaseModel):
    game_id: str
    action: Literal[
        "gf.get_state",
        "gf.setup_players",  # legacy/debug only
        "gf.debug_stack_top_card",
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
        "gf.scene_roll_difficulty",
        "gf.scene_draw_azzardo",
        "gf.scene_remove_azzardo",
        "gf.scene_skip_azzardo",
        "gf.scene_start",
        "gf.scene_new",
        "gf.scene_resolve",
        "gf.scene_draw_card",
        "gf.scene_stand",
        "gf.scene_play_scum",
        "gf.scene_play_vengeance",
        "gf.scene_acknowledge_resolution",
        "gf.scene_force_acknowledge_resolution",
        "gf.scene_assign_bonus_card",
    ]
    params: Dict[str, Any] = Field(default_factory=dict)
    view: Literal["public", "player", "debug"] = "debug"


class ActionResponse(BaseModel):
    game_id: str
    revision: int
    state: Dict[str, Any]
    events: list[Dict[str, Any]]
    result: Dict[str, Any]
    error: ErrorPayload | None = None
