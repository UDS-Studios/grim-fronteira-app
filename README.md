# Grim Fronteira

Backend engine and frontend for **Grim Fronteira**, a card-driven game
system.

This repository currently contains:

-   A deterministic card engine (Python)
-   A generic `GameState` layer with zones
-   A minimal Blackjack minigame used as an engine test harness
-   A pytest-based regression test suite

The architecture is intentionally modular:

    backend/
      engine/
        grimdeck/      # Pure deck mechanics
        state/         # GameState + zones + validators
        minigames/     # Blackjack (engine harness)
      tests/           # Pytest regression tests

    data/
      templates/       # Deck templates (52 / 54 cards)
      saves/           # Runtime game saves

------------------------------------------------------------------------

## Design Philosophy

The engine follows three strict principles:

1.  **Immutable state**
    -   All operations return new state objects.
    -   No silent mutation.
2.  **Pure transitions**
    -   Deck operations (`play`, `discard`, `shuffle`, `reset`) are
        deterministic.
    -   Randomness is seed-controlled.
3.  **Single source of truth**
    -   A card exists in exactly one place:
        -   deck piles
        -   or a zone
    -   Global validators enforce this invariant.

Blackjack is implemented only as a structural testbed.\
It validates that the engine supports real gameplay flows before Grim
Fronteira logic is layered on top.

------------------------------------------------------------------------

## Setup

### 1. Create virtual environment

``` bash
python3 -m venv .venv
source .venv/bin/activate
```

If needed:

``` bash
sudo apt install python3-venv
```

### 2. Install dependencies

``` bash
pip install -r requirements.txt
```

### 3. Run tests

``` bash
PYTHONPATH=. pytest backend/tests/
```

------------------------------------------------------------------------

## Deck Templates

Deck templates live in:

    data/templates/

Currently available:

-   `standard_52.json` -- 52 cards (Blackjack)
-   `standard_54.json` -- 52 cards + 2 Jokers (Grim Fronteira base)

Deck convention:

-   `draw_pile` is ordered bottom → top
-   The **last element is the top of the deck**
-   Drawing is implemented as `pop()` semantics

------------------------------------------------------------------------

## Engine Layers

### grimdeck/

Low-level card mechanics:

- `play()`
- `discard()`
- `shuffle(seed)`
- `reset(seed)`

No knowledge of players, zones, or game rules.

------------------------------------------------------------------------

### state/

Game session abstraction:

- `GameState`
- Dynamic zones (`dict[str, list[CardID]]`)
- Global validators (no duplicate cards)

The deck is embedded inside `GameState`.

------------------------------------------------------------------------

### minigames/

Blackjack:

- Deterministic test harness
- Phase-controlled state machine
- Strict rule enforcement

Used to validate engine integrity before implementing Grim Fronteira
rules.

------------------------------------------------------------------------

## Next Steps (Planned)

-   Expand validation layer (card ID constraints, deck size enforcement)
-   Event log layer for reproducible replays
-   FastAPI backend boundary
-   React frontend integration
-   Grim Fronteira rule layer

------------------------------------------------------------------------

## Development Discipline

-   No mutation of state objects
-   All new behavior must be covered by pytest
-   No game logic inside deck layer
-   No I/O inside engine logic


```bash
PYTHONPATH=. uvicorn backend.app.main:app --reload
npm run dev
```