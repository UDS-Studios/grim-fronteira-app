from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.state.game_state import GameState
from backend.engine.rules.grim_fronteira.setup import (
    extract_face_pile,
    choose_from_face_pile,
    setup_players,
    face_rank,
    setup_starting_baggage,
)
from backend.engine.state.validators import validate_unique_cards


def _setup_with_face(face_card: str) -> GameState:
    deck = load_deck("data/templates/standard_54.json")
    game = GameState(deck=deck, zones={}, meta={"game": "grim_fronteira"})

    game = extract_face_pile(game)
    game = choose_from_face_pile(game, face_card, "players.p1.character")
    game = setup_starting_baggage(game, "p1")

    validate_unique_cards(game)
    return game


def test_gf_setup_jack_gets_2_scum():
    game = _setup_with_face("JS")
    assert len(game.zones["players.p1.character"]) == 1
    assert len(game.zones["players.p1.scum"]) == 2
    assert len(game.zones["players.p1.vengeance"]) == 0
    assert len(game.zones["players.p1.rewards"]) == 0


def test_gf_setup_queen_gets_1_scum_1_vengeance():
    game = _setup_with_face("QH")
    assert len(game.zones["players.p1.character"]) == 1
    assert len(game.zones["players.p1.scum"]) == 1
    assert len(game.zones["players.p1.vengeance"]) == 1
    assert len(game.zones["players.p1.rewards"]) == 0


def test_gf_setup_king_gets_2_vengeance():
    game = _setup_with_face("KD")
    assert len(game.zones["players.p1.character"]) == 1
    assert len(game.zones["players.p1.scum"]) == 0
    assert len(game.zones["players.p1.vengeance"]) == 2
    assert len(game.zones["players.p1.rewards"]) == 0


def test_setup_players_orchestrates_multi_player_setup():
    deck = load_deck("data/templates/standard_54.json")
    game = GameState(deck=deck, zones={}, meta={"game": "grim_fronteira"})

    game = setup_players(
        game,
        ["p1", "p2", "p3"],
        character_choices={"p1": "JS"},
        shuffle_face_pile_first=True,
        face_shuffle_seed=123,
        return_remaining_faces=True,
        return_shuffle_seed=987,
    )

    assert game.meta["setup.players_done"] is True
    assert game.meta["setup.players"] == ["p1", "p2", "p3"]
    assert "setup.face_pile" not in game.zones

    seen_chars: set[str] = set()
    for player_id in ("p1", "p2", "p3"):
        character_zone = f"players.{player_id}.character"
        assert len(game.zones[character_zone]) == 1

        character = game.zones[character_zone][0]
        assert character not in seen_chars
        seen_chars.add(character)

        rank = face_rank(character)
        scum = len(game.zones[f"players.{player_id}.scum"])
        vengeance = len(game.zones[f"players.{player_id}.vengeance"])
        rewards = len(game.zones[f"players.{player_id}.rewards"])

        assert rewards == 0
        if rank == "J":
            assert scum == 2
            assert vengeance == 0
        elif rank == "Q":
            assert scum == 1
            assert vengeance == 1
        else:
            assert rank == "K"
            assert scum == 0
            assert vengeance == 2

    validate_unique_cards(game)
