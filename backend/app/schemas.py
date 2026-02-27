from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


# ---------- Requests ----------

class NewGameRequest(BaseModel):
    template_path: str = Field(default="data/templates/standard_54.json")
    meta: Dict[str, Any] = Field(default_factory=dict)
    view: Literal["public", "debug"] = "debug"


class ActionRequest(BaseModel):
    game_id: str
    action: Literal[
        "gf.setup_players",
        "gf.roll_difficulty",
        "gf.get_state",
    ]
    params: Dict[str, Any] = Field(default_factory=dict)
    view: Literal["public", "debug"] = "debug"


# ---------- Responses ----------

class ActionResponse(BaseModel):
    game_id: str
    revision: int
    state: Dict[str, Any]
    events: List[Dict[str, Any]] = Field(default_factory=list)
    result: Dict[str, Any] = Field(default_factory=dict)