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
    view: Literal["public", "debug"] = "debug"
    creator_id: str = "marshal"


class ActionRequest(BaseModel):
    game_id: str
    action: Literal[
        "gf.get_state",
        "gf.setup_players",  # legacy/debug only
        "gf.roll_difficulty",
        "gf.set_character_assignment_mode",
        "gf.claim_character",
        "gf.draw_character",
        "gf.join_lobby",
        "gf.set_registration_open",
        "gf.submit_character_name",
        "gf.submit_character_feature",
        "gf.start_game",
    ]
    params: Dict[str, Any] = Field(default_factory=dict)
    view: Literal["public", "debug"] = "debug"


class ActionResponse(BaseModel):
    game_id: str
    revision: int
    state: Dict[str, Any]
    events: list[Dict[str, Any]]
    result: Dict[str, Any]
    error: ErrorPayload | None = None