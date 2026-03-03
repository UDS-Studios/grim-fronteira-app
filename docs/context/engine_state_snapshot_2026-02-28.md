# Engine state snapshot (Grim Fronteira app)

Date: 2026-02-28  
Scope: **Engine + API boundary** snapshot for frontend scaffolding discussions (APP-ARCH thread).  
Repo: `grim-fronteira-app`

---

## 1) Current backend tree (verbatim)

```text
backend/
├── app
│   ├── main.py
│   ├── __pycache__
│   │   ├── main.cpython-312.pyc
│   │   ├── schemas.cpython-312.pyc
│   │   ├── serializers.cpython-312.pyc
│   │   └── store.cpython-312.pyc
│   ├── schemas.py
│   ├── serializers.py
│   └── store.py
├── engine
│   ├── grimdeck
│   │   ├── deck_io.py
│   │   ├── deck_ops.py
│   │   ├── __init__.py
│   │   ├── models.py
│   │   └── __pycache__
│   │       ├── deck_io.cpython-312.pyc
│   │       ├── deck_ops.cpython-312.pyc
│   │       ├── __init__.cpython-312.pyc
│   │       └── models.cpython-312.pyc
│   ├── __init__.py
│   ├── minigames
│   │   ├── blackjack.py
│   │   ├── __init__.py
│   │   └── __pycache__
│   │       ├── blackjack.cpython-312.pyc
│   │       └── __init__.cpython-312.pyc
│   ├── __pycache__
│   │   └── __init__.cpython-312.pyc
│   ├── rules
│   │   ├── grim_fronteira
│   │   │   ├── __init__.py
│   │   │   ├── __pycache__
│   │   │   │   ├── __init__.cpython-312.pyc
│   │   │   │   ├── scene_difficulty.cpython-312.pyc
│   │   │   │   └── setup.cpython-312.pyc
│   │   │   ├── scene_difficulty.py
│   │   │   └── setup.py
│   │   ├── __init__.py
│   │   └── __pycache__
│   │       └── __init__.cpython-312.pyc
│   └── state
│       ├── game_state_io.py
│       ├── game_state.py
│       ├── __init__.py
│       ├── __pycache__
│       │   ├── game_state.cpython-312.pyc
│       │   ├── __init__.cpython-312.pyc
│       │   ├── validators.cpython-312.pyc
│       │   └── zone_ops.cpython-312.pyc
│       ├── validators.py
│       └── zone_ops.py
├── __init__.py
├── __pycache__
│   └── __init__.cpython-312.pyc
└── tests
    ├── __init__.py
    ├── __pycache__
    │   ├── __init__.cpython-312.pyc
    │   ├── test_blackjack.cpython-312-pytest-9.0.2.pyc
    │   ├── test_gf_setup.cpython-312.pyc
    │   └── test_gf_setup.cpython-312-pytest-9.0.2.pyc
    ├── test_blackjack.py
    └── test_gf_setup.py
```

---

## 2) Data templates (deck)

Deck templates live under `data/templates/`:

- `standard_54.json` (includes jokers `RJ`, `BJ`)
- `standard_52.json` (no jokers; used by blackjack minigame)

Card ID format:

- Number + suit: `2C ... 10S`
- Face + suit: `JC, QH, KD, ...`
- Ace: `AS`
- Jokers: `RJ`, `BJ`

Deck convention:

- `draw_pile` is ordered bottom → top
- **top card is the LAST element** (`pop()` semantics)

---

## 3) Engine modules implemented

### A) `backend/engine/grimdeck/*`

**Purpose:** deck representation + pure operations (immutable returns).

- `models.py`
  - `CardID` type alias
  - `DeckState` dataclass (deck piles + metadata)
- `deck_io.py`
  - `load_deck(path)` and `save_deck(state, path)`
- `deck_ops.py`
  - pure ops: `play`, `discard`, `shuffle`, `reset`
  - plus targeted helpers used by setup logic for non-top moves

### B) `backend/engine/state/*`

**Purpose:** game-wide state wrapper around a deck + named zones.

- `game_state.py`
  - `GameState` dataclass: `{deck, zones, meta}`
- `zone_ops.py`
  - zone manipulation utilities (notably `claim_from_in_play(...)`)
- `validators.py`
  - `validate_unique_cards(state)` (no duplicates across deck piles + all zones)
  - `validate_card_conservation(state)` (expected total card count matches deck settings)
  - `validate_game_state(state)` wrapper (runs the invariant checks)

### C) `backend/engine/minigames/blackjack.py`

**Purpose:** small “blackjack correctness harness” using the same core primitives.

- `deal(game)`, `hit(game, who)`, `stand(game)`
- `hand_value(cards)` with Ace soft/hard logic
- Uses the staging convention:
  - `play()` → card goes to `deck.in_play`
  - `claim_from_in_play()` → card moved into zone (e.g. `hands.player`)

### D) `backend/engine/rules/grim_fronteira/setup.py`

**Purpose:** Grim Fronteira setup rules (multi-player) using shared deck and zones.

Key zones:

- `setup.face_pile` (extracted from draw_pile)
- `players.<pid>.character`
- `players.<pid>.scum`
- `players.<pid>.vengeance`
- `players.<pid>.rewards`

Key functions:

- `extract_face_pile(game)` / `return_face_pile_to_deck(game, ...)`
- `shuffle_zone(game, zone_name, seed)`
- `choose_from_face_pile(...)` / `draw_from_face_pile(...)`
- `draw_n_to_zone(game, zone, n)`
- `setup_starting_baggage(game, pid)` (J/Q/K rules)
- `setup_players(game, player_ids, ...)` orchestrator (shared deck, optional deterministic shuffle, optional explicit choices)

### E) `backend/engine/rules/grim_fronteira/scene_difficulty.py`

**Purpose:** Marshal difficulty helper with a modifiable rules strategy.

- Current assumed rule: **base 10 + 1 drawn card**
- Joker handling implemented:
  - Joker difficulty becomes **17**
  - `RJ`: all players gain +1 Scum
  - `BJ`: all players gain +1 Vengeance
- Difficulty artifacts stored in:
  - zone: `scene.difficulty.cards`
  - meta: `scene.difficulty_rule`, `scene.difficulty_value`, `scene.difficulty_base`
- Returns `(game, DifficultyRoll)` where `DifficultyRoll` includes `effects`

---

## 4) API boundary snapshot (FastAPI)

Location: `backend/app/*`

### Endpoints

- `POST /api/gf/new`
  - Creates a new game from a deck template
  - Returns `{game_id, revision, state, events, result}`
- `POST /api/gf/action`
  - Action dispatcher:
    - `gf.get_state`
    - `gf.setup_players`
    - `gf.roll_difficulty`
  - Returns updated state with bumped `revision`
- `GET /api/game/{game_id}?view=debug|public`
  - Fetch latest state from in-memory store

### View redaction (“public vs debug”)

Serializer: `backend/app/serializers.py`

- `view="debug"` → full state
- `view="public"` → redact `deck.draw_pile` to:

  ```json
  {"count": N}
  ```

---

## 5) Current invariants and conventions (important for UI)

### State authority

The backend state is authoritative. Clients are expected to:

- send actions
- receive full updated state (or redacted view)
- render from returned state

### Revisioning

`meta.revision` increments on:

- `new_game`
- every `/api/gf/action` call (including `gf.get_state`)

### Zones are “bags of cards”

Zones are lists of `CardID`. Their meaning is by naming convention, e.g.:

- `players.p1.scum` is “the Scum pile”, but its content is normal cards.

---

## 6) Tests

- `backend/tests/test_blackjack.py`
- `backend/tests/test_gf_setup.py`

Run:

```bash
PYTHONPATH=. pytest backend/tests/
```

---

## 7) What’s intentionally NOT implemented yet

- Player decision logic for scenes (blackjack “hit/stand” per player vs difficulty)
- Scum/Vengeance spend rules (+/- modifiers)
- Wounds, elimination, Rewards-as-points, “Dark” scenes
- Persistent storage (currently `store.py` is in-memory dict)
- Auth / multi-client sync

---

## 8) Next work packages (engine vs app-arch)

### ENGINE thread (this one)

- Scene resolution helpers (blackjack resolution against difficulty)
- Scum/Vengeance spend + validation
- Rewards/wounds/elimination bookkeeping
- Dark scene rules

### APP-ARCH thread (frontend scaffold)

- Minimal UI rendering of zones/meta + action buttons
- Debug vs public view selection
- State polling or websocket plan (later)
