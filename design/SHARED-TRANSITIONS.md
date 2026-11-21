# Synchronized shared transitions

Implementation dated 2026-11-01, based on `63cdb415e1da91d62862af917649b5129d13cbd2` and the wave-2 contract in [SHARED-ELEMENTS.md](SHARED-ELEMENTS.md). This is bounded uncoloured, nongame, nonstochastic timed/untimed support. Existing native Java and resource files are unchanged. No PR, push, deployment or user demo is part of this work.

## Source, commands, history and schema

`src/app/core/authored-shared.ts` extends the existing authoritative module:

- `SharedTransition` owns stable `id`, global `name`, and boolean `urgent`. An untimed pool must be nonurgent. No member owns duplicated semantic fields.
- `SharedOccurrence.kind` accepts place/transition, and transition geometry can retain `angle`. References are kind-checked. Pool IDs and global names are unique across both kinds, including unused pools and inactive components. Each component has at most one occurrence per pool.
- `SharedEdit` adds `createTransitionPool`, `editTransitionPool`, `deleteTransitionPool`. Existing `makeShared`, `usePool`, `detach`, `addOccurrence`, `removeOccurrence`, `copyComponent` and `patchGeometry` retain their interfaces and now handle transitions. Adoption of differing urgency requires explicit acceptance. Detachment copies source urgency, preserves local identity/geometry/arcs, and validates the fresh local name. Removal cleans incident transport pairs.
- `validateSharedSource` rejects every shared-transition/shared-place arc, in every component, including ordinary inputs/outputs, inhibitors and both transport endpoints. Conversion, local edits, paste, file import and forged simulation revisions cross this same check. Invalid native mutator-bypass topologies are never compiled or approximated by summing weights.
- Urgency validation projects source urgency solely into the existing scalar structural validator. All member guards and transport destinations are checked, including inactive members. The existing symbolic urgent-input gate remains intact. Local geometry/arc edits and constants retain authored terms through the existing sentinel adapter.
- The existing single V3 whole-source snapshot/history remains authoritative. Expected-source identity, stale edits, undo/redo, dirty/saved checkpoints and no-op behavior keep the existing document discipline. No second pool history is introduced.

This is an explicit compatible extension of V3's previously reserved `shared.transitions` array. Old V3 with empty transitions still validates unchanged. V1/V2 still pass their old exact schemas before migration; a V2 shared field is rejected. JSON preserves exact source IDs and protections. The existing `protectedSharedPlaces` query interface remains place-only; optional `protectedSharedTransitions` protects captured transition declarations, including unused pools. The field is emitted when transition pools exist. Existing component-symbol and membership protections also protect conversion/detachment and local original symbols. Explicit query removal is undoable; rename/delete does not rewrite opaque query text. No implicit flattening or downgrade is offered.

## Execution and provenance

`src/app/core/shared-network-simulation.ts` extends its private compiler. Every active occurrence in a transition pool maps to one physical transition. Component-local places remain disjoint, and every arc has a qualified physical ID. The existing engine therefore checks all member inputs as one conjunction and publishes one atomic firing. Inactive members do not constrain enabling, consume tokens or produce tokens. A pool with no active member has no event or urgency blocker; the native all-inactive vacuous predicate is deliberately not exposed as a selectable event.

`mapping.toPhysical` and immutable `mapping.occurrences` expose many-to-one provenance without exposing an executable projection. `enabled` lists one canonical qualified reference per event; `enabledFor` highlights all active members. Any active member can dispatch the same event. Trace labels use the captured global name and active component names. Source events with no marking effect still record once.

Manual shared-event inputs retain qualified arc keys and member references, so identical local arc IDs never collide. The picker names component/place/local arc, while local-transition bindings retain their old interface. Oldest, Youngest, Random (default) and Manual use the same engine path. Transport token identity/age, inhibitors, capacity checks and atomic failure/replay remain existing engine behavior. Back/Forward use stored states. The callback reentrancy guard and captured firing references remain in place. A dedicated regression proves that an opaque local arc ID resembling a compiled key still uses the local binding interface, rather than colliding with another member.

`src/app/timed-ui.ts`, `editor-workspace.ts` and `app.ts` dispatch through this adapter without flattening source. Physical transition counts count a shared pool once; occurrence counts and active-member labels remain explicit.

## Codecs and UI

`src/app/core/shared-files.ts` validates original root declarations and member repetitions before constructing disposable scalar inspection projections. Native declarations must be direct unprefixed root children in the accepted namespace. Native membership uses the matching global name of the correct kind; local arc endpoints remain local wire IDs. Root/member urgency, player, probability weight, distribution/value and firing-mode metadata must agree after defaults. The existing scalar inspector then refuses unsupported semantic values; nondefault native firing modes remain gated rather than discarded.

Native export emits one XML declaration, source-owned root urgency and matching member projections. Reparse verification compares shape-aware constant/component/pool correspondences, membership, geometry, timing terms and opaque queries. JSON is identity-preserving; native pool IDs are allocated deterministically by declaration order and compared by explicit name correspondence. Saves use initial source, never runtime marking. The visible 4.0.4 nonzero-initial-age warning is retained; this work makes no native age-file-IO claim.

`src/app/shared-transitions.ts` contains the focused pane, pool/occurrence dialog and draft-to-command adapter. It supports unused creation/deletion, rename/urgency, explicit adoption and safe detach. Local transition properties enter sharing. Shared-occurrence properties edit global semantics through the pool; rotation/routes stay local. The dialog traps focus, handles Escape, restores focus and rejects stale workspace drafts. Shared transition urgency is read from the pool for canvas/inspector display.

The unchanged train-level-crossing, workflow-advanced, workflow-complaint and workflow-medical examples now open. Their focused tests preserve query XML/constants and native save/reopen meaning, and reach a synchronized firing through legal local actions/delays. All 29 catalog originals remain byte-identical. Catalog status becomes 16 openable / 13 gated. `untimedGame` remains game-gated; ERK's ambiguous duplicate A43 remains a separate gap. Colour, game, stochastic semantics and verification are not enabled.

## Validation and bounded claims

New tests are in `core/shared-transitions.spec.ts`, `core/shared-transition-demos.spec.ts`, and `shared-transition-dialog.spec.ts`. Existing malformed-transition negatives now test closed-schema failures, alongside positive support coverage. Existing scalar public codec refusal tests remain unchanged because those entry points still do not opt into sharing.

- Final full suite: **1,029 tests / 46 files passed**. Application typecheck, formatting, production and development builds passed on the final implementation.
- Production/development builds, application typecheck and formatting passed. The 500 kB initial / 20 kB component-style warning limits remain unchanged; the existing app.css warning remains. No budget is raised.
- `npm run examples:update` and `npm run examples:check` passed; only catalog metadata changes, with source/copy byte checks for all 29 originals.
- `scripts/native-reference/check-synchronized-transitions.mjs`: 24 released-native/web differential cases agree, with 282 actual native assertions. Cases cover local physical inputs, two active/one inactive members, weights 1/2, ordinary versus transport production, Oldest/Youngest/manual binding and source-urgency propagation. This is an assertion harness over real 4.0.4 model classes, separate from the design observation printer. It does not substitute a delay predicate or claim native GUI/file-age parity.
- Existing native regressions rerun: 124 native / 124 web disjoint observations, 12 timed cases / 213 observations, 79 shared-place cases / 1,343 observations; all passed. The pre-existing shared-place harness substitutes only the GUI-dependent delay predicate and checks native invariants/urgency independently, as its report already documents.
- `scripts/check-shared-transitions-ui.mjs` passed **14** real-input browser assertions, including rejected-draft retention, a noncanonical member canvas click, and native query-protected transition rename refusal: pool membership/counts, global rename, JSON source save, one enabled event, qualified manual groups, one atomic history entry across views, frozen inactive locals and unchanged train demo import. App Angular state is read only. Preview returned `available:false`; Playwright used the explicitly supplied Chromium/core paths. Screenshots: `/tmp/tapaal-sync-final-evidence/synchronized-pane.png`, `synchronized-manual.png`, `train-shared-demo.png`.

All temporary worker jobs are managed and agent-owned servers must be stopped before handback. No manual-verification environment is left running. Independent parent review follows this implementation; these observations do not claim complete native replacement or GUI parity.

## Final evidence and file inventory

Production initial size is **676.92 kB** (161.63 kB estimated transfer); the existing warning thresholds remain 500 kB / 20 kB. `app.css` remains 20.31 kB with its existing warning. These are successful builds with warnings, not a claim of meeting the warning budgets.

Historical real-input browser checks passed on the implementation: native core **16/16**, documents **16/16**, constants **17/17**, shared-place review **15 scenarios / 115 assertions**, timed UI **20 scenarios / 139 assertions**, and example-gallery smoke. Evidence directories are `/tmp/tapaal-sync-final-native-core`, `-documents`, `-constants-ui`, `-shared-places-review`, `-timed-ui`, and `-example-gallery`. The all-openable gallery review additionally passed initial-network native save/reopen for **all 16** supported originals plus modal/fetch/focus checks; evidence is `/tmp/tapaal-sync-final-gallery-review`. The final focused synchronization browser evidence is `/tmp/tapaal-sync-final-evidence`. Earlier historical runs preceded the isolated rejected-draft/opaque-key fixes; the final focused browser and full unit/native suites include those fixes.

Managed workload admission refused two final validation attempts while other sessions reserved memory. They were retried at the same reservation after capacity was released. No other session's workload was stopped and no admission limit was bypassed. All owned browser jobs completed; the evidence server was explicitly stopped before handoff. No user environment remains.

Exact changed paths (relative to the repository root):

- `web/NATIVE-PARITY.md`
- `web/README.md`
- `web/src/app/app.html`
- `web/src/app/app.ts`
- `web/src/app/core/authored-shared.spec.ts`
- `web/src/app/core/authored-shared.ts`
- `web/src/app/core/shared-files.ts`
- `web/src/app/core/shared-network-review.spec.ts`
- `web/src/app/core/shared-network-simulation.spec.ts`
- `web/src/app/core/shared-network-simulation.ts`
- `web/src/app/document-dialog.ts`
- `web/src/app/editor-workspace.ts`
- `web/src/app/element-dialog.ts`
- `web/src/app/example-catalog.json`
- `web/src/app/timed-ui.ts`
- `web/design/SHARED-TRANSITIONS.md`
- `web/scripts/check-shared-transitions-ui.mjs`
- `web/scripts/native-reference/SynchronizedTransitionReference.java`
- `web/scripts/native-reference/check-synchronized-transitions.mjs`
- `web/src/app/core/shared-transition-demos.spec.ts`
- `web/src/app/core/shared-transitions.spec.ts`
- `web/src/app/shared-transition-dialog.spec.ts`
- `web/src/app/shared-transitions.ts`

Implementation commit: `86af402fa0831dd265289fe253f0e6a7377527ff` (all functional changes, focused tests, native/browser harnesses and initial report). A following documentation-only commit records this hash and refreshes module header comments. No PR/push/deploy was performed.
