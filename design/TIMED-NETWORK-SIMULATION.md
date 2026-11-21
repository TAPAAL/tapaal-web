# Opt-in disjoint timed network execution

`TimedNetworkSimulation` is a new core entry point for a captured `Network` revision. It does
not change `timedModelForNetwork`, application dispatch, UI gates, file adapters or saves. The
existing single-component adapter still refuses a multi-component network. This slice makes
no verification, future-enabling-interval, shared-element, or GUI parity claim.

## Execution contract

Only `timed: true, colored: false, game: false, stochastic: false` is accepted, with actual
booleans, before any adapter can normalize flags. `validateNetwork` validates **all** components,
canonical timing and saved-query protections. Each individual component is then checked through
the existing single-component adapter, including execution limits, even when inactive. Constants
and shared semantics are unsupported; known out-of-schema `constants`, `sharedPlaces`,
`sharedTransitions`, and `sharedElementIds` fields on the network, component or component net are
refused. File parsers remain responsible for refusing unsupported source-language constructs.
No query is executed or rewritten.

The engine intentionally compiles the disjoint active graphs into **one private physical timed
model** for `TimedSimulation`. Its physical `componentCount: 1` describes that newly constructed
graph, never the original network. `revision` retains the original component count, activity,
local identities, geometry, metadata, ages and query symbols. Per-node/arc geometry and extension
fields, including transport routes, are cloned into the private graph; annotations are qualified.
Network/component-level extensions remain in the revision. This graph is not a flattened layout
or a save format. Persist the source network through the existing network file adapters.

All active tokens advance by the same exact decimal delay. The legal interval is the intersection
of the remaining bounds of **occupied** active places, with open/closed endpoints preserved.
An enabled urgent transition in any active component restricts it to `[0,0]`. Input guards do not
restrict time passing: the interval is not a union of future transition-enabling times. Firing
changes only the chosen component; ordinary outputs get fresh identities and age zero;
transport preserves identities and ages and checks destination invariants. Repeated local IDs
or names never imply sharing.

Inactive projections retain initial identities and ages for the web document contract. This is
an intentional difference from native `NetworkMarking.delay/clone`, which omits inactive local
markings. Inactive projections are display data, excluded from delay, urgency, eligibility and
firing. Changing activity or editing any source data requires a new simulation session.

## API and identity boundary

```ts
const run = new TimedNetworkSimulation(document.network);
const transition = { componentId: 'component-id', elementId: 'transition-id' };
const choices = run.eligibleInputs(transition);
run.fire(transition, {
  mode: 'manual',
  bindings: Object.fromEntries(
    choices.map((input) => [
      input.arcId,
      input.tokens.slice(0, input.weight).map((token) => token.id),
    ]),
  ),
});
run.delay('0.1');
run.delay('0.2'); // global time is exactly '0.3'
const localPlaces = run.markingFor(transition.componentId);
const legal = run.delayInterval;
```

- `mapping.toComposed(componentId, elementId)` and `fromComposed(id)` are stable, bidirectional
  lookups for active nodes, arcs and annotations; unknown/inactive IDs return `undefined`.
  JSON tuple encoding is collision-free even for unusual UTF-16 IDs. Private node names use
  fixed-width UTF-16 encoding. The closed-over Maps cannot be mutated through this API.
- `marking[componentId][placeId]` includes empty places and read-only `{id, place, age}` tokens.
  `place` is the original local place ID. Token IDs are globally unique opaque identities, not
  place references; they stay unchanged across delay and transport. Newly produced identities
  come from the shared physical allocator. Commuting ordinary fires have equivalent ages/counts
  but may assign different fresh IDs according to firing order.
- `enabled` returns original `ElementRef`s; `enabledFor(id)` returns local transition IDs.
  `eligibleInputs(ref)` returns consuming inputs only, with **local** `arcId`, `place`, optional
  transport `destination`, weight, and eligible tokens. Inhibitors are not manual inputs. This
  list does not itself claim the transition is enabled; check `enabled` for all prerequisites.
- `fire(ref, TokenSelection)` defaults to oldest; youngest and random are also supported. Random
  requires the injected `random: () => number` source. Manual bindings must cover precisely the
  consuming local input arcs. Foreign token IDs, composed arc IDs, duplicate identities, extra
  arcs, missing bindings and ineligible tokens fail without changing history.
- `time`, `cursor`, `canBack`, `canForward`, `trace`, `back`, `forward`, `reset` expose session
  history separately from document undo. Every trace state carries its global time and original
  marking projection; fire states store original references and exact local-arc bindings.

```ts
const saved = run.trace.filter((state) => state.kind !== 'initial');
run.reset();
run.replay(saved); // uses recorded manual identities, never repicks random tokens
run.back();
run.delay('0.2'); // a successful action branches and discards the future
```

Replay starts from the captured initial state and replaces the run only after every action
succeeds. A failed action, delay, random choice or replay leaves cursor and future intact. Back
and Forward restore snapshots without firing again. Reset restores initial ages and identity
allocation. Views, trace, mapping refs and captured source data are deeply frozen and isolated
from caller mutations. External random-generator state is not rolled back after an exception.
The existing limits apply: 100,000 active explicit tokens (also checked per inactive component),
arc weights within that limit, safe integer counts, and at most 256 decimal digits. The global
clock is checked even when no tokens exist.

## Native evidence and precise limits

Repository source audit (line numbers at implementation):

- `src/main/java/dk/aau/cs/model/tapn/TimedArcPetriNetNetwork.java:211–220`,
  `activeTemplates`: includes only active templates.
- `src/main/java/dk/aau/cs/model/tapn/NetworkMarking.java:70–95`, `clone/isDelayPossible`:
  clone delays by zero; only active local markings constrain delay. `120–139`, `delay`: applies
  the same amount to every active local marking, omitting inactive ones. `142–155`, local
  `fireTransition`: clones the network and replaces only the chosen local marking.
- `src/main/java/dk/aau/cs/model/tapn/LocalTimedMarking.java:100–110`: tests invariants of tokens
  actually present. Empty places contribute no constraint.
- `src/main/java/pipe/gui/petrinet/animation/Animator.java:305–321`: enabled urgency is scanned
  over active templates; `807–808`: zero delay or invariant-legal delay with no enabled urgent
  transition. The headless reference reproduces these Animator conditions; it does not run GUI.

The new `scripts/native-reference/check-timed-network.mjs` compiles the existing read-only
`ExecutionReference.java` against **released 4.0.4** jars and compares the new wrapper directly:
12 cases, **213 matching observations** of enabled sets, legal/blocked delays, successful/failed
fires, and active place age multisets. Cases cover duplicate local IDs, two active components
plus inactive urgency/invariants, strict input/invariant boundaries, weights, inhibitors,
ordinary output reset, transports/selfloops, manual selection, and exact `0.1 + 0.2` delay.
Native token objects do not expose web identity strings; identity/history/freeze behavior is
covered by the focused TypeScript tests instead.

```sh
worker-job capacity
worker-job list
worker-job run tapaal-timed-network-check -- \
  node web/scripts/native-reference/check-timed-network.mjs /tmp/tapaal-timed-network
```

`TAPAAL_LIB` overrides the default `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib`.
The output directory contains generated scenarios, native/web observations and `results.json`.
Nonzero initial ages are constructed through the native model API: released 4.0.4 file IO loses
these ages, independently of its correct execution behavior. See TIMED-FILES.md for that file
limitation and native integer bounds. Decimal bounds remain the existing web/JSON superset.

Pending UI integration: explicitly dispatch this session for supported timed networks, render
`markingFor(viewedComponentId)` and `enabledFor`, keep selected transition refs component-qualified,
build token choices from `eligibleInputs`, and connect global delay/history controls. Catch
constructor/action refusals. Keep saves and document edits on the original network, rebuilding
the session after edits. No UI gate was opened by this implementation.

## Application integration (2026-10-29)

The native-style web UI now opts supported timed documents into `TimedNetworkSimulation` through
`DocumentSimulation`, for both single and multiple disjoint components. The legacy single-component
adapter gate is unchanged. Component views project original local IDs and ages while one session
retains the global clock, legal delay intersection, enabled references and history. Inactive views
explicitly identify their frozen initial projection. History distinguishes delays and qualified
fires with global time; manual token choices resolve against the firing component. View changes
cancel drafts while preserving the run. Document revisions and tab navigation end it.

All saves still use the complete initial source network, including inactive components and ages.
Shared elements, constants, colour/game/stochastic semantics and synchronization remain unsupported;
there is no untimed fallback. See [TIMED-UI.md](TIMED-UI.md) for interaction and validation details.
The API-only and pending-integration wording above describes the earlier core delivery stage.
