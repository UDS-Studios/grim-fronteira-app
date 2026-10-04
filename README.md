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

## Backend durability

The API persists complete games and seat recovery-token hashes before acknowledging
creation, joins, and gameplay mutations. Linux local filesystem storage is supported.
The default directory is `<repository>/var/games`, resolved independently of the
working directory. Set `GF_PERSISTENCE_DIR` to an **absolute** path to override it.
For production, use a service-owned directory such as `/var/lib/grim-fronteira/games`,
outside deployment/build output. The directory is restricted to `0700`, files to `0600`.
Initialization failures stop startup; there is no memory-only fallback.

Run **one backend serving process per directory**: an exclusive process-lifetime
filesystem lock rejects a second writer. Do not enable multiple Uvicorn workers.
Normal shutdown/reload releases ownership. Deployments must preserve the directory
and grant the backend service user access; the service unit is managed outside this repo.

Startup restores valid game snapshots independently. Invalid/unsupported snapshots
remain untouched and their games return `503 GAME_UNAVAILABLE`. Internal diagnostics
include only a game ID and fixed reason category. An uncertain save after atomic
replacement fences that game until restart; never roll back by overwriting its file.
A failure before replacement returns `503 PERSISTENCE_UNAVAILABLE` without committing
candidate gameplay state. Atomic save uses file fsync, replacement, and directory fsync.

After restart all seats are offline and old active sessions return `SESSION_INVALID`.
Persistent reconnect credentials recover the same seat with a new active session;
revision and pending interactions are preserved. Post-lobby games remain paused until
Marshal recovery. Reconnect/takeover and presence polling do not write snapshots.
There is no migration/import of engine-only saves, deletion endpoint, or retention policy.
Debug mutations use the same transactions; seat changes without matching recovery
authority are rejected as `409 SESSION_TOPOLOGY_INVALID`.

A committed request can lose its response during a crash: client retries are not
exactly-once. In particular, a lost initial credential-issuance response cannot be
reconstructed from the saved hash. No plaintext bearer credentials are stored.
