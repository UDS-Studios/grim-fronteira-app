from __future__ import annotations

from typing import List

from backend.engine.grimdeck.models import CardID
from backend.engine.state.game_state import GameState
from backend.engine.rules.grim_fronteira.setup import (
    extract_face_pile,
    choose_from_face_pile,
    draw_from_face_pile,
    shuffle_zone,
    setup_starting_baggage,
    return_face_pile_to_deck,
)

FIGURE_POOL_ZONE = "lobby.figure_pool.available"


def _meta_copy(meta: dict | None) -> dict:
    return dict(meta or {})


def _lobby_copy(meta: dict) -> dict:
    return dict(meta.get("lobby") or {})


def _ensure_player_zones(game: GameState, player_id: str) -> GameState:
    zones = {k: v.copy() for k, v in game.zones.items()}

    for zone_name in (
        f"players.{player_id}.character",
        f"players.{player_id}.scum",
        f"players.{player_id}.vengeance",
        f"players.{player_id}.rewards",
    ):
        zones.setdefault(zone_name, [])

    return GameState(deck=game.deck, zones=zones, meta=game.meta)


def _player_has_character(game: GameState, player_id: str) -> bool:
    cards = game.zones.get(f"players.{player_id}.character", [])
    return isinstance(cards, list) and len(cards) == 1


def _registered_players(game: GameState) -> List[str]:
    order = (game.meta or {}).get("players_order", [])
    if isinstance(order, list):
        return [x for x in order if isinstance(x, str)]
    return []


def _require_lobby(game: GameState) -> None:
    if (game.meta or {}).get("phase") != "lobby":
        raise ValueError("Action allowed only during lobby phase.")


def _require_marshal(game: GameState, actor_id: str) -> None:
    if (game.meta or {}).get("marshal_id") != actor_id:
        raise ValueError("Only the Marshal can perform this action.")


def initialize_lobby(game: GameState, creator_id: str) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")
    if not creator_id:
        raise ValueError("creator_id is required.")

    # Extract all face cards into the lobby figure pool
    game = extract_face_pile(game, zone_name=FIGURE_POOL_ZONE)

    # Initialize Marshal player zones
    game = _ensure_player_zones(game, creator_id)

    meta = _meta_copy(game.meta)
    meta["phase"] = "lobby"
    meta["marshal_id"] = creator_id
    meta["players_order"] = [creator_id]
    meta["lobby"] = {
        "registration_open": True,
        "character_assignment_mode": "choice",
        "character_assignment_locked": False,
        "game_started": False,
    }

    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def set_character_assignment_mode(game: GameState, actor_id: str, mode: str) -> GameState:
    _require_lobby(game)
    _require_marshal(game, actor_id)

    if mode not in ("choice", "random"):
        raise ValueError("character_assignment_mode must be 'choice' or 'random'.")

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("character_assignment_locked", False):
        raise ValueError("Character assignment mode is already locked.")

    lobby["character_assignment_mode"] = mode
    meta["lobby"] = lobby
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def join_lobby(game: GameState, player_id: str) -> GameState:
    _require_lobby(game)

    if not player_id:
        raise ValueError("player_id is required.")

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("game_started", False):
        raise ValueError("Cannot join: game already started.")
    if not lobby.get("registration_open", False):
        raise ValueError("Cannot join: registration is closed.")

    order = list(meta.get("players_order") or [])
    if player_id in order:
        raise ValueError(f"Player '{player_id}' is already registered.")

    order.append(player_id)
    meta["players_order"] = order

    game = _ensure_player_zones(game, player_id)
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def claim_character(game: GameState, player_id: str, card_id: CardID) -> GameState:
    _require_lobby(game)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("character_assignment_mode") != "choice":
        raise ValueError("Character assignment mode is not 'choice'.")
    if player_id not in _registered_players(game):
        raise ValueError(f"Player '{player_id}' is not registered.")
    if _player_has_character(game, player_id):
        raise ValueError(f"Player '{player_id}' already has a character.")

    dest_zone = f"players.{player_id}.character"
    game = choose_from_face_pile(game, card_id, dest_zone, face_pile_zone=FIGURE_POOL_ZONE)
    game = setup_starting_baggage(game, player_id)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)
    lobby["character_assignment_locked"] = True
    meta["lobby"] = lobby

    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def draw_character(game: GameState, player_id: str, seed: int | None = None) -> GameState:
    _require_lobby(game)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("character_assignment_mode") != "random":
        raise ValueError("Character assignment mode is not 'random'.")
    if player_id not in _registered_players(game):
        raise ValueError(f"Player '{player_id}' is not registered.")
    if _player_has_character(game, player_id):
        raise ValueError(f"Player '{player_id}' already has a character.")

    if seed is not None:
        game = shuffle_zone(game, FIGURE_POOL_ZONE, seed=seed)

    dest_zone = f"players.{player_id}.character"
    game = draw_from_face_pile(game, dest_zone, face_pile_zone=FIGURE_POOL_ZONE)
    game = setup_starting_baggage(game, player_id)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)
    lobby["character_assignment_locked"] = True
    meta["lobby"] = lobby

    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def set_registration_open(game: GameState, actor_id: str, is_open: bool) -> GameState:
    _require_lobby(game)
    _require_marshal(game, actor_id)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("game_started", False):
        raise ValueError("Cannot reopen or reclose registration after game start.")

    lobby["registration_open"] = bool(is_open)
    meta["lobby"] = lobby
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def start_game(game: GameState, actor_id: str, seed: int | None = None) -> GameState:
    _require_lobby(game)
    _require_marshal(game, actor_id)

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)

    if lobby.get("game_started", False):
        raise ValueError("Game already started.")
    if lobby.get("character_assignment_mode") not in ("choice", "random"):
        raise ValueError("Character assignment mode must be set before starting the game.")

    missing = [pid for pid in _registered_players(game) if not _player_has_character(game, pid)]
    if missing:
        raise ValueError(f"Cannot start game: players without character: {', '.join(missing)}")

    # Return any remaining figure cards to the main draw pile and shuffle
    if FIGURE_POOL_ZONE in game.zones:
        game = return_face_pile_to_deck(
            game,
            seed=seed,
            face_pile_zone=FIGURE_POOL_ZONE,
            delete_zone=True,
        )

    meta = _meta_copy(game.meta)
    lobby = _lobby_copy(meta)
    lobby["registration_open"] = False
    lobby["game_started"] = True
    lobby["character_assignment_locked"] = True
    meta["lobby"] = lobby
    meta["phase"] = "started"

    return GameState(deck=game.deck, zones=game.zones, meta=meta)