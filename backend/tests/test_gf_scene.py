from backend.app.serializers import game_state_to_dict
from backend.engine.rules.grim_fronteira.lobby import (
    initialize_lobby,
    join_lobby,
    claim_character,
    submit_character_name,
    submit_character_feature,
    start_game,
    begin_table,
)
from backend.engine.rules.grim_fronteira.scene import (
    scene_set_participants,
    scene_roll_difficulty,
    scene_draw_azzardo,
    scene_remove_azzardo,
    scene_skip_azzardo,
    scene_start,
    scene_draw_card,
    scene_stand,
    scene_resolve,
)
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.grimdeck.models import DeckState
from backend.engine.state.game_state import GameState


def _ready_table_game() -> GameState:
    deck = load_deck("data/templates/standard_54.json")
    game = GameState(deck=deck, zones={}, meta={"game": "grim_fronteira"})
    game = initialize_lobby(game, creator_id="host1")
    game = join_lobby(game, player_id="p1")
    game = join_lobby(game, player_id="p2")
    game = claim_character(game, player_id="p1", card_id="JS")
    game = claim_character(game, player_id="p2", card_id="QD")
    game = submit_character_name(game, player_id="p1", name="Ash")
    game = submit_character_feature(game, player_id="p1", feature="scarred")
    game = submit_character_name(game, player_id="p2", name="Mae")
    game = submit_character_feature(game, player_id="p2", feature="grim eyes")
    game = start_game(game, actor_id="host1", seed=123)
    game = begin_table(game, actor_id="host1", selected_hook=game.meta["hooks"]["suggestions"][0])
    return game


def _with_draw_order(game: GameState, draw_sequence: list[str]) -> GameState:
    assert game.deck is not None
    missing = [card for card in draw_sequence if card not in game.deck.draw_pile]
    if missing:
        raise AssertionError(f"Requested draw cards are not available in draw_pile: {missing}")
    remaining = [card for card in game.deck.draw_pile if card not in draw_sequence]
    new_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=remaining + list(reversed(draw_sequence)),
        in_play=game.deck.in_play,
        discard_pile=game.deck.discard_pile,
        removed=game.deck.removed,
    )
    return GameState(deck=new_deck, zones=game.zones, meta=game.meta)


def _first_available(game: GameState, candidates: list[str]) -> str:
    assert game.deck is not None
    for card in candidates:
        if card in game.deck.draw_pile:
            return card
    raise AssertionError(f"No candidate cards available in draw_pile: {candidates}")


def test_scene_set_participants_initializes_scene_state():
    game = _ready_table_game()

    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])

    scene = game.meta["scene"]
    assert scene["status"] == "setup"
    assert scene["participants"] == ["p1", "p2"]
    assert scene["dark_mode"] is False
    assert scene["difficulty"] == {
        "rule_id": None,
        "base": None,
        "card_id": None,
        "value": None,
    }
    assert scene["azzardo"] == {
        "status": "unavailable",
        "card_id": None,
        "value": None,
        "revealed": False,
    }
    assert scene["resolution"] == {
        "completed": False,
        "winners": [],
        "losers": [],
    }
    assert scene["players"]["p1"]["figure_card_id"] == "JS"
    assert scene["players"]["p1"]["hand_value"] == 10
    assert scene["players"]["p2"]["figure_card_id"] == "QD"
    assert "scene.difficulty" not in game.zones
    assert "scene.azzardo" not in game.zones
    assert "scene.hand.p1" not in game.zones


def test_scene_start_blocked_until_setup_complete():
    game = _ready_table_game()
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])

    try:
        scene_start(game, actor_id="host1")
    except ValueError as exc:
        assert "difficulty must be rolled" in str(exc)
    else:
        raise AssertionError("scene_start should fail before difficulty is rolled")


def test_scene_draw_azzardo_and_skip_paths():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])

    game, difficulty = scene_roll_difficulty(game, actor_id="host1")
    assert difficulty == {
        "rule_id": "base10_plus_1card_v1",
        "base": 10,
        "card_id": "5H",
        "value": 15,
        "effects": [],
    }

    game = scene_draw_azzardo(game, actor_id="host1")
    assert game.zones["scene.azzardo"] == ["6C"]
    assert game.meta["scene"]["azzardo"] == {
        "status": "drawn",
        "card_id": "6C",
        "value": 6,
        "revealed": False,
    }

    second_game = _ready_table_game()
    second_game = _with_draw_order(second_game, ["7D"])
    second_game = scene_set_participants(second_game, actor_id="host1", participant_ids=["p1"])
    second_game, _difficulty = scene_roll_difficulty(second_game, actor_id="host1")
    second_game = scene_skip_azzardo(second_game, actor_id="host1")

    assert second_game.meta["scene"]["azzardo"] == {
        "status": "skipped",
        "card_id": None,
        "value": None,
        "revealed": False,
    }


def test_scene_player_draw_and_stand():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_draw_card(game, player_id="p1")

    assert game.zones["scene.hand.p1"] == ["8D"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18
    assert game.meta["scene"]["players"]["p1"]["busted"] is False

    game = scene_stand(game, player_id="p1")
    assert game.meta["scene"]["players"]["p1"]["standing"] is True


def test_scene_resolve_blocks_until_all_participants_done():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")

    try:
        scene_resolve(game, actor_id="host1")
    except ValueError as exc:
        assert "All participants must stand or bust" in str(exc)
    else:
        raise AssertionError("scene_resolve should fail when a participant is still unresolved")


def test_scene_resolve_reveals_azzardo_and_grants_rewards():
    game = _ready_table_game()
    success_card = _first_available(game, ["10H", "10D", "10C", "10S", "AH", "AD", "AC", "AS"])
    game = _with_draw_order(game, ["4H", "6C", "8D", success_card, "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")

    hidden_public = game_state_to_dict(game, view="public")
    hidden_player = game_state_to_dict(game, view="player")
    assert hidden_public["meta"]["scene"]["azzardo"]["card_id"] is None
    assert hidden_public["meta"]["scene"]["azzardo"]["value"] is None
    assert hidden_public["zones"]["scene.azzardo"] == []
    assert hidden_player["meta"]["scene"]["azzardo"]["card_id"] is None
    assert hidden_player["meta"]["scene"]["azzardo"]["value"] is None
    assert hidden_player["zones"]["scene.azzardo"] == []

    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p1")
    game = scene_draw_card(game, player_id="p2")
    game = scene_stand(game, player_id="p2")
    game = scene_resolve(game, actor_id="host1")

    scene = game.meta["scene"]
    assert scene["status"] == "resolved"
    assert scene["azzardo"]["revealed"] is True
    assert scene["resolution"] == {
        "completed": True,
        "winners": ["p2"],
        "losers": ["p1"],
    }
    assert scene["players"]["p1"]["result"] == "failure"
    assert scene["players"]["p1"]["reward_gained"] is False
    assert scene["players"]["p2"]["result"] == "success"
    assert scene["players"]["p2"]["reward_gained"] is True
    assert len(game.zones["players.p2.rewards"]) == 1

    revealed_public = game_state_to_dict(game, view="public")
    revealed_player = game_state_to_dict(game, view="player")
    assert revealed_public["meta"]["scene"]["azzardo"]["card_id"] == "6C"
    assert revealed_public["meta"]["scene"]["azzardo"]["value"] == 6
    assert revealed_player["meta"]["scene"]["azzardo"]["card_id"] == "6C"
    assert revealed_player["meta"]["scene"]["azzardo"]["value"] == 6


def test_scene_set_participants_allows_second_scene_after_resolve():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p1")
    game = scene_resolve(game, actor_id="host1")

    assert game.meta["scene"]["status"] == "resolved"
    assert game.zones["scene.hand.p1"] == ["8D"]

    game = scene_set_participants(game, actor_id="host1", participant_ids=["p2"])

    scene = game.meta["scene"]
    assert scene["status"] == "setup"
    assert scene["participants"] == ["p2"]
    assert scene["players"] == {
        "p2": {
            "figure_card_id": "QD",
            "figure_value": 10,
            "hand_value": 10,
            "standing": False,
            "busted": False,
            "resolved": False,
            "wounds_gained": 0,
            "reward_gained": False,
            "result": None,
        }
    }
    assert scene["difficulty"] == {
        "rule_id": None,
        "base": None,
        "card_id": None,
        "value": None,
    }
    assert scene["azzardo"] == {
        "status": "unavailable",
        "card_id": None,
        "value": None,
        "revealed": False,
    }
    assert scene["resolution"] == {
        "completed": False,
        "winners": [],
        "losers": [],
    }
    assert "scene.hand.p1" not in game.zones


def test_scene_roll_difficulty_from_idle_enters_setup():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H"])

    game, difficulty = scene_roll_difficulty(game, actor_id="host1")

    assert game.meta["scene"]["status"] == "setup"
    assert game.meta["scene"]["participants"] == []
    assert difficulty["card_id"] == "5H"
    assert game.meta["scene"]["difficulty"]["value"] == 15


def test_scene_set_participants_preserves_difficulty_in_setup():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")

    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])

    scene = game.meta["scene"]
    assert scene["status"] == "setup"
    assert scene["participants"] == ["p1", "p2"]
    assert scene["difficulty"] == {
        "rule_id": "base10_plus_1card_v1",
        "base": 10,
        "card_id": "5H",
        "value": 15,
    }
    assert scene["azzardo"] == {
        "status": "unavailable",
        "card_id": None,
        "value": None,
        "revealed": False,
    }
    assert game.zones["scene.difficulty"] == ["5H"]


def test_scene_draw_and_remove_azzardo_returns_card_to_draw_pile():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")

    assert game.zones["scene.azzardo"] == ["6C"]

    game = scene_remove_azzardo(game, actor_id="host1")

    assert game.meta["scene"]["azzardo"] == {
        "status": "unavailable",
        "card_id": None,
        "value": None,
        "revealed": False,
    }
    assert "scene.azzardo" not in game.zones
    assert game.deck.draw_pile[-1] == "6C"


def test_scene_set_participants_preserves_azzardo_in_setup():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")

    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])

    scene = game.meta["scene"]
    assert scene["participants"] == ["p1", "p2"]
    assert scene["difficulty"]["card_id"] == "5H"
    assert scene["azzardo"] == {
        "status": "drawn",
        "card_id": "6C",
        "value": 6,
        "revealed": False,
    }
    assert game.zones["scene.azzardo"] == ["6C"]


def test_scene_setup_actions_lock_after_start():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    locked_actions = [
        lambda current: scene_set_participants(current, actor_id="host1", participant_ids=["p1", "p2"]),
        lambda current: scene_roll_difficulty(current, actor_id="host1"),
        lambda current: scene_draw_azzardo(current, actor_id="host1"),
        lambda current: scene_remove_azzardo(current, actor_id="host1"),
    ]
    for action in locked_actions:
        try:
            action(game)
        except ValueError:
            pass
        else:
            raise AssertionError("setup action should fail after scene_start")
