# Wave 1: opt-in authored schema, unchanged numeric callers

Implementation follow-up to [CONSTANTS.md](CONSTANTS.md), 2026-10-29. This records the explicitly requested safe-staging adjustment; it does not replace the original authored-authority decision. This is schema support, not public constants support or a native-file compatibility claim.

## Staging decision

`NetworkDocument.network`, its history, existing numeric editors, file adapters and engines retain their existing types and behavior. Wave 1 introduces a separate `AuthoredDocument`. Its current/saved/past/future snapshots contain declarations and literal-or-ID-reference terms only. There are no sparse overrides, stored numeric projections, numeric history copies or cached evaluated values.

`resolved-network.ts` extracts the existing `Network`, `Component`, `ComponentTiming`, `emptyTiming`, `validateComponentTiming` and `validateNetwork` definitions. `documents.ts` re-exports the original Interface. The validation bodies and numeric rules are unchanged. Existing single-component timed projection and all document mutation functions remain in `documents.ts`.

## Authored Interface

`authored-model.ts` provides:

- `AuthoredNetwork`, `AuthoredComponent`, `AuthoredNet`, `AuthoredArc`, `AuthoredTiming`, `AuthoredInterval`, `AuthoredInvariant`, `ConstantDecl`, `WeightTerm` and `BoundTerm`. Geometry and timing fields reuse the numeric shapes with deep readonly authoring types. Declarations are global, including inactive components. Binding identity survives renaming.
- `resolveAuthored(source): Result<ResolvedRevision>`. A privately branded, readonly result contains an immutable source revision and a deeply frozen numeric projection. Already deeply frozen source snapshots retain identity. Mutable import inputs are copied, never frozen in place. The projection cannot satisfy the authored schema or be committed as authored data. The numeric property has deep readonly types; current engine signatures require an explicit isolated numeric copy in a future adapter (tests use `structuredClone` with the numeric type). No engine, UI or serializer calls resolution implicitly.
- `constantUses(source, id)`, deriving immutable structured component/element/field locations and separate saved-query protection uses from a validated source. Failure results include issue codes, messages and relevant uses. Numeric whole-network validation failures may list all model uses, rather than claiming a minimal conflict set.
- `authoredFromNumeric(network)`, a validated immutable migration with `constants: []`. It refuses authoring metadata at this seam instead of silently flattening it.
- `captureAuthoredSavedQueries(source, xml)`, for one-time import/capture. It validates the existing opaque-query format and protects every current declaration. Transactions never call it or recapture protections.

Resolution rejects unknown keys, inherited records, accessors, hidden keys and malformed arrays before cloning can erase them. It checks declaration IDs/names/ranges, binding closure, every authored scalar position and exact transport-term identity, then validates the entire numeric projection using the extracted validators. Numeric defaults are omitted only in the projection; a symbolic-zero guard remains in the source. Literal default intervals/invariants must be omitted from the authored schema (setter callers use `null` to clear them). Symbolic urgent input guards are conservatively refused even at zero. Decimal literals remain valid web authoring values; native representability remains a later file-adapter gate.

Query XML and original component/node protections are validated with the unchanged legacy query validator. Extra constant protections are separately validated. Only after validation is all query metadata omitted from the disposable numeric projection. The authored source retains XML and protections. Existing numeric query guards and unsupported-key engine guards are unchanged.

Structural validity remains separate from explicit-token execution capacity: oversized but structurally valid models can resolve; the existing engines still refuse execution beyond their limits. Resolution does not expand initial tokens. Coloured, game and stochastic models remain unsupported.

## Transactions and migration

`authored-documents.ts` provides `openAuthoredDocument`, `authoredDocumentFromNumeric`, `transactDocument`, `undoAuthored`, `redoAuthored`, `markAuthoredSaved` and `isAuthoredDirty`.

The closed `AuthoredEdit` union includes declaration add/update/delete; weight, interval and invariant setters; a restricted authored graph patch; component add/copy/remove/active/template edits; network rename; and explicit removal of saved queries. A weight setter updates both transport halves together. A graph patch can move or add/remove elements and preserve every geometry field, but retained arcs must keep their authored weight, kind and endpoints exactly. Changing weight uses its dedicated setter; removing one transport half is refused. Timing for removed elements is removed, and age-count and query protections remain enforced. Same-document component copies keep global constant IDs and complete timing/geometry. No clipboard protocol is introduced.

`transactDocument(doc, expectedNetwork, edit)` checks captured revision identity before interpreting the draft, clones the candidate, applies one explicit edit, preserves query metadata, and validates the whole candidate. An invalid edit leaves all input identities unchanged. A no-op returns the original document, including its redo history. A successful change creates one authored history entry and clears future history. Saved snapshots and sessions retain their existing identities unless navigation must be reconciled after component removal. Undo/redo restores exact authored snapshots. As in the design, the expected token is snapshot identity, not a monotonically increasing generation counter.

The numeric-document migration converts current, saved, past and future snapshots to authored snapshots, preserving shared revision identities and session state without changing the original document. Existing UI callers continue to use the legacy document factories. Integration with UI draft lifetimes, simulator invalidation, additional timing-edit commands (urgency, transports and ages), file-open migration, native name mapping and save adapters belongs to subsequent waves. Callers must not feed numeric projections back into authoring or saving.

## Verification

The final complete regression run passed 601 tests in 25 files (548 existing tests plus 53 new tests in `authored-model.spec.ts` and `authored-documents.spec.ts`). App typechecking (`tsc --noEmit -p tsconfig.app.json`), production build (`ng build`) and full existing formatting checks passed. These checks ran sequentially in `worker-job run tapaal-authored-final-1`. The production initial bundle is 534.91 kB; the unchanged 500 kB budget emits its existing warning. No budget adjustment was made.

Both existing differential scripts were rerun unchanged after extraction:

```sh
worker-job run tapaal-authored-native-1 -- bash -c \
  'node scripts/check-execution-conformance.mjs /tmp/tapaal-authored-execution-96722a31 && node scripts/native-reference/check-timed-network.mjs /tmp/tapaal-authored-timed-96722a31'
```

Run from `web`, with the installed native 4.0.4 library at `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib`. The first comparison passed 124 native/web observations plus three web properties; the second passed 213 observations across 12 cases. Results are in the two output directories' `results.json` files. `tapaal.jar` SHA-256: `60914b11e6fffa6f9be8f481c51b945fd16c8f4fef9d31bc2d8d5db93f88cd5d`.

These checks establish numeric regression evidence, not symbolic native parsing, GUI behavior, query execution, clipboard compatibility or the unresolved native symbolic-zero urgent-input oracle. Native file parsers, UI modules, numeric engines and their tests were not edited. No server, commit, PR or deployment is part of this wave.
