# Solo learning adventure: The Road to Malopasso

The solo adventure teaches the existing app's basic rules through a short,
authored hunt. It uses no LLM. Choose a character, bargain for a gun, question
witnesses, investigate his former hideout, and follow a chain of clues into the
abandoned city of Malopasso before facing his machete in an alley duel. If the run continues,
associates challenge the player one at a time. Every result selects a written
passage; ordinary failures retry the current task with another passage and a
fresh test, using the ongoing deck.

## Extended trail

1. Buy a gun from the trader.
2. Question witnesses about Opossum's former customs-house hideout.
3. Get past the trapped door.
4. Reassure Inés, the freed Criollo captive, and learn about Elias Drywell.
5. Question Drywell, a Yankee farmer owed money by Opossum.
6. Rescue a farmhand from Drywell's burning storehouse.
7. Cross the broken bridge over the dry irrigation canal.
8. Free a scavenger trapped beneath a collapsed house.
9. Get past a lookout holding two enormous mastiffs.
10. Follow tracks through the abandoned tannery.
11. Evade Opossum's loaded handcart and corner him in the alley.
12. Duel Opossum; associates follow only after his defeat if the run continues.

Each investigation/obstacle scene advances on success or a surviving wound;
failure retries that task with another authored passage. A second wound ends the
run immediately. Opossum and associates keep fighting after failed or wounded
exchanges. The added obstacles use standard tests, including the mastiff lookout;
there are no extra combat, dog, trap, or damage rules. Rewards and exact-21 victory
remain unchanged, so the story can still end before reaching Opossum.

Existing saves remain valid: they keep their current node and resume from there.
A run already at the tannery or duel does not go back to the new earlier scenes.
Start a new solo adventure to experience the complete trail.

## Rules profile

Solo uses the current app rules, including character cards contributing 10 to
hands, difficulty 10 + one card, Joker difficulty 20, flexible hand Aces,
Vengeance (+1, or +2 with matching suit, capped at a hand total of 21 in both
solo and multiplayer), faction powers where applicable, Rewards, overflow discards and the
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

Winning the outlaw duel kills the outlaw and unlocks associates if the run is
still active. Failure or a nonlethal wound keeps the same outlaw duel going with
a fresh exchange and new narration. Associates never start while the outlaw is
alive; older saved runs are routed back to the outlaw before another encounter. Death or victory
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

`SoloAdventureView` composes the existing `PlayerLobbyView` and
`PlayerTableView`, so character selection, suggestions/custom names and features,
portrait, player board, Deck, Discard, scene lane, faction medallions, resources,
healing and Reward controls are the same ones used in multiplayer. The authored
Marshal's story sits above the player's scene; teaching notes occupy the space
normally used by other players. During play, continue/retry actions stay in the
story box. Endings use the shared result page with the multiplayer invitation,
special completion (when earned), Home and replay actions. The same viewport
fitting and scrolling behavior as the multiplayer Table is retained.

Scene descriptions and outcomes use the Saloon's character-by-character reveal
style at 25 ms per character, with a 290 ms pause after commas and
a 580 ms pause after periods. Across the authored passages this is roughly
300 words per minute, including punctuation pauses. Titles and controls remain immediately
available. Click the narration, or focus its reveal button and press Enter/Space,
to show it all. The full paragraph's space is reserved to avoid table movement;
screen readers receive the complete text once, rather than character updates.
Reduced-motion preferences bypass typing and a live preference change reveals
the text immediately. A passage identity based on game, scene, attempt, outcome
and text prevents polling or intro-to-playing transitions from restarting it.
Arrival is recorded in browser session storage, so reloads (even midway through
typing) and returning from Home reveal the current passage in full. New scenes,
retries, outcomes and new runs animate afresh. Endings remain static. This is a
frontend-only presentation effect; card rules and multiplayer are unchanged.

Both shared views accept an optional action transport. Solo provides its
revision-safe transport and single-flight guard; ordinary multiplayer uses the
existing transport unchanged. Solo character selection remains available while
multiplayer registration is closed, with a Chichimeca warning before claiming.
The solo ready stage offers Begin the adventure instead of waiting for a human
Marshal. Its status text never reports the internal Marshal as offline, and
skipped Azzardo is shown without a face-down placeholder. Home offers a new solo run and resume of the latest solo run.
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
interaction tests exercise the actual shared Lobby/Table callbacks: figure and
name/feature selection, Chichimeca warning, Deck and Vengeance actions, request
identity/revision, duplicate-click suppression, terminal calls to action and
post-scene choices. Multiplayer closed-registration and waiting behavior is
checked separately.

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

Associates stay in the fight after a failed exchange or a nonfatal wound. Only
success defeats the current associate and introduces the next one. Each new
associate receives a random ethnicity, gender, and feature from the player
character flavor data. This description is persisted across retries and reloads;
it grants no faction power and consumes no playing cards.

## Associate encounters and special completion

Each new associate receives a persisted encounter variant as well as their
ethnicity, gender and feature. Variants cover a debt collector in the arcade,
a rifle shooter on a balcony, a knife wielder by a water trough, and a rider
at the gate. Each has its own introduction, retry passages and three outcomes.
The next opponent gets a different variant from the preceding opponent;
failed or wounded exchanges preserve the current opponent and setting.
Older snapshots without a variant use a stable fallback derived from opponent
number, without drawing random content during reads.

The result page displays **A tale worth telling** when the run ends by exact-21
ascension or deck exhaustion and Opossum is dead. The server records
`opossum_hunter` on the ending and projects the authored `special_completion`
message. Death and endings before Opossum's defeat do not qualify. His defeat is
recorded after the duel is acknowledged, before its Reward is drawn, so a victory
or empty deck during that Reward draw still qualifies. The invitation to
multiplayer remains on the result page. No prize, redemption flow or QR code is
included; those can be agreed separately.

A higher completion tier, **The perfect last shot** (`opossum_finale`), replaces
the usual special panel when the run ends in Opossum's own successful, finalized
duel. This covers exact 21 from his Reward and deck exhaustion during its draw.
Runs ending later against associates retain **A tale worth telling**. This is
ending recognition only: it neither forces the adventure to end on his death nor
changes Rewards, wounds, or deck rules. Both tiers survive reloads.

## Contextual final scenes

Every obstacle and associate encounter has a separate `fatal_outcome`. When a
wound ends the run, the server records that scene's fatal text as
`ending_narrative`, ahead of the ordinary death summary. It describes the actual
trap, attack or accident and contains no next-step clue. Associate fatalities
use the current opponent's persisted encounter variant. The final scene appears
at the top of the shared result page, immediately and without typewriter
animation, followed by the mechanical result, recognition, invitation and actions.

Exact-21 endings before a personal kill close the hunt with a messenger reporting
Opossum shot and his accomplices arrested, with a chance to recover stolen goods.
If the player is already facing Opossum, arriving riders instead end that duel.
Neither epilogue changes `outlaw_defeated` or grants personal-kill recognition.
Later victories acknowledge the player's kill and the remaining accomplices'
capture. Endings on Opossum's own defeat retain **The perfect last shot**.
Deck exhaustion has its own survival epilogue for an unfinished hunt, a prior
personal kill, or a run ending on the kill itself.

The chosen ending narrative is saved with the terminal state so a reload does
not rewrite that run's conclusion. Legacy endings without this field derive a
compatible conclusion from their saved node, encounter and defeat flag. These
are narrative changes; the two-wound limit, Reward victory and finite-deck rules
remain unchanged.
