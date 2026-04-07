from fastapi import HTTPException

from backend.app.main import action, new_game
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.store import GAMES
from backend.engine.grimdeck.models import DeckState
from backend.engine.state.game_state import GameState


def setup_function() -> None:
    GAMES.clear()


def _new_game() -> tuple[str, dict]:
    payload = new_game(NewGameRequest()).model_dump()
    return payload["game_id"], payload["state"]


def _action(game_id: str, action_name: str, params: dict, view: str = "debug"):
    return action(
        ActionRequest(
            game_id=game_id,
            action=action_name,
            params=params,
            view=view,
        )
    )


def test_debug_stack_top_card_moves_draw_pile_middle_to_top():
    game_id, state = _new_game()
    card_id = state["deck"]["draw_pile"][-3]

    payload = _action(game_id, "gf.debug_stack_top_card", {"card_id": card_id}).model_dump()

    assert payload["result"]["top_of_draw_pile"] == card_id
    assert payload["state"]["deck"]["draw_pile"][-1] == card_id


def test_debug_stack_top_card_moves_discard_to_top():
    game_id, _state = _new_game()
    current = GAMES[game_id].state
    assert current.deck is not None
    card_id = current.deck.draw_pile[-2]
    draw_pile = list(current.deck.draw_pile)
    draw_pile.remove(card_id)
    deck = DeckState(
        version=current.deck.version,
        schema=current.deck.schema,
        created_utc=current.deck.created_utc,
        notes=current.deck.notes,
        settings=current.deck.settings,
        draw_pile=draw_pile,
        in_play=current.deck.in_play,
        discard_pile=current.deck.discard_pile + [card_id],
        removed=current.deck.removed,
    )
    GAMES[game_id].state = GameState(
        version=current.version,
        schema=current.schema,
        deck=deck,
        zones=current.zones,
        meta=current.meta,
    )

    payload = _action(game_id, "gf.debug_stack_top_card", {"card_id": card_id}).model_dump()

    assert payload["state"]["deck"]["discard_pile"][-1:] != [card_id]
    assert payload["state"]["deck"]["draw_pile"][-1] == card_id


def test_debug_stack_top_card_moves_zone_card_to_top():
    game_id, _state = _new_game()
    current = GAMES[game_id].state
    assert current.deck is not None
    card_id = current.deck.draw_pile[-4]
    draw_pile = list(current.deck.draw_pile)
    draw_pile.remove(card_id)
    deck = DeckState(
        version=current.deck.version,
        schema=current.deck.schema,
        created_utc=current.deck.created_utc,
        notes=current.deck.notes,
        settings=current.deck.settings,
        draw_pile=draw_pile,
        in_play=current.deck.in_play,
        discard_pile=current.deck.discard_pile,
        removed=current.deck.removed,
    )
    zones = dict(current.zones)
    zones["players.p1.rewards"] = [card_id]
    GAMES[game_id].state = GameState(
        version=current.version,
        schema=current.schema,
        deck=deck,
        zones=zones,
        meta=current.meta,
    )

    payload = _action(game_id, "gf.debug_stack_top_card", {"card_id": card_id}).model_dump()

    assert payload["state"]["zones"]["players.p1.rewards"] == []
    assert payload["state"]["deck"]["draw_pile"][-1] == card_id


def test_debug_stack_top_card_is_debug_only():
    game_id, state = _new_game()
    card_id = state["deck"]["draw_pile"][-1]

    try:
        _action(game_id, "gf.debug_stack_top_card", {"card_id": card_id}, view="public")
    except HTTPException as exc:
        assert exc.status_code == 403
        assert exc.detail == "gf.debug_stack_top_card is debug-only"
    else:
        raise AssertionError("gf.debug_stack_top_card should reject non-debug views")


def test_debug_stack_top_card_rejects_missing_card():
    game_id, _state = _new_game()

    try:
        _action(game_id, "gf.debug_stack_top_card", {"card_id": "ZZ"})
    except ValueError as exc:
        assert str(exc) == "Card ZZ not found anywhere in game state."
    else:
        raise AssertionError("gf.debug_stack_top_card should reject missing cards")
