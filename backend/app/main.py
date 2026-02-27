from __future__ import annotations

from uuid import uuid4
from typing import Any, Dict, List, Literal

from fastapi import FastAPI, HTTPException

from backend.app.schemas import NewGameRequest, ActionRequest, ActionResponse
from backend.app.store import GAMES, StoredGame
from backend.app.serializers import game_state_to_dict

from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_game_state

from backend.engine.rules.grim_fronteira.setup import setup_players
from backend.engine.rules.grim_fronteira.scene_difficulty import marshal_roll_difficulty


app = FastAPI(title="Grim Fronteira API", version="0.1.0")


def _get_game(game_id: str) -> StoredGame:
    g = GAMES.get(game_id)
    if g is None:
        raise HTTPException(status_code=404, detail=f"Unknown game_id '{game_id}'")
    return g


def _bump_revision(game: GameState) -> GameState:
    meta = dict(game.meta or {})
    meta["revision"] = int(meta.get("revision", 0)) + 1
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


@app.post("/api/gf/new", response_model=ActionResponse)
def new_game(req: NewGameRequest) -> ActionResponse:
    deck = load_deck(req.template_path)
    game = GameState(deck=deck, zones={}, meta={"game": "grim_fronteira", **(req.meta or {})})
    game = _bump_revision(game)
    validate_game_state(game)

    game_id = str(uuid4())
    GAMES[game_id] = StoredGame(state=game)

    return ActionResponse(
        game_id=game_id,
        revision=game.meta.get("revision", 0),
        state=game_state_to_dict(game, view=req.view),
        events=[],
        result={"created": True},
    )


from typing import Literal

@app.get("/api/game/{game_id}", response_model=ActionResponse)
def get_state(game_id: str, view: Literal["public", "debug"] = "debug") -> ActionResponse:
    g = _get_game(game_id)
    game = g.state
    validate_game_state(game)

    return ActionResponse(
        game_id=game_id,
        revision=game.meta.get("revision", 0),
        state=game_state_to_dict(game, view=view),
        events=[],
        result={},
    )


@app.post("/api/gf/action", response_model=ActionResponse)
def action(req: ActionRequest) -> ActionResponse:
    g = _get_game(req.game_id)
    game = g.state

    events: List[Dict[str, Any]] = []  # keep, even if empty (Unreal can use later)
    result: Dict[str, Any] = {}

    # --- Dispatch ---
    if req.action == "gf.get_state":
        # no-op
        pass

    elif req.action == "gf.setup_players":
        params = req.params
        player_ids = params.get("player_ids")
        if not isinstance(player_ids, list) or not all(isinstance(x, str) for x in player_ids):
            raise HTTPException(status_code=400, detail="params.player_ids must be a list of strings")

        character_choices = params.get("character_choices")
        if character_choices is not None and not isinstance(character_choices, dict):
            raise HTTPException(status_code=400, detail="params.character_choices must be a dict or omitted")

        game = setup_players(
            game,
            player_ids,
            character_choices=character_choices,
            shuffle_face_pile_first=bool(params.get("shuffle_face_pile_first", False)),
            face_shuffle_seed=params.get("face_shuffle_seed"),
            return_remaining_faces=bool(params.get("return_remaining_faces", False)),
            return_shuffle_seed=params.get("return_shuffle_seed"),
        )
        result = {"ok": True, "action": req.action}

    elif req.action == "gf.roll_difficulty":
        params = req.params
        player_ids = params.get("player_ids")
        if not isinstance(player_ids, list) or not all(isinstance(x, str) for x in player_ids):
            raise HTTPException(status_code=400, detail="params.player_ids must be a list of strings")

        game, diff = marshal_roll_difficulty(
            game,
            player_ids=player_ids,
            seed=params.get("seed"),
        )
        result = {
            "ok": True,
            "action": req.action,
            "difficulty": {
                "rule_id": diff.rule_id,
                "base": diff.base,
                "value": diff.value,
                "drawn_cards": diff.drawn_cards,
                "effects": [e.__dict__ for e in diff.effects],
            },
        }

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    # bump revision on any request (even no-op is fine; if you prefer, only bump on mutations)
    game = _bump_revision(game)

    # validate invariants
    validate_game_state(game)

    # persist
    g.state = game

    return ActionResponse(
        game_id=req.game_id,
        revision=game.meta.get("revision", 0),
        state=game_state_to_dict(game, view=req.view),
        events=events,
        result=result,
    )