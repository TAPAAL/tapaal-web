# Wave 1 authored constants: independent review

Review of [CONSTANTS.md](CONSTANTS.md) and [CONSTANTS-WAVE1-STAGING.md](CONSTANTS-WAVE1-STAGING.md) against `src/app/core/authored-model.ts`, `authored-documents.ts`, `resolved-network.ts` and the `documents.ts` re-exports, 2026-10-29. Production code and existing specs were not edited. The proof is `src/app/core/authored-review.spec.ts` (10 tests). It was run alone in `worker-job run tapaal-authored-review-4`: **7 pass, 3 fail**. The 3 failures are the defects below. The broad suite, build and native comparisons were not rerun. The implementation's reported counts are prior evidence, not results reproduced here.

## Defects

### F1 (medium): non-enumerable array entries pass validation, then cloning drops them

`authored-model.ts:163–167` (`plainTree`, array branch) checks that each index is an own data property. Unlike `closedAuthored` (`:145`), it does not check `descriptor.enumerable`. `structuredClone` copies only enumerable indices, so a hidden entry passes every check and then becomes a hole in the stored revision (`:413`, and again in `openAuthoredDocument`, `authored-documents.ts:97`). Contract: hidden fields are rejected before cloning can erase evidence.

Hidden entries inside a component `net` (nodes, arcs, notes, bends) are caught by accident: the numeric projection clones them away and `validateNetwork` then fails. That case is proved in the spec. Arrays the projection reads from the source instead (`constants`, `savedQueries.protectedConstants`, `savedQueries.xml`) and `timing.urgent` are not caught:

- `resolveAuthored({...s, constants: [hidden K, D, Zero]})` with weights referencing K returns `ok: true`. `value.source.constants[0]` is `undefined`, so the revision keeps references to a declaration it no longer contains. Expected: `ok: false`.
- `openAuthoredDocument` with a hidden `protectedConstants[0]` succeeds. The stored protection list has a hole. Every later `transactDocument` then fails `Invalid array entry`, including a valid value change and `removeSavedQueries`, so the document can no longer be edited. Expected: refused at open.

Reach: this needs a crafted in-memory object. JSON parsing cannot produce one, and no file adapter exists yet. Suggested fix (not applied or run here): add `descriptor.enumerable` to the array-entry check at `:165`. The three F1 tests in the spec are the regression guard.

### F2 (low): `openAuthoredDocument` does not validate `options.session`

`authored-documents.ts:109–111` clones any supplied session without checking it. `openAuthoredDocument(source(), { session: { componentId: 'nope', views: {} } })` returns `ok: true`, and the document is viewing a component that does not exist. `sessionFor` only repairs this after the next history move. The numeric `openNetworkDocument` always derives the session (`documents.ts:217`). Expected: refuse, or reconcile with `sessionFor` and check the shape with `closedAuthored`/`plainTree` before cloning. Today accessors on the session are run by `structuredClone` instead of being rejected.

## Contracts verified with focused proofs (pass)

- Ages are validated against a symbolic invariant in an **inactive** component. `D 5→2` with age 3 under `<= D` is refused and the document is unchanged. `D→3` commits exactly one history entry.
- `[Zero,inf)` stays authored while the numeric projection omits it. The same guard on an urgent transition's input is refused.
- The numeric core does not let authored terms through: `validateNetwork` throws on a `{constantId}` weight and on a `{constantId}` invariant bound.
- `copyComponent` (copying an inactive component) keeps the global binding IDs, ages, transports, intervals, angle, hidden names, bends and notes. Uses include the copy, so deleting the constant is refused (`in-use`).
- Removing an arc pair through `patchNet` drops its interval, transport and uses. Saved-query protections are kept unchanged. Removing protected nodes and renaming a protected constant are refused, and a value change is allowed. `removeSavedQueries`, then a rename, undoes twice back to the exact protected snapshot by identity, and redo restores the query-free snapshot by identity.
- Edit payloads are not frozen or aliased. A transport weight setter updates both halves.

## Read without separate proof (no defect found)

- Declarations: regex, exact-case `inf` reserved, duplicate IDs and names via `Map`/`Set`, range 0…2147483647. Duplicate or extra protected constants, and a name that does not match its declaration, are refused.
- Transport terms are compared by fingerprint, so two different constants with equal values are refused.
- The stale check is by identity and runs before the edit is read. A no-op returns the original `doc`, keeping its redo history. A failed edit returns before any new object is made.
- Numeric migration maps snapshot identity once, so aliases between current, saved, past and future are shared.
- Wave 1 adds no path that recaptures protections. `captureAuthoredSavedQueries` is called only by the caller.
- The `documents.ts` re-exports match `resolved-network.ts`. Byte-equality of the extracted validators could not be checked by diff because `web/` is untracked in this worktree.

## Observations for later waves (not defects in wave 1)

- Authored `copyComponent`/`addComponent` keep the supplied `active` flag and do not switch the session. The numeric `copyComponent` always makes the copy active and switches to it (`documents.ts:493–520`). The UI bridge must choose which behavior to keep.
- Numeric `validateNetwork`/`openNetworkDocument` ignore unknown top-level keys. A cast `AuthoredNetwork` that contains only literals would be accepted, and its `constants` would be dropped silently on a numeric save. TypeScript types prevent this today. The opt-in bridge must not pass authored data through numeric factories.
- Undo/redo returns earlier snapshot identities, so an `expected` captured before an undo becomes valid again after a redo (ABA). This is documented as identity, not a generation counter. The UI needs its own async guard.

## Limits

No native oracle was run, and none was needed: no claim depended on a native ambiguity. No interoperability, file I/O, UI, query execution or symbolic-zero urgent behavior is claimed. Shared, coloured, game and stochastic models were checked only by reading the existing gate. The prior suite, typecheck, build and native comparison counts were not reproduced.

## Owner follow-up — F1/F2 fixed

Array validation now requires enumerable own data descriptors before cloning. Opening an authored
document validates the options and supplied session without evaluating getters: the selected
component must exist, view records must have the declared shape, viewport values must be finite
with positive zoom, and selection IDs must form a dense enumerable data array. Failures return
structured issues rather than throwing or repairing away malformed input.

All 12 review proof tests pass, including two new session getter/view tests; all 65 focused
foundation tests pass. The full suite passes **613 tests in 26 files**. Application typecheck,
production build and formatting pass. Initial size remains 534.91 kB with the existing 500 kB
warning; no budget changed. No numeric engine/validator extraction was modified for these fixes,
so native comparisons were not repeated. No browser/server workload was needed or retained.

Clarification to the later-wave cast observation: numeric document factories and legacy Net
extraction are not authored-data adapters. Current whole-network JSON/TAPN serializers already
call a closed-field validator and refuse the extra constants field. The risk of losing unused
declarations applies to routing through numeric legacy-Net extraction, not to the current app's
whole-network save path. Future opt-in adapters must retain authored authority throughout.
