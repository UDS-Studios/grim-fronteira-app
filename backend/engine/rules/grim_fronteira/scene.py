from __future__ import annotations

from typing import Any

from backend.engine.grimdeck.deck_ops import play, shuffle as shuffle_deck
from backend.engine.grimdeck.models import CardID, DeckState
from backend.engine.rules.grim_fronteira.scene_difficulty import marshal_roll_difficulty
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_unique_cards
from backend.engine.state.zone_ops import claim_from_in_play


SCENE_STATUS_IDLE = "idle"
SCENE_STATUS_SETUP = "setup"
SCENE_STATUS_ACTIVE = "active"
SCENE_STATUS_RESOLVED = "resolved"

SCENE_DIFFICULTY_ZONE = "scene.difficulty"
SCENE_AZZARDO_ZONE = "scene.azzardo"
SCENE_HAND_PREFIX = "scene.hand."


def default_scene_state() -> dict[str, Any]:
    return {
        "status": SCENE_STATUS_IDLE,
        "participants": [],
        "dark_mode": False,
        "difficulty": {
            "rule_id": None,
            "base": None,
            "card_id": None,
            "value": None,
        },
        "azzardo": {
            "status": "unavailable",
            "card_id": None,
            "value": None,
            "revealed": False,
        },
        "players": {},
        "resolution": {
            "completed": False,
            "winners": [],
            "losers": [],
        },
    }


def ensure_scene_state(game: GameState) -> GameState:
    meta = dict(game.meta or {})
    meta["scene"] = _normalized_scene(meta.get("scene"))
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


def scene_set_participants(game: GameState, *, actor_id: str, participant_ids: list[str]) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] not in (SCENE_STATUS_IDLE, SCENE_STATUS_SETUP, SCENE_STATUS_RESOLVED):
        raise ValueError("Scene participants can only be set while the scene is idle, setup, or resolved.")
    if not all(isinstance(pid, str) and pid for pid in participant_ids):
        raise ValueError("participant_ids must be a list of non-empty player ids.")

    valid_players = set(_non_marshal_players(game))
    invalid = [pid for pid in participant_ids if pid not in valid_players]
    if invalid:
        raise ValueError(f"Participants must be registered non-marshal players: {', '.join(invalid)}")

    missing_character = [pid for pid in participant_ids if not _player_has_character(game, pid)]
    if missing_character:
        raise ValueError(f"Participants must already have characters: {', '.join(missing_character)}")

    zones = _reset_scene_zones(game.zones)
    players = {pid: _default_scene_player(game, pid) for pid in participant_ids}

    scene["status"] = SCENE_STATUS_SETUP
    scene["participants"] = participant_ids.copy()
    scene["dark_mode"] = False
    scene["difficulty"] = default_scene_state()["difficulty"]
    scene["azzardo"] = default_scene_state()["azzardo"]
    scene["players"] = players
    scene["resolution"] = default_scene_state()["resolution"]

    return _replace_scene(game, scene=scene, zones=zones)


def scene_roll_difficulty(game: GameState, *, actor_id: str, seed: int | None = None) -> tuple[GameState, dict[str, Any]]:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_SETUP:
        raise ValueError("Difficulty can only be rolled while the scene is in setup.")
    if not scene["participants"]:
        raise ValueError("Scene participants must be selected before rolling difficulty.")
    if scene["difficulty"]["card_id"] is not None:
        raise ValueError("Scene difficulty has already been rolled.")

    game = _replace_scene(game, scene=scene, zones=_reset_scene_zones(game.zones, keep_hands=True))
    game, diff = marshal_roll_difficulty(game, seed=seed, zone_name=SCENE_DIFFICULTY_ZONE)

    scene = _scene(game)
    card_id = diff.drawn_cards[0] if diff.drawn_cards else None
    scene["difficulty"] = {
        "rule_id": diff.rule_id,
        "base": diff.base,
        "card_id": card_id,
        "value": diff.value,
    }
    scene["dark_mode"] = bool(any(effect.kind == "DARK_MODE" for effect in diff.effects))

    game = _replace_scene(game, scene=scene)
    return game, {
        "rule_id": diff.rule_id,
        "base": diff.base,
        "card_id": card_id,
        "value": diff.value,
        "effects": [effect.kind for effect in diff.effects],
    }


def scene_draw_azzardo(game: GameState, *, actor_id: str, seed: int | None = None) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_SETUP:
        raise ValueError("Azzardo can only be drawn while the scene is in setup.")
    if scene["difficulty"]["card_id"] is None:
        raise ValueError("Scene difficulty must be rolled before drawing azzardo.")
    if scene["azzardo"]["status"] != "unavailable":
        raise ValueError("Azzardo is already set for this scene.")

    if seed is not None:
        if game.deck is None:
            raise ValueError("GameState has no deck.")
        game = GameState(deck=shuffle_deck(game.deck, seed=seed), zones=game.zones, meta=game.meta)

    game, card_id = _draw_to_zone(game, SCENE_AZZARDO_ZONE)
    scene = _scene(game)
    scene["azzardo"] = {
        "status": "drawn",
        "card_id": card_id,
        "value": _blackjack_value(card_id),
        "revealed": False,
    }
    return _replace_scene(game, scene=scene)


def scene_skip_azzardo(game: GameState, *, actor_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_SETUP:
        raise ValueError("Azzardo can only be skipped while the scene is in setup.")
    if scene["difficulty"]["card_id"] is None:
        raise ValueError("Scene difficulty must be rolled before skipping azzardo.")
    if scene["azzardo"]["status"] != "unavailable":
        raise ValueError("Azzardo is already set for this scene.")

    scene["azzardo"] = {
        "status": "skipped",
        "card_id": None,
        "value": None,
        "revealed": False,
    }
    return _replace_scene(game, scene=scene)


def scene_start(game: GameState, *, actor_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_SETUP:
        raise ValueError("Scene can only start from setup.")
    if not scene["participants"]:
        raise ValueError("Scene requires at least one participant.")
    if scene["difficulty"]["card_id"] is None:
        raise ValueError("Scene difficulty must be rolled before starting.")
    if scene["azzardo"]["status"] not in ("drawn", "skipped"):
        raise ValueError("Azzardo must be drawn or skipped before starting the scene.")

    scene["status"] = SCENE_STATUS_ACTIVE
    return _replace_scene(game, scene=scene)


def scene_draw_card(game: GameState, *, player_id: str) -> GameState:
    _require_table_phase(game)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_ACTIVE:
        raise ValueError("Scene cards can only be drawn while the scene is active.")
    if player_id not in scene["participants"]:
        raise ValueError("Only scene participants can draw scene cards.")

    pstate = dict(scene["players"].get(player_id) or {})
    if pstate.get("standing"):
        raise ValueError("Player has already stood.")
    if pstate.get("busted"):
        raise ValueError("Player is already busted.")

    zone_name = f"{SCENE_HAND_PREFIX}{player_id}"
    game, _card_id = _draw_to_zone(game, zone_name)
    scene = _scene(game)
    pstate = dict(scene["players"].get(player_id) or {})

    hand_cards = list(game.zones.get(zone_name, []))
    hand_value = 10 + _cards_blackjack_value(hand_cards)

    pstate["hand_value"] = hand_value
    pstate["busted"] = hand_value > 21
    scene["players"][player_id] = pstate
    return _replace_scene(game, scene=scene)


def scene_stand(game: GameState, *, player_id: str) -> GameState:
    _require_table_phase(game)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_ACTIVE:
        raise ValueError("Players can only stand while the scene is active.")
    if player_id not in scene["participants"]:
        raise ValueError("Only scene participants can stand.")

    pstate = dict(scene["players"].get(player_id) or {})
    if pstate.get("standing"):
        raise ValueError("Player has already stood.")
    if pstate.get("busted"):
        raise ValueError("Player is already busted.")

    pstate["standing"] = True
    scene["players"][player_id] = pstate
    return _replace_scene(game, scene=scene)


def scene_resolve(game: GameState, *, actor_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_ACTIVE:
        raise ValueError("Scene can only be resolved while active.")

    unresolved = [
        pid
        for pid in scene["participants"]
        if not bool((scene["players"].get(pid) or {}).get("standing"))
        and not bool((scene["players"].get(pid) or {}).get("busted"))
    ]
    if unresolved:
        raise ValueError(f"All participants must stand or bust before resolution: {', '.join(unresolved)}")

    azzardo = dict(scene["azzardo"])
    if azzardo["status"] == "drawn":
        azzardo["revealed"] = True

    effective_difficulty = int(scene["difficulty"]["value"])
    if azzardo["status"] == "drawn":
        effective_difficulty += int(azzardo["value"])

    winners: list[str] = []
    losers: list[str] = []

    for pid in scene["participants"]:
        pstate = dict(scene["players"].get(pid) or {})
        pstate["resolved"] = True
        pstate["wounds_gained"] = 0
        pstate["reward_gained"] = False

        if pstate.get("busted"):
            pstate["result"] = "bust"
            pstate["wounds_gained"] = 1
            losers.append(pid)
        elif int(pstate.get("hand_value", 0)) >= effective_difficulty:
            game, _reward_card = _draw_to_zone(game, f"players.{pid}.rewards")
            pstate["result"] = "success"
            pstate["reward_gained"] = True
            winners.append(pid)
        else:
            pstate["result"] = "failure"
            losers.append(pid)

        scene = _scene(game)
        scene["players"][pid] = pstate
        game = _replace_scene(game, scene=scene)

    scene = _scene(game)
    scene["azzardo"] = azzardo
    scene["resolution"] = {
        "completed": True,
        "winners": winners,
        "losers": losers,
    }
    scene["status"] = SCENE_STATUS_RESOLVED
    game = _replace_scene(game, scene=scene)
    validate_unique_cards(game)
    return game


def _default_scene_player(game: GameState, player_id: str) -> dict[str, Any]:
    figure_zone = list(game.zones.get(f"players.{player_id}.character", []))
    if len(figure_zone) != 1:
        raise ValueError(f"Player '{player_id}' must have exactly one character card.")

    figure_card_id = figure_zone[0]
    figure_value = _blackjack_value(figure_card_id)
    return {
        "figure_card_id": figure_card_id,
        "figure_value": figure_value,
        "hand_value": figure_value,
        "standing": False,
        "busted": False,
        "resolved": False,
        "wounds_gained": 0,
        "reward_gained": False,
        "result": None,
    }


def _replace_scene(game: GameState, *, scene: dict[str, Any], zones: dict[str, list[CardID]] | None = None) -> GameState:
    meta = dict(game.meta or {})
    meta["scene"] = _normalized_scene(scene)
    return GameState(deck=game.deck, zones=game.zones if zones is None else zones, meta=meta)


def _scene(game: GameState) -> dict[str, Any]:
    return _normalized_scene((game.meta or {}).get("scene"))


def _normalized_scene(raw_scene: Any) -> dict[str, Any]:
    default = default_scene_state()
    scene_in = dict(raw_scene or {})
    difficulty_in = dict(scene_in.get("difficulty") or {})
    azzardo_in = dict(scene_in.get("azzardo") or {})
    resolution_in = dict(scene_in.get("resolution") or {})
    players_in = dict(scene_in.get("players") or {})

    scene = {
        "status": scene_in.get("status") if scene_in.get("status") in {
            SCENE_STATUS_IDLE,
            SCENE_STATUS_SETUP,
            SCENE_STATUS_ACTIVE,
            SCENE_STATUS_RESOLVED,
        } else default["status"],
        "participants": [pid for pid in scene_in.get("participants") or [] if isinstance(pid, str)],
        "dark_mode": bool(scene_in.get("dark_mode", default["dark_mode"])),
        "difficulty": {
            "rule_id": difficulty_in.get("rule_id"),
            "base": difficulty_in.get("base"),
            "card_id": difficulty_in.get("card_id"),
            "value": difficulty_in.get("value"),
        },
        "azzardo": {
            "status": azzardo_in.get("status")
            if azzardo_in.get("status") in {"unavailable", "drawn", "skipped"}
            else default["azzardo"]["status"],
            "card_id": azzardo_in.get("card_id"),
            "value": azzardo_in.get("value"),
            "revealed": bool(azzardo_in.get("revealed", default["azzardo"]["revealed"])),
        },
        "players": {},
        "resolution": {
            "completed": bool(resolution_in.get("completed", default["resolution"]["completed"])),
            "winners": [pid for pid in resolution_in.get("winners") or [] if isinstance(pid, str)],
            "losers": [pid for pid in resolution_in.get("losers") or [] if isinstance(pid, str)],
        },
    }

    for pid, pstate in players_in.items():
        if not isinstance(pid, str):
            continue
        pdata = dict(pstate or {})
        scene["players"][pid] = {
            "figure_card_id": pdata.get("figure_card_id"),
            "figure_value": pdata.get("figure_value"),
            "hand_value": pdata.get("hand_value"),
            "standing": bool(pdata.get("standing", False)),
            "busted": bool(pdata.get("busted", False)),
            "resolved": bool(pdata.get("resolved", False)),
            "wounds_gained": int(pdata.get("wounds_gained", 0) or 0),
            "reward_gained": bool(pdata.get("reward_gained", False)),
            "result": pdata.get("result"),
        }

    return scene


def _reset_scene_zones(zones: dict[str, list[CardID]], *, keep_hands: bool = False) -> dict[str, list[CardID]]:
    new_zones: dict[str, list[CardID]] = {}
    for zone_name, cards in zones.items():
        if zone_name in {SCENE_DIFFICULTY_ZONE, SCENE_AZZARDO_ZONE}:
            continue
        if zone_name.startswith(SCENE_HAND_PREFIX) and not keep_hands:
            continue
        new_zones[zone_name] = cards.copy()
    return new_zones


def _draw_to_zone(game: GameState, zone_name: str) -> tuple[GameState, CardID]:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    new_deck = play(game.deck)
    game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)
    card_id = game.deck.in_play[-1]
    game = claim_from_in_play(game, card_id, zone_name)
    return game, card_id


def _require_table_phase(game: GameState) -> None:
    if (game.meta or {}).get("phase") != "table":
        raise ValueError("Action allowed only during table phase.")


def _require_marshal(game: GameState, actor_id: str) -> None:
    if (game.meta or {}).get("marshal_id") != actor_id:
        raise ValueError("Only the Marshal can perform this action.")


def _player_has_character(game: GameState, player_id: str) -> bool:
    cards = game.zones.get(f"players.{player_id}.character", [])
    return isinstance(cards, list) and len(cards) == 1


def _non_marshal_players(game: GameState) -> list[str]:
    meta = dict(game.meta or {})
    marshal_id = meta.get("marshal_id")
    order = meta.get("players_order") or []
    return [pid for pid in order if isinstance(pid, str) and pid != marshal_id]


def _blackjack_value(card_id: str) -> int:
    rank = _rank(card_id)
    if rank in ("RJ", "BJ", "J", "Q", "K"):
        return 10
    if rank == "A":
        return 11
    return int(rank)


def _cards_blackjack_value(cards: list[str]) -> int:
    return sum(_blackjack_value(card_id) for card_id in cards)


def _rank(card_id: str) -> str:
    if card_id in ("RJ", "BJ"):
        return card_id
    return card_id[:-1]
