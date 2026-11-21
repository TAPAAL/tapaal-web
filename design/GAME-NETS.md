# Uncoloured game nets: authoring, files and manual exploration

Implemented against baseline `4677c9a20` on 2026-11-01. Native Java and example resources remain read-only. This extension supports timed and untimed uncoloured games; it does not implement strategy synthesis, adversarial scheduling, query execution or verification.

## Source-backed semantics and interface

`TimedTransition.isUncontrollable` and `SharedTransition.setUncontrollable` establish the actor vocabulary and cascading behavior. `TapnXmlLoader` reads exact `player="1"` as uncontrollable; `TimedArcPetriNetNetworkWriter` writes player 0/1. Controller is the native default. The editor conservatively rejects other player spellings rather than silently interpreting them. `TimedTransition.isEnabledAlone`, synchronized enabling, and Animator's `letTimePass` use the existing token/interval/invariant/urgent predicates independently of actor. Manual exploration can choose either actor. Native transition drawing leaves Environment transitions unfilled, with a separate shared outline and urgency dot; the web uses a hollow Environment transition with a solid outline, independent shared outline and existing urgency label, plus actor text in accessible descriptions.

The authoritative V3 `SharedSource` is extended compatibly with a closed `TransitionActor` union (`controller | environment`) on local `LocalNode` transitions and on `SharedTransition` pools. Omission means Controller. No `NetNode` change broadens the scalar V1/V2 readers. Shared occurrences remain geometry-only: actor and urgency have exactly one global authority. Place actors, actors outside games, unknown roles, and actor fields on members are refused, including inactive locals and unused pools. Existing nongame source and JSON defaults stay unchanged. V1/V2 imports still cross their original strict readers first.

`transitionActor` resolves a source binding. `setActor` changes it atomically, cascading through global ownership rather than copying fields into members. `localActorEdit` combines the properties edit and actor choice into one snapshot. It validates its closed command shape and transition target. Existing expected-source/history/ABA handling applies; default-Controller role commands are no-ops. Make Shared transfers the local actor; Use Pool requires explicit adoption if actor or urgency differs; Detach copies source role and urgency. Component copy preserves local roles and global memberships. Ordinary geometry, node creation, arc editing and deletion retain source roles; new transitions default to Controller. Query symbol protections remain unchanged, while actor values can change like other semantic values. Opaque queries are never rewritten or executed.

The private structural validator removes actor fields only from its validation projection, after original source actor/type validation. The public source, snapshots, save checkpoints, views and simulation revision keep `game: true`. Scalar execution and file interfaces still reject games. `numeric` explicitly refuses them; `displayNumeric` is a disposable canvas projection, retains the public game flag so scalar engines still refuse it, and cannot be used for execution or saving.

## Files and execution

`shared-files.ts` validates original native player values and root/member metadata consensus before making its private scalar inspection clone. The adapter retains the original game feature and local/pool actors in the resulting source. Probability, distribution, nondefault firing mode, colour and stochastic metadata still pass strict existing gates. Native writing projects player 0/1 onto local transitions, root declarations and matching members, restores `isGame=true`, then reparses and compares game type, actors, IDs/name correspondences, timing/constant bindings, membership, geometry and saved queries. JSON preserves source identity. Existing transport ambiguity and 4.0.4 initial-age IO warnings remain unchanged.

`DocumentSimulation` always dispatches games, including games with no pools, to `SharedNetworkSimulation`. Its private token-engine model is actor-neutral; the adapter's captured source, actor lookup, role-labelled history and UI choices retain game meaning. A synchronized event appears once and checks all active members atomically. Inactive-member constraints and wholly inactive events retain existing behavior. Oldest, Youngest, Random and Manual share the same legality path and qualified token bindings. Back/Forward replay stored states; initial-source saves never store a runtime marking. Source/type/role edits invalidate a run through the existing source revision checks. Component switching retains it. Game Step/Fire requires a selected transition instead of silently choosing the first event; Forward may replay an existing step.

New model offers a Players choice alongside Timing. Local and global transition properties offer Controller/Environment with native controllability labels. Canvas accessible descriptions and the enabled list identify actors. Simulation explicitly states: “Game: manual exploration; strategy synthesis/verification unavailable.”

Game subnet clipboard transfers are deliberately refused before payload creation or system writes/cut/duplicate mutation. Component copy remains usable and preserves roles/memberships in one undo. Existing nongame clipboard formats and behavior remain unchanged.

## Examples and gaps

`package-delivery.tapn` opens unchanged through the normal gallery and preserves its opaque queries and roles in JSON and native saves. All 29 bundled originals remain byte-identical, as checked by `examples:update` and `examples:check`. Catalog status is now **19 openable / 10 gated** after [arc-label offsets](ARC-LABELS.md).

- `untimedGame.tapn` retains `nameOffsetX="23"` on `I4` in `injection_components`.
- `game-harddisk.tapn` retains `nameOffsetX="-7"` on `A2` in `harddisk_drive`.
- Both originals open unchanged; no semantic gates were weakened. ERK's duplicate A43 ambiguity remains separate.
- Colour, stochastic models, game strategy synthesis/verification, native game clipboard interchange and full desktop GUI parity remain gaps.

## Validation

The game-specific unit file covers both timing lenses, no-pool actor-aware execution, all-controller game retention, role-only history/no-op/staleness, make-shared/adoption/detach, strict actor fields, component-copy/clipboard, native player negatives and root/member mismatch. Existing app game-refusal cases were replaced with positive game choice/replay coverage; coloured/stochastic refusal tests remain.

`GameTransitionReference.java` and `check-game-transitions.mjs` compare released 4.0.4 model execution with the web adapter. They construct Controller and Environment transitions, exercise cascading role setters, enabled AND disabled synchronized urgency, ordinary/transport arcs, weights and inactive members, and token policies. Native delay uses actual `NetworkMarking.isDelayPossible` and delay on local-place networks. The Animator conjunction is reconstructed headlessly; the original GUI Animator is not executed. These are source/runtime semantics checks, not native nonzero-age file IO evidence.

Historical native gates passed: 124 native/web execution observations; 12 timed cases/213 observations; 79 shared-place cases/1,343 observations; 24 synchronized cases/282 native assertions. The shared-place harness retains its documented GUI-dependent delay substitution.

Browser tools returned `available:false`; real-input Playwright used the supplied Chromium/core paths. `scripts/check-game-ui.mjs` passed 27 assertions for gallery import, properties/undo, Controller and Environment fire (including Manual), Back/Forward, JSON/native download and file-input reopen, initial-source saves, atomic clipboard refusal, the two precise catalog gates, global pool actor editing, geometry-only members, one synchronized manual event across component views, frozen inactive members, New timed game and legal delay. Evidence is `/tmp/tapaal-game-ui-final/{game-roles,game-simulation,game-shared-marker,new-game}.png`. Browser state inspection is read-only. Temporary servers are agent checks, not a user demo, and are stopped before handback.

Final full suite: **1,078 tests / 48 files**. Typecheck and formatting pass. Production/development builds pass with existing warning thresholds unchanged (500 kB initial / 20 kB app.css); the production initial size is 687.37 kB and app.css 20.31 kB. The final released-native game probe passes **56 cases / 1,056 native assertions**, including Random with all eligible tokens consumed so nondeterministic choice cannot invalidate the comparison. No PR, push, deployment, subagent or user demo was created. Parent independent review remains outstanding.

Historical real-input browser checks also passed on this implementation: native core **16/16** (`/tmp/tapaal-game-native-core`); shared transitions **14 assertions** (`/tmp/tapaal-game-shared-ui`); timed UI **20 scenarios / 139 assertions** (`/tmp/tapaal-game-timed-ui`); symbolic clipboard **18 scenarios / 207 assertions** (`/tmp/tapaal-game-symbolic-clipboard`); all **17** supported gallery originals native-save/reopened, including package-delivery, with modal/fetch/focus checks (`/tmp/tapaal-game-gallery-review`). An initial shared browser invocation used the wrong working directory and stopped at its fixture path; rerunning it from the repository root passed without changing the harness or product. Early new-harness failures were DOM-settling/host-visibility synchronization issues; the final harness waits for the real token-picker form.

Changed paths, relative to the repository root:

- Core: `web/src/app/core/authored-shared.ts`, `model-types.ts`, `shared-files.ts`, `shared-network-simulation.ts`.
- Workspace/UI: `web/src/app/editor-workspace.ts`, `timed-ui.ts`, `constants-editor.ts`, `app.ts`, `app.html`, `document-dialog.ts`, `element-dialog.ts`, `shared-transitions.ts`.
- Tests: `web/src/app/core/game-nets.spec.ts`, `web/src/app/app.spec.ts`.
- Evidence harnesses: `web/scripts/check-game-ui.mjs`, `web/scripts/native-reference/GameTransitionReference.java`, `web/scripts/native-reference/check-game-transitions.mjs`.
- Catalog/docs: `web/src/app/example-catalog.json`, `web/README.md`, `web/NATIVE-PARITY.md`, `web/design/GAME-NETS.md`.

Final release validation repeats the full 1,078-test suite, typecheck, formatting and production/development builds after the public display-lens defense. The final 27-assertion game browser run uses those built assets. All owned browser contexts/tabs and managed servers were closed/stopped; no demo remains.

Implementation commit: `84621ba63a42ecbab125adccd6843ae25a774ea8`. A following documentation-only commit records this SHA and final validation.
