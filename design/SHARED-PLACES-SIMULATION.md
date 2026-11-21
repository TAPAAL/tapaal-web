# Opt-in shared-place execution

Implemented 2026-10-29 against [SHARED-ELEMENTS.md](SHARED-ELEMENTS.md),
[SHARED-PLACES-FOUNDATION.md](SHARED-PLACES-FOUNDATION.md), and
[SHARED-PLACES-FILES.md](SHARED-PLACES-FILES.md). This increment adds a private
compiler/session Module. It does not enable shared support in the application.
Existing production cores, codecs, document dispatch, clipboard gates and UI are
unchanged. Shared transitions remain refused.

## Interface and integration seam

`src/app/core/shared-network-simulation.ts` exports `SharedNetworkSimulation`,
`SharedMapping`, `SharedInput`, `SharedAction`, `SharedState`, and
`SharedPoolState`. Construct a session with `new SharedNetworkSimulation(revision,
random?)`, where `revision` is a `SharedRevision`. The constructor explicitly
revalidates `revision.source`, even for a forged branded wrapper. Errors throw
before any usable session is returned. Source validity remains separate from
execution capacity.

The public `revision` is the deeply frozen original-shape `SharedSource` snapshot,
including authored constant references, initial counts/ages, activity and saved
query metadata. It is never an executable numeric Network. `assertRevision(source)`
checks identity against the constructor's original revision.source; future
DocumentSimulation integration must call it against the current document before
an action, and replace the session after any authored edit, including activation
or constant edits. Runtime states must never be written into document source or
saved initial state. Reopening a session always starts from source initial state.

The interface follows the existing TimedNetworkSimulation seam:

- `marking`, `markingFor(componentId)`: component/local-place projections of token
  IDs and ages; `enabled`, `enabledFor(componentId)`: qualified local transitions.
- `eligibleInputs(ref)`: the existing engine's consuming-input eligibility, with
  local arc/place/destination IDs, `member: {componentId, elementId}` identifying
  the selected local transition, pool ID when applicable, and display names for
  both source and destination. A shared source's display name is its pool name.
  Token IDs are opaque and retain physical identity across projections.
- `fire(ref, selection?)`, `step(ref?, selection?)`: Random by default, injected
  through the constructor; Oldest, Youngest and manual use existing token-engine
  selection. `ref` is `{componentId, elementId}`. Manual bindings are keyed by
  local consuming arc ID; together with the qualified transition ref they identify
  the member without ambiguity. Inhibitors are not consuming binding groups.
- `time`, `delayInterval`, `delay(decimal)`: exact decimal time and legal delay
  interval. Untimed `delayInterval` is `null`; any untimed delay throws.
- `trace`, `cursor`, `canBack`, `canForward`, `back`, `forward`, `jump(index)`,
  `reset`, `replay(actions)`: reversible snapshots and atomic branch/replay.
  Recorded fire actions contain actual local-arc bindings and qualified transition
  refs. Replay uses manual bindings, never calls Random, and replaces the entire
  history only on success. Failed actions preserve future history and cursor.
- `pools`: declarations including unused ones, with `live`/`dormant` status, all
  original occurrence refs, and physical token IDs/ages. `totalTokens` counts each
  shared token once, plus active and frozen inactive local tokens. Do not sum
  projected occurrences to display document totals.
- `label(index)`: `Initial marking`, `Delay amount`, or `Fire Template.Transition`,
  with exact global time. Invalid indices throw. `mapping.toPhysical` and
  `mapping.occurrences` provide immutable many-to-one provenance; a physical pool
  has all occurrences, including inactive ones. Physical IDs are opaque runtime
  identities, not authored node IDs or editable graph state.

The future UI adapter should turn token lists into counts for its current
`DocumentSimulation.markingFor`, use token lists for age displays, display pool
status beside occurrences, and use physical totals. Its current `fire(componentId,
elementId, policy)` can construct the qualified ref and convert policy to the
existing `TokenSelection`. There is no public executable graph to save or edit.

## Private physical compiler

The compiler reads only validated source, resolves constants explicitly from the
captured declaration map, and constructs a fresh TimedModel. It does not execute
or export either the source validator's validationProjection or the file writer's
wire projection. No SharedSource-to-Network cast exists.

Each live pool becomes one physical place. Each active component's local place
and local transition gets an injective tagged tuple ID; every active local arc and
transport half is component-qualified independently. A pool is live when it has
an occurrence in any active component, even without incident arcs. Equal local
names/IDs never imply sharing. Private engine names use fixed-width UTF-16 hex
encoding of tagged tuple IDs, so arbitrary IDs and prototype-like strings cannot
collide or become invalid engine symbols. Local routes and weights are copied;
transport pairing is explicitly qualified. Annotations are not executable state.

`validateTimedModel` validates the complete physical graph after compilation,
including duplicate endpoints, one consuming source-place/transition input,
transport pairs/weights, destination invariants, urgency, unrestricted inhibitor
inputs and initial token identities. Source validation already checks the same
local rules, inactive topology, authored transport weight equality, lens and query
protections. Shared transitions are refused both by revalidation and by the
compiler's own explicit defense.

Untimed source uses the same physical token operations with empty timing metadata
and zero initial ages internally. The internal TimedModel wrapper is explicitly
constructed with timed=true solely to reuse token identity, eligibility, capacity,
selection and history operations; authored source/type is preserved. The public
contract has no delay operation for untimed source, no clock advance, no guards,
invariants, urgency or transport metadata. Thus it cannot introduce timed behavior
into an untimed document. Nonshared source uses identical qualification and
physical token rules, keeping disjoint local names/IDs and inactive locals apart.
This opt-in explicit-token session has the documented capacity below; existing
aggregate untimed execution remains unchanged.

## Runtime semantics and failure behavior

Active local transitions compete for the same physical shared marking. Every
occurrence, including inactive ones, reflects shared consumption/production.
Ordinary outputs reset age and allocate new deterministic identities; transport
outputs retain ID and age, including shared-to-local, local-to-shared,
shared-to-shared, self-loop and entirely local routes. Inhibitors observe global
pre-state multiplicity. Eligibility and selection come directly from timed.ts.
Manual selection must cover exactly the consuming local arcs with exactly the
required number of eligible, distinct physical IDs; foreign, consumed, repeated,
extra or omitted identities/bindings fail.

Each active physical token ages exactly once. Active occupied local invariants,
active-used occupied pool invariants and active enabled urgent transitions constrain
the global clock. Empty places do not constrain time. Zero delay follows existing
timed-engine policy. All-inactive timed source has no selectable event and permits
nonnegative delay with an unrestricted interval; source transitions in inactive
components are not events.

Unused/all-inactive pool tokens stay outside the validated active TimedModel.
Their runtime ages are derived from captured sparse initial ages plus global time;
their invariants cannot block delay. No dormant array is stored per step. All
source pool initial states still validate, including unused pools. Inactive LOCAL
markings/ages stay frozen at initial state, preserving the existing intentional
web behavior. Activation starts a fresh run from source and never promotes
possibly over-invariant dormant ages into the active engine.

Initial physical counts, including dormant pools and frozen inactive locals, are
summed and checked against MAX_TIMED_TOKENS (100,000) before any explicit token
array is constructed. Sparse metadata stays bounded by validated counts. An
oversized source remains valid/saveable; the session throws an actionable reduce-
initial-marking error instead of allocating a billion-token array. Fire checks
physical output totals including passive tokens before invoking selection or
allocating outputs; the underlying engine independently enforces active capacity.
Dormant decimal overflow is checked before delay publication too.

State, clock, committed bindings, cursor and history publish together only after
successful engine computation. Snapshots, mappings and all public projections are
deeply frozen. Navigation restores recorded snapshots without reselection; failed
branch actions retain future history. Injected RNG callbacks are external code;
no failed operation publishes their partial choices or stores a new selection.

## Validation and evidence

Focused tests cover competition, exact clock, active/dormant/inactive projections,
empty invariants, urgent active/inactive transitions, frozen constant/query source,
prototype-like IDs, distinct equal-age identities, all selection policies, manual
binding failures, replay/navigation/branch atomicity, all transport endpoint
combinations, strict destination eligibility, weighted normal/transport self-loops,
global inhibitors, shared-transition/duplicate-endpoint refusal, source/engine
capacity separation, preallocation checks, untimed and nonshared execution.

Final verification: **39 focused tests; 930 tests across 36 files pass**. App
TypeScript and standalone strict adapter/spec checks pass, as does repository
formatting. Production build passes with the unchanged **578.87 kB** initial
bundle and existing 500 kB budget warning. The existing disjoint native gates were
rerun: **124 native / 124 web observations, zero failures**, and **12 cases / 213
observations passed**. All owned finite worker jobs completed and cleaned up;
other sessions' jobs were preserved. No temporary environment was started.

New native files: `scripts/native-reference/SharedExecutionReference.java` and
`check-shared-execution.mjs`. The differential uses released 4.0.4 real model
classes for valid shared PLACE/local-transition nets only: 79 cases / 1,343 matching
observations. It compares enabling, action results and runtime age/multiplicity
across weighted guarded transports in all directions, normal self-loops,
competition, inhibitors, active/inactive cases, urgency and dormant traversal.
Oldest/Youngest/manual compare selected age effects; Random consumes every eligible
token in its cases so multiplicity/age results are deterministic without promising
identical random sequences. Web tests separately establish transport identity.

Native `NetworkMarking.isDelayPossible` requires a GUI current tab. Only that
predicate is replaced with an explicitly bounded network-aware predicate; every
delay also checks native place invariant predicates and active urgent transition
predicates independently. Released delay traversal, cloning, enabling, token
selection, consumption and production remain jar code. After each released result,
a wrapper reattaches the returned marking to the headless predicate; it does not
change token data. Shared observations read `NetworkMarking.getTokensFor`, since
an unused SharedPlace's cached marking pointer can be stale after native
`setMarking`. No shared transition is constructed, so the unrelated shared-
transition manual-token cast bug is not involved. No GUI or native Java token
object-identity parity is claimed. Nonzero ages are runtime model ages: this does
not establish released 4.0.4 nonzero-age FILE IO compatibility.

The native runner creates a fresh temporary directory and removes classes,
compiled web bundles and generated scenarios in finally. Run qualifying work
through worker-job after help/USAGE and capacity/list inspection:

```sh
worker-job run tapaal-shared-native-UNIQUE --memory 512M -- node web/scripts/native-reference/check-shared-execution.mjs
```

From web/, focused verification:

```sh
./node_modules/.bin/vitest run src/app/core/shared-network-simulation.spec.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module preserve --moduleResolution bundler --lib ES2022,DOM src/app/core/shared-network-simulation.ts src/app/core/shared-network-simulation.spec.ts
npm run format:check
```

Remaining release gates: deliberate V3 app/file dispatch, document-session
replacement/guards, pool-aware UI editing/counts/labels/token selection, clipboard
membership protections and UI smoke coverage. Shared transition synchronization,
query execution and native GUI parity remain outside this increment. No server,
manual environment, commit, PR or deployment is included.
