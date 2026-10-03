"""Restricted Marshal role contract; totals are derived and hidden totals omitted."""
from copy import deepcopy
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException

from backend.app.main import get_state
from backend.app.serializers import game_state_to_dict
from backend.app.store import GAMES
from backend.engine.state.game_state_io import load_game_state, save_game_state
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.tests.test_gf_dark import (
    game_id, hand_action, prepare_hand, DARK_HAND, _with_draw_order,
)
from backend.tests.test_yankees import http_request


pytestmark = pytest.mark.usefixtures("enabled_debug_api")


@pytest.mark.parametrize("viewer,expected", [(None, 422), ("", 422), ("   ", 422), ("p1", 403), (" host1 ", 403), ("host1", 200)])
@pytest.mark.parametrize("method", ["GET", "POST"])
def test_marshal_http_validation_before_mutation(game_id, viewer, expected, method):
    original = GAMES[game_id].state
    before = deepcopy(original)
    if method == "GET":
        query = {"view": "marshal"}
        if viewer is not None:
            query["viewer_id"] = viewer
        status, response = http_request(f"/api/game/{game_id}", query=urlencode(query))
    else:
        status, response = http_request("/api/gf/action", method="POST", body={
            "game_id": game_id, "action": "gf.scene_declare_dark", "params": {"actor_id": "host1"},
            "view": "marshal", "viewer_id": viewer,
        })
    assert status == expected
    if method == "POST" and expected == 200:
        assert response["revision"] == before.meta.get("revision", 0) + 1
    else:
        assert GAMES[game_id].state is original
        assert original == before


@pytest.mark.parametrize("viewer", [None, "", " ", "p1"])
def test_serializer_validates_marshal_role(game_id, viewer):
    with pytest.raises(HTTPException):
        game_state_to_dict(GAMES[game_id].state, view="marshal", viewer_id=viewer)


@pytest.mark.parametrize("cards,total,bust", [(["AH", "AC", "RJ"], 12, False), (["BJ", "AS"], 21, False), (["9H", "8C"], 27, True)])
def test_marshal_derived_total_reload_and_restrictions(game_id, tmp_path, cards, total, bust):
    prepare_hand(game_id, cards)
    for _ in cards[1:]:
        hand_action(game_id)
    original = GAMES[game_id].state
    before = deepcopy(original)
    path = tmp_path / "marshal.json"
    save_game_state(original, path)
    loaded = load_game_state(path)
    assert loaded == before
    assert "marshal_total" not in loaded.meta["scene"]["dark"]
    GAMES[game_id].state = loaded
    for view, viewer in [("marshal", "host1"), ("debug", None), ("public", None), ("player", "p1"), ("player", "host1")]:
        response = get_state(game_id, view=view, viewer_id=viewer)
        data = response.state
        scene = data["meta"]["scene"]
        if view in {"marshal", "debug"}:
            assert scene["dark"]["marshal_total"] == total
            assert scene["dark"]["must_discard_last"] is bust
            assert scene["difficulty"]["card_id"] == cards[0]
            assert scene["difficulty"]["value"] == loaded.meta["scene"]["difficulty"]["value"]
            assert data["zones"]["scene.difficulty"] == cards[:1]
            assert data["zones"].get(DARK_HAND, []) == cards[1:]
        else:
            assert "marshal_total" not in scene["dark"]
            assert "must_discard_last" not in scene["dark"]
            assert scene["difficulty"]["card_id"] is None
            assert scene["difficulty"]["value"] is None
            assert "scene.difficulty_value" not in data["meta"]
            assert data["zones"]["scene.difficulty"] == {"count": 1}
            assert data["zones"][DARK_HAND] == {"count": len(cards) - 1}
        if view != "debug":
            assert data["deck"]["draw_pile"] == {"count": len(loaded.deck.draw_pile)}
            assert data["deck"]["discard_pile"] == {"count": len(loaded.deck.discard_pile)}
        else:
            assert data["deck"]["draw_pile"] == loaded.deck.draw_pile
        assert response.revision == loaded.meta["revision"]
    assert GAMES[game_id].state == before


def test_marshal_keeps_yankee_private_payload_hidden(game_id):
    game = GAMES[game_id].state
    game = begin_pending_interaction(game, {
        "kind": "yankee_inspect_top_card", "actor_id": "p1",
        "allowed_actions": ["gf.faction_yankee_choose_top_card"],
        "payload": {"inspected_card_id": game.deck.draw_pile[-1]}, "continuation": None,
    })
    GAMES[game_id].state = game
    for view, viewer, visible in [("player", "p1", True), ("player", "p2", False),
                                  ("marshal", "host1", False), ("public", None, False), ("debug", None, True)]:
        payload = get_state(game_id, view=view, viewer_id=viewer).state["meta"]["pending_interaction"]["payload"]
        assert ("inspected_card_id" in payload) is visible


def test_marshal_preserves_hidden_azzardo_and_debug_only_actions(game_id):
    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "3C"])
    hand_action(game_id, "scene_roll_difficulty", view="marshal", viewer_id="host1")
    hand_action(game_id, "scene_draw_azzardo", view="marshal", viewer_id="host1")
    for view, viewer in [("marshal", "host1"), ("public", None), ("player", "p1")]:
        data = get_state(game_id, view=view, viewer_id=viewer).state
        assert data["meta"]["scene"]["azzardo"]["card_id"] is None
        assert data["meta"]["scene"]["azzardo"]["value"] is None
        assert data["zones"]["scene.azzardo"] == []
        assert "marshal_total" not in data["meta"]["scene"]["dark"]
    assert get_state(game_id, view="debug").state["zones"]["scene.azzardo"] == ["3C"]
    before = deepcopy(GAMES[game_id].state)
    status, _ = http_request("/api/gf/action", method="POST", body={
        "game_id": game_id, "action": "gf.debug_stack_top_card", "params": {"card_id": "RJ"},
        "view": "marshal", "viewer_id": "host1",
    })
    assert status == 403
    assert GAMES[game_id].state == before


@pytest.mark.parametrize("view,viewer", [("public", None), ("player", "p1"), ("player", "host1")])
def test_hidden_dark_count_lifecycle_is_projection_only(game_id, tmp_path, view, viewer):
    from backend.engine.state.validators import validate_game_state

    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "3C", "9D", "8S"])
    hand_action(game_id, "scene_declare_dark")

    def check(opening_count, extra_count):
        original = GAMES[game_id].state
        snapshot = deepcopy(original)
        response = get_state(game_id, view=view, viewer_id=viewer)
        data = response.state
        assert data["zones"]["scene.difficulty"] == {"count": opening_count}
        assert data["zones"][DARK_HAND] == {"count": extra_count}
        assert "scene.difficulty.cards" not in data["zones"]
        assert data["meta"]["scene"]["difficulty"]["card_id"] is None
        assert data["meta"]["scene"]["difficulty"]["value"] is None
        assert data["meta"]["scene"]["dark"] == {"revealed": False}
        assert "scene.difficulty_value" not in data["meta"]
        assert isinstance(data["deck"]["discard_pile"], dict)
        for card in ["2H", "3C", "9D"]:
            assert card not in str(data)
        assert response.revision == original.meta["revision"]
        assert GAMES[game_id].state is original
        assert original == snapshot
        assert all(isinstance(cards, list) for cards in original.zones.values())
        validate_game_state(original)
        for private_view, private_viewer in [("marshal", "host1"), ("debug", None)]:
            private = game_state_to_dict(original, view=private_view, viewer_id=private_viewer)
            assert private["zones"] == original.zones
            assert private["meta"]["scene"]["dark"]["must_discard_last"] == original.meta["scene"]["dark"]["must_discard_last"]
        return data

    check(0, 0)
    hand_action(game_id, "scene_roll_difficulty", view=view, viewer_id=viewer)
    check(1, 0)
    hand_action(game_id, "scene_dark_draw", view=view, viewer_id=viewer)
    check(1, 1)
    hand_action(game_id, "scene_dark_draw", view=view, viewer_id=viewer)
    check(1, 2)
    response = hand_action(game_id, "scene_dark_discard_last", view=view, viewer_id=viewer)
    assert response.state["zones"][DARK_HAND] == {"count": 1}
    assert "9D" not in str(response.model_dump())
    before_reload = check(1, 1)
    path = tmp_path / "hidden-counts.json"
    save_game_state(GAMES[game_id].state, path)
    GAMES[game_id].state = load_game_state(path)
    assert check(1, 1) == before_reload
    hand_action(game_id, "scene_start")
    hand_action(game_id, "scene_stand", player_id="p1")
    hand_action(game_id, "scene_dark_reveal")
    for revealed_view, revealed_viewer in [("public", None), ("player", "p1"), ("marshal", "host1"), ("debug", None)]:
        revealed = get_state(game_id, view=revealed_view, viewer_id=revealed_viewer).state
        assert revealed["zones"]["scene.difficulty"] == ["2H"]
        assert revealed["zones"][DARK_HAND] == ["3C"]
        assert revealed["meta"]["scene"]["dark"]["marshal_total"] == 15


@pytest.mark.parametrize("view,viewer", [("public", None), ("player", "p1")])
def test_legacy_hidden_difficulty_count_and_joker_privacy(game_id, view, viewer):
    prepare_hand(game_id, ["RJ", "BJ"])
    hand_action(game_id, "scene_dark_draw")
    game = deepcopy(GAMES[game_id].state)
    # A legacy physical difficulty zone gets the same count-only treatment.
    game.zones["scene.difficulty.cards"] = game.zones.pop("scene.difficulty")
    before = deepcopy(game)
    data = game_state_to_dict(game, view=view, viewer_id=viewer)
    assert data["zones"]["scene.difficulty"] == {"count": 0}
    assert data["zones"]["scene.difficulty.cards"] == {"count": 1}
    assert data["zones"][DARK_HAND] == {"count": 1}
    assert "RJ" not in str(data) and "BJ" not in str(data)
    assert data["meta"]["scene"]["dark"] == {"revealed": False}
    assert game == before
    for private_view, private_viewer in [("marshal", "host1"), ("debug", None)]:
        private = game_state_to_dict(game, view=private_view, viewer_id=private_viewer)
        assert private["zones"] == game.zones
        assert private["zones"]["scene.difficulty.cards"] == ["RJ"]
        assert private["zones"][DARK_HAND] == ["BJ"]
