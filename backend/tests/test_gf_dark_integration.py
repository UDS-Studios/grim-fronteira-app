"""Cross-system Dark audit: public API, persistence and full card conservation."""
from copy import deepcopy

import pytest

from backend.app.store import GAMES
from backend.engine.state.game_state_io import save_game_state, load_game_state
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.engine.state.validators import validate_game_state
from backend.tests.test_gf_dark import (
    game_id, dispatch, hand_action, reject, prepare_waiting, closed_loser,
    DARK_HAND, _with_draw_order, _replace_zone_cards,
)


pytestmark = pytest.mark.usefixtures("enabled_debug_api")


def test_legacy_difficulty_cannot_bypass_dark(game_id):
    dispatch(game_id)
    reject(game_id, "roll_difficulty", player_ids=["p1"], match="Dark")


def test_saved_new_scene_continuation_cannot_skip_dark_loss(game_id):
    closed_loser(game_id, ["5D"])
    GAMES[game_id].state = begin_pending_interaction(GAMES[game_id].state, {
        "kind": "legacy", "actor_id": "p1", "allowed_actions": [], "payload": {},
        "continuation": {"on_resolve": {"kind": "resume_scene_new", "payload": {}},
                         "on_reclaim": {"kind": "resume_scene_new", "payload": {}}},
    })
    reject(game_id, "pending_reclaim", match="Dark Reward")


def test_paisa_cannot_skip_outstanding_dark_loss(game_id):
    closed_loser(game_id, ["5D"])
    game = GAMES[game_id].state
    # Change the non-participant's figure to a Paisa using physical card movement.
    game = _replace_zone_cards(game, "players.p2.character", ["QC"])
    game = _replace_zone_cards(game, "players.p2.rewards", ["10H"])
    game = _replace_zone_cards(game, "players.p2.vengeance", ["2D", "3D", "4D"])
    GAMES[game_id].state = _with_draw_order(game, ["AH"])
    hand_action(game_id, "faction_paisa_claim_reward", actor_id="p2", player_id="p2", vengeance_card_ids=["2D", "3D", "4D"])
    assert GAMES[game_id].state.meta["phase"] == "table"
    hand_action(game_id, "scene_discard_dark_reward", actor_id="p1", player_id="p1", reward_card_id="5D")
    assert GAMES[game_id].state.meta["phase"] == "victory"
    assert GAMES[game_id].state.meta["victory"]["winner"] == "p2"


@pytest.mark.parametrize("bust", [False, True])
def test_complete_dark_encounter_with_reload_at_each_transition(game_id, tmp_path, bust):
    from backend.app.serializers import game_state_to_dict
    from backend.engine.rules.grim_fronteira.scene import ensure_scene_state

    def step(name, **params):
        response = hand_action(game_id, name, **params)
        game = GAMES[game_id].state
        validate_game_state(game)
        path = tmp_path / "encounter.json"
        save_game_state(game, path)
        loaded = load_game_state(path)
        assert loaded == game == ensure_scene_state(loaded)
        GAMES[game_id].state = loaded
        return response

    step("scene_set_participants", participant_ids=["p1", "p2"])
    step("scene_set_mode", mode="standard")
    game = GAMES[game_id].state
    # Provision known resources/rewards before the encounter starts.
    for zone, cards in {
        "players.p1.rewards": ["10D", "9D", "6D", "4H"],
        "players.p1.vengeance": ["5H"],
        "players.p2.vengeance": ["6H", "7H"],
        "players.p2.scum": ["3H", "4D"],
    }.items():
        game = _replace_zone_cards(game, zone, cards)
    GAMES[game_id].state = _with_draw_order(game, ["2H", "3C", "4C", "9C", "8S", "8C", "8D", "AC", "10C", "2D", "3D"])
    step("scene_declare_dark")
    step("scene_roll_difficulty")
    step("scene_dark_draw")
    step("scene_dark_draw")
    step("scene_dark_draw")  # 28: busting extra card stays until discarded.
    reject(game_id, "scene_dark_draw")
    step("scene_dark_discard_last")
    step("scene_start")
    if bust:
        step("scene_draw_card", player_id="p1")
        pending = GAMES[game_id].state.meta["pending_interaction"]
        assert pending["kind"] == "chichimeca_choose_target"
        step("pending_reclaim")
    else:
        step("scene_stand", player_id="p1")
        # Skip the bust card reserved for the alternate branch.
        GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["AC", "10C", "2D", "3D"])
    step("scene_stand", player_id="p2")
    assert GAMES[game_id].state.meta["scene"]["status"] == "active"
    step("scene_dark_draw")  # Soft Ace: total 20.
    step("scene_dark_draw")  # 30 -> discard while waiting.
    reject(game_id, "scene_dark_reveal")
    step("scene_dark_discard_last")
    snapshot = deepcopy(GAMES[game_id].state)
    for view, viewer in [("public", None), ("player", "p1"), ("player", "host1")]:
        data = game_state_to_dict(snapshot, view=view, viewer_id=viewer)
        assert data["zones"][DARK_HAND] == {"count": len(snapshot.zones[DARK_HAND])}
        assert data["meta"]["scene"]["difficulty"]["card_id"] is None
        assert data["meta"]["scene"]["difficulty"]["value"] is None
        assert "must_discard_last" not in data["meta"]["scene"]["dark"]
        assert isinstance(data["deck"]["discard_pile"], dict)
        assert "scene.difficulty_value" not in data["meta"]
    step("scene_dark_reveal", view="public")
    assert GAMES[game_id].state.deck == snapshot.deck
    assert GAMES[game_id].state.zones == snapshot.zones
    # P2 changes failure -> success (18 -> 20 through two off-suit cards).
    step("scene_play_vengeance", player_id="p2")  # +1 -> 19
    step("scene_play_vengeance", player_id="p2")  # +1 -> 20
    assert GAMES[game_id].state.meta["scene"]["players"]["p2"]["reward_cards_gained"] == 2
    if not bust:
        # P1's non-bust failure remains provisional until both acknowledge.
        assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 0
    for pid in ["p1", "p2"]:
        step("scene_acknowledge_resolution", player_id=pid)
    if not bust:
        assert GAMES[game_id].state.meta["pending_interaction"]["kind"] == "chichimeca_choose_target"
        step("faction_chichimeca_choose_target", actor_id="p1", player_id="p1", target_player_id="p2")
    assert GAMES[game_id].state.meta["players"]["p1"]["wounds"] == 1
    assert GAMES[game_id].state.meta["scene"]["status"] == "resolved"
    step("scene_close")
    game = GAMES[game_id].state
    assert game.zones["players.p2.rewards"] == ["2D", "3D"]
    assert not any(zone.startswith("scene.") for zone in game.zones)
    assert game.meta["scene"]["players"]["p1"]["dark_reward_loss_pending"]
    reject(game_id, "scene_new")
    step("scene_skip_heal", player_id="p1")
    step("scene_discard_reward", player_id="p1", reward_card_id="6D")
    reject(game_id, "scene_new")
    step("scene_discard_dark_reward", player_id="p1", reward_card_id="4H")
    step("scene_new")
    scene = GAMES[game_id].state.meta["scene"]
    assert scene["dark_mode"] is False
    assert scene["dark"] == {"revealed": False, "must_discard_last": False}
    assert not any(zone.startswith("scene.") for zone in GAMES[game_id].state.zones)


@pytest.mark.parametrize("name", ["scene_dark_draw", "scene_dark_discard_last", "scene_dark_reveal"])
def test_hidden_hand_errors_do_not_describe_secret_state(game_id, name):
    from backend.app.main import action
    from backend.app.schemas import ActionRequest
    prepare_waiting(game_id)
    if name != "scene_dark_discard_last":
        GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["8D"])
        hand_action(game_id, "scene_dark_draw")
    before = deepcopy(GAMES[game_id].state)
    for view in ["public", "player"]:
        with pytest.raises(ValueError, match="^Dark hand action is unavailable\\.$"):
            action(ActionRequest(game_id=game_id, action=f"gf.{name}",
                params={"actor_id": "host1"}, view=view, viewer_id="host1"))
        assert GAMES[game_id].state == before


def test_multiple_dark_chichimecas_resume_serially_after_reload(game_id, tmp_path):
    game = _replace_zone_cards(GAMES[game_id].state, "players.p2.character", ["QS"])
    GAMES[game_id].state = _with_draw_order(game, ["9H", "8S", "8C"])
    hand_action(game_id, "scene_set_participants", participant_ids=["p1", "p2"])
    for name in ["scene_declare_dark", "scene_roll_difficulty", "scene_start"]:
        hand_action(game_id, name)
    for pid in ["p1", "p2"]:
        hand_action(game_id, "scene_stand", player_id=pid)
    hand_action(game_id, "scene_dark_reveal")
    for pid in ["p1", "p2"]:
        hand_action(game_id, "scene_acknowledge_resolution", player_id=pid)
    for pid, target in [("p1", "p2"), ("p2", "p1")]:
        game = GAMES[game_id].state
        assert game.meta["pending_interaction"]["actor_id"] == pid
        path = tmp_path / "wounds.json"
        save_game_state(game, path)
        GAMES[game_id].state = load_game_state(path)
        assert GAMES[game_id].state == game
        reject(game_id, "scene_close", match="Action not permitted")
        hand_action(game_id, "faction_chichimeca_choose_target", actor_id=pid, player_id=pid, target_player_id=target)
    game = GAMES[game_id].state
    assert game.meta.get("pending_interaction") is None
    assert game.meta["scene"]["status"] == "resolved"
    for pid in ["p1", "p2"]:
        assert game.meta["players"][pid]["wounds"] == 1
        assert game.meta["scene"]["players"][pid]["wounds_applied"] == 1
    hand_action(game_id, "scene_close")
    hand_action(game_id, "scene_new")


@pytest.mark.parametrize("joker,bonus,player_card", [("BJ", "vengeance", "8S"), ("RJ", "scum", "9S")])
def test_hidden_joker_bonus_used_in_same_scene(game_id, joker, bonus, player_card):
    from backend.tests.test_gf_dark import finish_acknowledgements

    for pid in ["p1", "p2"]:
        GAMES[game_id].state = _replace_zone_cards(GAMES[game_id].state, f"players.{pid}.{bonus}", [])
    hand_action(game_id, "scene_declare_dark")
    GAMES[game_id].state = _with_draw_order(
        GAMES[game_id].state, ["9H", joker, player_card, "5H", "6C"])
    hand_action(game_id, "scene_roll_difficulty")
    before = deepcopy(GAMES[game_id].state)
    hand_action(game_id, "scene_dark_draw", view="public")
    for pid in ["p1", "p2"]:
        zone = f"players.{pid}.{bonus}"
        assert GAMES[game_id].state.zones.get(zone, []) == before.zones.get(zone, [])
    hand_action(game_id, "scene_start")
    hand_action(game_id, "scene_stand", player_id="p1")
    hand_action(game_id, "scene_dark_reveal")
    game = GAMES[game_id].state
    assert game.meta["scene"]["status"] == "awaiting_ack"
    assert not game.meta["scene"]["players"]["p1"]["acknowledged"]
    assert game.zones[f"players.p1.{bonus}"] == ["5H"]
    assert game.zones[f"players.p2.{bonus}"] == ["6C"]
    prior = game.meta["scene"]["players"]["p1"]["result"]
    if bonus == "vengeance":
        assert prior == "failure"
        hand_action(game_id, "scene_play_vengeance", player_id="p1")
        assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["result"] == "success"
    else:
        assert prior == "success"
        hand_action(game_id, "scene_play_scum", player_id="p2", target_player_id="p1")
        assert GAMES[game_id].state.meta["scene"]["players"]["p1"]["result"] == "failure"
    finish_acknowledgements(game_id)
    hand_action(game_id, "scene_close")
    hand_action(game_id, "scene_new")
    game = GAMES[game_id].state
    assert not any(zone.startswith("scene.") for zone in game.zones)
    validate_game_state(game)


def test_marshal_frontend_visibility_contract(game_id):
    from backend.tests.test_yankees import http_request

    def step(name, **params):
        before = GAMES[game_id].state.meta.get("revision", 0)
        status, response = http_request("/api/gf/action", method="POST", body={
            "game_id": game_id, "action": f"gf.{name}",
            "params": {"actor_id": "host1", **params}, "view": "marshal", "viewer_id": "host1",
        })
        assert status == 200, response
        assert response["revision"] == before + 1
        validate_game_state(GAMES[game_id].state)
        return response

    def check_hidden(total, cards, bust=False):
        before = deepcopy(GAMES[game_id].state)
        for query in ["view=public", "view=player&viewer_id=p1", "view=player&viewer_id=host1", "view=marshal&viewer_id=host1"]:
            status, response = http_request(f"/api/game/{game_id}", query=query)
            assert status == 200
            data = response["state"]
            scene = data["meta"]["scene"]
            if query.startswith("view=marshal"):
                assert scene["difficulty"]["card_id"] == "2H"
                assert scene["difficulty"]["value"] == 12
                assert data["zones"].get(DARK_HAND, []) == cards
                assert scene["dark"]["marshal_total"] == total
                assert scene["dark"]["must_discard_last"] is bust
            else:
                assert scene["difficulty"]["card_id"] is None
                assert data["zones"][DARK_HAND] == {"count": len(cards)}
                assert "marshal_total" not in scene["dark"]
                assert "must_discard_last" not in scene["dark"]
            assert isinstance(data["deck"]["discard_pile"], dict)
        assert GAMES[game_id].state == before

    GAMES[game_id].state = _with_draw_order(GAMES[game_id].state, ["2H", "3C", "9S", "8S"])
    step("scene_declare_dark")
    response = step("scene_roll_difficulty")
    assert response["result"]["difficulty"]["card_id"] == "2H"
    assert response["state"]["meta"]["scene"]["dark"]["marshal_total"] == 12
    check_hidden(12, [])
    response = step("scene_dark_draw")
    assert response["result"]["card_id"] == "3C"
    assert response["state"]["zones"][DARK_HAND] == ["3C"]
    check_hidden(15, ["3C"])
    step("scene_dark_draw")
    check_hidden(24, ["3C", "9S"], bust=True)
    response = step("scene_dark_discard_last")
    assert response["result"]["card_id"] == "9S"
    assert response["result"]["marshal_total"] == 15
    assert isinstance(response["state"]["deck"]["discard_pile"], dict)
    check_hidden(15, ["3C"])
    step("scene_start")
    step("scene_stand", player_id="p1")
    step("scene_dark_reveal")
    for query in ["view=public", "view=player&viewer_id=p1", "view=marshal&viewer_id=host1", "view=debug"]:
        status, response = http_request(f"/api/game/{game_id}", query=query)
        assert status == 200
        data = response["state"]
        assert data["meta"]["scene"]["dark"]["marshal_total"] == 15
        assert data["meta"]["scene"]["difficulty"]["card_id"] == "2H"
        assert data["zones"][DARK_HAND] == ["3C"]
    assert "marshal_total" not in GAMES[game_id].state.meta["scene"]["dark"]


def test_discarded_dark_card_cannot_be_the_next_draw(game_id):
    from backend.tests.test_gf_dark import prepare_hand
    prepare_hand(game_id, ["9H", "8C", "2D"])

    def locations(card):
        game = GAMES[game_id].state
        validate_game_state(game)
        piles = {"draw": game.deck.draw_pile, "discard": game.deck.discard_pile,
                 "in_play": game.deck.in_play, "removed": game.deck.removed, **game.zones}
        return [name for name, cards in piles.items() if card in cards]

    assert locations("8C") == ["draw"]
    hand_action(game_id, "scene_dark_draw", view="marshal", viewer_id="host1")
    assert locations("8C") == [DARK_HAND]
    assert GAMES[game_id].state.meta["scene"]["dark"]["must_discard_last"]
    response = hand_action(game_id, "scene_dark_discard_last", view="marshal", viewer_id="host1")
    assert locations("8C") == ["discard"]
    assert isinstance(response.state["deck"]["discard_pile"], dict)
    response = hand_action(game_id, "scene_dark_draw", view="marshal", viewer_id="host1")
    assert response.result["card_id"] == "2D"
    assert locations("2D") == [DARK_HAND]
    assert locations("8C") == ["discard"]
