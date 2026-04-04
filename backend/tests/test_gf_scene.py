from backend.app.serializers import game_state_to_dict
from backend.engine.rules.grim_fronteira.meta_enrich import enrich_meta_for_ui
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
    scene_play_scum,
    scene_play_vengeance,
    scene_acknowledge_resolution,
    scene_force_acknowledge_resolution,
    scene_assign_bonus_card,
    scene_new,
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
    assert scene["players"]["p1"]["scum_mod_cards"] == []
    assert scene["players"]["p1"]["vengeance_mod_cards"] == []
    assert scene["players"]["p1"]["modifier_total"] == 0
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


def test_scene_ace_difficulty_blocks_azzardo():
    game = _ready_table_game()
    game = _with_draw_order(game, ["AH"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, difficulty = scene_roll_difficulty(game, actor_id="host1")

    assert difficulty["value"] == 21

    try:
        scene_draw_azzardo(game, actor_id="host1")
    except ValueError as exc:
        assert "not allowed" in str(exc)
    else:
        raise AssertionError("scene_draw_azzardo should fail when difficulty is already 21")


def test_scene_red_joker_difficulty_gives_each_player_one_scum():
    game = _ready_table_game()
    game = _with_draw_order(game, ["RJ", "5H", "6C"])
    discard_cards = ["7C", "9D"]
    deck = game.deck
    assert deck is not None
    game = GameState(
        deck=DeckState(
            version=deck.version,
            schema=deck.schema,
            created_utc=deck.created_utc,
            notes=deck.notes,
            settings=deck.settings,
            draw_pile=[card for card in deck.draw_pile if card not in discard_cards],
            in_play=deck.in_play,
            discard_pile=discard_cards,
            removed=deck.removed,
        ),
        zones=game.zones,
        meta=game.meta,
    )
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])

    game, difficulty = scene_roll_difficulty(game, actor_id="host1")

    assert difficulty["card_id"] == "RJ"
    assert difficulty["effects"] == []
    assert game.zones["scene.difficulty"] == ["RJ"]
    assert game.zones["players.p1.scum"] == ["5H"]
    assert game.zones["players.p2.scum"] == ["6C"]
    assert game.zones["players.p1.vengeance"] == []
    assert game.zones["players.p2.vengeance"] == []
    assert game.deck is not None
    assert game.deck.discard_pile == discard_cards


def test_scene_black_joker_difficulty_gives_each_player_one_vengeance():
    game = _ready_table_game()
    game = _with_draw_order(game, ["BJ", "5H", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])

    game, difficulty = scene_roll_difficulty(game, actor_id="host1")

    assert difficulty["card_id"] == "BJ"
    assert difficulty["effects"] == ["DARK_MODE"]
    assert game.zones["scene.difficulty"] == ["BJ"]
    assert game.zones["players.p1.vengeance"] == ["5H"]
    assert game.zones["players.p2.vengeance"] == ["6C"]
    assert game.zones["players.p1.scum"] == []
    assert game.zones["players.p2.scum"] == []


def test_scene_player_draw_and_stand():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.zones["scene.hand.p1"] == ["8D"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18

    game = scene_draw_card(game, player_id="p1")

    assert game.zones["scene.hand.p1"] == ["8D", "2H"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 20
    assert game.meta["scene"]["players"]["p1"]["busted"] is False

    game = scene_stand(game, player_id="p1")
    assert game.meta["scene"]["players"]["p1"]["resolved"] is True


def test_scene_player_draw_red_joker_counts_zero_and_grants_scum_to_drawer():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "RJ", "5H"])
    discard_cards = ["7C", "9D"]
    deck = game.deck
    assert deck is not None
    game = GameState(
        deck=DeckState(
            version=deck.version,
            schema=deck.schema,
            created_utc=deck.created_utc,
            notes=deck.notes,
            settings=deck.settings,
            draw_pile=[card for card in deck.draw_pile if card not in discard_cards],
            in_play=deck.in_play,
            discard_pile=discard_cards,
            removed=deck.removed,
        ),
        zones=game.zones,
        meta=game.meta,
    )
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18

    game = scene_draw_card(game, player_id="p1")

    assert game.zones["scene.hand.p1"] == ["8D", "RJ"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18
    assert game.meta["scene"]["players"]["p1"]["busted"] is False
    assert game.zones["players.p1.scum"] == ["5H"]
    assert game.zones["players.p1.vengeance"] == []
    assert game.zones["players.p2.scum"] == []
    assert game.zones["players.p2.vengeance"] == []
    assert game.deck is not None
    assert game.deck.discard_pile == discard_cards


def test_scene_player_draw_black_joker_counts_zero_and_grants_vengeance_to_drawer():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "BJ", "6C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18

    game = scene_draw_card(game, player_id="p1")

    assert game.zones["scene.hand.p1"] == ["8D", "BJ"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18
    assert game.meta["scene"]["players"]["p1"]["busted"] is False
    assert game.zones["players.p1.vengeance"] == ["6C"]
    assert game.zones["players.p1.scum"] == []
    assert game.zones["players.p2.scum"] == []
    assert game.zones["players.p2.vengeance"] == []


def test_scene_new_reshuffles_discard_after_cleanup_when_joker_is_in_discard():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "RJ", "8D", "2H"])
    discard_cards = ["7C", "9D"]
    deck = game.deck
    assert deck is not None
    game = GameState(
        deck=DeckState(
            version=deck.version,
            schema=deck.schema,
            created_utc=deck.created_utc,
            notes=deck.notes,
            settings=deck.settings,
            draw_pile=[card for card in deck.draw_pile if card not in discard_cards],
            in_play=deck.in_play,
            discard_pile=discard_cards,
            removed=deck.removed,
        ),
        zones=game.zones,
        meta=game.meta,
    )
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.deck is not None
    assert game.deck.discard_pile == discard_cards

    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_new(game, actor_id="host1")

    assert game.deck.discard_pile == []
    assert "7C" in game.deck.draw_pile
    assert "9D" in game.deck.draw_pile
    assert "RJ" in game.deck.draw_pile


def test_scene_start_deals_initiative_and_reorders_participants():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "2H", "AH"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")

    game = scene_start(game, actor_id="host1")

    scene = game.meta["scene"]
    assert scene["participants"] == ["p2", "p1"]
    assert game.zones["scene.hand.p1"] == ["2H"]
    assert game.zones["scene.hand.p2"] == ["AH"]
    assert scene["players"]["p1"]["hand_value"] == 12
    assert scene["players"]["p2"]["hand_value"] == 21


def test_scene_start_allows_implicit_azzardo_skip():
    game = _ready_table_game()
    game = _with_draw_order(game, ["5H", "8D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")

    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["status"] == "active"
    assert game.meta["scene"]["azzardo"]["status"] == "unavailable"
    assert game.zones["scene.hand.p1"] == ["8D"]


def test_scene_resolve_blocks_until_all_participants_done():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "2H", "3H"])
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


def test_scene_resolve_reveals_azzardo_and_previews_rewards():
    game = _ready_table_game()
    success_card = _first_available(game, ["AH", "AD", "AC", "AS"])
    game = _with_draw_order(game, ["4H", "6C", "8D", "2H", success_card, "3H"])
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
    game = scene_draw_card(game, player_id="p2")
    game = scene_stand(game, player_id="p2")
    game = scene_stand(game, player_id="p1")

    scene = game.meta["scene"]
    assert scene["status"] == "awaiting_ack"
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
    assert len(game.zones["players.p2.rewards"]) == 0

    revealed_public = game_state_to_dict(game, view="public")
    revealed_player = game_state_to_dict(game, view="player")
    assert revealed_public["meta"]["scene"]["azzardo"]["card_id"] == "6C"
    assert revealed_public["meta"]["scene"]["azzardo"]["value"] == 6
    assert revealed_player["meta"]["scene"]["azzardo"]["card_id"] == "6C"
    assert revealed_player["meta"]["scene"]["azzardo"]["value"] == 6


def test_scene_auto_resolves_after_last_participant_finishes():
    game = _ready_table_game()
    success_card = _first_available(game, ["AH", "AD", "AC", "AS"])
    game = _with_draw_order(game, ["4H", "6C", "8D", "2H", success_card])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_draw_card(game, player_id="p2")
    game = scene_stand(game, player_id="p2")
    game = scene_stand(game, player_id="p1")

    scene = game.meta["scene"]
    assert scene["status"] == "awaiting_ack"
    assert scene["azzardo"]["revealed"] is True
    assert scene["resolution"]["completed"] is True
    assert scene["players"]["p1"]["result"] == "failure"
    assert scene["players"]["p2"]["result"] == "success"


def test_scene_equal_to_difficulty_is_success_when_not_busted():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "2H", "3C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p1")
    scene = game.meta["scene"]

    assert scene["status"] == "awaiting_ack"
    assert scene["players"]["p1"]["hand_value"] == 15
    assert scene["players"]["p1"]["result"] == "success"


def test_scene_marshal_bust_makes_all_non_busted_players_succeed():
    game = _ready_table_game()
    game = _with_draw_order(game, ["10H", "KD", "9C", "8D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    scene = game.meta["scene"]
    assert scene["status"] == "awaiting_ack"
    assert scene["azzardo"]["revealed"] is True
    assert scene["players"]["p1"]["busted"] is True
    assert scene["players"]["p1"]["result"] == "bust"
    assert scene["players"]["p1"]["wounds_gained"] == 0
    assert scene["players"]["p1"]["reward_gained"] is False
    assert scene["players"]["p2"]["busted"] is False
    assert scene["players"]["p2"]["result"] == "success"
    assert scene["players"]["p2"]["reward_gained"] is True


def test_scene_play_scum_spends_card_and_reduces_target_total():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9H", "2C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p1.scum"] = ["7S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["participants"][0] == "p1"
    assert game.meta["scene"]["players"]["p2"]["hand_value"] == 12

    game, result = scene_play_scum(game, player_id="p1", target_player_id="p2")

    assert result["modifier"] == -2
    assert result["target_total"] == 10
    assert game.meta["scene"]["players"]["p2"]["hand_value"] == 10
    assert game.meta["scene"]["players"]["p2"]["modifier_total"] == -2
    assert game.meta["scene"]["players"]["p2"]["scum_mod_cards"] == ["7S"]
    assert game.zones["players.p1.scum"] == []
    assert game.zones["scene.mod.scum.p2"] == ["7S"]


def test_scene_play_scum_allows_offscene_player_to_target_scene_participant():
    game = _ready_table_game()
    game = _with_draw_order(game, ["9H", "2C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p2"])
    game.zones["players.p1.scum"] = ["7S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["participants"] == ["p2"]
    assert game.meta["scene"]["players"]["p2"]["hand_value"] == 12

    game, result = scene_play_scum(game, player_id="p1", target_player_id="p2")

    assert result["modifier"] == -2
    assert result["target_total"] == 10
    assert game.meta["scene"]["players"]["p2"]["hand_value"] == 10
    assert game.meta["scene"]["players"]["p2"]["modifier_total"] == -2
    assert game.meta["scene"]["players"]["p2"]["scum_mod_cards"] == ["7S"]
    assert game.zones["players.p1.scum"] == []
    assert game.zones["scene.mod.scum.p2"] == ["7S"]


def test_scene_play_vengeance_spends_card_and_increases_own_total():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9H", "2C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p1.vengeance"] = ["5S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.meta["scene"]["participants"][0] == "p1"
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 19

    game, result = scene_play_vengeance(game, player_id="p1")

    assert result["modifier"] == 2
    assert result["target_total"] == 21
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 21
    assert game.meta["scene"]["players"]["p1"]["modifier_total"] == 2
    assert game.meta["scene"]["players"]["p1"]["vengeance_mod_cards"] == ["5S"]
    assert game.zones["players.p1.vengeance"] == []
    assert game.zones["scene.mod.vengeance.p1"] == ["5S"]


def test_scene_drawn_ace_uses_best_value_below_or_equal_21():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "AH"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    assert game.zones["scene.hand.p1"] == ["9C"]
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 19

    game = scene_draw_card(game, player_id="p1")
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 20
    assert game.meta["scene"]["players"]["p1"]["busted"] is False


def test_scene_set_participants_allows_second_scene_after_resolve():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.zones["scene.hand.p1"] == ["8D", "2H"]

    game = scene_acknowledge_resolution(game, player_id="p1")
    assert game.meta["scene"]["status"] == "resolved"

    game = scene_new(game, actor_id="host1")

    game = scene_set_participants(game, actor_id="host1", participant_ids=["p2"])

    scene = game.meta["scene"]
    assert scene["status"] == "setup"
    assert scene["participants"] == ["p2"]
    assert scene["players"] == {
        "p2": {
            "figure_card_id": "QD",
            "figure_value": 10,
            "hand_value": 10,
            "scum_mod_cards": [],
            "vengeance_mod_cards": [],
            "modifier_total": 0,
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


def test_scene_bust_increments_persistent_wounds():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "5D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_draw_card(game, player_id="p1")

    scene = game.meta["scene"]
    assert scene["status"] == "awaiting_ack"
    assert scene["players"]["p1"]["busted"] is True
    assert scene["players"]["p1"]["wounds_gained"] == 1
    assert scene["players"]["p1"]["result"] == "bust"
    assert game.meta["players"]["p1"].get("wounds", 0) == 0


def test_scene_acknowledge_resolution_discards_scene_cards_after_last_ack():
    game = _ready_table_game()
    success_card = _first_available(game, ["AH", "AD", "AC", "AS"])
    game = _with_draw_order(game, ["4H", "6C", "8D", "2H", success_card])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p1.scum"] = ["7S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game, _ = scene_play_scum(game, player_id="p1", target_player_id="p2")
    game = scene_stand(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.zones["scene.difficulty"] == ["4H"]
    assert game.zones["scene.azzardo"] == ["6C"]
    assert game.zones["scene.hand.p1"] == ["8D"]
    assert game.zones["scene.hand.p2"] == ["2H"]
    assert game.zones["scene.mod.scum.p2"] == ["7S"]

    game = scene_acknowledge_resolution(game, player_id="p1")
    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p1"]["acknowledged"] is True
    assert "scene.difficulty" in game.zones

    game = scene_acknowledge_resolution(game, player_id="p2")

    assert game.meta["scene"]["status"] == "resolved"
    assert game.meta["scene"]["participants"] == ["p1", "p2"]
    assert game.meta["scene"]["players"]["p2"]["acknowledged"] is True
    assert game.meta["scene"]["difficulty"]["card_id"] == "4H"
    assert game.meta["scene"]["azzardo"]["card_id"] == "6C"
    assert game.zones["scene.difficulty"] == ["4H"]
    assert game.zones["scene.azzardo"] == ["6C"]
    assert game.zones["scene.hand.p1"] == ["8D"]
    assert game.zones["scene.hand.p2"] == ["2H"]
    assert game.zones["scene.mod.scum.p2"] == ["7S"]


def test_scene_new_reopens_setup_after_all_acknowledged():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"

    game = scene_acknowledge_resolution(game, player_id="p1")

    assert game.meta["scene"]["status"] == "resolved"
    assert len(game.zones["players.p1.rewards"]) == 0

    game = scene_new(game, actor_id="host1")

    scene = game.meta["scene"]
    assert scene["status"] == "setup"
    assert scene["participants"] == []
    assert scene["players"] == {}
    assert scene["difficulty"]["card_id"] is None
    assert "scene.difficulty" not in game.zones
    assert "scene.hand.p1" not in game.zones
    assert len(game.zones["players.p1.rewards"]) == 1


def test_bust_applies_exactly_one_persistent_wound_on_new_scene():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "5D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["players"]["p1"].get("wounds", 0) == 0

    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_new(game, actor_id="host1")

    assert game.meta["players"]["p1"]["wounds"] == 1


def test_marshal_bust_prevents_persistent_wound_for_busted_player():
    game = _ready_table_game()
    game = _with_draw_order(game, ["10H", "KD", "9C", "8D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["players"]["p1"].get("wounds", 0) == 0

    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_acknowledge_resolution(game, player_id="p2")
    game = scene_new(game, actor_id="host1")

    assert game.meta["players"]["p1"]["wounds"] == 0
    assert len(game.zones["players.p2.rewards"]) == 1


def test_dead_player_cannot_join_future_scene():
    game = _ready_table_game()
    game.meta.setdefault("players", {})
    game.meta["players"]["p1"] = {"wounds": 2}

    try:
        scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    except ValueError as exc:
        assert "Dead characters cannot participate" in str(exc)
    else:
        raise AssertionError("Expected dead player to be blocked from scene participation")


def test_dead_player_cannot_receive_marshal_bonus_card():
    game = _ready_table_game()
    game.meta.setdefault("players", {})
    game.meta["players"]["p2"] = {"wounds": 2}
    game.meta["scene"] = {"status": "resolved", "participants": [], "players": {}}

    try:
        scene_assign_bonus_card(game, actor_id="host1", player_id="p2", bonus_type="scum")
    except ValueError as exc:
        assert "Dead characters cannot receive" in str(exc)
    else:
        raise AssertionError("Expected dead player to be blocked from Marshal bonus assignment")


def test_scene_new_enters_victory_phase_when_all_players_are_dead():
    game = _ready_table_game()
    game.meta.setdefault("players", {})
    game.meta["players"]["p1"] = {"wounds": 1}
    game.meta["players"]["p2"] = {"wounds": 2}
    game = _with_draw_order(game, ["4H", "9C", "5D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"

    game = scene_acknowledge_resolution(game, player_id="p1")
    game = scene_new(game, actor_id="host1")

    assert game.meta["phase"] == "victory"
    assert game.meta["victory"] == {
        "winner": "marshal",
        "winner_label": "Marshal",
        "reason": "All players are dead.",
    }


def test_scene_post_resolution_modifiers_recompute_results_and_clear_acks():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9H", "2C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p2.scum"] = ["7D"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")

    game = scene_stand(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p2"]["result"] == "failure"

    game = scene_acknowledge_resolution(game, player_id="p1")
    assert game.meta["scene"]["players"]["p1"]["acknowledged"] is True

    game, result = scene_play_scum(game, player_id="p2", target_player_id="p1")

    assert result["modifier"] == -1
    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p1"]["acknowledged"] is False
    assert game.meta["scene"]["players"]["p2"]["acknowledged"] is False
    assert game.meta["scene"]["players"]["p1"]["hand_value"] == 18
    assert game.meta["scene"]["players"]["p1"]["result"] == "success"


def test_busted_player_cannot_play_vengeance_on_self():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "5D"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game.zones["players.p1.vengeance"] = ["5S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")

    assert game.meta["scene"]["players"]["p1"]["busted"] is True

    try:
        scene_play_vengeance(game, player_id="p1")
    except ValueError as exc:
        assert "already busted" in str(exc)
    else:
        raise AssertionError("Expected busted player to be blocked from playing Vengeance")


def test_busted_player_cannot_be_targeted_with_scum_after_resolution():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "5D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p2.scum"] = ["7D"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p1"]["busted"] is True

    try:
        scene_play_scum(game, player_id="p2", target_player_id="p1")
    except ValueError as exc:
        assert "cannot be targeted with Scum" in str(exc)
    else:
        raise AssertionError("Expected busted player to be blocked from Scum targeting")


def test_busted_player_can_play_scum_on_non_busted_target_after_resolution():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "9C", "5D", "2H"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game.zones["players.p1.scum"] = ["7S"]
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_draw_card(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p1"]["busted"] is True
    assert game.meta["scene"]["players"]["p2"]["busted"] is False

    game, result = scene_play_scum(game, player_id="p1", target_player_id="p2")

    assert result["modifier"] == -2
    assert game.meta["scene"]["players"]["p2"]["hand_value"] == 10


def test_marshal_can_force_acknowledge_participant():
    game = _ready_table_game()
    success_card = _first_available(game, ["AH", "AD", "AC", "AS"])
    game = _with_draw_order(game, ["4H", "6C", "8D", "2H", success_card])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1", "p2"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_draw_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")
    game = scene_stand(game, player_id="p2")

    assert game.meta["scene"]["status"] == "awaiting_ack"

    game = scene_force_acknowledge_resolution(game, actor_id="host1", player_id="p1")

    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert game.meta["scene"]["players"]["p1"]["acknowledged"] is True
    assert game.meta["scene"]["players"]["p2"]["acknowledged"] is False


def test_marshal_can_assign_one_bonus_card_per_player_after_scene():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "2H", "9C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")
    game = scene_acknowledge_resolution(game, player_id="p1")

    assert game.meta["scene"]["status"] == "resolved"
    initial_scum = list(game.zones["players.p2.scum"])

    game, result = scene_assign_bonus_card(
        game,
        actor_id="host1",
        player_id="p2",
        bonus_type="scum",
    )

    assert result["bonus_type"] == "scum"
    assert len(game.zones["players.p2.scum"]) == len(initial_scum) + 1
    assert game.meta["scene"]["bonus_assignments"]["p2"] == "scum"

    try:
        scene_assign_bonus_card(game, actor_id="host1", player_id="p2", bonus_type="vengeance")
    except ValueError as exc:
        assert "at most one Marshal bonus card" in str(exc)
    else:
        raise AssertionError("Expected second bonus assignment to the same player to fail")


def test_bonus_assignment_survives_ui_enrichment_and_still_blocks_second_bonus():
    game = _ready_table_game()
    game = _with_draw_order(game, ["4H", "8D", "2H", "9C"])
    game = scene_set_participants(game, actor_id="host1", participant_ids=["p1"])
    game, _difficulty = scene_roll_difficulty(game, actor_id="host1")
    game = scene_skip_azzardo(game, actor_id="host1")
    game = scene_start(game, actor_id="host1")
    game = scene_stand(game, player_id="p1")
    game = scene_acknowledge_resolution(game, player_id="p1")

    game, _result = scene_assign_bonus_card(
        game,
        actor_id="host1",
        player_id="p2",
        bonus_type="vengeance",
    )

    game = enrich_meta_for_ui(game)
    assert game.meta["scene"]["bonus_assignments"]["p2"] == "vengeance"

    try:
        scene_assign_bonus_card(game, actor_id="host1", player_id="p2", bonus_type="scum")
    except ValueError as exc:
        assert "at most one Marshal bonus card" in str(exc)
    else:
        raise AssertionError("Expected second bonus assignment after enrich_meta_for_ui to fail")


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
