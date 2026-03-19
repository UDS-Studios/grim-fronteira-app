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

from backend.engine.helpers.hooks import generate_hook_suggestions
from backend.engine.helpers.characters import character_label, figure_to_character
from backend.engine.helpers.character_creation import pick_three

FIGURE_POOL_ZONE = "lobby.figure_pool.available"


def _meta_copy(meta: dict | None) -> dict:
    return dict(meta or {})


def _lobby_copy(meta: dict) -> dict:
    return dict(meta.get("lobby") or {})

def _lobby_players(meta: dict) -> dict:
    lobby = dict(meta.get("lobby") or {})
    players = dict(lobby.get("players") or {})
    lobby["players"] = players
    meta["lobby"] = lobby
    return players


def _empty_lobby_player_state(player_id: str) -> dict:
    return {
        "stage": "waiting_for_figure",
        "card_id": None,
        "character_label": None,

        "rank_name": None,
        "rank_burden_text": None,

        "faction_name": None,
        "ability_name": None,
        "ability_text": None,

        "character_rules": [],

        "name_suggestions": [],
        "chosen_name": None,
        "feature_suggestions": [],
        "chosen_feature": None,
        "ready": False,
        "summary_text": None,
        "display_text": f"{player_id} has not selected a figure yet",
    }


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
    players = _lobby_players(meta)
    players[creator_id] = _empty_lobby_player_state(creator_id)

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

    players = _lobby_players(meta)
    players[player_id] = _empty_lobby_player_state(player_id)

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
    players = _lobby_players(meta)
    pstate = dict(players.get(player_id) or _empty_lobby_player_state(player_id))

    info = figure_to_character(card_id)

    pstate["card_id"] = card_id
    pstate["character_label"] = character_label(card_id)

    pstate["rank_name"] = info["role"]
    pstate["rank_burden_text"] = info["rank_burden_text"]

    pstate["faction_name"] = info["faction"]
    pstate["ability_name"] = info["ability_name"]
    pstate["ability_text"] = info["ability_text"]

    pstate["character_rules"] = [
        info["rank_burden_text"],
        info["ability_rule_text"],
    ]
    pstate["name_suggestions"] = pick_three(card_id)
    pstate["chosen_name"] = None
    pstate["feature_suggestions"] = []
    pstate["chosen_feature"] = None
    pstate["ready"] = False
    pstate["stage"] = "waiting_for_name"
    pstate["summary_text"] = None
    pstate["display_text"] = f"{player_id} selected {pstate['character_label']}. Choose a name."

    players[player_id] = pstate
    game = GameState(deck=game.deck, zones=game.zones, meta=meta)

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

    card_id = game.zones[f"players.{player_id}.character"][0]
    info = figure_to_character(card_id)

    meta = _meta_copy(game.meta)
    players = _lobby_players(meta)
    pstate = dict(players.get(player_id) or _empty_lobby_player_state(player_id))

    pstate["card_id"] = card_id
    pstate["character_label"] = character_label(card_id)

    pstate["rank_name"] = info["role"]
    pstate["rank_burden_text"] = info["rank_burden_text"]

    pstate["faction_name"] = info["faction"]
    pstate["ability_name"] = info["ability_name"]
    pstate["ability_text"] = info["ability_text"]

    pstate["character_rules"] = [
        info["rank_burden_text"],
        info["ability_rule_text"],
    ]

    pstate["name_suggestions"] = pick_three(card_id, seed=seed)
    pstate["chosen_name"] = None
    pstate["feature_suggestions"] = []
    pstate["chosen_feature"] = None
    pstate["ready"] = False
    pstate["stage"] = "waiting_for_name"
    pstate["summary_text"] = None
    pstate["display_text"] = f"{player_id} selected {pstate['character_label']}. Choose a name."

    players[player_id] = pstate

    lobby = _lobby_copy(meta)
    lobby["character_assignment_locked"] = True
    meta["lobby"] = lobby

    return GameState(deck=game.deck, zones=game.zones, meta=meta)

def submit_character_name(game: GameState, player_id: str, name: str, seed: int | None = None) -> GameState:
    _require_lobby(game)

    if player_id not in _registered_players(game):
        raise ValueError(f"Player '{player_id}' is not registered.")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Character name must be a non-empty string.")

    meta = _meta_copy(game.meta)
    players = _lobby_players(meta)
    pstate = dict(players.get(player_id) or _empty_lobby_player_state(player_id))

    if pstate.get("stage") != "waiting_for_name":
        raise ValueError("Player is not waiting for a character name.")

    chosen_name = name.strip()
    pstate["chosen_name"] = chosen_name
    pstate["feature_suggestions"] = pick_three("feature", seed=seed)
    pstate["stage"] = "waiting_for_feature"
    pstate["display_text"] = f"{chosen_name} has taken a name. Now choose a distinctive feature."

    players[player_id] = pstate
    return GameState(deck=game.deck, zones=game.zones, meta=meta)

def submit_character_feature(game: GameState, player_id: str, feature: str) -> GameState:
    _require_lobby(game)

    if player_id not in _registered_players(game):
        raise ValueError(f"Player '{player_id}' is not registered.")
    if not isinstance(feature, str) or not feature.strip():
        raise ValueError("Character feature must be a non-empty string.")

    meta = _meta_copy(game.meta)
    players = _lobby_players(meta)
    pstate = dict(players.get(player_id) or _empty_lobby_player_state(player_id))

    if pstate.get("stage") != "waiting_for_feature":
        raise ValueError("Player is not waiting for a character feature.")
    if not pstate.get("chosen_name"):
        raise ValueError("Player must choose a character name first.")
    if not pstate.get("character_label"):
        raise ValueError("Player must choose a figure first.")

    chosen_feature = feature.strip()
    pstate["chosen_feature"] = chosen_feature
    pstate["ready"] = True
    pstate["stage"] = "ready"
    pstate["summary_text"] = (
        f"{pstate['chosen_name']}, a {pstate['character_label']} with {chosen_feature}"
    )
    pstate["display_text"] = (
        f"Your character is {pstate['chosen_name']}, a {pstate['character_label']} with {chosen_feature}."
    )

    players[player_id] = pstate
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
    players = dict(lobby.get("players") or {})
    order = list(meta.get("players_order") or [])
    marshal_id = meta.get("marshal_id")

    not_ready = [
        pid for pid in order
        if pid != marshal_id and not bool((players.get(pid) or {}).get("ready", False))
    ]
    if not_ready:
        raise ValueError(f"Cannot start game: players not ready: {', '.join(not_ready)}")

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

    meta["phase"] = "hook_selection"
    meta["hooks"] = {
        "suggestions": generate_hook_suggestions(seed=seed, count=3),
        "selected_hook": None,
    }

    return GameState(deck=game.deck, zones=game.zones, meta=meta)

def begin_table(game: GameState, actor_id: str, selected_hook: str | None = None) -> GameState:
    if (game.meta or {}).get("phase") != "hook_selection":
        raise ValueError("Action allowed only during hook_selection phase.")

    if (game.meta or {}).get("marshal_id") != actor_id:
        raise ValueError("Only the Marshal can perform this action.")

    meta = _meta_copy(game.meta)
    hooks = dict(meta.get("hooks") or {})

    suggestions = hooks.get("suggestions") or []
    if selected_hook is not None:
        if not isinstance(selected_hook, str) or not selected_hook.strip():
            raise ValueError("selected_hook must be a non-empty string or omitted.")
        if selected_hook not in suggestions:
            raise ValueError("selected_hook must be one of the suggested hooks.")
        hooks["selected_hook"] = selected_hook

    meta["hooks"] = hooks
    meta["phase"] = "table"

    return GameState(deck=game.deck, zones=game.zones, meta=meta)