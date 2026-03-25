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
from backend.engine.rules.grim_fronteira.meta_enrich import enrich_meta_for_ui
from backend.engine.rules.grim_fronteira.scene import (
    ensure_scene_state,
    scene_set_participants,
    scene_roll_difficulty,
    scene_draw_azzardo,
    scene_remove_azzardo,
    scene_skip_azzardo,
    scene_start,
    scene_resolve,
    scene_draw_card,
    scene_stand,
)

from backend.engine.rules.grim_fronteira.lobby import (
    initialize_lobby,
    set_character_assignment_mode,
    claim_character,
    draw_character,
    join_lobby,
    set_registration_open,
    submit_character_name,
    submit_character_feature,
    start_game,
    begin_table,
)

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

    if req.seed is not None:
        deck = shuffle_deck(deck, seed=req.seed)

    game = GameState(deck=deck, zones={}, meta={"game": "grim_fronteira", **(req.meta or {})})
    game = initialize_lobby(game, creator_id=req.creator_id)
    game = enrich_meta_for_ui(game)
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
def get_state(game_id: str, view: Literal["public", "player", "debug"] = "debug") -> ActionResponse:
    g = _get_game(game_id)
    game = g.state
    validate_game_state(game)
    game = enrich_meta_for_ui(game)
    game = ensure_scene_state(game)

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
                "effects": [e.kind for e in diff.effects],
            },
        }
    elif req.action == "gf.set_character_assignment_mode":
        params = req.params
        actor_id = params.get("actor_id")
        mode = params.get("mode")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if not isinstance(mode, str):
            raise HTTPException(status_code=400, detail="params.mode must be a string")

        game = set_character_assignment_mode(game, actor_id=actor_id, mode=mode)
        mutated = True
        result = {"ok": True, "action": req.action, "mode": mode}

    elif req.action == "gf.join_lobby":
        params = req.params
        player_id = params.get("player_id")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")

        game = join_lobby(game, player_id=player_id)
        mutated = True
        result = {"ok": True, "action": req.action, "player_id": player_id}

    elif req.action == "gf.claim_character":
        params = req.params
        player_id = params.get("player_id")
        card_id = params.get("card_id")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")
        if not isinstance(card_id, str):
            raise HTTPException(status_code=400, detail="params.card_id must be a string")

        game = claim_character(game, player_id=player_id, card_id=card_id)
        mutated = True
        result = {"ok": True, "action": req.action, "player_id": player_id, "card_id": card_id}

    elif req.action == "gf.draw_character":
        params = req.params
        player_id = params.get("player_id")
        seed = params.get("seed")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")
        if seed is not None and not isinstance(seed, int):
            raise HTTPException(status_code=400, detail="params.seed must be an integer or omitted")

        game = draw_character(game, player_id=player_id, seed=seed)
        mutated = True
        result = {"ok": True, "action": req.action, "player_id": player_id}

    elif req.action == "gf.submit_character_name":
        params = req.params
        player_id = params.get("player_id")
        name = params.get("name")
        seed = params.get("seed")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")
        if not isinstance(name, str):
            raise HTTPException(status_code=400, detail="params.name must be a string")
        if seed is not None and not isinstance(seed, int):
            raise HTTPException(status_code=400, detail="params.seed must be an integer or omitted")

        game = submit_character_name(game, player_id=player_id, name=name, seed=seed)
        mutated = True
        result = {
            "ok": True,
            "action": req.action,
            "player_id": player_id,
            "name": name,
        }

    elif req.action == "gf.submit_character_feature":
        params = req.params
        player_id = params.get("player_id")
        feature = params.get("feature")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")
        if not isinstance(feature, str):
            raise HTTPException(status_code=400, detail="params.feature must be a string")

        game = submit_character_feature(game, player_id=player_id, feature=feature)
        mutated = True
        result = {
            "ok": True,
            "action": req.action,
            "player_id": player_id,
            "feature": feature,
        }

    elif req.action == "gf.set_registration_open":
        params = req.params
        actor_id = params.get("actor_id")
        is_open = params.get("is_open")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if not isinstance(is_open, bool):
            raise HTTPException(status_code=400, detail="params.is_open must be a boolean")

        game = set_registration_open(game, actor_id=actor_id, is_open=is_open)
        mutated = True
        result = {"ok": True, "action": req.action, "registration_open": is_open}

    elif req.action == "gf.start_game":
        params = req.params
        actor_id = params.get("actor_id")
        seed = params.get("seed")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if seed is not None and not isinstance(seed, int):
            raise HTTPException(status_code=400, detail="params.seed must be an integer or omitted")

        game = start_game(game, actor_id=actor_id, seed=seed)
        mutated = True
        result = {"ok": True, "action": req.action, "phase": "hook_selection"}

    elif req.action == "gf.begin_table":
        params = req.params
        actor_id = params.get("actor_id")
        selected_hook = params.get("selected_hook")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if selected_hook is not None and not isinstance(selected_hook, str):
            raise HTTPException(status_code=400, detail="params.selected_hook must be a string or omitted")

        game = begin_table(game, actor_id=actor_id, selected_hook=selected_hook)
        mutated = True
        result = {
            "ok": True,
            "action": req.action,
            "phase": "table",
            "selected_hook": selected_hook,
        }

    elif req.action == "gf.scene_set_participants":
        params = req.params
        actor_id = params.get("actor_id")
        participant_ids = params.get("participant_ids")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if not isinstance(participant_ids, list) or not all(isinstance(pid, str) for pid in participant_ids):
            raise HTTPException(status_code=400, detail="params.participant_ids must be a list of strings")

        game = scene_set_participants(game, actor_id=actor_id, participant_ids=participant_ids)
        mutated = True
        result = {"ok": True, "action": req.action, "participant_ids": participant_ids}

    elif req.action == "gf.scene_roll_difficulty":
        params = req.params
        actor_id = params.get("actor_id")
        seed = params.get("seed")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if seed is not None and not isinstance(seed, int):
            raise HTTPException(status_code=400, detail="params.seed must be an integer or omitted")

        game, difficulty = scene_roll_difficulty(game, actor_id=actor_id, seed=seed)
        mutated = True
        result = {"ok": True, "action": req.action, "difficulty": difficulty}

    elif req.action == "gf.scene_draw_azzardo":
        params = req.params
        actor_id = params.get("actor_id")
        seed = params.get("seed")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")
        if seed is not None and not isinstance(seed, int):
            raise HTTPException(status_code=400, detail="params.seed must be an integer or omitted")

        game = scene_draw_azzardo(game, actor_id=actor_id, seed=seed)
        mutated = True
        result = {"ok": True, "action": req.action}

    elif req.action == "gf.scene_remove_azzardo":
        params = req.params
        actor_id = params.get("actor_id")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")

        game = scene_remove_azzardo(game, actor_id=actor_id)
        mutated = True
        result = {"ok": True, "action": req.action}

    elif req.action == "gf.scene_skip_azzardo":
        params = req.params
        actor_id = params.get("actor_id")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")

        game = scene_skip_azzardo(game, actor_id=actor_id)
        mutated = True
        result = {"ok": True, "action": req.action}

    elif req.action == "gf.scene_start":
        params = req.params
        actor_id = params.get("actor_id")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")

        game = scene_start(game, actor_id=actor_id)
        mutated = True
        result = {"ok": True, "action": req.action}

    elif req.action == "gf.scene_draw_card":
        params = req.params
        player_id = params.get("player_id")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")

        game = scene_draw_card(game, player_id=player_id)
        mutated = True
        result = {"ok": True, "action": req.action, "player_id": player_id}

    elif req.action == "gf.scene_stand":
        params = req.params
        player_id = params.get("player_id")

        if not isinstance(player_id, str):
            raise HTTPException(status_code=400, detail="params.player_id must be a string")

        game = scene_stand(game, player_id=player_id)
        mutated = True
        result = {"ok": True, "action": req.action, "player_id": player_id}

    elif req.action == "gf.scene_resolve":
        params = req.params
        actor_id = params.get("actor_id")

        if not isinstance(actor_id, str):
            raise HTTPException(status_code=400, detail="params.actor_id must be a string")

        game = scene_resolve(game, actor_id=actor_id)
        mutated = True
        result = {"ok": True, "action": req.action}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    # bump revision only on mutations
    if mutated:
        game = _bump_revision(game)

    game = enrich_meta_for_ui(game)
    game = ensure_scene_state(game)
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
