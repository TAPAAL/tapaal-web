# Independent shared-place foundation review

## Owner follow-up

All three findings were fixed after review. Any defined `savedQueries` value now
enters closed-record validation. Direct pool invariant failures retain that pool's
constant-use location. Projection diagnostics preserve their existing locations,
translate member invariants into deduplicated global pool uses, and no longer
substitute all document dependencies. Authored arc-weight resolution now validates
the resolved weight with its own use context before whole-network validation.

All 110 focused tests, including the six original failing proofs, pass. The full
suite passes 801 tests across 33 files; application typecheck, formatting and the
production build pass. The existing 500 kB budget warning remains at 578.87 kB.
These checks do not establish shared file, execution or UI support. The original
review and its evidence below remain unchanged.

Reviewed 2026-10-29. Scope: the opt-in internal foundation described in
`SHARED-PLACES-FOUNDATION.md`, against `SHARED-ELEMENTS.md`. Production and existing
tests were read-only. This review adds only this report and
`../src/app/core/authored-shared-review.spec.ts`. No production fixes, subagents,
commits, PRs, deployments, or servers were used.

## Findings

### 1. P2: falsy malformed query fields bypass closed source validation

Location: `src/app/core/authored-shared.ts:291`, and the truthiness branch in
`validationProjection` at line 169.

Exact repro: start with the independent `source()` fixture in the review spec and
call `validateSharedSource({ ...source(), savedQueries: null })`. It returns
`ok: true`, retaining `savedQueries: null` in its branded frozen source. The same
occurs with `false`, `0`, and `""`. All four cases are retained as failing tests.

The optional field must be absent/undefined or a valid `SharedQueries` record.
Both validation and projection use truthiness, so malformed values skip the query
schema entirely. V2's resolver checks `savedQueries !== undefined` and rejects
these values; this is a new weakening at the source boundary. It contradicts the
closed-source validation contract and permits a validated revision that does not
satisfy its public type. This repro does **not** demonstrate removal of genuine
query protections through a supported edit: no command replaces the query object.

Suggested correction: inspect any defined query value as a record before
projection, and use definedness consistently. Keep all four negative proofs.

### 2. P3: invalid unused pool invariant loses the constant's use location

Location: `src/app/core/authored-shared.ts:239`, with the catch at line 356.

Exact repro: create an unused timed pool `__proto__`, zero tokens, no ages,
invariant `< Limit`, with constant `limit` initially 5. Open a document and issue
`updateConstant { id: 'limit', name: 'Limit', value: 0 }`. The transaction correctly
fails with `The invariant < 0 is invalid.`, but `issues[0].uses` is empty. Expected
use: `{ constantId: 'limit', poolId: '__proto__', field: 'invariant',
activeMemberCount: 0 }`.

The direct pool validator calls `validateInvariant` before reaching the explicit
age-error path that attaches pool uses. The outer catch has no use context. The
source and history remain unchanged; the defect is missing diagnostic/navigation
information promised by the constant-use interface, including unused pools.

Suggested correction: retain relevant constant-use context for direct invariant
validation failures, without fabricating a component/element location.

### 3. P3: projection errors report unrelated constants and pools as uses

Location: `src/app/core/authored-shared.ts:345`.

Exact repro: the review fixture has independent constants `limit` (used only by
the shared pool invariant) and `batch` (used by transport arc weights). Issue
`updateConstant { id: 'batch', name: 'Batch', value: 0 }`. The zero arc weight
correctly fails validation. Its returned use list nevertheless includes the
`limit` pool invariant, alongside the `batch` arc uses.

Every projection issue's original `uses` is overwritten with the uses of **every
constant in the document**. This creates false dependency locations even though
`sharedConstantUses(source, 'batch')` itself is correctly scoped. The failure is
atomic, but its diagnostic directs callers toward an unaffected pool. It also
scales with all document uses rather than those relevant to the error.

Suggested correction: preserve relevant original diagnostic context and translate
projected member invariant uses to one global pool use, rather than substituting
the full document's use list.

## Verified behavior and review judgments

- Independent source construction validates the intended global pool authority:
  member source contains geometry and a pool ID, without count/name/invariant/age
  projections. A validated revision exposes only `source` as a string-keyed
  property. Old authored resolution and JSON/TAPN serialization reject V3 source.
- All-inactive source stays inactive. Unused declarations still validate their
  initial ages and invariant and report zero active members. A billion-token
  source can validate without allocating explicit token arrays.
- Prototype-like pool, component, and member IDs work in the independent fixture.
  Duplicate occurrences, inactive local/global name collisions, member semantic
  fields, and member timing entries are rejected.
- Getter-backed model type and geometry fields are rejected without invocation.
  Non-enumerable numeric array slots are rejected. Invalid/missing model flags and
  malformed document options are rejected. The existing suite also covers
  inherited/symbol/extra/sparse descriptors and explicit adoption of symbolic
  differences.
- Query captures survive component copy and deletion of an unprotected copied
  occurrence. Original protected membership stays protected; explicit query
  removal enables detach, and undo restores the original protections.
- Copy retains shared identity and marking once. Moving a copied occurrence does
  not move the original. Copied nodes may internally share frozen object identity;
  that is safe immutable structural sharing, not a geometry mutation defect.
- Removing a member deletes its incident transport input, its nonincident output
  partner, interval, and transport metadata, retaining the pool. Undo/redo restores
  the exact source snapshot.
- Twelve command variants have independent invalid-command atomicity and
  stale-before-getter proofs with redo retained. `removeQueries` no-ops retain
  document identity; saved/dirty checks and generic V2 document helper no-ops pass.
  Existing shared tests additionally cover successful conversion, adoption,
  detachment, pool creation/edit/rename/delete, constants edits, and query removal.

No additional documented-standard violation was established. These three findings
concern the source/spec contract and diagnostic behavior, not style heuristics.

## Reproduction and results

From `web/`:

```sh
./node_modules/.bin/vitest run src/app/core/authored-shared-review.spec.ts src/app/core/authored-shared.spec.ts src/app/core/authored-model.spec.ts src/app/core/authored-documents.spec.ts
```

Result: **104 passed, 6 failed, 110 total, 4 files**. All three existing suites
pass; the new review suite has **18 passed / 6 failed**. Four failures prove
finding 1; one each proves findings 2 and 3. Failures are intentionally retained
for the implementer to fix, with no `.skip`, `.todo`, or expected-failure marker.

The new test file passes focused strict TypeScript checking:

```sh
./node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --module preserve --moduleResolution bundler --lib ES2022,DOM --skipLibCheck --strict src/app/core/authored-shared-review.spec.ts
```

The first TypeScript invocation omitted TS6's `--ignoreConfig` and stopped with
TS5112; the corrected invocation above passed. Both new files pass a focused
Prettier check. These are lightweight, finite focused checks, run directly; no
worker jobs were launched or left behind.

## Limits and intentional gates

The implementer's 777-test/32-file baseline, app typecheck, build, repository-wide
formatting, and disjoint native 124/213 observations were reported inputs, not
independently rerun here. The focused checks above are the independent evidence.
The command proofs are sampled invariant checks, not exhaustive property testing
over every valid/invalid edit combination. No native Java or GUI experiment was
needed to establish these source-validator findings.

UI, codecs, clipboard integration, shared execution, and shared transitions remain
explicitly staged/gated. Their absence is not reported as a defect in this
internal slice. The existing shared oracle documentation is bounded headless
evidence with a substituted delay predicate; neither it nor this review establishes
full native GUI, file, composer, or shared-execution conformance.
