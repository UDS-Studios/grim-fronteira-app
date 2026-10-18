# Solo learning adventure: The Road to Malopasso

The solo adventure teaches the existing app's basic rules through a short,
authored hunt. It uses no LLM. Choose a character, bargain for a gun, question
witnesses, track an outlaw through Malopasso, and duel. If the run continues,
associates challenge the player one at a time. Every result selects a written
passage; ordinary failures retry the current task with another passage and a
fresh test, using the ongoing deck.

## Rules profile

Solo uses the current app rules, including character cards contributing 10 to
hands, difficulty 10 + one card, Joker difficulty 20, flexible hand Aces,
Vengeance, faction powers where applicable, Rewards, overflow discards and the
existing healing choice. Two wounds end the run. Exact-21 Reward victory can
happen before the final duel. The gun is a story flag, not a numerical bonus.
The starter website describes some rules differently; this mode does not mix
that profile into the running app's engine.

Solo-specific restrictions are intentional:

- No Dark or Azzardo. Every ending invites the player into multiplayer to try
  both, play Scum against rivals and use their faction's full power.
- No simulated NPC resource pool. Scum has no eligible rival player here.
- Chichimeca is selectable with an explicit warning and no compensating power.
  Its wound trigger finds no eligible target and does not open a blocking prompt.
- Solo keeps discarded cards rather than recycling them when a Joker enters
  the discard pile. Exhaustion ends the finite learning run as survival,
  distinct from exact-21 ascension. Multiplayer recycling is unchanged.
- A required draw from an empty deck ends the run safely, including an initial
  hand, Joker bonus or Reward draw. It never invents a card or leaves a retry
  that repeatedly fails on an empty pile.

Winning the outlaw duel marks them defeated. Failure/bust lets them escape.
Either result leads to associates if the run is still active. Death or victory
always takes precedence over another scene. Retrying from an ending creates a
new run and fresh shuffle; reloading resumes the existing run.

## Architecture

`backend/engine/rules/grim_fronteira/solo.py` is a small server-side controller
calling the existing lobby, scene, faction, Reward and wound functions. Its
versioned content lives in `backend/engine/data/adventures/malopasso_v1.json`.
There is one authenticated player seat. The internal Marshal is an engine
identity with no issued or stored session credentials. Solo never depends on
Marshal presence; multiplayer pause/authentication rules remain in place.

`POST /api/gf/solo` accepts an empty object and returns the existing response
and session envelope. Clients cannot supply rules, a deck path or shuffle seed.
The existing action endpoint accepts `gf.solo_continue` with the player identity.
All solo mutations require `expected_revision`; stale or duplicate requests are
rejected with 409. Clients must fetch the latest state and choose again, not
resubmit a changed command automatically. Existing session recovery remains
available after server/browser restarts.

Solo mode restricts the action allowlist on the backend. Clients cannot join,
act as the internal Marshal, enable Dark/Azzardo, or invoke target powers against
invented NPC seats. Story progress, cards and automatic settlement commit as
one candidate through the existing atomic persistence mechanism. Failed saves
publish neither the story advance nor the mechanical mutation.

Saved state includes adventure/version, current node, attempt number, scene
number, possession/defeat flags, outcome/history and terminal result. Presentation
is derived from those saved values, so reloads do not select different passages.
Player responses retain the existing hidden-deck projection.

`SoloAdventureView` supplies character selection, story passages, contextual
rules, card controls, resources/faction decisions, healing/overflow, a compact
history and the final multiplayer/retry actions. It reuses card assets and API
session handling. Home offers a new solo run and resume of the latest solo run.
The existing multiplayer table and tutorials retain their own routes.

## Local validation

From the repository root:

```bash
PYTHONPATH=. .venv/bin/python -m pytest backend/tests/
npm --prefix frontend test
npm --prefix frontend run build
```

The solo backend suite exercises every story edge, all factions with three
simple draw policies, card conservation, death, early exact-21 victory,
exhaustion, overflow, healing, failed saves, revision conflicts, forbidden
requests, and disk/reconnect recovery during a Yankee inspection. Solo frontend
interaction tests cover selection warnings, request identity/revision, duplicate
click suppression, terminal calls to action, and post-scene choices.

When changing content, preserve existing version semantics for saved runs;
introduce a new definition/version and migration strategy before removing a
version that users may still be playing. Current snapshot loading rejects an
unsupported adventure version instead of guessing a continuation.

## Playtest checklist

Use a fresh King for an accessible first run, then a Chichimeca to inspect the
warning and no-target behavior. Check normal failure versus bust explanations,
Vengeance before accepting a result, first Reward, healing and overflow when
they occur. Complete or lose a run, confirm the multiplayer invitation mentions
Azzardo and Dark, and retry. Refresh mid-hand and close/reopen the browser to
resume. Check a narrow mobile viewport as well as desktop. The graph allows
retries and additional associates, so actual run duration depends on play and
cards rather than a fixed promised number of minutes.
