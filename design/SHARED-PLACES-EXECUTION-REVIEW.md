# Independent shared-place execution review

## Owner follow-up

Both callback-boundary findings are fixed. Firing now holds a reentrancy guard
through selection and publication, releasing it in `finally`. Fire, step, delay,
replay and every history mutation refuse nested mutation during that interval.
The transition reference is captured before callbacks; `step` also returns its
captured reference. Read-only inspection remains available to callbacks.

The three original proofs pass. Nine additional checks cover all eight mutation
entry points, future preservation, guard release after failure, and `step` with
a caller reference changed by its RNG. All 78 focused execution tests pass.
This corrects the injected-callback boundary; the original pure-RNG native
evidence and its limits below remain distinct.

Reviewed 2026-10-29. Scope: opt-in shared-place compiler/session, authored-source
validation, token engine, existing focused tests, and released-native differential.
Only this document and `src/app/core/shared-network-review.spec.ts` were created.
No production changes, existing-test changes, commits, servers or UI integration.

## Findings: runtime correctness

Two P2 findings affect the injected-callback boundary. Neither requires private
field access, an invalid model, or a forged revision. Ordinary operation with a
pure RNG passed the reviewed checks. The callback preconditions below matter:
these are not spontaneous failures with `Math.random`.

### R1 — P2: reentrant RNG can corrupt history and violate failed-action atomicity

Location: `src/app/core/shared-network-simulation.ts:425` (`fire`, especially
lines 427, 440 and 447), together with mutating session methods such as `delay` at 459. `fire` captures a previous marking, invokes external code through
`fireTimed`, then appends using the session's potentially changed cursor/history.
There is no transaction/reentrancy guard around these operations.

Reproduction with a valid three-token shared pool:

```ts
let session: SharedNetworkSimulation;
session = new SharedNetworkSimulation(revision, () => {
  session.delay('0.25');
  return NaN;
});
session.delay('0.1');
session.back();
session.fire({ componentId: 'a', elementId: 't' });
```

The fire throws for invalid RNG output, but time becomes `0.25`, cursor becomes
1, and the former future `Delay 0.1` is replaced by `Delay 0.25`. A failed action
has therefore published state and destroyed future history. Returning valid `0`
instead appends the fire computed from time zero after the nested delay, yielding
trace times **0, 0.25, 0**. The trace cannot be reproduced by executing its actions
in order.

Proofs: the two unskipped `R1` tests in
`src/app/core/shared-network-review.spec.ts:257` and `:268`. Both fail on the
reviewed implementation. A suitable correction is to reject nested mutation for
the entire external-callback interval, including navigation/reset/replay, with
guard cleanup on failure. Merely checking the cursor after the callback does not
restore history already replaced by the callback.

### R2 — P2: callback mutation of the transition argument publishes an invalid trace

Location: `src/app/core/shared-network-simulation.ts:425`, `:443` and `:448`.
The physical transition is resolved before calling the RNG, but local provenance
and the recorded action use the caller's `ref` again afterward.

```ts
const ref = { componentId: 'a', elementId: 't' };
const session = new SharedNetworkSimulation(revision, () => {
  ref.elementId = 'q'; // q is an ordinary local place
  return 0;
});
session.fire(ref);
```

The engine successfully fires `a.t` and produces a token in `a.q`, but the
committed action says it fired **a.q**. Replaying that action cannot resolve a
local transition. Changing `componentId` instead causes `Missing compiled
provenance` after computation; changing only `elementId` demonstrates the more
serious successful publication of a false action. `ElementRef` is not captured
before invoking user code. Copy/canonicalize the validated reference once and use
that captured value throughout firing and the return from `step`.

Proof: unskipped `R2` test at
`src/app/core/shared-network-review.spec.ts:284`. Its recorded-reference assertion
fails: expected `t`, received `q`. This is independent of R1: no reentrant session
operation occurs.

## Passing checks and implementation assessment

The new file contains **30 tests: 27 pass and 3 fail** for the two findings above.
The existing shared execution file's **39 tests pass** in the same run: combined
**66 passed / 3 failed / 69 total**. The failing proofs assert the intended
contract; they are neither skipped nor marked expected failures.

Independent passing checks cover:

- Invalid RNG values (`NaN`, both infinities, negative, 1, 2) after one successful
  weighted selection; throwing RNG; preservation of the future branch.
- Negative/malformed delay arguments; active and dormant 256-digit overflow;
  invalid jump indices and failed replay rollback.
- Capacity including both dormant pools and frozen inactive locals, checked
  before RNG invocation; billion-token source remains serializable but execution
  refuses it without explicit expansion; source-valid arc weights over the
  engine limit are rejected by the compiler's final validation.
- Twelve successive ordinary shared self-loop firings, fresh noncolliding output
  IDs, age reset, shared projections including inactive occurrences, physical
  totals, deterministic history/replay without RNG resampling.
- Weighted transports in all five endpoint combinations, exact ID/age retention,
  qualified local eligibility/destination mapping, stale manual eligibility after
  delay, and branching back to a valid pre-delay binding. These fixtures combine
  a finite strict destination invariant with a finite input guard. Existing tests
  separately isolate strict destination-invariant filtering.
- Authored save data unchanged after firing/delay; constant/activation edits
  rejected by the source identity guard; a new session starts from initial ages;
  deeply frozen provenance, pool tokens and captured constants; forged source
  with shared transitions is revalidated and refused.

I also read and reran the existing focused cases for one shared physical marking,
active-only firing, dormant/unused/all-inactive pool aging, frozen inactive local
ages, empty invariants, active/inactive urgency, exact `0.1 + 0.2` clock behavior,
normal outputs and global inhibitors, selection policies, invalid manual IDs,
strict transport destinations, repeated/prototype-like IDs, and untimed execution.
The private compiler uses tagged tuple identities and validates the completed
physical graph. Source validation forbids duplicate membership within a component
and duplicate endpoints; local transition IDs remain disjoint across components.

No public typed executable numeric projection is returned. The captured
`revision` retains authored constants and the authored timed flag. Untimed uses
the internal timed token engine intentionally, with no timing metadata and with
public delay disabled. The 100,000 physical-token cap and inactive/dormant rules
are intentional constraints, not findings. Source/codecs/app refusal gates are
staging boundaries, not missing-feature findings.

The identity guard assumes immutable source revisions, as documented and supplied
by `validateSharedSource`; the constructor separately clones/revalidates its
source. It does not compare source contents on each action. Future adapters must
actually call `assertRevision` on the current document source.

## Native compatibility evidence and limits

I reran the existing differential through
`worker-job run tapaal-shared-review-native-20261029 --memory 512M -- node web/scripts/native-reference/check-shared-execution.mjs`.
Result: **79 cases / 1,343 observations, passed**. Jar SHA-256:
`60914b11e6fffa6f9be8f481c51b945fd16c8f4fef9d31bc2d8d5db93f88cd5d`.
The job completed and `worker-job list` returned `[]`; no environment remains.

This is an assertion differential, unlike the earlier exploratory shared-elements
printer. It asserts output length and every observation line, comparing enabled
transition sets, action success/refusal, and sorted runtime token ages/multiplicity.
The 79 cases are 60 weighted transport combinations (five routes, two weights,
three policies, strict/non-strict destination), six normal-output/self-loop cases,
eight active/urgent/inhibitor combinations, and five Random transport cases.
Each case makes 17 observations around delays `0.5`, `2`, `0` and two attempted
firings; these are correlated observations, not 1,343 independent scenarios.

`SharedExecutionReference.java` constructs actual shared places/local transitions.
Transport construction explicitly calls `setWeight` after the null-expression
constructor, avoiding the native transport-weight reset pitfall. Normal input,
output and inhibitor constructors receive explicit weights; the passing weighted
marking observations provide execution evidence beyond merely supplying a weight
argument. No shared-transition invalid-incidence workaround is used here.

The headless marking replaces GUI-dependent `isDelayPossible`; the runner compares
that decision against a second traversal using native place-invariant predicates
and active urgent-transition enabling. Released delay traversal, enabling,
selection and token transformations still run in the jar. Rewrapping released
markings restores the substitute predicate. This is **not** evidence that the
original GUI predicate or GUI integration was executed. Both legality traversals
use the same active/shared-use policy, so agreement is bounded by that policy.

Specific coverage limits established by reading the generator and assertions:

- Both components receive the same `active` flag. The differential has no mixed
  active/inactive shared occurrence in a single case. Web tests cover that case.
- Native marking observations omit inactive local places; their frozen web
  marking behavior is intentional, and is not established by these comparisons.
- Manual native bindings are generated from web eligibility, then matched by
  place and age in Java. This verifies the selected valid age effects, not an
  independent enumeration of every eligible identity or invalid-manual rejection.
- Random cases consume all three eligible tokens. They establish deterministic
  multiplicity/age effects while using native Random, not random distribution or
  matching random sequences. Sorted ages do not establish Java object identity.
- Constants, session navigation/replay, callback behavior, capacity and decimal
  overflow are web-side contracts; this differential does not cover them.
- Ages are constructed directly in native runtime objects. No native nonzero-age
  FILE IO, original-source export roundtrip, GUI, or query-execution parity is
  claimed. Runtime state must never become saved initial data implicitly.

No native mismatch was observed within that boundary. The prior **124/124** and
**12 cases / 213 observations** disjoint native results, full **930 tests / 36
files**, and **578.87 kB** build/budget warning are implementer-reported baseline
evidence, not reruns performed in this review.

## Validation and next UI integration concerns

Focused command, from `web/`:

```sh
./node_modules/.bin/vitest run src/app/core/shared-network-review.spec.ts src/app/core/shared-network-simulation.spec.ts --reporter=dot
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module preserve --moduleResolution bundler --lib ES2022,DOM src/app/core/shared-network-review.spec.ts
```

Standalone strict TypeScript passes. The initial CLI invocation without
`--ignoreConfig` was refused by TypeScript 6 (TS5112); the corrected command above
was used. Formatting is checked only for the two owned new files. No broad build
or baseline suite rerun was necessary for this read-only review.

Before wiring the opt-in session into the UI, address the callback findings and
retain the source/session boundary: guard against constant/activation edits,
restart from authored initial data, use `totalTokens` rather than summing shared
occurrences, label dormant pools and frozen inactive locals, preserve qualified
transition/local-arc binding identities, and reject stale token selections.
Saving/exporting must continue to use authored source; neither `marking` nor
`trace` is replacement initial data. Deliberate dispatch, pool-aware editing,
clipboard membership protections and UI smoke checks remain the next integration
work, not defects in this opt-in increment.
