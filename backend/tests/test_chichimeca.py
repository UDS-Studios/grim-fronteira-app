from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.schemas import ActionRequest
from backend.app.store import GAMES, StoredGame
from backend.engine.grimdeck.deck_io import load_deck
from backend.engine.rules.grim_fronteira.factions import CHICHIMECA_CHOOSE_TARGET as CHOOSE
from backend.engine.rules.grim_fronteira.scene import default_scene_state
from backend.engine.state.continuations import normalize_continuation
from backend.engine.state.game_state import GameState
from backend.engine.state.pending_interaction import begin_pending_interaction
from backend.engine.state.validators import validate_game_state

RECLAIM = "gf.pending_reclaim"


def make_game(debts=None, wounds=None, character="JS"):
    debts = {"p1": 1} if debts is None else debts
    zones = {
        "players.p1.character": [character], "players.p2.character": ["QS"],
        "players.p3.character": ["QC"], "players.p4.character": ["QD"],
        "players.p5.character": ["JH"],
        "players.p1.scum": ["3C"], "players.p2.scum": ["4C", "5C"],
        "players.p3.scum": ["6C"], "players.p4.scum": ["7C"],
        "players.host.scum": ["8C"], "players.outsider.scum": ["9C"],
    }
    deck = load_deck("data/templates/standard_54.json")
    owned = {c for cards in zones.values() for c in cards}
    deck = replace(deck, draw_pile=[c for c in deck.draw_pile if c not in owned])
    scene = {**default_scene_state(), "status": "active", "participants": list(debts),
             "difficulty": {"value": 10},
             "players": {pid: {"wounds_gained": debt, "standing": pid != "p1", "hand_value": 15} for pid, debt in debts.items()}}
    game = GameState(deck=deck, zones=zones, meta={
        "phase": "table", "marshal_id": "host", "revision": 10,
        "players_order": ["host", "p1", "p2", "p3", "p4", "p5"],
        "players": {pid: {"wounds": (wounds or {}).get(pid, 2 if pid == "p4" else 0)}
                    for pid in ["p1", "p2", "p3", "p4", "p5"]}, "scene": scene,
    })
    validate_game_state(game)
    return game


@pytest.fixture(autouse=True)
def store():
    GAMES.clear()
    yield
    GAMES.clear()


def install(game):
    GAMES["test"] = StoredGame(state=game)
    return game


def current():
    return GAMES["test"].state


def dispatch(action, **params):
    return main.action(ActionRequest(game_id="test", action=action, params=params))


def start(game=None):
    install(make_game() if game is None else game)
    return dispatch("gf.scene_stand", player_id="p1")


def finish_scene():
    if current().meta["scene"]["status"] == "awaiting_ack":
        for pid in current().meta["scene"]["participants"]:
            dispatch("gf.scene_acknowledge_resolution", player_id=pid)
    dispatch("gf.scene_close", actor_id="host")
    dispatch("gf.scene_new", actor_id="host")


def choose(actor="p1", target="p2"):
    return dispatch(CHOOSE, player_id=actor, target_player_id=target)


def reject(action, **params):
    original = current()
    snapshot = deepcopy(original)
    with pytest.raises((ValueError, HTTPException)):
        dispatch(action, **params)
    assert current() is original
    assert current() == snapshot


@pytest.mark.parametrize("character", ["JD", "JC", "KH"])
def test_other_factions_do_not_interrupt(character):
    start(make_game(character=character))
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "awaiting_ack"


def test_trigger_commits_one_wound_and_pauses_with_authoritative_targets():
    original = make_game()
    snapshot = deepcopy(original)
    response = start(original)
    assert original == snapshot
    assert response.revision == 11
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "active"
    assert current().meta["scene"]["players"]["p1"]["wounds_gained"] == 0
    assert current().meta["pending_interaction"] == {
        "kind": "chichimeca_choose_target", "actor_id": "p1", "allowed_actions": [CHOOSE],
        "payload": {"eligible_target_ids": ["p2", "p3"]},
        "continuation": {"on_resolve": {"kind": "resume_scene_wounds", "payload": {}},
                         "on_reclaim": {"kind": "resume_scene_wounds", "payload": {}}},
    }
    # Both eligible enemies are nonparticipants.
    assert current().meta["scene"]["participants"] == ["p1"]


def test_choice_discards_top_scum_and_resumes_exactly_once():
    start()
    original = current()
    response = choose()
    assert response.result == {"ok": True, "action": CHOOSE, "player_id": "p1",
                               "target_player_id": "p2", "discarded_scum_card_id": "5C"}
    assert current().zones["players.p2.scum"] == ["4C"]
    assert current().deck.discard_pile == original.deck.discard_pile + ["5C"]
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "awaiting_ack"
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert response.revision == 12
    validate_game_state(current())
    reject(CHOOSE, player_id="p1", target_player_id="p2")
    reject(RECLAIM, actor_id="host")


def test_reclaim_skips_effect_and_resumes_exactly_once():
    start()
    original = current()
    response = dispatch(RECLAIM, actor_id="host")
    assert response.revision == 12
    assert current().zones == original.zones
    assert current().deck == original.deck
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "awaiting_ack"
    reject(RECLAIM, actor_id="host")
    reject(CHOOSE, player_id="p1", target_player_id="p2")


@pytest.mark.parametrize("target", ["p1", "host", "p4", "outsider", "p5", "missing", "", None])
def test_invalid_target_preserves_pending(target):
    start()
    reject(CHOOSE, player_id="p1", target_player_id=target)


def test_target_must_be_in_saved_list_and_still_own_scum():
    start()
    game = current()
    pending = deepcopy(game.meta["pending_interaction"])
    pending["payload"]["eligible_target_ids"] = ["p3"]
    install(replace(game, meta={**game.meta, "pending_interaction": pending}))
    reject(CHOOSE, player_id="p1", target_player_id="p2", eligible_target_ids=["p2"])
    install(replace(game, zones={**game.zones, "players.p2.scum": []},
                    deck=replace(game.deck, discard_pile=game.deck.discard_pile + game.zones["players.p2.scum"])))
    reject(CHOOSE, player_id="p1", target_player_id="p2")


def test_no_possible_target_does_not_pause():
    game = make_game()
    zones = dict(game.zones)
    removed = zones.pop("players.p2.scum") + zones.pop("players.p3.scum")
    game = replace(game, zones=zones, deck=replace(game.deck, discard_pile=removed))
    start(game)
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "awaiting_ack"


@pytest.mark.parametrize("first,second", [("resolve", "reclaim"), ("reclaim", "resolve")])
def test_two_wounded_chichimecas_are_discovered_one_at_a_time(first, second):
    start(make_game(debts={"p1": 1, "p2": 1}))
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    assert current().meta["players"]["p2"]["wounds"] == 0
    if first == "resolve":
        choose(target="p3")
    else:
        dispatch(RECLAIM, actor_id="host")
    assert current().meta["pending_interaction"]["actor_id"] == "p2"
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["players"]["p2"]["wounds"] == 1
    assert current().meta["revision"] == 12
    # No precomputed target queue: the next interaction sees the earlier discard.
    assert ("p3" in current().meta["pending_interaction"]["payload"]["eligible_target_ids"]) == (first == "reclaim")
    if second == "resolve":
        choose(actor="p2", target="p3")
    else:
        dispatch(RECLAIM, actor_id="host")
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "awaiting_ack"
    assert current().meta["revision"] == 13
    assert [current().meta["players"][pid]["wounds"] for pid in ["p1", "p2"]] == [1, 1]
    assert current().deck.discard_pile.count("6C") == 1


def test_each_wound_unit_is_consumed_separately():
    start(make_game(debts={"p1": 2}))
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["players"]["p1"]["wounds_gained"] == 1
    choose()
    assert current().meta["players"]["p1"]["wounds"] == 2
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    assert current().meta["scene"]["players"]["p1"]["wounds_gained"] == 0
    choose()
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 2
    assert current().zones["players.p2.scum"] == []
    reject(CHOOSE, player_id="p1", target_player_id="p2")


def test_lethal_wound_still_triggers_then_normal_death_rules_apply():
    start(make_game(wounds={"p1": 1}))
    assert current().meta["players"]["p1"]["wounds"] == 2
    choose()
    assert current().meta["scene"]["status"] == "awaiting_ack"
    reject("gf.scene_set_participants", actor_id="host", participant_ids=["p1"])


def test_final_wounds_retain_marshal_victory_path():
    start(make_game(wounds={"p1": 1, "p2": 2, "p3": 2, "p4": 2, "p5": 2}))
    assert current().meta["pending_interaction"] is None
    finish_scene()
    assert current().meta["victory"]["winner"] == "marshal"


def test_dead_player_without_new_wound_does_not_trigger():
    start(make_game(debts={"p1": 0}, wounds={"p1": 2}))
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 2


@pytest.mark.parametrize("action", [CHOOSE, RECLAIM])
def test_failure_during_resumption_preserves_original_pending_and_effect(action, monkeypatch):
    from backend.engine.rules.grim_fronteira import scene
    start()
    original = current()
    snapshot = deepcopy(original)
    def fail(game):
        assert game.meta["pending_interaction"] is None
        assert game.zones["players.p2.scum"] == (["4C"] if action == CHOOSE else ["4C", "5C"])
        raise ValueError("controlled resume failure")
    with monkeypatch.context() as patch:
        patch.setattr(scene, "resume_scene_wounds", fail)
        with pytest.raises(ValueError, match="controlled resume failure"):
            if action == CHOOSE:
                choose()
            else:
                dispatch(RECLAIM, actor_id="host")
    assert current() is original
    assert original == snapshot
    choose()
    assert current().meta["revision"] == 12


@pytest.mark.parametrize("action,params", [
    ("gf.scene_draw_card", {"player_id": "p1"}), ("gf.scene_stand", {"player_id": "p1"}),
    ("gf.scene_new", {"actor_id": "host"}), ("gf.scene_close", {"actor_id": "host"}),
    ("gf.faction_paisa_claim_reward", {"player_id": "p3", "vengeance_card_ids": []}),
    ("gf.faction_criollo_convert_resource", {"player_id": "p4", "card_id": "7C", "from_resource": "scum"}),
    ("gf.debug_stack_top_card", {"card_id": "AD"}),
    (CHOOSE, {"player_id": "p2", "target_player_id": "p3"}),
    (CHOOSE, {"player_id": "p2", "actor_id": "p1", "target_player_id": "p3"}),
    (RECLAIM, {"actor_id": "p1"}),
])
def test_pending_gate_and_caller_identity_rejections(action, params):
    start()
    reject(action, **params)


def test_readable_pending_and_no_recursive_dispatch(monkeypatch):
    from backend.engine.rules.grim_fronteira.factions import chichimeca_choose_target
    start()
    original = current()
    response = dispatch("gf.get_state")
    assert response.state["meta"]["pending_interaction"] == original.meta["pending_interaction"]
    def forbidden(*args, **kwargs):
        pytest.fail("Continuation must not dispatch an API action")
    monkeypatch.setattr(main, "action", forbidden)
    derived, _ = chichimeca_choose_target(original, player_id="p1", target_player_id="p2")
    assert derived.meta["pending_interaction"] is None
    assert derived.meta["revision"] == original.meta["revision"]
    assert current() is original


def test_choose_requires_specific_pending_kind():
    game = begin_pending_interaction(make_game(), {
        "kind": "unrelated", "actor_id": "p1", "allowed_actions": [CHOOSE],
        "payload": {"eligible_target_ids": ["p2"]}, "continuation": None,
    })
    install(game)
    reject(CHOOSE, player_id="p1", target_player_id="p2")


@pytest.mark.parametrize("payload", [{"actor_id": "host"}, {"action": "gf.scene_new"}, []])
def test_scene_continuation_rejects_nonempty_or_malformed_payload(payload):
    with pytest.raises(ValueError):
        normalize_continuation({"on_resolve": {"kind": "resume_scene_wounds", "payload": payload}, "on_reclaim": None})


def ready_to_bust_game(*, other_standing=False):
    game = make_game(debts={"p1": 0, "p3": 0})
    scene = deepcopy(game.meta["scene"])
    scene["players"]["p1"].update(figure_card_id="JS", hand_value=20)
    scene["players"]["p3"].update(figure_card_id="QC", hand_value=15, standing=other_standing)
    zones = {**game.zones, "scene.hand.p1": ["10D"]}
    draw = [c for c in game.deck.draw_pile if c not in {"10D", "2D"}] + ["2D"]
    return replace(game, zones=zones, deck=replace(game.deck, draw_pile=draw), meta={**game.meta, "scene": scene})


def test_real_bust_commits_immediately_before_other_participants_finish():
    install(ready_to_bust_game())
    dispatch("gf.scene_draw_card", player_id="p1")
    assert current().meta["scene"]["status"] == "active"
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["players"]["p1"]["wounds_gained"] == 0
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    assert current().meta["pending_interaction"]["payload"]["eligible_target_ids"] == ["p2", "p3"]
    assert "p2" not in current().meta["scene"]["participants"]
    choose()
    assert current().meta["scene"]["status"] == "active"
    assert current().meta["pending_interaction"] is None
    dispatch("gf.scene_stand", player_id="p3")
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["pending_interaction"] is None
    finish_scene()
    assert current().meta["scene"]["status"] == "setup"
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1



def test_lethal_trigger_resumes_into_marshal_victory_after_remaining_wound():
    start(make_game(debts={"p1": 1, "p2": 1}, wounds={
        "p1": 1, "p2": 1, "p3": 2, "p4": 2, "p5": 2,
    }))
    assert current().meta["players"]["p1"]["wounds"] == 2
    assert current().meta["pending_interaction"]["payload"]["eligible_target_ids"] == ["p2"]
    choose()
    assert current().meta["players"]["p2"]["wounds"] == 2
    assert current().meta["pending_interaction"] is None
    finish_scene()
    assert current().meta["victory"]["winner"] == "marshal"
    assert current().zones["players.p2.scum"] == ["4C"]


@pytest.mark.parametrize("action,handler,params", [
    ("gf.faction_paisa_claim_reward", "paisa_claim_reward", {"player_id": "p3", "vengeance_card_ids": []}),
    ("gf.faction_criollo_convert_resource", "criollo_convert_resource", {"player_id": "p4", "card_id": "7C", "from_resource": "scum"}),
    (CHOOSE, "chichimeca_choose_target", {"player_id": "p2", "target_player_id": "p3"}),
])
def test_gate_rejects_before_faction_engine(action, handler, params, monkeypatch):
    start()
    def forbidden(*args, **kwargs):
        pytest.fail("Unauthorized faction engine call")
    monkeypatch.setattr(main, handler, forbidden)
    original = current()
    with pytest.raises(HTTPException) as error:
        dispatch(action, **params)
    assert error.value.status_code == 403
    assert current() is original


@pytest.mark.parametrize("view", ["public", "player", "debug"])
def test_pending_scene_continuation_serializes_and_reloads(view, tmp_path):
    from backend.engine.state.game_state_io import save_game_state, load_game_state
    start()
    response = main.action(ActionRequest(game_id="test", action="gf.get_state", view=view, viewer_id="p1"))
    assert response.state["meta"]["pending_interaction"] == current().meta["pending_interaction"]
    path = tmp_path / "interrupted.json"
    save_game_state(current(), path)
    loaded = load_game_state(path)
    assert loaded == current()
    install(loaded)
    choose()
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "awaiting_ack"


@pytest.mark.parametrize("outcome", ["resolve", "reclaim"])
def test_last_bust_resumes_resolution_without_closing_or_starting_scene(outcome):
    install(ready_to_bust_game(other_standing=True))
    dispatch("gf.scene_draw_card", player_id="p1")
    interrupted = current()
    assert interrupted.meta["scene"]["status"] == "active"
    assert not interrupted.meta["scene"]["resolution"]["completed"]
    assert interrupted.meta["players"]["p1"]["wounds"] == 1
    if outcome == "resolve":
        choose()
        assert current().zones["players.p2.scum"] == ["4C"]
    else:
        dispatch(RECLAIM, actor_id="host")
        assert current().zones == interrupted.zones
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "awaiting_ack"
    assert current().meta["scene"]["resolution"]["completed"]
    assert current().zones["scene.hand.p1"] == interrupted.zones["scene.hand.p1"]
    assert current().meta["players"]["p1"]["wounds"] == 1


def test_real_bust_without_targets_continues_and_later_scum_does_not_retrigger():
    game = ready_to_bust_game(other_standing=True)
    zones = dict(game.zones)
    removed = zones.pop("players.p2.scum") + zones.pop("players.p3.scum")
    install(replace(game, zones=zones, deck=replace(game.deck, discard_pile=removed)))
    dispatch("gf.scene_draw_card", player_id="p1")
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] != "active"
    assert current().meta["players"]["p1"]["wounds"] == 1
    if current().meta["scene"]["status"] == "awaiting_ack":
        for pid in current().meta["scene"]["participants"]:
            dispatch("gf.scene_acknowledge_resolution", player_id=pid)
    dispatch("gf.scene_assign_bonus_card", actor_id="host", player_id="p3", bonus_type="scum")
    dispatch("gf.scene_close", actor_id="host")
    dispatch("gf.scene_new", actor_id="host")
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1


@pytest.mark.parametrize("status", ["active", "awaiting_ack"])
def test_vengeance_bust_commits_and_interrupts_immediately(status):
    game = ready_to_bust_game()
    scene = deepcopy(game.meta["scene"])
    scene["status"] = status
    scene["players"]["p1"].update(hand_value=21, standing=status == "awaiting_ack")
    zones = {**game.zones, "players.p1.vengeance": ["4S"]}
    deck = replace(game.deck, draw_pile=[c for c in game.deck.draw_pile if c != "4S"])
    install(replace(game, zones=zones, deck=deck, meta={**game.meta, "scene": scene}))
    dispatch("gf.scene_play_vengeance", player_id="p1")
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["players"]["p1"]["busted"]
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    choose()
    assert current().meta["players"]["p1"]["wounds"] == 1


def test_non_bust_duel_wound_is_committed_at_final_acknowledgement():
    game = make_game(debts={"p1": 0, "p2": 0})
    scene = deepcopy(game.meta["scene"])
    scene.update(mode="duel", duel={"subtype": "pvp"})
    scene["players"]["p1"].update(figure_card_id="JS", hand_value=16)
    scene["players"]["p2"].update(figure_card_id="QS", hand_value=18)
    install(replace(game, meta={**game.meta, "scene": scene}))
    dispatch("gf.scene_stand", player_id="p1")
    assert current().meta["scene"]["status"] == "awaiting_ack"
    assert current().meta["players"]["p1"]["wounds"] == 0
    dispatch("gf.scene_acknowledge_resolution", player_id="p1")
    dispatch("gf.scene_acknowledge_resolution", player_id="p2")
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["pending_interaction"]["actor_id"] == "p1"
    dispatch(RECLAIM, actor_id="host")
    assert current().meta["scene"]["status"] == "resolved"
    assert current().meta["pending_interaction"] is None
    finish_scene()
    assert current().meta["players"]["p1"]["wounds"] == 1


def test_legacy_scene_new_debt_does_not_open_a_delayed_power():
    game = make_game()
    scene = {**game.meta["scene"], "status": "closed"}
    install(replace(game, meta={**game.meta, "scene": scene}))
    dispatch("gf.scene_new", actor_id="host")
    assert current().meta["pending_interaction"] is None
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["scene"]["status"] == "setup"


def test_reversible_duel_preview_does_not_leave_a_wound_on_the_eventual_winner():
    game = make_game(debts={"p1": 0, "p2": 0})
    scene = deepcopy(game.meta["scene"])
    scene.update(mode="duel", duel={"subtype": "pvp"})
    scene["players"]["p1"].update(figure_card_id="JS", hand_value=17)
    scene["players"]["p2"].update(figure_card_id="QS", hand_value=18)
    zones = {**game.zones, "players.p1.vengeance": ["4S"]}
    deck = replace(game.deck, draw_pile=[c for c in game.deck.draw_pile if c != "4S"])
    install(replace(game, zones=zones, deck=deck, meta={**game.meta, "scene": scene}))
    dispatch("gf.scene_stand", player_id="p1")
    assert current().meta["scene"]["resolution"]["losers"] == ["p1"]
    dispatch("gf.scene_play_vengeance", player_id="p1")
    assert current().meta["scene"]["resolution"]["losers"] == ["p2"]
    assert current().meta["pending_interaction"] is None
    for pid in ["p1", "p2"]:
        dispatch("gf.scene_acknowledge_resolution", player_id=pid)
    assert current().meta["pending_interaction"]["actor_id"] == "p2"
    assert current().meta["players"]["p1"]["wounds"] == 0
    assert current().meta["players"]["p2"]["wounds"] == 1


def test_old_saved_pending_can_still_resume_scene_new_without_new_interrupts():
    game = make_game(debts={"p1": 0, "p2": 1}, wounds={"p1": 1})
    scene = {**game.meta["scene"], "status": "closed"}
    game = replace(game, meta={**game.meta, "scene": scene})
    game = begin_pending_interaction(game, {
        "kind": "chichimeca_choose_target", "actor_id": "p1", "allowed_actions": [CHOOSE],
        "payload": {"eligible_target_ids": ["p2"]},
        "continuation": {branch: {"kind": "resume_scene_new", "payload": {}}
                         for branch in ["on_resolve", "on_reclaim"]},
    })
    install(game)
    choose()
    assert current().meta["pending_interaction"] is None
    assert current().meta["scene"]["status"] == "setup"
    assert current().meta["players"]["p1"]["wounds"] == 1
    assert current().meta["players"]["p2"]["wounds"] == 1


def test_chichimeca_character_metadata_uses_canonical_discard_rule():
    from backend.engine.helpers.characters import figure_to_character
    character = figure_to_character("QS")
    assert character["ability_name"] == "Children of the Earth"
    assert character["ability_text"] == "Whenever you take a wound, choose an enemy: they discard 1 Scum card."
