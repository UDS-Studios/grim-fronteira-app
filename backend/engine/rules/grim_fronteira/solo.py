"""Authored solo adventure; delegates card rules to the existing scene engine.

Only the server invokes Marshal transitions. No session exists for the internal
Marshal. Every returned state can be committed with its story in one snapshot.
"""
from dataclasses import replace
from functools import lru_cache
import json
from pathlib import Path
from random import choice

from backend.engine.helpers.character_creation import build_character_profile
from backend.engine.helpers.characters import figure_to_character

from backend.engine.state.game_state import GameState
from backend.engine.state.pending_interaction import get_pending_interaction
from . import scene as scenes
from .lobby import initialize_lobby, join_lobby, start_game, begin_table

MARSHAL = "solo_marshal"
PLAYER = "solo_player"
SOLO_CONTINUE = "gf.solo_continue"
SOLO_ACTIONS = frozenset({
    SOLO_CONTINUE, "gf.claim_character", "gf.submit_character_name",
    "gf.submit_character_feature", "gf.scene_draw_card", "gf.scene_stand",
    "gf.scene_play_vengeance", "gf.scene_acknowledge_resolution",
    "gf.scene_skip_heal", "gf.scene_heal_wound", "gf.scene_discard_reward",
    "gf.faction_paisa_claim_reward", "gf.faction_criollo_convert_resource",
    "gf.faction_yankee_choose_top_card",
})


@lru_cache(maxsize=1)
def adventure() -> dict:
    path = Path(__file__).resolve().parents[2] / "data/adventures/malopasso_v1.json"
    return json.loads(path.read_text(encoding="utf-8"))


def is_solo(game: GameState) -> bool:
    return game.meta.get("mode") == "solo"


def _update(game: GameState, **fields) -> GameState:
    return replace(game, meta={**game.meta, "solo": {**game.meta["solo"], **fields}})


def _ensure_associate(game: GameState, *, replace_opponent: bool = False) -> GameState:
    """Create flavor once per opponent, independently of the playing deck."""
    solo = game.meta["solo"]
    if solo["node"] != "associates" or (solo.get("associate") and not replace_opponent):
        return game
    gender = choice(["man", "woman"])
    card = ("Q" if gender == "woman" else "J") + choice("DCHS")
    profile = build_character_profile(card, "solo_associate")
    number = solo.get("associate_number", 0) + 1
    encounters = adventure()["associate_encounters"]
    previous = (solo.get("associate") or {}).get("encounter")
    encounter = choice([e["id"] for e in encounters if e["id"] != previous])
    return _update(game, associate_number=number, associate={
        "number": number, "encounter": encounter, "ethnicity": figure_to_character(card)["faction"],
        "gender": gender, "feature": profile["feature"],
    })


def initialize_solo(game: GameState) -> GameState:
    game = initialize_lobby(game, creator_id=MARSHAL)
    game = join_lobby(game, player_id=PLAYER)
    lobby = {**game.meta["lobby"], "registration_open": False}
    return replace(game, meta={**game.meta, "mode": "solo", "lobby": lobby, "solo": {
        "adventure_id": "malopasso", "version": 1, "node": "gun",
        "step": "intro", "attempt": 0, "scene_number": 0,
        "has_gun": False, "outlaw_defeated": False, "history": [],
        "outcome": None, "ending": None,
    }})


def guard_action(game: GameState, action: str) -> None:
    if not is_solo(game) or action == "gf.get_state":
        return
    if action not in SOLO_ACTIONS:
        raise ValueError("This action is unavailable in the solo learning adventure.")
    if game.meta["solo"]["ending"] is not None:
        raise ValueError("This adventure has ended. Start a new run to play again.")
    if game.meta.get("phase") != "lobby" and action.startswith("gf.submit_"):
        raise ValueError("Character creation is complete.")


def _special_completion(game: GameState, ending: str | None) -> dict | None:
    if ending in {"ascension", "exhaustion"} and game.meta["solo"]["outlaw_defeated"]:
        scene = scenes._scene(game)
        if (game.meta["solo"]["node"] == "duel"
                and scene["status"] in {"resolved", "closed"}
                and scene["players"].get(PLAYER, {}).get("result") == "success"):
            return adventure()["duel_completion"]
        return adventure()["special_completion"]
    return None


def finish(game: GameState, ending: str) -> GameState:
    special = _special_completion(game, ending)
    game = _update(game, step="ending", ending=ending, opossum_hunter=bool(special),
                   opossum_finale=bool(special and special["id"] == "opossum_finale"))
    # No incomplete reaction should survive a terminal state.
    meta = {**game.meta, "phase": "victory", "pending_interaction": None,
            "victory": {"winner": "marshal" if ending == "death" else PLAYER,
                        "winner_label": "The Fronteira" if ending == "death" else "You",
                        "reason": adventure()["endings"][ending]["text"] + (" " + special["text"] if special else "")}}
    return replace(game, meta=meta)


class SoloDeckExhausted(Exception):
    """Carries the valid candidate reached before an impossible required draw."""
    def __init__(self, game: GameState):
        self.game = game


def continue_adventure(game: GameState) -> GameState:
    if not is_solo(game):
        raise ValueError("This is not a solo adventure.")
    solo = game.meta["solo"]
    if get_pending_interaction(game) is not None:
        raise ValueError("Finish the pending choice first.")
    if game.meta.get("phase") == "lobby":
        game = start_game(game, actor_id=MARSHAL)
        game = begin_table(game, actor_id=MARSHAL)
        # Narrative hooks do not belong to this authored adventure.
        game = replace(game, meta={k: v for k, v in game.meta.items() if k != "hooks"})
    elif solo["step"] == "outcome":
        if scenes._has_pending_post_scene_requirements(game):
            raise ValueError("Finish healing and Reward choices before continuing.")
        node = adventure()["nodes"][solo["node"]]["next"][solo["outcome"]]
        # Only a defeated outlaw unlocks associates, including in older saves.
        if node == "associates" and not solo["outlaw_defeated"]:
            node = "duel"
        new_associate = node == "associates" and solo["outcome"] == "success"
        attempt = solo["attempt"] + 1 if node == solo["node"] and not new_associate else 0
        game = scenes.scene_new(game, actor_id=MARSHAL)
        game = _update(game, node=node, attempt=attempt, outcome=None, step="intro", resolved_hand=[])
        # Leave the next passage visible before dealing its scene.
        return _ensure_associate(game, replace_opponent=new_associate)
    elif solo["step"] != "intro":
        raise ValueError("Finish the current test first.")

    if game.meta["solo"]["node"] == "associates" and not game.meta["solo"]["outlaw_defeated"]:
        game = _update(game, node="duel", attempt=0, outcome=None)
    game = _ensure_associate(game)
    node = adventure()["nodes"][game.meta["solo"]["node"]]
    game = _update(game, step="playing", scene_number=game.meta["solo"]["scene_number"] + 1)
    game = scenes.scene_set_participants(game, actor_id=MARSHAL, participant_ids=[PLAYER])
    game = scenes.scene_set_mode(game, actor_id=MARSHAL, mode=node["mode"],
                                 duel_subtype="npc" if node["mode"] == "duel" else None)
    game, _ = scenes.scene_roll_difficulty(game, actor_id=MARSHAL)
    game = scenes.scene_skip_azzardo(game, actor_id=MARSHAL)
    return scenes.scene_start(game, actor_id=MARSHAL)


def settle(game: GameState) -> GameState:
    """Automate housekeeping, stopping at every player-owned decision."""
    if not is_solo(game) or game.meta["solo"]["ending"]:
        return game
    if scenes._player_is_dead(game, PLAYER):
        return finish(game, "death")
    # Acknowledged success defeats Opossum before the Reward draw. Exhaustion
    # during that draw must not lose the kill, nor should an early victory invent it.
    scene = scenes._scene(game)
    if (game.meta["solo"]["node"] == "duel" and scene["status"] in {"resolved", "closed"}
            and scene["players"].get(PLAYER, {}).get("result") == "success"):
        game = _update(game, outlaw_defeated=True)
    if game.meta.get("phase") == "victory":
        ending = "exhaustion" if "exhaust" in game.meta.get("victory", {}).get("reason", "").lower() else "ascension"
        return finish(game, ending)
    if game.meta.get("phase") != "table" or get_pending_interaction(game) is not None:
        return game
    scene = scenes._scene(game)
    if scene["status"] == "active" and all(
        p.get("standing") or p.get("busted") for p in scene["players"].values()
    ):
        game = scenes.scene_resolve(game, actor_id=MARSHAL)
        if scenes._player_is_dead(game, PLAYER):
            return finish(game, "death")
        scene = scenes._scene(game)
    if scene["status"] == "resolved":
        # Closing moves cards to discard; retain a display-only result record.
        game = _update(game, resolved_hand=list(game.zones.get(f"scene.hand.{PLAYER}", [])))
        game = scenes.scene_close(game, actor_id=MARSHAL)
        scene = scenes._scene(game)
    if scene["status"] == "closed" and game.meta["solo"]["step"] == "playing":
        result = scene["players"][PLAYER]["result"]
        solo = game.meta["solo"]
        node = solo["node"]
        entry = {"node": node, "outcome": result, "attempt": solo["attempt"],
                 "scene_number": solo["scene_number"],
                 "cards": list(solo.get("resolved_hand", [])),
                 "total": scene["players"][PLAYER]["hand_value"]}
        game = _update(game, step="outcome", outcome=result,
                       history=[*solo["history"], entry],
                       has_gun=solo["has_gun"] or (node == "gun" and result in {"success", "bust"}),
                       outlaw_defeated=solo["outlaw_defeated"] or (node == "duel" and result == "success"))
    if game.meta.get("phase") == "victory":
        return settle(game)
    return game


def presentation(game: GameState) -> dict:
    """Stable authored copy derived from persisted node/attempt, no random redraw."""
    solo = game.meta["solo"]
    story = adventure()
    node = story["nodes"][solo["node"]]
    if solo["node"] == "associates" and solo.get("associate"):
        opponent = solo["associate"]
        variants = story["associate_encounters"]
        node = next((e for e in variants if e["id"] == opponent.get("encounter")),
                    variants[(opponent.get("number", 1) - 1) % len(variants)])
    data = {**solo, "title": node["title"], "adventure_title": story["title"],
            "text": node["passages"][solo["attempt"] % len(node["passages"])],
            "invitation": story["invitation"], "needs_heal": False, "needs_discard": False,
            "special_completion": _special_completion(game, solo["ending"])}
    if solo["outcome"]:
        data["text"] = node["outcomes"][solo["outcome"]]
    if solo["node"] == "associates" and solo.get("associate"):
        opponent = solo["associate"]
        description = f"Your opponent: a {opponent['ethnicity']} {opponent['gender']} with {opponent['feature']}."
        data["text"] = f"{description} {data['text']}"
    if solo["ending"]:
        data.update(story["endings"][solo["ending"]])
    elif game.meta.get("phase") == "table":
        data["needs_heal"] = scenes._must_heal_or_skip(game, PLAYER)
        data["needs_discard"] = scenes._must_discard_rewards(game, PLAYER)
    return data


def validate_solo(game: GameState) -> None:
    if not is_solo(game):
        return
    solo = game.meta.get("solo", {})
    if not isinstance(solo, dict):
        raise ValueError("Unsupported solo adventure snapshot.")
    if (solo.get("adventure_id") != "malopasso" or solo.get("version") != 1
            or solo.get("node") not in adventure()["nodes"]
            or solo.get("step") not in {"intro", "playing", "outcome", "ending"}
            or solo.get("ending") not in {None, "death", "ascension", "exhaustion"}
            or game.meta.get("marshal_id") != MARSHAL
            or game.meta.get("players_order") != [MARSHAL, PLAYER]):
        raise ValueError("Unsupported solo adventure snapshot.")

    if (type(solo.get("attempt")) is not int or solo["attempt"] < 0
            or type(solo.get("scene_number")) is not int or solo["scene_number"] < 0
            or type(solo.get("has_gun")) is not bool
            or type(solo.get("outlaw_defeated")) is not bool
            or solo.get("outcome") not in {None, "success", "failure", "bust"}
            or not isinstance(solo.get("history"), list)
            or (solo["step"] == "ending") != (solo["ending"] is not None)
            or (solo["step"] == "outcome" and solo["outcome"] is None)):
        raise ValueError("Invalid solo adventure progress.")
    for entry in solo["history"]:
        if (not isinstance(entry, dict) or entry.get("node") not in adventure()["nodes"]
                or entry.get("outcome") not in {"success", "failure", "bust"}
                or type(entry.get("attempt")) is not int or entry["attempt"] < 0
                or type(entry.get("scene_number")) is not int or entry["scene_number"] < 1):
            raise ValueError("Invalid solo adventure history.")
