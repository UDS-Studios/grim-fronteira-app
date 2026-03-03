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


class ActionRequest(BaseModel):
    game_id: str
    action: Literal["gf.get_state", "gf.setup_players", "gf.roll_difficulty"]
    params: Dict[str, Any] = Field(default_factory=dict)
    view: Literal["public", "debug"] = "debug"


class ActionResponse(BaseModel):
    game_id: str
    revision: int
    state: Dict[str, Any]
    events: list[Dict[str, Any]]
    result: Dict[str, Any]
    error: ErrorPayload | None = None