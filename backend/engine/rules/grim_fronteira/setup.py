from __future__ import annotations

from typing import Dict, List

from backend.engine.grimdeck.deck_ops import play
from backend.engine.grimdeck.deck_ops import shuffle as shuffle_deck
from backend.engine.grimdeck.models import CardID, DeckState
from backend.engine.state.game_state import GameState
from backend.engine.state.validators import validate_unique_cards
from backend.engine.state.zone_ops import claim_from_in_play


FACE_PILE_ZONE = "setup.face_pile"


def is_face(card_id: CardID) -> bool:
    """
    Face cards are J, Q, K of any suit.
    Card IDs are like: "JC", "QH", "KS", "10D", "AS".
    """
    rank = card_id[:-1]  # strip suit
    return rank in ("J", "Q", "K")


def face_rank(card_id: CardID) -> str:
    """
    Return 'J', 'Q', or 'K' for a face card. Raise otherwise.
    """
    r = card_id[:-1]
    if r not in ("J", "Q", "K"):
        raise ValueError(f"Not a face card: {card_id}")
    return r


def _zones_copy(zones: Dict[str, List[CardID]]) -> Dict[str, List[CardID]]:
    return {k: v.copy() for k, v in zones.items()}


def _ensure_zone(zones: Dict[str, List[CardID]], zone_name: str) -> None:
    if zone_name not in zones:
        zones[zone_name] = []


def shuffle_zone(game: GameState, zone_name: str, seed: int | None = None) -> GameState:
    import random

    pile = game.zones.get(zone_name)
    if pile is None:
        raise ValueError(f"Zone '{zone_name}' does not exist.")

    rng = random.Random(seed)
    new_zones = _zones_copy(game.zones)
    new_pile = new_zones[zone_name]
    rng.shuffle(new_pile)

    new_game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)
    validate_unique_cards(new_game)
    return new_game


def extract_face_pile(game: GameState, zone_name: str = FACE_PILE_ZONE) -> GameState:
    """
    Remove all face cards (J/Q/K) from deck.draw_pile and put them into `zone_name`.

    - Preserves relative order of remaining draw_pile cards.
    - Face pile order is preserved as encountered in draw_pile.
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    if zone_name in game.zones and len(game.zones[zone_name]) > 0:
        raise ValueError(f"Zone '{zone_name}' already exists and is not empty.")

    faces: List[CardID] = []
    rest: List[CardID] = []

    for c in game.deck.draw_pile:
        (faces if is_face(c) else rest).append(c)

    if not faces:
        raise ValueError("No face cards found in draw_pile (unexpected for standard deck).")

    new_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=rest,
        in_play=game.deck.in_play,
        discard_pile=game.deck.discard_pile,
        removed=game.deck.removed,
    )

    new_zones = _zones_copy(game.zones)
    new_zones[zone_name] = faces

    new_game = GameState(deck=new_deck, zones=new_zones, meta=game.meta)
    validate_unique_cards(new_game)
    return new_game


def choose_from_face_pile(
    game: GameState,
    card_id: CardID,
    dest_zone: str,
    face_pile_zone: str = FACE_PILE_ZONE,
) -> GameState:
    """
    Choose a specific face card from the face pile and move it to `dest_zone`.
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    pile = game.zones.get(face_pile_zone)
    if pile is None:
        raise ValueError(
            f"Face pile zone '{face_pile_zone}' does not exist. Call extract_face_pile() first."
        )

    if card_id not in pile:
        raise ValueError(f"Card {card_id} not found in face pile '{face_pile_zone}'.")

    new_zones = _zones_copy(game.zones)
    _ensure_zone(new_zones, dest_zone)

    # remove from face pile
    new_pile = new_zones[face_pile_zone]
    new_pile.remove(card_id)

    # add to destination
    new_zones[dest_zone].append(card_id)

    new_game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)
    validate_unique_cards(new_game)
    return new_game


def draw_from_face_pile(
    game: GameState,
    dest_zone: str,
    face_pile_zone: str = FACE_PILE_ZONE,
) -> GameState:
    """
    Draw the *top* face card from the face pile and move it to `dest_zone`.
    Convention: top is the LAST element (stack semantics).
    """
    pile = game.zones.get(face_pile_zone)
    if pile is None:
        raise ValueError(
            f"Face pile zone '{face_pile_zone}' does not exist. Call extract_face_pile() first."
        )
    if not pile:
        raise ValueError(f"Face pile zone '{face_pile_zone}' is empty.")

    card_id = pile[-1]  # top is last
    return choose_from_face_pile(game, card_id, dest_zone, face_pile_zone=face_pile_zone)


def return_face_pile_to_deck(
    game: GameState,
    seed: int | None = None,
    face_pile_zone: str = FACE_PILE_ZONE,
    delete_zone: bool = True,
) -> GameState:
    """
    Return any remaining face cards in `face_pile_zone` back into deck.draw_pile, then shuffle.

    - Default behavior: merge + shuffle with optional seed (deterministic).
    - If delete_zone=True, removes the face pile zone entirely after returning.
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    pile = game.zones.get(face_pile_zone)
    if pile is None:
        raise ValueError(f"Face pile zone '{face_pile_zone}' does not exist.")

    # Merge remaining faces back into draw pile
    merged_draw = game.deck.draw_pile + pile

    merged_deck = DeckState(
        version=game.deck.version,
        schema=game.deck.schema,
        created_utc=game.deck.created_utc,
        notes=game.deck.notes,
        settings=game.deck.settings,
        draw_pile=merged_draw,
        in_play=game.deck.in_play,
        discard_pile=game.deck.discard_pile,
        removed=game.deck.removed,
    )

    # Shuffle draw pile
    shuffled_deck = shuffle_deck(merged_deck, seed=seed)

    new_zones = _zones_copy(game.zones)
    if delete_zone:
        new_zones.pop(face_pile_zone, None)
    else:
        new_zones[face_pile_zone] = []

    new_game = GameState(deck=shuffled_deck, zones=new_zones, meta=game.meta)
    validate_unique_cards(new_game)
    return new_game


def draw_n_to_zone(game: GameState, dest_zone: str, n: int = 1) -> GameState:
    """
    Draw n cards from the main deck (top of draw_pile) into dest_zone.

    Uses the staging convention:
      play() -> card goes to deck.in_play
      claim_from_in_play() -> move into dest_zone
    """
    if n < 0:
        raise ValueError("n must be >= 0")
    if game.deck is None:
        raise ValueError("GameState has no deck.")

    for _ in range(n):
        new_deck = play(game.deck)
        game = GameState(deck=new_deck, zones=game.zones, meta=game.meta)

        card_id = game.deck.in_play[-1]
        game = claim_from_in_play(game, card_id, dest_zone)

        validate_unique_cards(game)

    return game


def setup_starting_baggage(game: GameState, player_id: str) -> GameState:
    """
    Implements sample rules:

      Jacks  -> start with 2 Scum cards
      Queens -> start with 1 Scum and 1 Vengeance
      Kings  -> start with 2 Vengeance cards

    Scum/Vengeance are *piles* (zones) containing normal cards drawn from the main deck.
    """
    char_zone = f"players.{player_id}.character"
    scum_zone = f"players.{player_id}.scum"
    ven_zone = f"players.{player_id}.vengeance"
    rew_zone = f"players.{player_id}.rewards"

    if char_zone not in game.zones or len(game.zones[char_zone]) != 1:
        raise ValueError(f"Expected exactly 1 character card in zone '{char_zone}'.")

    # Ensure target zones exist
    new_zones = _zones_copy(game.zones)
    _ensure_zone(new_zones, scum_zone)
    _ensure_zone(new_zones, ven_zone)
    _ensure_zone(new_zones, rew_zone)
    game = GameState(deck=game.deck, zones=new_zones, meta=game.meta)

    r = face_rank(game.zones[char_zone][0])

    if r == "J":
        game = draw_n_to_zone(game, scum_zone, n=2)
    elif r == "Q":
        game = draw_n_to_zone(game, scum_zone, n=1)
        game = draw_n_to_zone(game, ven_zone, n=1)
    elif r == "K":
        game = draw_n_to_zone(game, ven_zone, n=2)
    else:
        raise ValueError("Unreachable: face_rank returned unexpected value.")

    game = GameState(deck=game.deck, zones=game.zones, meta={**game.meta, "setup.baggage_done": True})
    validate_unique_cards(game)
    return game

def setup_players(
    game: GameState,
    player_ids: List[str],
    *,
    character_choices: Dict[str, CardID] | None = None,
    shuffle_face_pile_first: bool = False,
    face_shuffle_seed: int | None = None,
    return_remaining_faces: bool = False,
    return_shuffle_seed: int | None = None,
    face_pile_zone: str = FACE_PILE_ZONE,
) -> GameState:
    """
    Orchestrate Grim Fronteira setup for multiple players using a shared deck:
    - extract + optional shuffle face pile
    - assign character cards (choose or random)
    - assign starting baggage (Scum/Vengeance piles)
    - optionally return face pile to deck
    """
    if game.deck is None:
        raise ValueError("GameState has no deck.")
    if not player_ids:
        raise ValueError("player_ids must contain at least one player.")
    if len(set(player_ids)) != len(player_ids):
        raise ValueError("player_ids contains duplicates.")

    choices = character_choices or {}
    unknown_players = set(choices) - set(player_ids)
    if unknown_players:
        names = ", ".join(sorted(unknown_players))
        raise ValueError(f"character_choices has unknown player_id(s): {names}")

    game = extract_face_pile(game, zone_name=face_pile_zone)

    if shuffle_face_pile_first:
        game = shuffle_zone(game, face_pile_zone, seed=face_shuffle_seed)

    for player_id in player_ids:
        character_zone = f"players.{player_id}.character"
        chosen = choices.get(player_id)

        if chosen is None:
            game = draw_from_face_pile(game, character_zone, face_pile_zone=face_pile_zone)
        else:
            if not is_face(chosen):
                raise ValueError(f"Chosen card for player '{player_id}' is not a face card: {chosen}")
            game = choose_from_face_pile(
                game,
                chosen,
                character_zone,
                face_pile_zone=face_pile_zone,
            )

        game = setup_starting_baggage(game, player_id)

    if return_remaining_faces:
        game = return_face_pile_to_deck(
            game,
            seed=return_shuffle_seed,
            face_pile_zone=face_pile_zone,
            delete_zone=True,
        )

    meta = {
        **game.meta,
        "setup.players_done": True,
        "setup.players": player_ids.copy(),
    }
    game = GameState(deck=game.deck, zones=game.zones, meta=meta)
    validate_unique_cards(game)
    return game
