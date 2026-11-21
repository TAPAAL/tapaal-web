# Disjoint untimed network simulation

`src/app/core/network-simulation.ts` composes active components into a private P/T net and delegates firing and history to the existing `Simulation`. The app now uses this engine for every supported untimed document, including the single-component case. The document model and file adapters are unchanged.

## Native source basis and scope

The Java source in this repository is authoritative:

- `src/main/java/dk/aau/cs/verification/TAPNComposer.java`: `transformModel`, `createPlaces`, `createTransitions`, and arc creation iterate `activeTemplates()`, qualify local identities, and preserve arc weights. Native composition has separate shared-place and shared-transition handling.
- `src/main/java/dk/aau/cs/verification/NameMapping.java`: maps component/local identities to composed identities and back.
- `src/main/java/pipe/gui/petrinet/animation/Animator.java`: `updateFireableTransitions` visits active templates; `storeModel` and `restoreModel` preserve the initial marking; firing and backward/forward navigation operate on network marking history.
- `src/main/java/dk/aau/cs/model/tapn/NetworkMarking.java`: ordinary `fireTransition` clones the network marking and replaces only the fired transition's local marking. Shared firing follows a separate path.

This implementation covers **uncoloured, untimed, nongame, nonstochastic networks with no shared entities**. The original `timed`, `colored`, `game`, and `stochastic` flags must each be explicitly `false`. It does not normalize flags or infer execution support from editor capabilities. Adding timed editing or metadata elsewhere does not authorize this engine to execute a timed network. There is no delay/age API or shared clock; untimed transitions change integer counts only.

The current Network schema has no shared entities and the file adapter rejects native shared declarations. Repeated local names or IDs do not mean sharing. No places are fused and no transitions synchronize. Any future shared schema needs explicit validation and execution dispatch before it can reach this module. Likewise, future timing semantics must use an appropriate engine, not be represented as ignored optional decoration on an untimed graph.

One intentional distinction from the verification composer: local transitions with no arcs are retained. `TAPNComposer.createTransitions` removes orphan transitions and warns that this can change deadlock answers. Interactive execution retains the existing `Simulation` behavior: an input-free transition is enabled, including one that changes no marking. This module is not a verification export.

## Composition and mapping

`composeNetwork(network)` returns `{ net, mapping }`. Validation runs on every component, including inactive components, before composing. Local node names must still be valid and unique within their component. Names may repeat across components. The network must contain at least one active component, following `validateNetwork`.

Only active components contribute nodes, arcs and annotations. Array order follows component order, then local element order. A composed ID is the JSON encoding of `[componentId, elementId]`; it is collision-free even for delimiter-like strings, Unicode, or object-prototype property names. IDs remain stable across component reorder, activation of another component, or display-name changes. Composed node names use fixed-width UTF-16 encoding of that ID, yielding unique valid identifiers without relying on ambiguous name concatenation.

- `mapping.toComposed(componentId, elementId)` returns the composed ID, or `undefined` for an inactive/unknown element.
- `mapping.fromComposed(id)` returns a frozen `{ componentId, elementId }`, or `undefined` for an unknown ID.

Both directions include nodes, arcs, and annotations. Maps stay private; clients cannot corrupt them. The graph is a deep clone, so callers can mutate its geometry without touching the input. Node and arc extension fields, label offsets/visibility, transition angles, arc bends/curvature, annotations, weights and initial token counts survive. Endpoint IDs are rewritten; geometry stays in original component coordinates. This is an execution graph, not a flattened visual layout or save format. Network/component metadata and saved queries remain in the captured revision; they are not converted into flattened graph metadata or evaluated.

## Session and canvas API

`new NetworkSimulation(network)` captures a deep-frozen clone as `revision`, including optional metadata. Source edits after construction cannot change the session. A document revision change requires a new session; history is never silently migrated. The revision and source document's initial markings are never modified by firing, replay, navigation, or reset.

`enabled` returns frozen original transition references across all active components. `markingFor(componentId)` returns a frozen marking keyed by original place IDs; `enabledFor(componentId)` returns original transition IDs. These methods can feed the existing component canvas directly while it continues to render its original `Net`. Switching viewed component does not change the run. Inactive components show their initial markings and an empty enabled list, and attempts to fire them throw. Unknown components and nontransition IDs throw.

`fire(componentId, transitionId)` uses the existing weighted normal/inhibitor semantics. Inhibitors test strictly below their weight and never consume tokens. Consuming precedes producing, and unsafe integer results throw before changing marking or history. Firing one component leaves every other component unchanged.

`marking` and `trace` expose deep-frozen network snapshots keyed by original component/place IDs, including inactive initial markings. Each trace state has `{ transition, marking }`, where `transition` is an original element reference or `null` for the initial state. Previously returned snapshots remain unchanged as the session advances.

- `back`, `forward`, `cursor`, `canBack`, and `canForward` mirror the existing simulator; navigation does not truncate history.
- A successful firing after going back replaces the future branch. A failed firing leaves that branch intact.
- `step()` fires the first enabled transition in component/node order, or returns `null` at deadlock. `step(ref)` fires a particular original reference. There is no hidden random selection or delay.
- `replay(refs)` builds a new run from the captured initial state. It replaces the old run only after the entire sequence succeeds. Invalid references, disabled transitions, or count overflow preserve the old marking, cursor, and future history.
- `reset()` returns to the initial state and discards all firing history.

## Validation

`network-simulation.spec.ts` exercises duplicate local identities/names, stable mapping and unusual IDs, validation before name rewriting, inactive exclusion, geometry/extension cloning, explicit type rejection, independent enabled transitions, weighted and inhibitor firing, commuting local firings without a clock, immutable revision/history, navigation/branching/replay/reset, and atomic failures including safe-integer overflow. Focused Vitest, strict TypeScript checks, and Prettier checks require no running application or manual demo.

## Application integration

`app.ts` constructs `NetworkSimulation` before entering simulation, so its whole-network validation and explicit false type-flag requirement are the execution gate. The `documents.networkCapabilities` helper reports supported disjoint untimed networks as executable, including multiple components; the engine constructor remains the final validation boundary. The app does not normalize type flags or route timed execution to this engine.

The canvas keeps the original component net and uses `markingFor` and `enabledFor`-equivalent original-reference filtering for its viewed component. Enabled rows span active components, select their component view, and use original references when firing. Inactive views explicitly show initial markings and cannot fire locally; network Step/Fire controls can still fire an active component. Empty local enabled lists do not imply network deadlock. History rows use component-qualified transition names and full network marking tooltips, independent of the currently viewed component.

Component switching preserves the engine, history and cursor. Editing selections are stored before simulation and restored on exit; viewport navigation remains available. Document-tab switching, document creation/opening and tab closing deliberately exit the run. Execution actions and publication check document identity and the captured source revision; a changed revision ends the run rather than migrating history. Ordinary edits remain blocked during simulation. Saving updates the saved checkpoint from the original whole network without changing the simulation session or writing simulated tokens.

App regressions cover repeated local IDs and names, inactive exclusion, view projection and retention, qualified history, network navigation/branching/reset, whole-network initial-state saves, document/revision boundaries, preserved editing selection, and independent refusal of every unsupported type flag. No shared, timed, coloured, game or stochastic execution is enabled.

### Integration validation (2026-10-28)

- Full Vitest suite: **436/436** tests pass (including nine new app cases and the existing annotation preferred-height regression).
- Production and development Angular builds pass; source and documentation Prettier checks pass.
- Real Chromium network smoke check: **12/12** assertions pass using file upload and actual sidebar/component/control clicks, with app state read only. Evidence: `/tmp/tapaal-network-browser-check.mjs` and `/tmp/tapaal-network-browser-result.json`.
- Existing layout harness: **58/58** assertions across **7/7** scenarios pass, including narrowing annotations to width 40 with height 112. Evidence: `/tmp/tapaal-network-layout-check/results.json`.
- Existing native navigation/Quick Draw harness: **16/16** checks pass. Evidence: `/tmp/tapaal-network-core-check/results.json`.
- Existing document harness: **14/15** executed checks pass. T10 was excluded because it asserts that all multi-component simulation must be refused. T14 fails because it expects Ctrl+S in a focused inspector field to save; the existing app test `protects text focus from annotation/token/tool/save shortcuts` and the unchanged keyboard handler deliberately suppress that shortcut in text controls. This slice preserves that current behavior. Evidence: `/tmp/tapaal-network-document-check/results.json`. These two harness expectations need reconciliation by their owner; the harness files were not changed.

All workloads used `worker-job`. The temporary static server was stopped after browser checks; no manual demo was started or retained. No protected core modules, model-type rules, or file adapters were changed.

### Owner follow-up

Reconciled the document capability helper with supported multi-component execution. Updated
the obsolete T10 harness expectation to exercise a running network across view switches and
an inactive component. Restored Ctrl/Cmd+S outside modal dialogs even when an inspector text
field has focus: save blurs/validates the field, includes its committed value, and refuses invalid
input. Text undo/delete and tool shortcuts still belong to the text control; modal drafts remain
protected. The former text-focus shortcut test incorrectly expected Save to be suppressed.

Full suite: **436/436 pass**. The updated document browser harness now passes **16/16**, including
T10 and T14. Evidence: `/tmp/tapaal-network-final-documents/results.json`. Development build and
formatting pass. The temporary verification server is stopped.
