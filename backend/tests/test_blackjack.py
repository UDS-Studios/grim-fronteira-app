from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.grimdeck.deck_ops import shuffle
from backend.engine.state.game_state import GameState
from backend.engine.minigames.blackjack import deal, hit, stand, hand_value


def test_blackjack_player_bust_seed_123():
    deck = load_deck("data/templates/standard_52.json")
    deck = shuffle(deck, seed=123)

    game = GameState(deck=deck, zones={}, meta={})
    game = deal(game)

    assert hand_value(game.zones["hands.player"]) == 12
    assert hand_value(game.zones["hands.dealer"]) == 8
    assert game.meta["phase"] == "player_turn"

    game = hit(game, "player")

    assert hand_value(game.zones["hands.player"]) == 22
    assert game.meta["phase"] == "done"
    assert game.meta["outcome"] == "player_bust"