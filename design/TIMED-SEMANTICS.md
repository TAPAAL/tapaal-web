# Standalone timed execution core

`src/app/core/timed.ts` implements explicit-token timed P/T execution for one
uncoloured, nongame, nonstochastic component without shared elements. This is an
execution core, not a claim of UI, import/export, query or native feature parity.
Existing model-type gates and the untimed executor are unchanged.

## Integration boundary

A `TimedModel` deliberately wraps, rather than extends, `Net`. The `net` member
supplies stable node/arc IDs, connectivity and weights. Separate `intervals`
(input arc IDs), `invariants` (place IDs), `urgent` (transition IDs), `transports`
(paired input/output arc IDs) and `initial` (individual token IDs, places and
ages) supply timing semantics. Missing intervals mean `[0,infinity)`; missing
invariants mean `< infinity`. The initial token counts must agree with Net's
aggregate initial marking. Runtime markings need not agree with those counts.

A future adapter for `Network.type.timed` must inspect the original network type,
component count, sharing, and unsupported features before constructing this
wrapper. It must supply `componentCount: 1`, `sharedElementIds: []`, and the exact
type flags only when those assertions are true. It must resolve constants without
floating-point conversion and preserve all timing data. Never discard timing,
colour, game or stochastic metadata to make an unsupported document load. Never
pass `model.net` into the untimed `Simulation`, `isEnabled` or `fireTransition`:
that member is only the aggregate graph and cannot enforce timed semantics.
The wrapper's different shape prevents accidentally passing it directly as Net;
explicitly unwrapping it remains the adapter's responsibility.

Minimal execution sequence:

```ts
const marking = initialTimedMarking(model);
const later = delayTimed(model, marking, '0.2');
if (isTimedEnabled(model, later, transitionId)) {
  const { marking: next, bindings } = fireTimed(model, later, transitionId, {
    mode: 'oldest',
  });
}
```

All public execution functions validate the model and supplied marking. Invalid
inputs throw; disabled transitions return false from `isTimedEnabled`, and
`fireTimed` throws. An unknown transition ID is an input error. Operations never
mutate the model or supplied marking. Returned objects are caller-owned.

`TimedSimulation` clones its model, owns reversible snapshots, and exposes cloned
`marking`/`trace` getters, `cursor`, `canBack`, `canForward`, `fire`, `delay`, `back`,
`forward`, and `reset`. A successful action after stepping backward truncates the
future; a failed action changes nothing. Forward replays a stored snapshot rather
than reselecting tokens. Reset restores the initial snapshot and clears the trace.
This history is independent of document undo/redo.

## Semantics and native sources

All source paths below are relative to the repository root.

- `src/main/java/dk/aau/cs/model/tapn/TimeInterval.java`, `isIncluded` and
  `isValidInterval`: finite lower bound, finite or infinite upper bound, open or
  closed finite endpoints, and nonempty intervals. Infinity is represented by
  `null` and must be open. A closed singleton is valid.
- `TimeInvariant.java` in the same directory, `isSatisfied`: each resident token
  must satisfy its place's upper bound. `< 0` and `<= infinity` are invalid.
  Empty places impose no delay restriction. `<= 0` allows a fresh output token.
- `TimedInputArc.java`, `isEnabled` and `getElligibleTokens`: at least the arc
  weight must fall within its interval. `TimedInhibitorArc.java` forcibly uses
  `[0,infinity)` and enables when the place count is strictly below its weight;
  the web core rejects a nontrivial inhibitor interval instead of discarding it.
- `TransportArc.java`, `isEnabledBy`: the input interval and destination invariant
  both constrain eligibility. Paired normal graph arcs represent one transport
  operation; weights and connecting transition must match. The output half is
  excluded from ordinary output production. Transport preserves age and identity.
- `TimedTransition.java`, `isEnabledAlone`, `calculateConsumedTokens`, and
  `calculateProducedTokensFrom`: all input requirements must hold simultaneously;
  ordinary outputs get age zero, transports retain consumed ages. Consumption is
  computed before production, including ordinary and transport selfloops.
- `TimedMarking.java`, `LocalTimedMarking.java`, `NetworkMarking.java`: delay and
  fire produce new markings. Delay adds the same nonnegative amount to each age
  and checks invariants. Network/shared synchronization is deliberately excluded.
- `src/main/java/pipe/gui/petrinet/animation/Animator.java`, `letTimePass`, and
  `TimedTransition.calculateDInterval`: enabled urgency forbids positive delay;
  zero delay remains legal. `src/main/java/pipe/gui/petrinet/editor/TAPNTransitionEditor.java`
  requires unrestricted urgent inputs and no finite invariant on an urgent
  transport's destination. The core enforces these constraints, so an urgent
  transition's eligibility cannot change solely due to time elapsing.
- `src/main/java/dk/aau/cs/model/tapn/simulation/{Oldest,Youngest,Random}FiringMode.java`:
  choose eligible tokens per input arc. Age ordering is exact; equal-age ties
  preserve marking order. Random mode requires an injected `[0,1)` source and
  samples without replacement. There is no ambient `Math.random`. The default
  here is oldest, unlike the native random default. Manual mode specifies exactly
  one identity list per consuming input arc; counts, eligibility, uniqueness and
  absence of extra bindings are checked before returning a result.

## Exact arithmetic, identity and limits

Ages, finite bounds, and delays are serializable nonnegative plain decimal
strings. Binary JavaScript numbers, signs, exponents, whitespace and leading
integer zeroes are rejected. Arithmetic aligns decimal scales using BigInt and
returns normalized decimal strings: delaying by `'0.1'` and then `'0.2'` produces
exactly `'0.3'`, including at strict boundaries. Finite decimal inputs retain full
precision; there is no epsilon or rounding. Nonterminating rationals are not
accepted. Native BigDecimal arithmetic sometimes uses `AGE_PRECISION` for future
enabling calculations; this core does not reproduce those rounded calculations.
Decimal strings/results are limited to 256 digits (excluding the decimal point);
overflow throws rather than rounding. ES2022 compilation supports BigInt.

Tokens have unique IDs. Initial IDs must not start with reserved `@timed:`.
Ordinary outputs allocate `@timed:N` from a serialized monotonic `nextId` counter;
transport retains the original ID. Each generated live ID must be below that
counter. Snapshots include the counter, so branching/replay is deterministic.
IDs are branch-local, not globally unique across alternate simulation histories.

Explicit-token capacity is 100,000 tokens; weights above that limit are rejected.
Firing checks the resulting total before allocating outputs, including selfloop
consumption. The resource limit is not part of mathematical enabling: a transition
can be enabled but firing can throw a capacity error. Decimal and ID-counter
limits likewise produce errors without modifying input state.

## Deliberate exclusions and validation scope

`timedDelayInterval` returns the exact legal delay interval from the current
marking, respecting all occupied-place invariants and enabled urgency. It does
not calculate future transition enabling interval unions. Future-enabling,
verification, network synchronization, shared nodes, coloured bindings, player
ownership, stochastic distributions, and timed file serialization are not ported.

The existing Net validator rejects parallel arcs between the same endpoints.
Consequently a place supplies at most one consuming input to a given transition;
ordinary and transport inputs cannot compete for the same tokens. Reusing either
half of a transport pair is rejected. More general competing arc bindings require
an explicit matching algorithm and are not silently approximated here. Different
transitions may share a source because firing is atomic and sequential.

The typed wrapper is an integration API, not a replacement network file parser.
Callers must not fabricate capability assertions or strip unsupported data.
Unknown references, mismatched initial counts, duplicate token IDs, malformed
bounds, invalid markings and unsupported type flags fail validation.

## Focused checks

`timed.spec.ts` contains native-derived fixtures for strict/open endpoints,
`0.1 + 0.2`, urgent enabled/disabled states, occupied and empty-place invariants,
weighted eligibility, multiple inputs, inhibitors, transport destination
invariants/identity/age retention, selfloops, manual bindings, injected random
selection, resource/input failures, and reversible/branching/reset history.
These fixtures exercise the port directly; they are not a Java differential test
or evidence of UI integration.

Run from `web`:

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module preserve --moduleResolution bundler src/app/core/timed.ts src/app/core/timed.spec.ts
./node_modules/.bin/vitest run src/app/core/timed.spec.ts
./node_modules/.bin/prettier --check src/app/core/timed.ts src/app/core/timed.spec.ts design/TIMED-SEMANTICS.md
```
