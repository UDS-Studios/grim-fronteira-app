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
SCENE_STATUS_AWAITING_ACK = "awaiting_ack"
SCENE_STATUS_RESOLVED = "resolved"

SCENE_DIFFICULTY_ZONE = "scene.difficulty"
SCENE_AZZARDO_ZONE = "scene.azzardo"
SCENE_HAND_PREFIX = "scene.hand."
SCENE_SCUM_MOD_PREFIX = "scene.mod.scum."
SCENE_VENGEANCE_MOD_PREFIX = "scene.mod.vengeance."


def default_scene_state() -> dict[str, Any]:
    return {
        "status": SCENE_STATUS_IDLE,
        "participants": [],
        "dark_mode": False,
        "bonus_assignments": {},
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
    original_status = scene["status"]
    if scene["status"] == SCENE_STATUS_ACTIVE:
        raise ValueError("Scene participants cannot be changed after the scene has started.")
    if not all(isinstance(pid, str) and pid for pid in participant_ids):
        raise ValueError("participant_ids must be a list of non-empty player ids.")

    valid_players = set(_non_marshal_players(game))
    invalid = [pid for pid in participant_ids if pid not in valid_players]
    if invalid:
        raise ValueError(f"Participants must be registered non-marshal players: {', '.join(invalid)}")

    missing_character = [pid for pid in participant_ids if not _player_has_character(game, pid)]
    if missing_character:
        raise ValueError(f"Participants must already have characters: {', '.join(missing_character)}")

    dead_players = [pid for pid in participant_ids if _player_is_dead(game, pid)]
    if dead_players:
        raise ValueError(f"Dead characters cannot participate in scenes: {', '.join(dead_players)}")

    old_participants = set(scene["participants"])
    new_participants = set(participant_ids)

    if scene["status"] == SCENE_STATUS_IDLE:
        game = _start_clean_setup(game)
        scene = _scene(game)
        zones = game.zones
    elif scene["status"] == SCENE_STATUS_SETUP:
        zones = _remove_scene_hands_for_players(game.zones, old_participants - new_participants)
    else:
        raise ValueError("Scene participants can only be set while the scene is idle or in setup.")

    players = {pid: _default_scene_player(game, pid) for pid in participant_ids}

    scene["status"] = SCENE_STATUS_SETUP
    scene["participants"] = participant_ids.copy()
    if original_status != SCENE_STATUS_SETUP:
        scene["dark_mode"] = False
        scene["difficulty"] = default_scene_state()["difficulty"]
        scene["azzardo"] = default_scene_state()["azzardo"]
    scene["players"] = players
    scene["resolution"] = default_scene_state()["resolution"]

    return _replace_scene(game, scene=scene, zones=zones)


def scene_roll_difficulty(game: GameState, *, actor_id: str, seed: int | None = None) -> tuple[GameState, dict[str, Any]]:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    game = _ensure_scene_setup(game)
    scene = _scene(game)
    if scene["difficulty"]["card_id"] is not None:
        raise ValueError("Scene difficulty has already been rolled.")

    game = _replace_scene(game, scene=scene, zones=_reset_scene_zones(game.zones, keep_hands=True))
    game, diff = marshal_roll_difficulty(game, seed=seed, zone_name=SCENE_DIFFICULTY_ZONE)
    if diff.drawn_cards and diff.drawn_cards[0] in {"RJ", "BJ"}:
        game = _grant_joker_bonus_cards(
            game,
            bonus_type="scum" if diff.drawn_cards[0] == "RJ" else "vengeance",
        )

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


def _grant_joker_bonus_cards(game: GameState, *, bonus_type: str) -> GameState:
    if bonus_type not in {"scum", "vengeance"}:
        raise ValueError("bonus_type must be 'scum' or 'vengeance'.")

    for player_id in _non_marshal_players(game):
        if not _player_has_character(game, player_id) or _player_is_dead(game, player_id):
            continue
        zone_name = f"players.{player_id}.{'scum' if bonus_type == 'scum' else 'vengeance'}"
        game, _card_id = _draw_to_zone(game, zone_name)

    validate_unique_cards(game)
    return game


def _grant_player_joker_bonus_card(game: GameState, *, player_id: str, bonus_type: str) -> GameState:
    if bonus_type not in {"scum", "vengeance"}:
        raise ValueError("bonus_type must be 'scum' or 'vengeance'.")
    if not _player_has_character(game, player_id) or _player_is_dead(game, player_id):
        return game

    zone_name = f"players.{player_id}.{'scum' if bonus_type == 'scum' else 'vengeance'}"
    game, _card_id = _draw_to_zone(game, zone_name)
    validate_unique_cards(game)
    return game


def _reshuffle_discard_into_draw(game: GameState, *, seed: int | None = None) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")
    if not game.deck.discard_pile:
        return game

    merged_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=game.deck.draw_pile + game.deck.discard_pile,
        in_play=game.deck.in_play,
        discard_pile=[],
        removed=game.deck.removed,
    )
    game = GameState(deck=merged_deck, zones=game.zones, meta=game.meta)
    game = GameState(deck=shuffle_deck(game.deck, seed=seed), zones=game.zones, meta=game.meta)
    validate_unique_cards(game)
    return game


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
    if int(scene["difficulty"]["value"] or 0) >= 21:
        raise ValueError("Azzardo is not allowed when scene difficulty is already 21 or higher.")

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


def scene_remove_azzardo(game: GameState, *, actor_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_SETUP:
        raise ValueError("Azzardo can only be removed while the scene is in setup.")
    if scene["azzardo"]["status"] != "drawn":
        raise ValueError("Azzardo must be drawn before it can be removed.")
    if scene["azzardo"]["revealed"]:
        raise ValueError("Revealed azzardo cannot be removed.")

    game = _return_zone_card_to_draw_pile(game, SCENE_AZZARDO_ZONE)
    scene = _scene(game)
    scene["azzardo"] = default_scene_state()["azzardo"]
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
    if scene["azzardo"]["status"] not in ("unavailable", "drawn", "skipped"):
        raise ValueError("Azzardo is in an invalid state for starting the scene.")

    initiative_order: list[tuple[str, int, int]] = []
    for original_idx, pid in enumerate(scene["participants"]):
        zone_name = f"{SCENE_HAND_PREFIX}{pid}"
        game, _card_id = _draw_to_zone(game, zone_name)
        scene = _scene(game)
        pstate = dict(scene["players"].get(pid) or {})
        hand_cards = list(game.zones.get(zone_name, []))
        hand_value = _scene_hand_value(figure_card_id=pstate.get("figure_card_id"), hand_cards=hand_cards)
        pstate["hand_value"] = hand_value
        pstate["busted"] = hand_value > 21
        scene["players"][pid] = pstate
        initiative_order.append((pid, hand_value, original_idx))
        game = _replace_scene(game, scene=scene)

    initiative_order.sort(key=lambda item: (-item[1], item[2]))

    scene = _scene(game)
    scene["participants"] = [pid for pid, _score, _original_idx in initiative_order]
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
    if scene["status"] == SCENE_STATUS_ACTIVE and pstate.get("busted"):
        raise ValueError("Player is already busted.")

    zone_name = f"{SCENE_HAND_PREFIX}{player_id}"
    game, drawn_card_id = _draw_to_zone(game, zone_name)
    if drawn_card_id in {"RJ", "BJ"}:
        game = _grant_player_joker_bonus_card(
            game,
            player_id=player_id,
            bonus_type="scum" if drawn_card_id == "RJ" else "vengeance",
        )
    scene = _scene(game)
    pstate = dict(scene["players"].get(player_id) or {})

    hand_cards = list(game.zones.get(zone_name, []))
    hand_value = _scene_hand_value(figure_card_id=pstate.get("figure_card_id"), hand_cards=hand_cards)

    pstate["hand_value"] = hand_value
    pstate["busted"] = hand_value > 21
    scene["players"][player_id] = pstate
    game = _replace_scene(game, scene=scene)
    return _resolve_scene_if_all_participants_done(game)


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
    game = _replace_scene(game, scene=scene)
    return _resolve_scene_if_all_participants_done(game)


def scene_play_scum(game: GameState, *, player_id: str, target_player_id: str) -> tuple[GameState, dict[str, Any]]:
    _require_table_phase(game)

    scene = _scene(game)
    if scene["status"] not in {SCENE_STATUS_ACTIVE, SCENE_STATUS_AWAITING_ACK}:
        raise ValueError("Scum can only be played while the scene is active or awaiting acknowledgement.")
    if player_id not in _non_marshal_players(game):
        raise ValueError("Only registered non-marshal players can play Scum.")
    if not _player_has_character(game, player_id):
        raise ValueError("Player must have a character to play Scum.")
    if target_player_id not in scene["participants"]:
        raise ValueError("Scum target must be a scene participant.")
    if target_player_id == player_id:
        raise ValueError("Scum must target another participant.")
    if scene["status"] == SCENE_STATUS_ACTIVE and player_id in scene["participants"] and _active_scene_player_id(scene) != player_id:
        raise ValueError("Only the active participant can play Scum.")

    pstate = dict(scene["players"].get(player_id) or {})
    if scene["status"] == SCENE_STATUS_ACTIVE and player_id in scene["participants"] and pstate.get("standing"):
        raise ValueError("Player has already stood.")
    if scene["status"] == SCENE_STATUS_ACTIVE and player_id in scene["participants"] and pstate.get("busted"):
        raise ValueError("Player is already busted.")
    if scene["status"] == SCENE_STATUS_AWAITING_ACK and player_id in scene["participants"] and pstate.get("acknowledged"):
        raise ValueError("Player has already acknowledged the resolved scene.")

    target_state = dict(scene["players"].get(target_player_id) or {})
    if target_state.get("busted"):
        raise ValueError("Busted participants cannot be targeted with Scum.")
    if scene["status"] == SCENE_STATUS_ACTIVE and target_state.get("resolved"):
        raise ValueError("Resolved participants cannot be targeted with Scum.")

    scum_zone = f"players.{player_id}.scum"
    scum_cards = list(game.zones.get(scum_zone, []))
    if not scum_cards:
        raise ValueError("Player has no Scum cards to play.")

    scum_card_id = scum_cards[-1]
    source_figure_card_id = pstate.get("figure_card_id") or _player_character_card_id(game, player_id)
    modifier = -2 if _card_suit(scum_card_id) == _card_suit(source_figure_card_id) else -1

    game = _move_zone_top_card_to_zone(game, scum_zone, f"{SCENE_SCUM_MOD_PREFIX}{target_player_id}")
    scene = _scene(game)
    target_state = dict(scene["players"].get(target_player_id) or {})
    target_state["hand_value"] = int(target_state.get("hand_value") or 0) + modifier
    target_state["modifier_total"] = int(target_state.get("modifier_total") or 0) + modifier
    target_state["scum_mod_cards"] = list(target_state.get("scum_mod_cards") or []) + [scum_card_id]
    scene["players"][target_player_id] = target_state
    game = _replace_scene(game, scene=scene)
    if scene["status"] == SCENE_STATUS_AWAITING_ACK:
        game = _refresh_scene_resolution_preview(game, reset_acknowledgements=True)
    validate_unique_cards(game)
    return game, {
        "player_id": player_id,
        "target_player_id": target_player_id,
        "scum_card_id": scum_card_id,
        "modifier": modifier,
        "target_total": target_state["hand_value"],
    }


def scene_play_vengeance(game: GameState, *, player_id: str) -> tuple[GameState, dict[str, Any]]:
    _require_table_phase(game)

    scene = _scene(game)
    if scene["status"] not in {SCENE_STATUS_ACTIVE, SCENE_STATUS_AWAITING_ACK}:
        raise ValueError("Vengeance can only be played while the scene is active or awaiting acknowledgement.")
    if player_id not in scene["participants"]:
        raise ValueError("Only scene participants can play Vengeance.")
    if scene["status"] == SCENE_STATUS_ACTIVE and _active_scene_player_id(scene) != player_id:
        raise ValueError("Only the active participant can play Vengeance.")

    pstate = dict(scene["players"].get(player_id) or {})
    if scene["status"] == SCENE_STATUS_ACTIVE and pstate.get("standing"):
        raise ValueError("Player has already stood.")
    if pstate.get("busted"):
        raise ValueError("Player is already busted.")
    if scene["status"] == SCENE_STATUS_AWAITING_ACK and pstate.get("acknowledged"):
        raise ValueError("Player has already acknowledged the resolved scene.")

    vengeance_zone = f"players.{player_id}.vengeance"
    vengeance_cards = list(game.zones.get(vengeance_zone, []))
    if not vengeance_cards:
        raise ValueError("Player has no Vengeance cards to play.")

    vengeance_card_id = vengeance_cards[-1]
    modifier = 2 if _card_suit(vengeance_card_id) == _card_suit(pstate.get("figure_card_id")) else 1

    game = _move_zone_top_card_to_zone(game, vengeance_zone, f"{SCENE_VENGEANCE_MOD_PREFIX}{player_id}")
    scene = _scene(game)
    pstate = dict(scene["players"].get(player_id) or {})
    pstate["hand_value"] = int(pstate.get("hand_value") or 0) + modifier
    pstate["modifier_total"] = int(pstate.get("modifier_total") or 0) + modifier
    pstate["vengeance_mod_cards"] = list(pstate.get("vengeance_mod_cards") or []) + [vengeance_card_id]
    scene["players"][player_id] = pstate
    game = _replace_scene(game, scene=scene)
    if scene["status"] == SCENE_STATUS_AWAITING_ACK:
        game = _refresh_scene_resolution_preview(game, reset_acknowledgements=True)
    validate_unique_cards(game)
    return game, {
        "player_id": player_id,
        "vengeance_card_id": vengeance_card_id,
        "modifier": modifier,
        "target_total": pstate["hand_value"],
    }


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
    marshal_busted = effective_difficulty > 21

    winners: list[str] = []
    losers: list[str] = []

    for pid in scene["participants"]:
        pstate = dict(scene["players"].get(pid) or {})
        pstate["resolved"] = True
        pstate["acknowledged"] = False
        pstate["wounds_gained"] = 0
        pstate["reward_gained"] = False

        if marshal_busted:
            if pstate.get("busted"):
                pstate["result"] = "bust"
                pstate["wounds_gained"] = 0
                losers.append(pid)
            else:
                pstate["result"] = "success"
                pstate["reward_gained"] = True
                winners.append(pid)
        elif pstate.get("busted"):
            pstate["result"] = "bust"
            pstate["wounds_gained"] = 1
            losers.append(pid)
        elif int(pstate.get("hand_value", 0)) >= effective_difficulty:
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
    scene["status"] = SCENE_STATUS_AWAITING_ACK
    game = _replace_scene(game, scene=scene)
    game = _refresh_scene_resolution_preview(game, reset_acknowledgements=False)
    validate_unique_cards(game)
    return game


def scene_acknowledge_resolution(game: GameState, *, player_id: str) -> GameState:
    _require_table_phase(game)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_AWAITING_ACK:
        raise ValueError("Scene acknowledgement is only allowed after resolution and before cleanup.")
    if player_id not in scene["participants"]:
        raise ValueError("Only scene participants can acknowledge the scene result.")

    pstate = dict(scene["players"].get(player_id) or {})
    if not pstate.get("resolved"):
        raise ValueError("Player cannot acknowledge before their scene result is resolved.")
    if pstate.get("acknowledged"):
        raise ValueError("Player has already acknowledged the resolved scene.")

    return _acknowledge_scene_player(game, player_id=player_id)


def scene_force_acknowledge_resolution(game: GameState, *, actor_id: str, player_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_AWAITING_ACK:
        raise ValueError("Force acknowledgement is only allowed after resolution and before cleanup.")
    if player_id not in scene["participants"]:
        raise ValueError("Only scene participants can be force acknowledged.")

    pstate = dict(scene["players"].get(player_id) or {})
    if not pstate.get("resolved"):
        raise ValueError("Player cannot be force acknowledged before their scene result is resolved.")
    if pstate.get("acknowledged"):
        raise ValueError("Player has already acknowledged the resolved scene.")

    return _acknowledge_scene_player(game, player_id=player_id)


def _resolve_scene_if_all_participants_done(game: GameState) -> GameState:
    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_ACTIVE:
        return game

    unresolved = [
        pid
        for pid in scene["participants"]
        if not bool((scene["players"].get(pid) or {}).get("standing"))
        and not bool((scene["players"].get(pid) or {}).get("busted"))
    ]
    if unresolved:
        return game

    marshal_id = (game.meta or {}).get("marshal_id")
    if not isinstance(marshal_id, str) or not marshal_id:
        raise ValueError("Scene cannot auto-resolve without a marshal_id.")

    return scene_resolve(game, actor_id=marshal_id)


def _acknowledge_scene_player(game: GameState, *, player_id: str) -> GameState:
    scene = _scene(game)
    pstate = dict(scene["players"].get(player_id) or {})
    pstate["acknowledged"] = True
    scene["players"][player_id] = pstate
    game = _replace_scene(game, scene=scene)

    scene = _scene(game)
    all_acknowledged = all(
        bool((scene["players"].get(pid) or {}).get("acknowledged"))
        for pid in scene["participants"]
    )
    if not all_acknowledged:
        return game

    scene["status"] = SCENE_STATUS_RESOLVED
    game = _replace_scene(game, scene=scene)
    validate_unique_cards(game)
    return game


def _refresh_scene_resolution_preview(game: GameState, *, reset_acknowledgements: bool) -> GameState:
    scene = _scene(game)
    effective_difficulty = int(scene["difficulty"]["value"])
    azzardo = dict(scene["azzardo"])
    if azzardo["status"] == "drawn":
        effective_difficulty += int(azzardo["value"])
    marshal_busted = effective_difficulty > 21

    winners: list[str] = []
    losers: list[str] = []
    players = dict(scene["players"])

    for pid in scene["participants"]:
        pstate = dict(players.get(pid) or {})
        hand_value = int(pstate.get("hand_value") or 0)
        busted = hand_value > 21
        pstate["busted"] = busted
        pstate["resolved"] = True
        pstate["wounds_gained"] = 0 if marshal_busted else 1 if busted else 0
        pstate["reward_gained"] = (not busted) if marshal_busted else (not busted and hand_value >= effective_difficulty)
        if reset_acknowledgements:
            pstate["acknowledged"] = False

        if marshal_busted:
            if busted:
                pstate["result"] = "bust"
                losers.append(pid)
            else:
                pstate["result"] = "success"
                winners.append(pid)
        elif busted:
            pstate["result"] = "bust"
            losers.append(pid)
        elif pstate["reward_gained"]:
            pstate["result"] = "success"
            winners.append(pid)
        else:
            pstate["result"] = "failure"
            losers.append(pid)

        players[pid] = pstate

    scene["players"] = players
    scene["resolution"] = {
        "completed": True,
        "winners": winners,
        "losers": losers,
    }
    return _replace_scene(game, scene=scene)


def _finalize_resolved_scene(game: GameState) -> GameState:
    scene = _scene(game)
    for pid in scene["participants"]:
        pstate = dict(scene["players"].get(pid) or {})
        if pstate.get("result") == "bust":
            game = _increment_player_wounds(game, pid, int(pstate.get("wounds_gained", 0) or 0))
        elif pstate.get("result") == "success":
            game, _reward_card = _draw_to_zone(game, f"players.{pid}.rewards")
    return game


def scene_new(game: GameState, *, actor_id: str) -> GameState:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_RESOLVED:
        raise ValueError("A new scene can only be started after the previous one is fully acknowledged.")

    game = _finalize_resolved_scene(game)
    if _all_non_marshal_players_dead(game):
        meta = dict(game.meta or {})
        meta["phase"] = "victory"
        meta["victory"] = {
            "winner": "marshal",
            "winner_label": "Marshal",
            "reason": "All players are dead.",
        }
        validate_unique_cards(game)
        return GameState(deck=game.deck, zones=game.zones, meta=meta)

    game = _discard_scene_play_zones(game)
    scene = default_scene_state()
    scene["status"] = SCENE_STATUS_SETUP
    return _replace_scene(game, scene=scene, zones=_reset_scene_zones(game.zones))


def scene_assign_bonus_card(
    game: GameState,
    *,
    actor_id: str,
    player_id: str,
    bonus_type: str,
) -> tuple[GameState, dict[str, Any]]:
    _require_table_phase(game)
    _require_marshal(game, actor_id)

    scene = _scene(game)
    if scene["status"] != SCENE_STATUS_RESOLVED:
        raise ValueError("Bonus Scum/Vengeance cards can only be assigned after the scene is fully acknowledged.")
    if player_id not in _non_marshal_players(game):
        raise ValueError("Bonus cards can only be assigned to registered non-marshal players.")
    if _player_is_dead(game, player_id):
        raise ValueError("Dead characters cannot receive Marshal bonus cards.")
    if bonus_type not in {"scum", "vengeance"}:
        raise ValueError("bonus_type must be 'scum' or 'vengeance'.")

    bonus_assignments = dict(scene.get("bonus_assignments") or {})
    if bonus_assignments.get(player_id):
        raise ValueError("Each player can receive at most one Marshal bonus card per scene.")

    zone_name = f"players.{player_id}.{'scum' if bonus_type == 'scum' else 'vengeance'}"
    game, card_id = _draw_to_zone(game, zone_name)
    scene = _scene(game)
    bonus_assignments = dict(scene.get("bonus_assignments") or {})
    bonus_assignments[player_id] = bonus_type
    scene["bonus_assignments"] = bonus_assignments
    game = _replace_scene(game, scene=scene)
    validate_unique_cards(game)
    return game, {
        "player_id": player_id,
        "bonus_type": bonus_type,
        "card_id": card_id,
    }


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
        "scum_mod_cards": [],
        "vengeance_mod_cards": [],
        "modifier_total": 0,
        "standing": False,
        "busted": False,
        "resolved": False,
        "acknowledged": False,
        "wounds_gained": 0,
        "reward_gained": False,
        "result": None,
    }


def _active_scene_player_id(scene: dict[str, Any]) -> str | None:
    if scene["status"] != SCENE_STATUS_ACTIVE:
        return None
    for pid in scene["participants"]:
        pstate = dict(scene["players"].get(pid) or {})
        if not pstate.get("standing") and not pstate.get("busted") and not pstate.get("resolved"):
            return pid
    return None


def _ensure_scene_setup(game: GameState) -> GameState:
    scene = _scene(game)
    if scene["status"] == SCENE_STATUS_IDLE:
        return _start_clean_setup(game)
    if scene["status"] == SCENE_STATUS_SETUP:
        return game
    if scene["status"] == SCENE_STATUS_AWAITING_ACK:
        raise ValueError("Resolved scenes must be acknowledged by all participants before setup can continue.")
    if scene["status"] == SCENE_STATUS_RESOLVED:
        raise ValueError("Resolved scenes must be reset with scene_set_participants before setup can continue.")
    raise ValueError("Scene setup is locked after the scene has started.")


def _start_clean_setup(game: GameState) -> GameState:
    scene = default_scene_state()
    scene["status"] = SCENE_STATUS_SETUP
    return _replace_scene(game, scene=scene, zones=_reset_scene_zones(game.zones))




def _replace_scene(game: GameState, *, scene: dict[str, Any], zones: dict[str, list[CardID]] | None = None) -> GameState:
    meta = dict(game.meta or {})
    meta["scene"] = _normalized_scene(scene)
    return GameState(deck=game.deck, zones=game.zones if zones is None else zones, meta=meta)


def _increment_player_wounds(game: GameState, player_id: str, amount: int) -> GameState:
    if amount <= 0:
        return game

    meta = dict(game.meta or {})
    players = dict(meta.get("players") or {})
    pdata = dict(players.get(player_id) or {})
    pdata["wounds"] = int(pdata.get("wounds", 0) or 0) + amount
    players[player_id] = pdata
    meta["players"] = players
    return GameState(deck=game.deck, zones=game.zones, meta=meta)


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
            SCENE_STATUS_AWAITING_ACK,
            SCENE_STATUS_RESOLVED,
        } else default["status"],
        "participants": [pid for pid in scene_in.get("participants") or [] if isinstance(pid, str)],
        "dark_mode": bool(scene_in.get("dark_mode", default["dark_mode"])),
        "bonus_assignments": {
            pid: bonus
            for pid, bonus in dict(scene_in.get("bonus_assignments") or {}).items()
            if isinstance(pid, str) and bonus in {"scum", "vengeance"}
        },
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
            "scum_mod_cards": [card_id for card_id in pdata.get("scum_mod_cards") or [] if isinstance(card_id, str)],
            "vengeance_mod_cards": [
                card_id for card_id in pdata.get("vengeance_mod_cards") or [] if isinstance(card_id, str)
            ],
            "modifier_total": int(pdata.get("modifier_total", 0) or 0),
            "standing": bool(pdata.get("standing", False)),
            "busted": bool(pdata.get("busted", False)),
            "resolved": bool(pdata.get("resolved", False)),
            "acknowledged": bool(pdata.get("acknowledged", False)),
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


def _remove_scene_hands_for_players(zones: dict[str, list[CardID]], player_ids: set[str]) -> dict[str, list[CardID]]:
    if not player_ids:
        return {zone_name: cards.copy() for zone_name, cards in zones.items()}

    new_zones: dict[str, list[CardID]] = {}
    for zone_name, cards in zones.items():
        if any(zone_name == f"{SCENE_HAND_PREFIX}{player_id}" for player_id in player_ids):
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


def _move_zone_top_card_to_zone(game: GameState, source_zone_name: str, dest_zone_name: str) -> GameState:
    zone_cards = list(game.zones.get(source_zone_name, []))
    if not zone_cards:
      raise ValueError(f"Zone '{source_zone_name}' is empty.")

    card_id = zone_cards[-1]
    zones = {name: cards.copy() for name, cards in game.zones.items()}
    zones[source_zone_name] = zones.get(source_zone_name, []).copy()
    zones[source_zone_name].pop()
    zones.setdefault(dest_zone_name, []).append(card_id)
    return GameState(deck=game.deck, zones=zones, meta=game.meta)


def _move_zone_top_card_to_discard(game: GameState, zone_name: str) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    zone_cards = list(game.zones.get(zone_name, []))
    if not zone_cards:
        raise ValueError(f"Zone '{zone_name}' is empty.")

    card_id = zone_cards[-1]
    zones = {name: cards.copy() for name, cards in game.zones.items()}
    zones[zone_name] = zones.get(zone_name, []).copy()
    zones[zone_name].pop()

    deck = game.deck
    new_deck = DeckState(
        version=deck.version,
        schema=deck.schema,
        created_utc=deck.created_utc,
        notes=deck.notes,
        settings=deck.settings,
        draw_pile=deck.draw_pile,
        in_play=deck.in_play,
        discard_pile=deck.discard_pile + [card_id],
        removed=deck.removed,
    )

    return GameState(deck=new_deck, zones=zones, meta=game.meta)


def _discard_scene_modifier_zones(game: GameState) -> GameState:
    zones = {name: cards.copy() for name, cards in game.zones.items()}
    modifier_zone_names = [
        name
        for name in zones
        if name.startswith(SCENE_SCUM_MOD_PREFIX) or name.startswith(SCENE_VENGEANCE_MOD_PREFIX)
    ]
    if not modifier_zone_names:
        return game
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    discard_cards: list[CardID] = []
    for zone_name in modifier_zone_names:
        discard_cards.extend(zones.pop(zone_name, []))

    deck = game.deck
    new_deck = DeckState(
        version=deck.version,
        schema=deck.schema,
        created_utc=deck.created_utc,
        notes=deck.notes,
        settings=deck.settings,
        draw_pile=deck.draw_pile,
        in_play=deck.in_play,
        discard_pile=deck.discard_pile + discard_cards,
        removed=deck.removed,
    )
    return GameState(deck=new_deck, zones=zones, meta=game.meta)


def _discard_scene_play_zones(game: GameState) -> GameState:
    game = _discard_zone_if_present(game, SCENE_DIFFICULTY_ZONE)
    game = _discard_zone_if_present(game, SCENE_AZZARDO_ZONE)

    hand_zone_names = [
        zone_name
        for zone_name in list(game.zones.keys())
        if zone_name.startswith(SCENE_HAND_PREFIX)
    ]
    for zone_name in hand_zone_names:
        game = _discard_zone_if_present(game, zone_name)

    game = _discard_scene_modifier_zones(game)
    if any(card_id in {"RJ", "BJ"} for card_id in list((game.deck.discard_pile if game.deck else []))):
        game = _reshuffle_discard_into_draw(game)
    return game


def _discard_zone_if_present(game: GameState, zone_name: str) -> GameState:
    while list(game.zones.get(zone_name, [])):
        game = _move_zone_top_card_to_discard(game, zone_name)

    zones = {name: cards.copy() for name, cards in game.zones.items()}
    if zone_name in zones and not zones[zone_name]:
        zones.pop(zone_name, None)
        return GameState(deck=game.deck, zones=zones, meta=game.meta)

    return game


def _return_zone_card_to_draw_pile(game: GameState, zone_name: str) -> GameState:
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    zone_cards = list(game.zones.get(zone_name, []))
    if len(zone_cards) != 1:
        raise ValueError(f"Zone '{zone_name}' must contain exactly one card.")

    card_id = zone_cards[0]
    zones = {name: cards.copy() for name, cards in game.zones.items()}
    zones.pop(zone_name, None)

    deck = game.deck
    new_deck = DeckState(
        version=deck.version,
        schema=deck.schema,
        created_utc=deck.created_utc,
        notes=deck.notes,
        settings=deck.settings,
        draw_pile=deck.draw_pile + [card_id],
        in_play=deck.in_play,
        discard_pile=deck.discard_pile,
        removed=deck.removed,
    )

    game = GameState(deck=new_deck, zones=zones, meta=game.meta)
    validate_unique_cards(game)
    return game


def _require_table_phase(game: GameState) -> None:
    if (game.meta or {}).get("phase") != "table":
        raise ValueError("Action allowed only during table phase.")


def _require_marshal(game: GameState, actor_id: str) -> None:
    if (game.meta or {}).get("marshal_id") != actor_id:
        raise ValueError("Only the Marshal can perform this action.")


def _player_has_character(game: GameState, player_id: str) -> bool:
    cards = game.zones.get(f"players.{player_id}.character", [])
    return isinstance(cards, list) and len(cards) == 1


def _player_character_card_id(game: GameState, player_id: str) -> str | None:
    cards = game.zones.get(f"players.{player_id}.character", [])
    if isinstance(cards, list) and len(cards) == 1 and isinstance(cards[0], str):
        return cards[0]
    return None


def _player_is_dead(game: GameState, player_id: str) -> bool:
    pdata = dict(((game.meta or {}).get("players") or {}).get(player_id) or {})
    return int(pdata.get("wounds", 0) or 0) >= 2


def _non_marshal_players(game: GameState) -> list[str]:
    meta = dict(game.meta or {})
    marshal_id = meta.get("marshal_id")
    order = meta.get("players_order") or []
    return [pid for pid in order if isinstance(pid, str) and pid != marshal_id]


def _all_non_marshal_players_dead(game: GameState) -> bool:
    player_ids = _non_marshal_players(game)
    return bool(player_ids) and all(_player_is_dead(game, player_id) for player_id in player_ids)


def _blackjack_value(card_id: str) -> int:
    rank = _rank(card_id)
    if rank in ("RJ", "BJ", "J", "Q", "K"):
        return 10
    if rank == "A":
        return 11
    return int(rank)


def _cards_blackjack_value(cards: list[str]) -> int:
    return sum(_blackjack_value(card_id) for card_id in cards)


def _scene_hand_value(*, figure_card_id: str | None, hand_cards: list[str]) -> int:
    cards = [card_id for card_id in [figure_card_id, *hand_cards] if isinstance(card_id, str) and card_id]
    total = sum(_scene_card_value(card_id) for card_id in cards)
    aces = sum(1 for card_id in cards if _rank(card_id) == "A")

    # Count aces as 1 instead of 11 when that produces the best non-busting total.
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1

    return total


def _scene_card_value(card_id: str) -> int:
    if card_id in {"RJ", "BJ"}:
        return 0
    return _blackjack_value(card_id)


def _rank(card_id: str) -> str:
    if card_id in ("RJ", "BJ"):
        return card_id
    return card_id[:-1]


def _card_suit(card_id: str | None) -> str:
    if not isinstance(card_id, str) or len(card_id) < 2 or card_id in ("RJ", "BJ"):
        return ""
    return card_id[-1].upper()
