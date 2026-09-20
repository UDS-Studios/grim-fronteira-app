import asyncio
from copy import deepcopy
from dataclasses import replace
import json

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.app import main
from backend.app.schemas import ActionRequest, NewGameRequest
from backend.app.serializers import game_state_to_dict
from backend.app.store import GAMES, StoredGame
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.rules.grim_fronteira.factions import (
    YANKEE_CHOOSE_TOP_CARD as CHOOSE, begin_next_yankee_inspection,
)
from backend.engine.rules.grim_fronteira.scene import default_scene_state
from backend.engine.state.continuations import normalize_continuation
from backend.engine.state.game_state import GameState
from backend.engine.state.game_state_io import save_game_state, load_game_state
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.engine.state.validators import validate_game_state

RECLAIM = "gf.pending_reclaim"


def make_game(characters=("QH", "QD"), mode="duel", subtype="pvp", order=None):
    deck = load_deck("data/templates/standard_54.json")
    zones = {f"players.p{i}.character": [card] for i, card in enumerate(characters, 1)}
    # Existing NPC/standard start preconditions include a difficulty card.
    zones["scene.difficulty"] = ["2S"]
    owned = {c for cards in zones.values() for c in cards}
    sequence = ["9C", "9D", "8C", "5C", "2D"]
    draw = [c for c in deck.draw_pile if c not in owned and c not in sequence] + list(reversed(sequence))
    game = GameState(deck=replace(deck, draw_pile=draw), zones=zones, meta={
        "phase": "table", "marshal_id": "host", "revision": 10,
        "players_order": ["host", "p1", "p2"], "players": {"p1": {"wounds": 0}, "p2": {"wounds": 0}},
        "scene": {**default_scene_state(), "status": "setup", "mode": mode,
                  "duel": {"subtype": subtype if mode == "duel" else None, "sudden_death": False},
                  "difficulty": {"rule_id": None, "base": 2, "card_id": "2S", "value": 2}},
    })
    install(game)
    dispatch("gf.scene_set_participants", actor_id="host", participant_ids=order or (["p1"] if mode == "duel" and subtype == "npc" else ["p1", "p2"]))
    validate_game_state(current())
    return current()


@pytest.fixture(autouse=True)
def store():
    GAMES.clear()
    yield
    GAMES.clear()


def install(game):
    GAMES["test"] = StoredGame(state=game)


def current():
    return GAMES["test"].state


def dispatch(action, *, view="debug", viewer_id=None, **params):
    return main.action(ActionRequest(game_id="test", action=action, params=params, view=view, viewer_id=viewer_id))


def start(**kwargs):
    make_game(**kwargs)
    return dispatch("gf.scene_start", actor_id="host")


def choose(choice="keep", actor="p1", **kwargs):
    return dispatch(CHOOSE, player_id=actor, choice=choice, **kwargs)


def reject(action, **params):
    original = current()
    snapshot = deepcopy(original)
    with pytest.raises((ValueError, HTTPException)):
        dispatch(action, **params)
    assert current() is original
    assert current() == snapshot


@pytest.mark.parametrize("subtype", ["npc", "pvp"])
def test_start_pauses_before_deal_and_marks_usage(subtype):
    original = make_game(subtype=subtype)
    assert original.meta["pending_interaction"] is None
    response = dispatch("gf.scene_start", actor_id="host")
    assert response.revision == original.meta["revision"] + 1
    assert current().deck == original.deck
    assert current().zones == original.zones
    assert current().meta["scene"]["status"] == "setup"
    assert current().meta["scene"]["faction_power_usage"] == {"p1": {"yankee": True}}
    assert current().meta["pending_interaction"] == {
        "kind": "yankee_inspect_top_card", "actor_id": "p1", "allowed_actions": [CHOOSE],
        "payload": {"inspected_card_id": "9C"},
        "continuation": {"on_resolve": {"kind": "resume_scene_start", "payload": {}},
                         "on_reclaim": {"kind": "resume_scene_start", "payload": {}}},
    }


@pytest.mark.parametrize("choice", ["keep", "bury"])
def test_choice_then_dealing_and_replay(choice):
    start()
    original = current()
    draw = original.deck.draw_pile
    expected = draw if choice == "keep" else [draw[-1], *draw[:-1]]
    response = choose(choice, inspected_card_id="not-trusted")
    assert response.result == {"ok": True, "action": CHOOSE, "player_id": "p1", "choice": choice, "inspected_card_id": "9C"}
    assert current().zones["scene.hand.p1"] == [expected[-1]]
    assert current().zones["scene.hand.p2"] == [expected[-2]]
    assert current().deck == replace(original.deck, draw_pile=expected[:-2])
    assert current().meta["scene"]["status"] == "active"
    assert current().meta["pending_interaction"] is None
    assert response.revision == original.meta["revision"] + 1
    validate_game_state(current())
    reject(CHOOSE, player_id="p1", choice=choice)
    reject(RECLAIM, actor_id="host")


@pytest.mark.parametrize("choice,second_top", [("keep", "9C"), ("bury", "9D")])
def test_multiple_yankees_discover_actual_top_in_participant_order(choice, second_top):
    start(characters=("QH", "JH"), order=["p2", "p1"])
    assert current().meta["pending_interaction"]["actor_id"] == "p2"
    before = current()
    response = choose(choice, actor="p2")
    assert response.revision == before.meta["revision"] + 1
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    assert current().meta["pending_interaction"]["payload"]["inspected_card_id"] == second_top
    assert current().zones == before.zones
    assert current().meta["scene"]["faction_power_usage"] == {"p2": {"yankee": True}, "p1": {"yankee": True}}
    choose(actor="p1")
    assert current().zones["scene.hand.p2"] == [second_top]
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "active"


@pytest.mark.parametrize("mode,characters", [("standard", ("QH", "QD")), ("duel", ("QC", "QD"))])
def test_no_inspection_for_standard_or_non_yankee(mode, characters):
    start(mode=mode, characters=characters)
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "active"
    assert current().zones["scene.hand.p1"] == ["9C"]


def test_dead_or_nonparticipant_yankee_does_not_inspect():
    game = make_game(subtype="npc", order=["p2"])
    assert begin_next_yankee_inspection(game) is game
    scene = {**game.meta["scene"], "participants": ["p1", "p2"]}
    game = replace(game, meta={**game.meta, "scene": scene, "players": {"p1": {"wounds": 2}, "p2": {"wounds": 0}}})
    assert begin_next_yankee_inspection(game) is game


@pytest.mark.parametrize("multiple", [False, True])
def test_reclaim_defaults_keep_and_preserves_usage(multiple):
    start(characters=("QH", "JH" if multiple else "QD"))
    original = current()
    response = dispatch(RECLAIM, actor_id="host")
    assert response.revision == original.meta["revision"] + 1
    assert current().meta["scene"]["faction_power_usage"]["p1"]["yankee"] is True
    if multiple:
        assert current().deck == original.deck
        assert current().meta["pending_interaction"]["actor_id"] == "p2"
        assert current().meta["pending_interaction"]["payload"]["inspected_card_id"] == "9C"
        choose(actor="p2")
    assert current().zones["scene.hand.p1"] == ["9C"]
    reject(RECLAIM, actor_id="host")
    reject(CHOOSE, player_id="p1", choice="bury")


@pytest.mark.parametrize("action", [CHOOSE, RECLAIM])
@pytest.mark.parametrize("bad", ["moved_top", "missing_secret", "empty_deck"])
def test_top_card_protection_is_atomic(action, bad):
    start()
    game = current()
    if bad == "moved_top":
        deck = replace(game.deck, draw_pile=[game.deck.draw_pile[-1], *game.deck.draw_pile[:-1]])
        game = replace(game, deck=deck)
    elif bad == "empty_deck":
        game = replace(game, deck=replace(game.deck, draw_pile=[], discard_pile=game.deck.draw_pile))
    else:
        pending = deepcopy(game.meta["pending_interaction"])
        pending["payload"] = {}
        game = replace(game, meta={**game.meta, "pending_interaction": pending})
    install(game)
    reject(action, **({"player_id": "p1", "choice": "bury"} if action == CHOOSE else {"actor_id": "host"}))


def test_empty_deck_keeps_existing_start_failure_without_inspection():
    game = make_game()
    game = replace(game, deck=replace(game.deck, draw_pile=[], discard_pile=game.deck.draw_pile))
    assert begin_next_yankee_inspection(game) is game
    install(game)
    reject("gf.scene_start", actor_id="host")
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["faction_power_usage"] == {}


@pytest.mark.parametrize("choice", ["keep", "bury"])
def test_failed_resume_preserves_original_order_pending_usage_and_revision(choice, monkeypatch):
    from backend.engine.rules.grim_fronteira import scene
    start()
    original = current()
    snapshot = deepcopy(original)
    def fail(game):
        assert game.meta["pending_interaction"] is None
        draw = original.deck.draw_pile
        assert game.deck.draw_pile == (draw if choice == "keep" else [draw[-1], *draw[:-1]])
        raise ValueError("controlled resume failure")
    with monkeypatch.context() as patch:
        patch.setattr(scene, "resume_scene_start", fail)
        with pytest.raises(ValueError, match="controlled resume failure"):
            choose(choice)
    assert current() is original
    assert current() == snapshot
    choose(choice)


@pytest.mark.parametrize("choice", ["KEEP", "discard", "", None, [], 1])
def test_invalid_choice_rejected(choice):
    start()
    reject(CHOOSE, player_id="p1", choice=choice)


def test_requires_specific_pending_kind_and_yankee_identity():
    game = make_game()
    install(begin_pending_interaction(game, {"kind": "other", "actor_id": "p1", "allowed_actions": [CHOOSE], "payload": {}, "continuation": None}))
    reject(CHOOSE, player_id="p1", choice="keep")
    start()
    game = current()
    zones = {**game.zones, "players.p1.character": game.zones["players.p2.character"],
             "players.p2.character": game.zones["players.p1.character"]}
    install(replace(game, zones=zones))
    reject(CHOOSE, player_id="p1", choice="keep")


@pytest.mark.parametrize("action,params", [
    ("gf.scene_start", {"actor_id": "host"}), ("gf.scene_draw_card", {"player_id": "p1"}),
    ("gf.scene_stand", {"player_id": "p1"}), ("gf.scene_new", {"actor_id": "host"}),
    ("gf.faction_paisa_claim_reward", {"player_id": "p1"}),
    ("gf.faction_criollo_convert_resource", {"player_id": "p1"}),
    ("gf.faction_chichimeca_choose_target", {"player_id": "p1", "target_player_id": "p2"}),
    ("gf.debug_stack_top_card", {"card_id": "AD"}),
    (CHOOSE, {"player_id": "p2", "choice": "keep"}), (RECLAIM, {"actor_id": "p1"}),
])
def test_pending_gate(action, params):
    start()
    original = current()
    with pytest.raises(HTTPException) as error:
        dispatch(action, **params)
    assert error.value.status_code == 403
    assert current() is original


VIEWS = [("public", None, False), ("player", "p1", True), ("player", "p2", False), ("debug", None, True)]


@pytest.mark.parametrize("view,viewer,visible", VIEWS)
def test_projection_and_read_action_response_privacy(view, viewer, visible):
    start()
    original = current()
    snapshot = deepcopy(original)
    data = game_state_to_dict(original, view=view, viewer_id=viewer)
    response = dispatch("gf.get_state", view=view, viewer_id=viewer)
    get_response = main.get_state("test", view=view, viewer_id=viewer)
    for projection in [data, response.model_dump()["state"], get_response.model_dump()["state"]]:
        pending = projection["meta"]["pending_interaction"]
        assert pending["actor_id"] == "p1"
        assert pending["allowed_actions"] == [CHOOSE]
        assert ("inspected_card_id" in pending["payload"]) == visible
        if not visible:
            assert "9C" not in json.dumps(projection)
    assert current() is original and original == snapshot


@pytest.mark.parametrize("view,viewer,visible", VIEWS)
def test_choice_response_filters_result_and_next_pending_independently(view, viewer, visible):
    start(characters=("QH", "JH"))
    response = choose("bury", view=view, viewer_id=viewer).model_dump()
    assert ("inspected_card_id" in response["result"]) == visible
    # Next inspection belongs to p2, not the actor of the completed action.
    next_visible = view == "debug" or (view == "player" and viewer == "p2")
    payload = response["state"]["meta"]["pending_interaction"]["payload"]
    assert ("inspected_card_id" in payload) == next_visible
    if view == "public":
        assert "9C" not in json.dumps(response) and "9D" not in json.dumps(response)


@pytest.mark.parametrize("viewer", [None, "", " ", 1, [], "unknown"])
def test_serializer_missing_or_malformed_viewer_fails_closed(viewer):
    start()
    projection = game_state_to_dict(current(), view="player", viewer_id=viewer)
    assert projection["meta"]["pending_interaction"]["payload"] == {}


@pytest.mark.parametrize("viewer", [None, "", " ", 1, []])
def test_player_api_requires_valid_viewer(viewer):
    with pytest.raises(ValidationError):
        ActionRequest(game_id="test", action="gf.get_state", view="player", viewer_id=viewer)
    with pytest.raises(ValidationError):
        NewGameRequest(view="player", viewer_id=viewer)
    with pytest.raises(HTTPException):
        main.get_state("test", view="player", viewer_id=viewer)


def test_save_reload_preserves_secret_and_resolves(tmp_path):
    start()
    path = tmp_path / "yankee.json"
    save_game_state(current(), path)
    loaded = load_game_state(path)
    assert loaded == current()
    assert loaded.meta["pending_interaction"]["payload"]["inspected_card_id"] == "9C"
    for view, viewer, visible in VIEWS:
        payload = game_state_to_dict(loaded, view=view, viewer_id=viewer)["meta"]["pending_interaction"]["payload"]
        assert ("inspected_card_id" in payload) == visible
    install(loaded)
    choose("bury")
    assert current().zones["scene.hand.p1"] == ["9D"]


def test_rematch_preserves_usage_and_genuine_new_scene_resets_it():
    start()
    choose()
    dispatch("gf.scene_stand", player_id="p1")
    dispatch("gf.scene_stand", player_id="p2")
    assert current().meta["scene"]["status"] == "active"
    assert current().meta["pending_interaction"] is None
    assert current().zones["scene.hand.p1"] == ["8C"]
    assert current().zones["scene.hand.p2"] == ["5C"]
    assert current().meta["scene"]["faction_power_usage"]["p1"]["yankee"] is True
    dispatch("gf.scene_stand", player_id="p1")
    dispatch("gf.scene_stand", player_id="p2")
    assert current().meta["scene"]["status"] == "resolved"
    dispatch("gf.scene_close", actor_id="host")
    dispatch("gf.scene_new", actor_id="host")
    assert current().meta["scene"]["faction_power_usage"] == {}
    dispatch("gf.scene_set_participants", actor_id="host", participant_ids=["p1", "p2"])
    dispatch("gf.scene_set_mode", actor_id="host", mode="duel", duel_subtype="pvp")
    dispatch("gf.scene_start", actor_id="host")
    assert current().meta["pending_interaction"]["actor_id"] == "p1"


@pytest.mark.parametrize("payload", [{"action": "gf.scene_start"}, {"actor_id": "host"}, []])
def test_continuation_payload_must_be_empty_mapping(payload):
    with pytest.raises(ValueError):
        normalize_continuation({"on_resolve": {"kind": "resume_scene_start", "payload": payload}, "on_reclaim": None})


def test_engine_resumption_has_no_api_dispatch_or_revision_increment(monkeypatch):
    from backend.engine.rules.grim_fronteira.factions import yankee_choose_top_card
    start()
    original = current()
    def forbidden(*args, **kwargs):
        pytest.fail("Internal continuation re-entered HTTP dispatch")
    monkeypatch.setattr(main, "action", forbidden)
    derived, _ = yankee_choose_top_card(original, player_id="p1", choice="keep")
    assert derived.meta["scene"]["status"] == "active"
    assert derived.meta["revision"] == original.meta["revision"]
    assert current() is original


def http_request(path, *, method="GET", body=None, query=""):
    """Exercise actual ASGI routes without adding an HTTP-client dependency."""
    async def request():
        messages = []
        received = False
        async def receive():
            nonlocal received
            if received:
                await asyncio.Event().wait()
            received = True
            return {"type": "http.request", "body": json.dumps(body).encode() if body else b"", "more_body": False}
        async def send(message):
            messages.append(message)
        await asyncio.wait_for(main.app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
                        "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
                        "query_string": query.encode(), "headers": [(b"content-type", b"application/json")],
                        "server": ("test", 80), "client": ("test", 123)}, receive, send), timeout=2)
        status = next(m["status"] for m in messages if m["type"] == "http.response.start")
        data = json.loads(b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body"))
        return status, data
    return asyncio.run(request())


@pytest.mark.parametrize("viewer,visible", [("p1", True), ("p2", False)])
def test_real_http_get_and_action_select_explicit_viewer(viewer, visible):
    start()
    status, data = http_request("/api/game/test", query=f"view=player&viewer_id={viewer}")
    assert status == 200
    assert ("inspected_card_id" in data["state"]["meta"]["pending_interaction"]["payload"]) == visible
    status, data = http_request("/api/gf/action", method="POST", body={
        "game_id": "test", "action": "gf.get_state", "view": "player", "viewer_id": viewer,
        "params": {"player_id": "p1", "viewer_id": "p1"},
    })
    assert status == 200
    assert ("inspected_card_id" in data["state"]["meta"]["pending_interaction"]["payload"]) == visible


def test_real_http_missing_viewer_is_rejected_without_mutation():
    start()
    original = current()
    for path, method, body, query in [
        ("/api/game/test", "GET", None, "view=player"),
        ("/api/gf/action", "POST", {"game_id": "test", "action": CHOOSE, "view": "player",
                                   "params": {"player_id": "p1", "choice": "bury", "viewer_id": "p1"}}, ""),
    ]:
        status, data = http_request(path, method=method, body=body, query=query)
        assert status == 422
        assert data["state"] == {}
    assert current() is original
