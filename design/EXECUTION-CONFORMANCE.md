# Execution conformance against native TAPAAL 4.0.4

Independent differential check of `src/app/core/timed.ts` and
`src/app/core/network-simulation.ts` against the released native model classes. Neither core
is wired into the UI for timed execution; this validates the engines only, not import/export,
UI or verification. The 15 + 17 unit tests are not counted as evidence here.

## Method

`scripts/native-reference/ExecutionReference.java` builds native `TimedArcPetriNetNetwork`,
`LocalTimedPlace`, `TimedTransition`, `TimedInputArc`, `TimedOutputArc`, `TimedInhibitorArc`
and `TransportArc` objects headlessly from the released `tapaal.jar` (4.0.4), then fires through
`NetworkMarking.fireTransition` (Oldest/Youngest firing modes, or an explicit token list for
manual selection) and delays through `NetworkMarking.delay`. No GUI or Animator is created.
Two Animator rules are reproduced in the harness and cited:

- Delay legality is `Animator.letTimePass` (`Animator.java:807`): zero always, otherwise
  `isDelayPossible` and no enabled urgent transition in an active template
  (`updateFireableTransitions`, `Animator.java:314-320`).
- Only transitions of active templates can be fired (`Animator.java:323`).

`scripts/check-execution-conformance.mjs` bundles both web cores with esbuild, runs every case in
`scripts/native-reference/scenarios.txt` through the web engines, runs the same file through the
Java harness, and compares the observation streams line by line (enabled sets, delay
legality, fire success/failure, and per-place multisets of exact token ages). It also asserts
web-only properties that need the native GUI to observe (see below).

Harness artefact found and corrected: the native constructor
`TransportArc(source, transition, destination, interval, weight)` passes null expressions, and
`createNewInputArcExpression` then resets the weight to 1 (`TransportArc.java:31-56,203,212`).
`TapnXmlLoader.java:1039,1083` passes expressions, so loaded models keep their weight when expressions are present. Files without transport expressions reset the weight to 1; the later native file-IO check reproduced this interoperability defect (TV-1 in TIMED-UI-VALIDATION.md). The
harness sets the weight explicitly after construction. That harness setup issue is separate from the subsequently reproduced web export defect; the export now includes native expressions (see the TV-1 owner follow-up).

## Result (2026-10-29)

**124/124 native and web observations agree across 19 scenarios; 3/3 web properties pass; 0
divergences.** HEAD `28c9bd917` source matches the 4.0.4 binary for every method used; no
version difference was observed.

Sensitivity check: six deliberately broken copies of the cores (in `/tmp`, production
untouched) were each detected: inclusive open lower bound (1 divergence), ignored transport
destination invariant (6), ignored urgency (7), `<=` inhibitor threshold (6), swapped
oldest/youngest (1), and inactive components composed (3).

| Scenario                                                  | Native behaviour confirmed                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `endpoints`                                               | `[1,3)` vs `(1,3]` at ages 1, 2.5, 3, 3.0001                                                                          |
| `exact-decimal`, `strict-invariant`                       | `0.1+0.2+0.7` reaches `<=1` exactly; `<1` blocks reaching 1; `1e-10` overshoot blocked                                |
| `empty-place-invariant`                                   | empty `<=0` place never blocks; fresh age-0 output into `<=0` blocks positive delay                                   |
| `oldest-youngest-weighted`                                | per-arc eligibility filter before ordering; weight 2 consumption                                                      |
| `manual-weighted`                                         | ineligible, short, duplicate selections fail atomically; legal pair fires                                             |
| `transport-destination-invariant`                         | destination invariant filters transport input; ordinary output to same place is not checked                           |
| `transport-weighted-identity`, `-filter-by-destination`   | ages preserved; output half not duplicated; weight 2 moves exactly two tokens                                         |
| `urgency`, `urgent-enabled-by-inhibitor`, `urgent-source` | enabled urgent blocks positive delay, zero delay allowed; disabled urgent does not block                              |
| `source-transition`, `selfloops`                          | input-free transitions enabled; ordinary selfloop resets age; transport selfloop keeps it                             |
| `inhibitor-threshold`, `inhibitor-below`                  | strict `count < weight`, independent of token ages                                                                    |
| `multiple-inputs`                                         | all inputs simultaneously; two transitions sharing a source fire sequentially                                         |
| `network-active-only` (untimed)                           | repeated names in three components; inactive excluded from enabled and firing; firing one component leaves the others |

Web-only properties (no headless native API): untimed network engine rejects a timed type flag
rather than normalizing it; firing never mutates the source document and reset restores the
initial snapshot; `TimedSimulation` forward replays the stored snapshot, a new action after back
truncates the future, and a failed fire leaves history intact.

## Findings

No correctness divergence was found within the tested bounds. Source-reading notes for owners
of adjacent work (none require a change to the execution cores):

1. **Decimal bounds are a web superset (persistence, low).** Native interval and invariant
   bounds are integers or integer constants: `TimeInterval.parse` uses `Integer.parseInt`
   (`TimeInterval.java:111-150`), and `TimeInvariant.isSatisfied` compares against
   `upper.value()` as an `int` (`TimeInvariant.java:37-43`). `validateInterval` accepts
   `{lower: '0.5', ...}`. A timed adapter must not save such a model as a native TAPN; it should
   reject or never construct non-integer bounds. Delays and ages may be decimal in both.
2. **Initial ages (persistence, corrected by owner).** Tokens default to age 0, but the current
   repository loader then applies optional `initialMarkingAge/token` records
   (`TapnXmlLoader.java:765,784-831`). The writer preserves nonzero ages and omits zero ages
   (`TimedArcPetriNetNetworkWriter.java:602-628`). An adapter must preserve those records,
   supplying age 0 only for unspecified tokens. The earlier note inspected token creation
   without the following age application. This differential harness does not test file IO or
   establish whether the released 4.0.4 loader supports that extension. The later file-IO check
   confirmed that 4.0.4 ignores the extension and resets those ages to zero (TV-3 in
   TIMED-UI-VALIDATION.md).

3. **Inactive components during simulation (presentation, informational).**
   `NetworkMarking.delay`/`clone` copy only active templates (`NetworkMarking.java:70-72,133-137`),
   so native drops inactive markings after the first step and restores them on exit
   (`Animator.storeModel`/`restoreModel`). The web engine reports inactive components at their
   initial marking. Semantics are identical; only the projection differs.
4. **Failed action after back (intentional deviation).** Native `fireTransition` and
   `letTimePass` call `clearStepsForward()` before attempting the action
   (`Animator.java:749-751,802-804`), so a blocked delay can clear the forward side-panel entries.
   The web cores change nothing on failure. Not reproduced at runtime (requires the GUI).
5. **Documented limits, confirmed by source, not bugs:** default firing mode is Random natively
   (`Animator.java:182`) vs oldest on the web; future delay-enabling intervals
   (`TimedTransition.calculateDInterval`) are not ported; 100,000 explicit-token and 256-digit
   caps have no native counterpart; inhibitor arcs with a nontrivial interval and urgent inputs
   with intervals are rejected rather than executed, matching native editor rules
   (`TAPNTransitionEditor.java:36-37`). Parallel arcs between the same place and transition are
   rejected natively (`TimedArcPetriNet.java:176-177`), which confirms the web's
   no-competing-bindings assumption.

## Tested bounds

Covered: single-component timed nets with integer bounds, decimal delays and ages, weights 1-2,
open/closed endpoints, invariants `<N`, `<=N`, `<=0`, `inf`; oldest, youngest, and manual
selection; disjoint untimed networks with active/inactive components and repeated names.

Not covered: random selection (native uses `Math.random`), weights above 2, constants, shared
places/transitions, timed multi-component networks, native trace/history navigation at runtime,
file import/export, UI wiring, and future-enabling display. Manual selection in the harness
picks tokens by place and age, since native tokens have no identity; identity preservation is
checked through age preservation and web-side IDs.

## Reproduce

Requires Java 17 and the released jars. From `web`:

```sh
TAPAAL_LIB=/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib \
  node scripts/check-execution-conformance.mjs /tmp/tapaal-exec-conformance
```

Exit status 1 on any divergence or failed property; full observations in
`/tmp/tapaal-exec-conformance/results.json`. The run takes a few seconds and starts no server.

Owner rerun: the unchanged differential harness again passed **124/124 observations** and
**3/3 properties**, with evidence at `/tmp/tapaal-exec-conformance-owner/results.json`.
No production core changes were required.
