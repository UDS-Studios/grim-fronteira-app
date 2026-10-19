"""Solo HTTP boundaries, authored outcomes, durability and full-run regressions."""
from copy import deepcopy
from dataclasses import replace
import json

import pytest
from fastapi import HTTPException

from backend.app import main
from backend.app.schemas import ActionRequest, NewSoloRequest, ReconnectRequest
from backend.app.store import GAMES
from backend.app.persistence import encode_envelope, decode_envelope, InvalidSnapshot
from backend.engine.grimdeck.deck_ops import shuffle
from backend.engine.state.debug_ops import stack_card_on_top
from backend.engine.state.validators import validate_game_state
from backend.engine.rules.grim_fronteira import solo
from backend.engine.rules.grim_fronteira.lobby import start_game, begin_table
from backend.engine.rules.grim_fronteira import lobby as lobby_rules
from backend.tests.test_yankees import http_request


@pytest.fixture
def run():
    GAMES.clear()
    created = main.new_solo(NewSoloRequest())
    yield created.game_id, created.result["session"]
    GAMES.clear()


def act(run, action, **params):
    game_id, credentials = run
    return main.action(ActionRequest(game_id=game_id, action=action,
        params={"player_id": solo.PLAYER, **params}, view="player", viewer_id=solo.PLAYER,
        expected_revision=GAMES[game_id].state.meta["revision"]),
        x_gf_session=credentials["active_session"])


def ready(run, card="KD"):
    act(run, "gf.claim_character", card_id=card)
    act(run, "gf.submit_character_name", name="Dust")
    return act(run, "gf.submit_character_feature", feature="a red coat")


def stack(run, cards):
    stored = GAMES[run[0]]
    game = stored.state
    for card in reversed(cards):
        game = stack_card_on_top(game, card)
    stored.state = game


def begin(run):
    game = GAMES[run[0]].state
    if game.meta["phase"] == "lobby":
        game = start_game(game, actor_id=solo.MARSHAL)
        GAMES[run[0]].state = begin_table(game, actor_id=solo.MARSHAL)


def start_scene(run, difficulty="2C", hand="10H"):
    begin(run)
    stack(run, [difficulty, hand])
    return act(run, solo.SOLO_CONTINUE)


def accept(run):
    game = GAMES[run[0]].state
    if game.meta.get("phase") == "table" and game.meta["scene"]["status"] == "awaiting_ack":
        return act(run, "gf.scene_acknowledge_resolution")


def test_creation_has_only_one_recoverable_seat_and_no_marshal_pause(run):
    game_id, credentials = run
    stored = GAMES[game_id]
    assert set(stored.sessions) == {solo.PLAYER}
    assert credentials["role"] == "player"
    response = main.get_state(game_id, "player", solo.PLAYER, credentials["active_session"])
    assert response.state["meta"]["session_pause"]["paused"] is False
    assert response.state["deck"]["draw_pile"] == {"count": 42}
    assert "seed" not in response.state["meta"]["solo"]


def test_new_runs_shuffle():
    first = main.new_solo(NewSoloRequest())
    second = main.new_solo(NewSoloRequest())
    assert GAMES[first.game_id].state.deck.draw_pile != GAMES[second.game_id].state.deck.draw_pile
    GAMES.clear()


@pytest.mark.parametrize("card", ["KD", "QC", "JH", "KS"])
def test_supported_characters_and_starting_baggage(run, card):
    response = ready(run, card)
    expected = {"J": (2, 0), "Q": (1, 1), "K": (0, 2)}[card[0]]
    zones = response.state["zones"]
    assert tuple(len(zones[f"players.{solo.PLAYER}.{r}"]) for r in ("scum", "vengeance")) == expected
    assert response.state["meta"]["lobby"]["players"][solo.PLAYER]["ready"]


@pytest.mark.parametrize("node,result,next_node,gun", [
    ("gun", "success", "witnesses", True), ("gun", "failure", "gun", False),
    ("gun", "bust", "witnesses", True),
    ("witnesses", "success", "hideout", False), ("witnesses", "failure", "witnesses", False),
    ("witnesses", "bust", "hideout", False),
    ("tracking", "success", "cart", False), ("tracking", "failure", "tracking", False),
    ("tracking", "bust", "cart", False),
    ("hideout", "success", "captive", False),
    ("hideout", "failure", "hideout", False),
    ("hideout", "bust", "captive", False),
    ("captive", "success", "farmer", False),
    ("captive", "failure", "captive", False),
    ("captive", "bust", "farmer", False),
    ("farmer", "success", "fire", False),
    ("farmer", "failure", "farmer", False),
    ("farmer", "bust", "fire", False),
    ("canal", "success", "rubble", False),
    ("canal", "failure", "canal", False),
    ("canal", "bust", "rubble", False),
    ("lookout", "success", "tracking", False),
    ("lookout", "failure", "lookout", False),
    ("lookout", "bust", "tracking", False),
    ("fire", "success", "canal", False),
    ("fire", "failure", "fire", False),
    ("fire", "bust", "canal", False),
    ("rubble", "success", "lookout", False),
    ("rubble", "failure", "rubble", False),
    ("rubble", "bust", "lookout", False),
    ("cart", "success", "duel", False),
    ("cart", "failure", "cart", False),
    ("cart", "bust", "duel", False),
    ("duel", "success", "associates", False), ("duel", "failure", "duel", False),
    ("duel", "bust", "duel", False),
    ("associates", "success", "associates", False), ("associates", "failure", "associates", False),
    ("associates", "bust", "associates", False),
])
def test_every_story_edge(run, node, result, next_node, gun):
    ready(run)
    game = GAMES[run[0]].state
    GAMES[run[0]].state = solo._update(game, node=node, outlaw_defeated=node == "associates")
    start_scene(run, "2C" if result != "failure" else "AS", "10H" if result != "failure" else "2H")
    if result == "bust":
        stack(run, ["3D"])
        act(run, "gf.scene_draw_card")
    else:
        act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["outcome"] == result
    assert game.meta["solo"]["has_gun"] is gun
    assert game.meta["solo"]["outlaw_defeated"] == (node == "associates" or (node == "duel" and result == "success"))
    assert game.meta.get("players", {}).get(solo.PLAYER, {}).get("wounds", 0) == (1 if result == "bust" else 0)
    rewards = len(game.zones.get(f"players.{solo.PLAYER}.rewards", []))
    assert rewards == (1 if result == "success" else 0)
    prior = deepcopy(game)
    response = act(run, solo.SOLO_CONTINUE)
    assert response.state["meta"]["solo"]["node"] == next_node
    assert response.state["meta"]["solo"]["step"] == "intro"
    assert len(GAMES[run[0]].state.deck.draw_pile) == len(prior.deck.draw_pile)
    validate_game_state(GAMES[run[0]].state)


def test_second_wound_ends_and_cannot_be_healed_or_replayed(run):
    ready(run, "KS")
    start_scene(run)
    stack(run, ["3D"])
    act(run, "gf.scene_draw_card")
    act(run, solo.SOLO_CONTINUE)
    start_scene(run, "3C", "10D")
    stack(run, ["4D"])
    response = act(run, "gf.scene_draw_card")
    assert response.state["meta"]["solo"]["ending"] == "death"
    assert response.state["meta"]["pending_interaction"] is None
    assert response.state["meta"]["players"][solo.PLAYER]["wounds"] == 2
    for action in (solo.SOLO_CONTINUE, "gf.scene_heal_wound"):
        with pytest.raises(ValueError, match="ended"):
            act(run, action, reward_card_ids=[])


def test_revision_rejects_duplicate_action_without_drawing_twice(run):
    ready(run)
    start_scene(run)
    req = ActionRequest(game_id=run[0], action="gf.scene_stand", params={"player_id": solo.PLAYER},
                        expected_revision=GAMES[run[0]].state.meta["revision"])
    main.action(req, x_gf_session=run[1]["active_session"])
    original = deepcopy(GAMES[run[0]].state)
    with pytest.raises(HTTPException) as exc:
        main.action(req, x_gf_session=run[1]["active_session"])
    assert exc.value.status_code == 409
    assert GAMES[run[0]].state == original


@pytest.mark.parametrize("action,params", [
    ("gf.scene_declare_dark", {"actor_id": solo.MARSHAL}),
    ("gf.scene_draw_azzardo", {"actor_id": solo.MARSHAL}),
    ("gf.join_lobby", {"player_id": "intruder"}),
    ("gf.scene_play_scum", {"target_player_id": solo.MARSHAL}),
    ("gf.faction_chichimeca_choose_target", {"target_player_id": solo.MARSHAL}),
])
def test_disallowed_actions_cannot_change_solo(run, action, params):
    before = deepcopy(GAMES[run[0]].state)
    status, body = http_request("/api/gf/action", method="POST", headers={"X-GF-Session": run[1]["active_session"]},
        body={"game_id": run[0], "action": action, "params": {"player_id": solo.PLAYER, **params},
              "expected_revision": before.meta["revision"]})
    assert status in {400, 403}
    assert body["error"]
    assert GAMES[run[0]].state == before


def test_solo_requires_authentication_and_revision(run):
    status, _ = http_request("/api/gf/action", method="POST", body={"game_id": run[0],
        "action": solo.SOLO_CONTINUE, "params": {"player_id": solo.PLAYER}})
    assert status == 401
    with pytest.raises(HTTPException) as exc:
        main.action(ActionRequest(game_id=run[0], action=solo.SOLO_CONTINUE,
            params={"player_id": solo.PLAYER}), x_gf_session=run[1]["active_session"])
    assert exc.value.status_code == 409


def test_disk_restart_and_reconnect_without_marshal(run, file_repository):
    # file_repository clears the global store, so create after it opens.
    response = main.new_solo(NewSoloRequest())
    run = response.game_id, response.result["session"]
    ready(run, "KH")
    GAMES[run[0]].state = solo._update(GAMES[run[0]].state, node="duel")
    start_scene(run)
    snapshot = deepcopy(GAMES[run[0]].state)
    assert snapshot.meta["pending_interaction"]["kind"] == "yankee_inspect_top_card"
    restored = file_repository.load_all()
    GAMES.clear()
    GAMES.update(restored.games)
    assert GAMES[run[0]].state == snapshot
    response = main.reconnect(ReconnectRequest(game_id=run[0], reconnect_token=run[1]["reconnect_token"]))
    assert not response.state["meta"]["session_pause"]["paused"]
    run[1]["active_session"] = response.result["session"]["active_session"]
    response = act(run, "gf.faction_yankee_choose_top_card", choice="bury")
    assert response.state["meta"]["scene"]["status"] == "active"


def test_unknown_solo_version_fails_snapshot_validation(run):
    game_id, _ = run
    stored = GAMES[game_id]
    envelope = encode_envelope(game_id, stored.state, stored.sessions)
    envelope["game_state"]["meta"]["solo"]["version"] = 999
    with pytest.raises(InvalidSnapshot):
        decode_envelope(json.dumps(envelope), game_id)


def test_exhaustion_mid_required_draw_is_a_saved_ending(run, file_repository):
    response = main.new_solo(NewSoloRequest())
    run = response.game_id, response.result["session"]
    ready(run)
    begin(run)
    game = GAMES[run[0]].state
    # Leave one ordinary difficulty card; the initial hand cannot be dealt.
    remaining = [c for c in game.deck.draw_pile if c != "2C"]
    GAMES[run[0]].state = replace(game, deck=replace(game.deck, draw_pile=["2C"], removed=[*game.deck.removed, *remaining]))
    response = act(run, solo.SOLO_CONTINUE)
    assert response.state["meta"]["solo"]["ending"] == "exhaustion"
    assert file_repository.load_all().games[run[0]].state == GAMES[run[0]].state
    validate_game_state(GAMES[run[0]].state)


@pytest.mark.parametrize("card", ["KD", "KC", "KH", "KS"])
@pytest.mark.parametrize("threshold", [12, 17, 20])
def test_complete_runs_terminate_with_valid_cards(monkeypatch, card, threshold):
    original_return = lobby_rules.return_face_pile_to_deck
    for seed in range(6):
        monkeypatch.setattr(main, "shuffle_deck", lambda deck: shuffle(deck, seed=seed))
        monkeypatch.setattr(lobby_rules, "return_face_pile_to_deck",
                            lambda game, **kwargs: original_return(game, **{**kwargs, "seed": seed}))
        response = main.new_solo(NewSoloRequest())
        run = response.game_id, response.result["session"]
        ready(run, card)
        for _ in range(350):
            game = GAMES[run[0]].state
            validate_game_state(game)
            if game.meta["solo"]["ending"]:
                break
            scene = game.meta["scene"]
            if game.meta.get("pending_interaction"):
                act(run, "gf.faction_yankee_choose_top_card", choice="keep")
            elif game.meta["solo"]["step"] in {"intro", "outcome"}:
                if scene["status"] == "closed" and main.solo.scenes._must_heal_or_skip(game, solo.PLAYER):
                    act(run, "gf.scene_skip_heal")
                elif scene["status"] == "closed" and main.solo.scenes._must_discard_rewards(game, solo.PLAYER):
                    act(run, "gf.scene_discard_reward", reward_card_id=game.zones[f"players.{solo.PLAYER}.rewards"][-1])
                else:
                    act(run, solo.SOLO_CONTINUE)
            elif scene["status"] == "awaiting_ack":
                act(run, "gf.scene_acknowledge_resolution")
            elif scene["status"] == "active":
                value = scene["players"][solo.PLAYER]["hand_value"]
                act(run, "gf.scene_draw_card" if value < threshold else "gf.scene_stand")
            else:
                pytest.fail(f"Solo flow deadlocked: {scene['status']}")
        else:
            pytest.fail("Run failed to terminate within 350 player decisions")
        assert GAMES[run[0]].state.meta["solo"]["ending"] in {"death", "exhaustion", "ascension"}
        GAMES.clear()


def add_rewards(run, cards):
    game = GAMES[run[0]].state
    for card in cards:
        game = stack_card_on_top(game, card)
        game, _ = solo.scenes._draw_to_zone(game, f"players.{solo.PLAYER}.rewards")
    GAMES[run[0]].state = game


def test_exact_21_can_end_before_the_duel(run):
    ready(run)
    start_scene(run)
    add_rewards(run, ["AS"])
    stack(run, ["10C"])
    act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["ending"] == "ascension"
    assert game.meta["solo"]["node"] == "gun"
    assert sum(solo.scenes.reward_card_points(c) for c in game.zones[f"players.{solo.PLAYER}.rewards"]) == 21


def test_overflow_and_healing_settle_before_story_can_advance(run):
    ready(run)
    start_scene(run)
    add_rewards(run, ["AS", "9C"])
    stack(run, ["8D"])
    act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    assert solo.presentation(game)["needs_discard"]
    with pytest.raises(ValueError, match="choices"):
        act(run, solo.SOLO_CONTINUE)
    act(run, "gf.scene_discard_reward", reward_card_id="AS")
    game = GAMES[run[0]].state
    # Model a prior nonlethal wound to exercise the existing healing choice.
    players = {**game.meta["players"], solo.PLAYER: {**game.meta["players"][solo.PLAYER], "wounds": 1}}
    GAMES[run[0]].state = replace(game, meta={**game.meta, "players": players})
    assert solo.presentation(GAMES[run[0]].state)["needs_heal"]
    with pytest.raises(ValueError, match="choices"):
        act(run, solo.SOLO_CONTINUE)
    response = act(run, "gf.scene_heal_wound", reward_card_ids=["9C", "8D"])
    assert response.state["meta"]["players"][solo.PLAYER]["wounds"] == 0
    assert not response.state["meta"]["solo"]["needs_heal"]
    act(run, solo.SOLO_CONTINUE)
    assert GAMES[run[0]].state.meta["solo"]["node"] == "witnesses"


def test_save_failure_does_not_publish_story_advance(run, monkeypatch):
    from backend.app import store
    from backend.app.persistence import PersistenceUnavailable
    ready(run)
    start_scene(run)
    act(run, "gf.scene_stand")
    accept(run)
    before = deepcopy(GAMES[run[0]].state)
    def fail(*args):
        raise PersistenceUnavailable()
    monkeypatch.setattr(store.repository, "save_snapshot", fail)
    with pytest.raises(PersistenceUnavailable):
        act(run, solo.SOLO_CONTINUE)
    assert GAMES[run[0]].state == before


def test_solo_creation_rejects_client_rules_or_seed():
    status, body = http_request("/api/gf/solo", method="POST", body={"seed": 1, "mode": "debug"})
    assert status == 422
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_wounded_outlaw_duel_continues_until_the_outlaw_is_killed(run):
    ready(run)
    GAMES[run[0]].state = solo._update(GAMES[run[0]].state, node="duel")
    start_scene(run)
    stack(run, ["3D"])
    act(run, "gf.scene_draw_card")
    game = GAMES[run[0]].state
    assert game.meta["solo"]["outcome"] == "bust"
    assert not game.meta["solo"]["outlaw_defeated"]
    assert game.meta["players"][solo.PLAYER]["wounds"] == 1
    act(run, solo.SOLO_CONTINUE)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["node"] == "duel"
    assert game.meta["solo"]["attempt"] == 1
    assert solo.presentation(game)["text"] != solo.adventure()["nodes"]["duel"]["passages"][0]
    start_scene(run, "4C", "9H")
    stack(run, ["5D"])
    act(run, "gf.scene_stand")
    accept(run)
    assert GAMES[run[0]].state.meta["solo"]["outlaw_defeated"]
    assert GAMES[run[0]].state.meta["players"][solo.PLAYER]["wounds"] == 1
    response = act(run, solo.SOLO_CONTINUE)
    assert response.state["meta"]["solo"]["node"] == "associates"


def test_lethal_outlaw_wound_ends_run_without_starting_associates(run):
    ready(run)
    GAMES[run[0]].state = solo._update(GAMES[run[0]].state, node="duel")
    start_scene(run)
    stack(run, ["3D"])
    act(run, "gf.scene_draw_card")
    act(run, solo.SOLO_CONTINUE)
    start_scene(run, "4C", "10D")
    stack(run, ["4D"])
    response = act(run, "gf.scene_draw_card")
    assert response.state["meta"]["solo"]["ending"] == "death"
    assert response.state["meta"]["solo"]["node"] == "duel"
    assert not response.state["meta"]["solo"]["outlaw_defeated"]


@pytest.mark.parametrize("step", ["intro", "outcome"])
def test_old_save_cannot_start_another_associate_while_outlaw_is_alive(run, step):
    ready(run)
    if step == "outcome":
        start_scene(run)
        act(run, "gf.scene_stand")
        accept(run)
    else:
        begin(run)
    game = GAMES[run[0]].state
    GAMES[run[0]].state = solo._update(game, node="associates", step=step, outlaw_defeated=False)
    response = act(run, solo.SOLO_CONTINUE)
    assert response.state["meta"]["solo"]["node"] == "duel"
    assert not response.state["meta"]["solo"]["outlaw_defeated"]


@pytest.mark.parametrize("result", ["failure", "bust", "success"])
def test_associate_identity_survives_retries_and_changes_only_after_defeat(run, result):
    ready(run)
    game = GAMES[run[0]].state
    GAMES[run[0]].state = solo._update(game, node="associates", outlaw_defeated=True)
    start_scene(run, "AS" if result == "failure" else "2C", "2H" if result == "failure" else "10H")
    opponent = deepcopy(GAMES[run[0]].state.meta["solo"]["associate"])
    assert opponent["ethnicity"] in {"Criollo", "Paisà", "Yankee", "Chichimeca"}
    assert opponent["gender"] in {"man", "woman"}
    from backend.engine.helpers.character_creation import _FLAVOR
    assert opponent["feature"] in _FLAVOR["features"]
    game = GAMES[run[0]].state
    before = deepcopy(game)
    assert solo.presentation(game) == solo.presentation(game)
    assert game == before
    if result == "bust":
        stack(run, ["3D"])
        act(run, "gf.scene_draw_card")
    else:
        act(run, "gf.scene_stand")
    accept(run)
    act(run, solo.SOLO_CONTINUE)
    game = GAMES[run[0]].state
    current = game.meta["solo"]["associate"]
    if result == "success":
        assert current["number"] == opponent["number"] + 1
        assert game.meta["solo"]["attempt"] == 0
    else:
        assert current == opponent
        assert game.meta["solo"]["attempt"] == 1
    assert current["feature"] in solo.presentation(game)["text"]
    # JSON snapshots preserve the opponent without another flavor draw.
    restored = replace(game, meta=json.loads(json.dumps(game.meta)))
    assert solo.presentation(restored) == solo.presentation(game)


@pytest.mark.parametrize("choice,expected", [("keep", "8S"), ("bury", "6C")])
def test_first_yankee_duel_deals_once_and_keeps_result_cards_visible(run, choice, expected):
    ready(run, "KH")
    # Arrive at the first duel through the complete extended trail.
    for reward in ["2H", "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10C", "JD", "QC"]:
        start_scene(run, "3C", "10H")
        stack(run, [reward])
        act(run, "gf.scene_stand")
        accept(run)
        while solo.presentation(GAMES[run[0]].state)["needs_discard"]:
            act(run, "gf.scene_discard_reward", reward_card_id=GAMES[run[0]].state.zones[f"players.{solo.PLAYER}.rewards"][0])
        act(run, solo.SOLO_CONTINUE)
    assert GAMES[run[0]].state.meta["solo"]["node"] == "duel"
    stack(run, ["6D", "8S", "6C"])
    response = act(run, solo.SOLO_CONTINUE)
    assert response.state["meta"]["pending_interaction"]["payload"]["inspected_card_id"] == "8S"
    before = deepcopy(GAMES[run[0]].state)
    response = act(run, "gf.faction_yankee_choose_top_card", choice=choice)
    game = GAMES[run[0]].state
    assert game.zones[f"scene.hand.{solo.PLAYER}"] == [expected]
    assert len(game.deck.draw_pile) == len(before.deck.draw_pile) - 1
    assert game.meta["scene"]["players"][solo.PLAYER]["hand_value"] == (18 if choice == "keep" else 16)
    assert game.meta["scene"]["status"] == "active"
    assert game.meta["solo"]["step"] == "playing"
    if choice == "keep":
        # The screenshot's total: 10 + 8 + 6. It requires another draw.
        act(run, "gf.scene_draw_card")
        expected_cards, total = ["8S", "6C"], 24
    else:
        stack(run, ["5H"])
        act(run, "gf.scene_stand")
        expected_cards, total = ["6C"], 16
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["scene"]["status"] == "closed"
    assert not game.zones.get(f"scene.hand.{solo.PLAYER}")
    assert solo.presentation(game)["resolved_hand"] == expected_cards
    assert game.meta["solo"]["history"][-1]["cards"] == expected_cards
    assert game.meta["solo"]["history"][-1]["total"] == total
    while solo.presentation(GAMES[run[0]].state)["needs_discard"]:
        act(run, "gf.scene_discard_reward", reward_card_id=GAMES[run[0]].state.zones[f"players.{solo.PLAYER}.rewards"][0])
    if solo.presentation(GAMES[run[0]].state)["needs_heal"]:
        act(run, "gf.scene_skip_heal")
    act(run, solo.SOLO_CONTINUE)
    assert solo.presentation(GAMES[run[0]].state)["resolved_hand"] == []


@pytest.mark.parametrize("node", ["hideout", "captive", "farmer", "fire", "canal", "rubble", "lookout", "tracking", "cart"])
def test_extended_trail_second_wound_ends_run_before_advancing(run, node):
    ready(run)
    game = GAMES[run[0]].state
    players = {**game.meta["players"], solo.PLAYER: {**game.meta["players"][solo.PLAYER], "wounds": 1}}
    GAMES[run[0]].state = solo._update(replace(game, meta={**game.meta, "players": players}), node=node)
    start_scene(run, "2C", "10H")
    stack(run, ["3D"])
    act(run, "gf.scene_draw_card")
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["ending"] == "death"
    assert game.meta["solo"]["node"] == node
    with pytest.raises(ValueError, match="ended"):
        act(run, solo.SOLO_CONTINUE)


def test_extended_route_order_and_stable_saved_passages(run):
    expected = ["gun", "witnesses", "hideout", "captive", "farmer", "fire", "canal", "rubble", "lookout", "tracking", "cart", "duel", "associates"]
    story = solo.adventure()
    node, route = "gun", []
    while node not in route:
        route.append(node)
        node = story["nodes"][node]["next"]["success"]
    assert route == expected
    ready(run)
    # Persist each new node and its retry position using the real snapshot codec.
    for node in expected[2:-2]:
        game = solo._update(GAMES[run[0]].state, node=node, attempt=1)
        before = solo.presentation(game)
        envelope = encode_envelope(run[0], game, GAMES[run[0]].sessions)
        restored = decode_envelope(json.dumps(envelope), run[0])
        assert solo.presentation(restored.state) == before


@pytest.mark.parametrize("after_standing", [False, True])
def test_solo_matching_vengeance_at_20_caps_at_21_without_wound(run, after_standing):
    from backend.tests.test_gf_scene import _replace_zone_cards
    ready(run, "KD")
    start_scene(run, "AS", "10H")
    game = GAMES[run[0]].state
    GAMES[run[0]].state = _replace_zone_cards(game, "players.solo_player.vengeance", ["5D"])
    if after_standing:
        act(run, "gf.scene_stand")
    response = act(run, "gf.scene_play_vengeance")
    assert response.state["meta"]["scene"]["players"][solo.PLAYER]["hand_value"] == 21
    assert response.state["meta"]["players"][solo.PLAYER]["wounds"] == 0
    if not after_standing:
        act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["outcome"] == "success"
    assert game.meta["players"][solo.PLAYER]["wounds"] == 0


@pytest.mark.parametrize("ending", ["ascension", "exhaustion", "death"])
@pytest.mark.parametrize("defeated", [False, True])
def test_special_completion_requires_survival_and_opossums_death(run, ending, defeated):
    game = solo._update(GAMES[run[0]].state, outlaw_defeated=defeated)
    game = solo.finish(game, ending)
    expected = defeated and ending != "death"
    assert game.meta["solo"]["opossum_hunter"] is expected
    assert bool(solo.presentation(game)["special_completion"]) is expected
    if expected:
        assert solo.presentation(game)["special_completion"]["id"] == "opossum_hunter"
        assert "brought Opossum down" in game.meta["victory"]["reason"]
    restored = decode_envelope(json.dumps(encode_envelope(run[0], game, GAMES[run[0]].sessions)), run[0])
    assert solo.presentation(restored.state)["special_completion"] == solo.presentation(game)["special_completion"]


@pytest.mark.parametrize("ending", ["ascension", "exhaustion"])
def test_opossum_kill_is_recorded_when_his_reward_ends_the_run(run, ending):
    ready(run)
    GAMES[run[0]].state = solo._update(GAMES[run[0]].state, node="duel")
    start_scene(run, "2C", "10H")
    if ending == "ascension":
        add_rewards(run, ["AS"])
        stack(run, ["10C"])
    else:
        game = GAMES[run[0]].state
        GAMES[run[0]].state = replace(game, deck=replace(game.deck,
            draw_pile=[], discard_pile=[*game.deck.discard_pile, *game.deck.draw_pile]))
    act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    assert game.meta["solo"]["ending"] == ending
    assert game.meta["solo"]["outlaw_defeated"]
    assert game.meta["solo"]["opossum_hunter"]
    assert solo.presentation(game)["special_completion"]["id"] == "opossum_finale"
    assert game.meta["solo"]["opossum_finale"]
    restored = decode_envelope(json.dumps(encode_envelope(run[0], game, GAMES[run[0]].sessions)), run[0])
    assert solo.presentation(restored.state)["special_completion"] == solo.presentation(game)["special_completion"]


def test_associate_encounters_vary_between_opponents_and_persist_within_fight(run):
    ready(run)
    game = solo._update(GAMES[run[0]].state, node="associates", outlaw_defeated=True)
    seen = set()
    # Exercise every authored variant rather than relying on random coverage.
    for encounter in solo.adventure()["associate_encounters"]:
        game = solo._ensure_associate(game, replace_opponent=True)
        opponent = {**game.meta["solo"]["associate"], "encounter": encounter["id"]}
        game = solo._update(game, associate=opponent)
        for outcome in [None, "failure", "bust", "success"]:
            for attempt in range(3):
                saved = solo._update(game, attempt=attempt, outcome=outcome,
                    step="intro" if outcome is None else "outcome")
                view = solo.presentation(saved)
                assert view["title"] == encounter["title"]
                assert opponent["feature"] in view["text"]
                assert (encounter["passages"][attempt] if outcome is None else encounter["outcomes"][outcome]) in view["text"]
                assert solo.presentation(saved) == view
        seen.add(solo.presentation(game)["title"])
        new = solo._ensure_associate(game, replace_opponent=True)
        assert new.meta["solo"]["associate"]["encounter"] != encounter["id"]
    assert len(seen) == 4


@pytest.mark.parametrize("ending", ["ascension", "exhaustion"])
def test_ending_after_associates_keeps_original_special_tier(run, ending):
    ready(run)
    game = solo._update(GAMES[run[0]].state, node="associates", outlaw_defeated=True)
    game = solo.finish(game, ending)
    assert game.meta["solo"]["opossum_hunter"]
    assert not game.meta["solo"]["opossum_finale"]
    assert solo.presentation(game)["special_completion"]["id"] == "opossum_hunter"


@pytest.mark.parametrize("result,status", [("failure", "closed"), ("bust", "closed"), ("success", "awaiting_ack")])
def test_finale_needs_a_final_successful_opossum_duel(run, result, status):
    ready(run)
    game = GAMES[run[0]].state
    scene = {**game.meta["scene"], "status": status,
        "players": {solo.PLAYER: {"result": result}}}
    game = solo._update(replace(game, meta={**game.meta, "scene": scene}), node="duel", outlaw_defeated=True)
    assert solo._special_completion(game, "exhaustion")["id"] == "opossum_hunter"
    assert solo._special_completion(game, "death") is None


@pytest.mark.parametrize("node,variant", [
    *[(node, None) for node in solo.adventure()["nodes"] if node != "associates"],
    *[("associates", encounter["id"]) for encounter in solo.adventure()["associate_encounters"]],
])
def test_fatal_bust_reports_the_current_scene_and_freezes_it_in_the_save(run, node, variant):
    ready(run)
    game = GAMES[run[0]].state
    players = {**game.meta["players"], solo.PLAYER: {**game.meta["players"][solo.PLAYER], "wounds": 1}}
    game = solo._update(replace(game, meta={**game.meta, "players": players}),
        node=node, outlaw_defeated=node == "associates")
    if variant:
        game = solo._ensure_associate(game)
        game = solo._update(game, associate={**game.meta["solo"]["associate"], "encounter": variant})
    GAMES[run[0]].state = game
    start_scene(run, "2C", "10H")
    stack(run, ["3D"])
    response = act(run, "gf.scene_draw_card")
    accept(run)
    game = GAMES[run[0]].state
    expected = solo._story_node(game)["fatal_outcome"]
    assert game.meta["solo"]["ending"] == "death"
    assert game.meta["solo"]["node"] == node
    assert game.meta["solo"]["ending_narrative"] == expected
    assert solo.presentation(game)["ending_narrative"] == expected
    assert game.meta["victory"]["reason"].startswith(expected)
    assert response.state["meta"]["solo"]["ending_narrative"] == expected
    assert solo.presentation(game)["special_completion"] is None
    restored = decode_envelope(json.dumps(encode_envelope(run[0], game, GAMES[run[0]].sessions)), run[0])
    assert solo.presentation(restored.state)["ending_narrative"] == expected
    # Old completed snapshots have no frozen narrative: infer the correct scene
    # without changing the snapshot on a read.
    legacy = replace(game, meta={**game.meta, "solo": {k: v for k, v in game.meta["solo"].items() if k != "ending_narrative"}})
    before = deepcopy(legacy)
    assert solo.presentation(legacy)["ending_narrative"] == expected
    assert legacy == before
    if node == "captive":
        assert "knife" in expected
        assert "Drywell" not in expected and "farmer" not in expected


def test_early_21_has_a_messenger_epilogue_without_awarding_a_personal_kill(run):
    ready(run)
    start_scene(run, "2C", "10H")
    add_rewards(run, ["AS"])
    stack(run, ["10C"])
    act(run, "gf.scene_stand")
    accept(run)
    game = GAMES[run[0]].state
    view = solo.presentation(game)
    assert game.meta["solo"]["ending"] == "ascension"
    assert not game.meta["solo"]["outlaw_defeated"]
    assert not game.meta["solo"]["opossum_hunter"]
    assert not game.meta["solo"]["opossum_finale"]
    assert view["special_completion"] is None
    assert view["ending_narrative"] == solo.adventure()["epilogues"]["ascension"]["unfinished"]
    assert "messenger" in view["ending_narrative"]
    assert "even if the hunt was unfinished" not in view["text"]


@pytest.mark.parametrize("ending", ["ascension", "exhaustion"])
@pytest.mark.parametrize("stage", ["trail", "live_duel", "associates", "final_shot"])
def test_epilogue_matches_hunt_progress_without_rewriting_kill_credit(run, ending, stage):
    ready(run)
    game = GAMES[run[0]].state
    node = {"trail": "captive", "live_duel": "duel", "associates": "associates", "final_shot": "duel"}[stage]
    defeated = stage in {"associates", "final_shot"}
    if stage == "final_shot":
        scene = {**game.meta["scene"], "status": "closed", "players": {solo.PLAYER: {"result": "success"}}}
        game = replace(game, meta={**game.meta, "scene": scene})
    game = solo._update(game, node=node, outlaw_defeated=defeated)
    game = solo.finish(game, ending)
    variant = "on_opossum" if stage == "final_shot" else "after_opossum" if defeated else "unfinished_duel" if stage == "live_duel" and ending == "ascension" else "unfinished"
    expected = solo.adventure()["epilogues"][ending][variant]
    assert solo.presentation(game)["ending_narrative"] == expected
    assert game.meta["solo"]["outlaw_defeated"] is defeated
    assert game.meta["solo"]["opossum_hunter"] is defeated
    # Once committed, later content changes do not rewrite this run's ending.
    game = solo._update(game, ending_narrative="A saved final scene.")
    assert solo.presentation(game)["ending_narrative"] == "A saved final scene."
