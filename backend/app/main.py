from __future__ import annotations

from uuid import uuid4
from typing import Any, Dict, List, Literal, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from backend.app.schemas import NewGameRequest, ActionRequest, ActionResponse, ErrorPayload
from backend.app.store import GAMES, StoredGame
from backend.app.serializers import game_state_to_dict

from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.grimdeck.deck_ops import shuffle as shuffle_deck
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_game_state

from backend.engine.rules.grim_fronteira.setup import setup_players
from backend.engine.rules.grim_fronteira.scene_difficulty import marshal_roll_difficulty

app = FastAPI(title="Grim Fronteira API", version="0.1.0")

# --- Dev CORS: Vite + localhost variants ---
DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Error envelope handlers (consistent payload shape) ---

async def _extract_game_context(request: Request) -> Tuple[str, int]:
    """
    Best-effort: if request body is JSON and contains game_id, return (game_id, revision).
    Otherwise ("", 0). Never raises.
    """
    game_id = ""
    revision = 0
    try:
        body = await request.json()
        if isinstance(body, dict):
            game_id = body.get("game_id") or ""
            if isinstance(game_id, str) and game_id in GAMES:
                revision = int(GAMES[game_id].state.meta.get("revision", 0))
            else:
                game_id = "" if not isinstance(game_id, str) else game_id
    except Exception:
        pass
    return game_id, revision

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    game_id, revision = await _extract_game_context(request)
    payload = ActionResponse(
        game_id=game_id,
        revision=revision,
        state={},
        events=[],
        result={},
        error=ErrorPayload(
            code="VALIDATION_ERROR",
            message="Request validation failed",
            details={"errors": exc.errors()},
        ),
    )
    return JSONResponse(status_code=422, content=payload.model_dump())


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    game_id, revision = await _extract_game_context(request)
    payload = ActionResponse(
        game_id=game_id,
        revision=revision,
        state={},
        events=[],
        result={},
        error=ErrorPayload(
            code=f"HTTP_{exc.status_code}",
            message=str(exc.detail),
            details=None,
        ),
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    game_id, revision = await _extract_game_context(request)
    payload = ActionResponse(
        game_id=game_id,
        revision=revision,
        state={},
        events=[],
        result={},
        error=ErrorPayload(
            code="BAD_REQUEST",
            message=str(exc),
            details=None,
        ),
    )
    return JSONResponse(status_code=400, content=payload.model_dump())

# --- Helpers ---

def _get_game(game_id: str) -> StoredGame:
    g = GAMES.get(game_id)
    if g is None:
        raise HTTPException(status_code=404, detail=f"Unknown game_id '{game_id}'")
    return g


def _bump_revision(game: GameState) -> GameState:
    meta = dict(game.meta or {})
    meta["revision"] = int(meta.get("revision", 0)) + 1
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


# --- Routes ---

@app.post("/api/gf/new", response_model=ActionResponse)
def new_game(req: NewGameRequest) -> ActionResponse:
    deck = load_deck(req.template_path)

    # Optional deterministic shuffle for reproducible dev runs
    if req.seed is not None:
        deck = shuffle_deck(deck, seed=req.seed)

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
        error=None,
    )


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
        error=None,
    )


@app.post("/api/gf/action", response_model=ActionResponse)
def action(req: ActionRequest) -> ActionResponse:
    g = _get_game(req.game_id)
    game = g.state

    events: List[Dict[str, Any]] = []  # keep, even if empty (future Unreal-friendly)
    result: Dict[str, Any] = {}
    mutated = False

    if req.action == "gf.get_state":
        # no-op
        result = {"ok": True, "action": req.action}

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
        mutated = True
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
        mutated = True
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

    # bump revision only on mutations
    if mutated:
        game = _bump_revision(game)

    validate_game_state(game)
    g.state = game

    return ActionResponse(
        game_id=req.game_id,
        revision=game.meta.get("revision", 0),
        state=game_state_to_dict(game, view=req.view),
        events=events,
        result=result,
        error=None,
    )