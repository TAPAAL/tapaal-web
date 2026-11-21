# Independent review: uncoloured game nets + arc-label offsets

## Owner follow-up

F1–F3 are fixed. The urgency helper removes the actor from the scalar edit payload;
the existing shared transaction restores the source role. Its original proof is
now a positive regression for Environment and native-reopened Controller nodes,
including one history entry and preservation of the game lens. Simulation renders
status notices, so unselected game Step/Fire explains the required choice. Adoption
text names both urgency and player in games; refusal messages use user-facing
wording rather than `acceptPoolValues`.

Owner checks on the corrected source: **1,107 tests / 50 files**, typecheck,
formatting, development and production builds pass. Initial bundle is **689.82 kB**,
App CSS **20.31 kB**, with unchanged warning thresholds. The updated review browser
harness passes **38 assertions**, including the inverted F2/F3 regressions;
evidence is `/tmp/tapaal-game-label-fixed-browser/results.json`. A separate fresh
label run passes **17 assertions** and writes
`/tmp/tapaal-final-label-probe/labels.tapn`. Including that regenerated one-arc file
with the two original games, the released loader/writer offset probe passes
**88 arcs**. Without that optional file the original pair covers **87 arcs**.

Native evidence wording remains bounded: the game harness compares 56 final
markings; the 1,056 count includes internal Java assertions, and urgency/delay are
checked separately on each side. Offset checks establish loader/writer
preservation, not native Swing pixel layout. No fresh native-execution rerun is
claimed for these helper/copy fixes. All owner browser/server workloads completed
and cleaned up. This follow-up is owner verification; the independent verdict and
its exact reviewed head below remain distinct.

Reviewer: Opus 5.5 (high), independent of the implementation. 2026-11-01.

- Review head: `4312dce7522e4627b8e4cf979885e00521ab6861` (docs-only on top of the implementation).
- Baseline: `4677c9a20` (synchronized transitions, previously approved).
- Commits under review: game `84621ba63` and arc labels `bae4a27e776824409262980e6315b185a842deaa`.

Production code, existing tests, docs, harnesses, native Java and example resources were read-only. The only new files are this report, `src/app/core/game-label-review.spec.ts` and `scripts/check-game-label-review-ui.mjs`. Nothing was committed, pushed or deployed. No subagents or user demo were used.

## Verdict

- **CODE: APPROVE.** One low-severity, fail-closed API defect (F1) is not reachable from the current UI. No data-corruption, flag-flattening, role-loss or label-offset loss path was found.
- **UI/UX: REQUEST CHANGES (minor).**
  - F2: the game-only "choose a transition" guidance is never rendered, so an unselected Step/Fire silently does nothing.
  - F3: the adoption copy in game models mentions urgency but not the player it also adopts.

  Both are small copy/feedback fixes; neither affects semantics.

## Findings (each has an unskipped reproduction; invert the assertion after fixing)

| ID | Severity | Where | Repro | Impact | Minimal fix |
|---|---|---|---|---|---|
| F1 | Low (latent API) | `editor-workspace.ts` `setTransitionUrgent` (≈L535–545) | `game-label-review.spec.ts` "F1 reproduces". `setTransitionUrgent(doc,'e',true)` on a game transition with `actor` throws `Unknown or non-data field actor.` After native reopen, **every** local game transition carries an explicit actor (Controllers too), so the helper refuses all of them. | Fails closed and atomically. The UI urgency path uses the dialog's display node (actor stripped) and works (spec R3). Any future caller of this exported helper breaks on games. `setPlaceTokenAges`/`setPlaceInvariant` take places and are unaffected. | Strip the actor before the scalar command (`const { actor: _a, ...scalar } = element as LocalNode`). The `localEdit` merge already restores it. |
| F2 | Low–medium (UX) | `app.ts` `step()`/`fireSelected()` set `notice`. `app.html` footer renders `mode()==='Simulate' ? '' : notice()` (≈L1211). | Browser "F2 reproduces": with no selection, Step and Fire transition leave the cursor at 0. `notice()` is "Choose a Controller or Environment transition.", but the page text never shows it. No `role=alert`. | Two enabled buttons do nothing visibly in games. The documented contract ("Step/Fire requires a selected transition") is implemented, but users get no feedback. | Render the game notice in the simulation group (`role=status`), or disable Step/Fire for games while no enabled transition is selected and explain why in the title. |
| F3 | Low (UX copy) | `shared-transitions.ts` use-pool checkbox "Adopt this pool's urgency if it differs". The create text says "Source urgency … transfers". Refusal text: "Pool urgency or actor differs; explicitly acceptPoolValues." | Browser "F3 reproduces" (dialog text captured in `results.json`). | In games the checkbox also adopts the pool's **player**, which the label does not say. The error exposes an internal field name. Semantics are correct: refusal without adoption is atomic and the pool role wins. | Game-conditional copy: "Adopt this pool's urgency and player if they differ", "urgency and player transfer". Use a user-facing error. |

## Semantics and code: verified

**Source model and actor ownership**

- `TransitionActor` is closed, on `LocalNode` and `SharedTransition` only.
- `validateSharedSource` refuses actors outside games, on places, on members, with unknown or cased spellings (`'Environment'`, `'__proto__'`), via accessors or prototype inheritance, and on inactive locals or unused pools (spec R6).
- `transitionActor` resolves members through the pool, giving one global authority.

**Atomic edits and history**

- `setActor` and `localActorEdit` are single-snapshot edits. A name+actor change is one history entry and one undo (browser).
- A no-op Controller command returns the same document.
- `localActorEdit` refuses members and a spoofed transition kind on a place (R7). Stale-revision guards still apply.

**makeShared, usePool and detach**

- makeShared transfers the local role.
- usePool refuses a role or urgency mismatch unless adoption is explicit, and the pool role wins (spec plus browser).
- Detach copies the global role (browser, Environment).

**Role preservation through other edits**

- Component copy preserves roles.
- Scalar edits (`patchNet` geometry, deletion, UI property edits) restore local actors through the `localEdit` merge (R2, R3).

**Flag flattening**

- `game:false` appears only in private projections: the validation projection, the scalar inspection clone in `parseSharedTapn`, the writer's scalar serialization (then re-stamped), the private simulator model, and `displayNumeric`'s internal resolve.
- `displayNumeric` returns `type.game:true`, and `DocumentSimulation(displayNumeric(...))` refuses. `numeric` throws (R8).
- Clipboard copy, paste, cut and duplicate are gated before any write. In the browser the refusal is atomic and specific.
- V1/V2 games still fail through their original readers. V3 is the only game JSON path.

**Native files**

- Player is read from the original document before the clone. Root and member consensus compares `player` with urgency and the other metadata (`wireSemantics`).
- Probability, distribution, firing-mode, colour and stochastic gates are unchanged.
- The writer stamps `isGame` and players on locals, root declarations and members. Reopen verification goes through `meaning()`, which normalizes actors and arc offsets, not numeric equality.
- Roundtrips keep pool actor, urgency, constants, geometry-only members and offsets (R5).
- The three originals keep their role multisets and queries (R11, and the browser after a simulation step).

**Execution**

- Legality is actor-agnostic. Games always dispatch to `SharedNetworkSimulation`.
- The enabled list labels actors. Back/Forward replay stored states.
- A role edit invalidates the run (browser: cursor back to 0).
- Saves from Simulate write the initial source, not the runtime marking (all three originals).

**Arc labels**

- `Arc.nameOffsetX/Y` are optional, finite, within ±1e6, and omitted when zero.
- JSON keeps fractions exactly. Native export of fractions refuses, including for games (R4: no silent truncation).
- Native import pairs the two attributes like `TapnXmlLoader` (one attribute alone gives 0,0), and the strict reader refuses fractions (R10).
- `geometryPatch` carries offsets while weights, constant refs, actors, urgency and membership come from source (R2, browser).

**Conservative native divergences (declared, acceptable)**

- Native `parseFeature` infers `isGame` from active uncontrollable transitions when the attribute is missing. Native also treats any player other than `"1"` as Controller.
- The web refuses both cases rather than guessing (R9). This never mis-assigns a role.

**Arc-label anchoring truthfulness**

- Native `NameLabel` places the text box's **right** edge at the label x and its top at y−12, after `Grid.align`. The web keeps its pre-existing centred text with the baseline at midpoint.y−12, then adds the same stored offset.
- For identical stored offsets, a web label therefore sits about half its text width to the right of native and about one text line higher, without grid snap.
- The same shift already applied at zero offset before this change. Stored values are exact and relative displacement is preserved.
- This is a declared, bounded font/layout adaptation, not data corruption, and `ARC-LABELS.md` states it truthfully. It does not contradict the file-position contract (relative to the native polyline midpoint), so I do not ask for a font rewrite.

**Cited native sources**

All cited native line ranges were checked against `src/main/java`: `Arc.java:147-153`, the `ArcPath` midpoint, `NameLabel` `updatePosition`, `Constants.NAMELABEL_OFFSET=12`, `TapnXmlLoader` 860–869/957–963, the `LabelHandler` drag, the writer's player and `isGame`, and `TimedTransitionComponent` uncontrollable fill. Nit: `ARC-LABELS.md` cites `handler/LabelHandler.java`; the full path is `pipe/gui/petrinet/handler/LabelHandler.java`.

## Reproduced claims (rerun by me at the review head)

**Unit suite and type/format checks**

| Claim | Result |
|---|---|
| 1,093 tests / 49 files | **Pass**: 1,093 / 49 before my spec; **1,107 / 50** with it |
| examples check | Included in the suite: pass |
| Typecheck (`tsc -p tsconfig.app.json`) | Pass |
| Formatting | Pass (`prettier --check src angular.json package.json tsconfig*.json`) |

**Builds**

| Claim | Result |
|---|---|
| Production build 689.68 kB, app.css 20.31 kB, budgets 500 kB / 20 kB unchanged | **Match**: same two existing warnings (output to `/tmp/tapaal-review-build-prod`, so `dist/` was not overwritten) |
| Development build | Pass (`/tmp/tapaal-review-build-dev`) |

**Native probes** (all under `worker-job`, with the released 4.0.4 library)

| Claim | Result |
|---|---|
| Native core 124 | **124/124**, 0 failures |
| Timed 12 / 213 | **Pass** |
| Shared places 79 / 1,343 | **Pass** (documented GUI delay-predicate substitution) |
| Synchronized 24 / 282 | **Pass** |
| Game 56 / 1,056 | **Pass** |
| Arc offsets 88 | **87** on the two originals. The claimed 88 includes a browser-written file passed as an extra argument, which I did not regenerate. |

**Catalog and assets**

| Claim | Result |
|---|---|
| Catalog 29 = 19 openable / 10 gated | **Match** |

- Gated: ERK (duplicate A43), seven coloured nets and two stochastic nets. None of the gated files are games.
- All 29 `sha256` values match both `src/main/resources/Example nets/` and `public/examples/`. The public folder has only the existing extra `LICENSE.txt` and `PROVENANCE.txt`.
- No resources were stripped. Native Java and resources are unchanged since the baseline.

**Evidence manifest**

- `/tmp/tapaal-arc-evidence.json` (sha `03e6a9f3…086e`): all 33 entries match the current files, including `dist/.../main.js` `c92392a6…9fc4`, which the browser review used.

**Not rerun by me**

- The implementer's own browser harnesses (17 label / 39 game assertions, native-core 16, timed 20/139, symbolic clipboard 18/207, 19-gallery native save/reopen).
- My independent browser harness covers the same risk areas listed under Browser review below. The rest remain the implementer's claims.

### Meaning of the native probes

**Game harness**

- It cross-compares **56 marking snapshots** (age multisets per component) between released 4.0.4 model classes and the web adapter.
- The 1,056 count is mostly **native-side** assertions: role-setter cascades, enabledness, urgency, and the actual `NetworkMarking.isDelayPossible`/`delay`.
- Urgency and delay legality are asserted independently on each side, not compared value by value. The Animator `letTimePass` conjunction (`isDelayPossible && !urgentEnabled`) is reconstructed headlessly; the GUI Animator is not executed.
- Every case is a timed synchronized pool with one inactive member. Local-only and untimed games are covered by unit and browser tests, not by the native probe.
- This is source-grounded, actor-agnostic legality evidence, not GUI parity.

**Arc harness**

- It proves that the native loader's offsets equal the file attributes under native truncation and pairing, and that the native writer→reader roundtrip keeps them.
- On its own it is not a web-vs-native comparison. Web agreement comes from the web native writer, unit reopen tests, and native acceptance of web-written files.
- It covers no nonzero-age file IO, Swing layout or synthesis.

## Browser review (real input)

`preview_status` returned `available:false`. Fallback: Playwright-core 1.63.0 with chromium-1248 at the supplied paths, headless.

- `scripts/check-game-label-review-ui.mjs` serves the manifest-verified dev bundle in-process inside one finite `worker-job` (1 GiB), so the server, browser and context end with the job.
- App state is read through `window.ng` only; there are no signal writes.
- `pointercancel` is the one synthetic event, because a real device cannot be scripted to cancel.

Result: **38 assertions pass** (36 behavioural plus the F2/F3 reproductions), with no uncaught errors. Final `results.json` sha `cbebdbbb…dbbb`; harness sha `ed2cad8c…7784`.

**Coverage**

- **New models:** both new game lenses (untimed and timed), plus a nongame default.
- **Role authoring:**
  - Environment shown in the dialog; name+actor edit is one undo.
  - Make Shared transfers Controller to a geometry-only member.
  - Use Pool refuses a role mismatch atomically, then explicit adoption succeeds.
  - A global pool role edit cascades to the canvas `aria-label`; detach copies Environment.
- **Simulation:**
  - The enabled list shows actor labels.
  - Unselected Step/Fire does not auto-fire.
  - A selected Environment transition fires through manual token choice; Back/Forward work.
  - A role edit invalidates the run.
- **Arc-label drag** on a constant-weighted arc:
  - At 100%: stored offsets equal the truncated total model delta, with one history entry. Constant weight, actor and game type are unchanged.
  - Escape and pointercancel restore the label with no history entry.
  - At 150%: offsets are unzoomed and truncated to integers.
  - Fit contains a far-moved label.
  - Native save and reopen keep the offset and the constant ref.
- **Clipboard:** in a nongame net, the web envelope carries `-17/9` offsets with the explicit desktop-unavailable notice, and paste duplicates them exactly.
- **Originals:** package-delivery, untimedGame and game-harddisk each open as games with Environment roles. Firing one step and then native-saving reopens to the initial source, roles, tokens and queries. A role change on query-bearing package-delivery keeps the opaque queries.

**Observations (not defects)**

- The Edit-mode selection carries into Simulate and its enabled row is highlighted, so Step fires that **visible** user choice.
- After firing, the selection persists while that transition is still enabled.
- Escape does not clear the selection in Simulate; clicking empty canvas does.

These are consistent with "no automatic choice".

**Screenshots** (`/tmp/tapaal-game-label-review-ui/`, sha256 prefix):

| File | sha256 prefix |
|---|---|
| `roles-shared.png` | `d34a0a0c` |
| `game-manual.png` | `7768abed` |
| `label-100.png` | `df7ff0e8` |
| `label-150.png` | `8027f833` |
| `label-fit.png` | `3f808ccc` |
| `original-package-delivery.png` | `541047f4` |
| `original-untimedGame.png` | `d8c22533` |
| `original-game-harddisk.png` | `1fdad405` |

They are deterministic across runs.

## Unit probes (`src/app/core/game-label-review.spec.ts`, 14 tests, sha `4960ba61…8260`)

| Probe | Checks |
|---|---|
| R1 | Single global authority |
| R2 | Label drag in a game keeps actor, urgency, membership and constant weight |
| R3 | UI-shaped edits and deletion keep actors |
| F1 | Repro |
| R4 | Fractional game offsets refuse native export, exact in JSON |
| R5 | Native game roundtrip |
| R6 | Hostile actor fields |
| R7 | `localActorEdit` member/kind spoofing |
| R8 | Public projections keep the flag |
| R9 | Conservative `isGame` inference |
| R10 | Paired/fractional native offsets |
| R11 | Three originals: roles, queries, simulation |

## Final gap list (bounded; not a feature wishlist)

1. Fix F1–F3 (each a one- or two-line change) and invert the three reproduction assertions.
2. Optional: regenerate the 88th arc-offset input or restate the arc claim as 87 on the originals plus web-written files; correct the `LabelHandler` path.
3. Declared and unchanged:
   - No strategy synthesis, verification or game query execution.
   - No native game clipboard.
   - The native label anchor/font/grid layout is not reproduced.
   - Native nonzero-age file IO caveat.
   - ERK A43 and coloured/stochastic gates.
   - No full desktop GUI parity is claimed.

## Cleanup

- `worker-job list` is empty. Each review job (vitest, native, builds, browser) was a finite `run` and has exited.
- No `start` jobs, servers, browser contexts or tabs remain.
- Temporary build outputs are in `/tmp/tapaal-review-build-{prod,dev}`. `dist/` was not modified.
