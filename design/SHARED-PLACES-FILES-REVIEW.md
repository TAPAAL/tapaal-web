# Independent shared-place codec review

## Owner follow-up

The comparator now normalizes only typed reference fields: authored scalar terms,
occurrence pool references and query protection references. Timing-record keys
remain opaque IDs. Missing reference correspondence fails explicitly instead of
becoming an omitted undefined field. The three original failing proofs now pass;
six additional fault-injection checks cover interval references and token ages
under each of the three special-looking IDs. All 90 focused codec tests pass.
The finding established a verifier weakness, not an ordinary unmodified-writer
data-loss path; that distinction remains unchanged.

Reviewed 2026-10-29 against `SHARED-ELEMENTS.md`,
`SHARED-PLACES-FOUNDATION.md`, and `SHARED-PLACES-FILES.md`. Read the shared
codec, shared-source validator/query capture, authored and numeric codecs, timing
and dot inspectors, native loader/writer source, and the existing bounded
`SharedFilesReference.java` / `check-shared-files.mjs` oracle.

Only this new report and `../src/app/core/shared-files-review.spec.ts` were
created. Production, existing tests, and existing documents were read-only.
No fixes, subagents, commits, PRs, deployments, servers, or worker jobs were used.

## F1 — P2: export verification loses timing entries whose IDs resemble reference fields

Location: `src/app/core/shared-files.ts:282–294`, used by the final verification
in `writeSharedTapn`.

The recursive `normalize` function interprets **every** object key named
`constantId`, `sharedId`, or `componentId` as a reference. These are also valid
opaque local node/arc IDs, including keys of timing records. For example:

```ts
invariants: {
  constantId: { upper: { constantId: 'tapn:constant:1' }, upperClosed: true }
}
```

At the outer `constantId` key, normalization calls
`constants.get(invariantObject)` instead of descending into the invariant.
That lookup is undefined, and the fingerprint omits the entry. The same happens
for `sharedId` and `componentId` through the other name maps. Entire invariant,
interval, or age values under these keys consequently evade comparison.

The new proof at `shared-files-review.spec.ts:279` constructs and validates an
independent shared model with a local place whose invariant references `Limit=5`.
It first lets the actual authored writer serialize the private projection, then
uses a test-only spy to change just that place's emitted invariant from
`<= Limit` to `<= 5`. Everything else, including IDs, topology, pool authority,
and numeric value, remains unchanged. This deliberately tests the independent
export verifier's contract; it does not replace the parser or verifier.

- With ordinary ID `local`, shared export correctly refuses with verification
  failure and the JSON alternative.
- With ID `constantId`, `componentId`, or `sharedId`, shared export succeeds.
  Reopening the returned file confirms that the original reference became literal
  string `"5"`. The three expected-refusal proofs fail unskipped.
- Without the test-only perturbation, ordinary exports for all three IDs pass
  exact reopen checks. **No naturally occurring reference-loss path in today's
  unmodified writer was established.** This is a verified defect in the required
  independent loss-detection guard, not evidence that ordinary exports currently
  flatten those references.

The distinction matters: changing `Limit` later would change the original model
but leave the accepted perturbed export's local invariant at 5. Numeric equality
at export time cannot justify this comparison. The documented requirement says
that self-reopen compares authored references and meaning, including exotic IDs.

Required correction: normalize references at known typed fields/records. Preserve
opaque keys of intervals, invariants, and ages, and normalize their values according
to their shape. Do not reject these valid IDs or treat a missing map lookup as an
acceptable correspondence. Keep the three failing proofs and ordinary-ID control;
cover all timing-map kinds when revising the comparator.

## Verified behavior and conservative refusals

The independent 41-test review suite has 38 passing tests plus the three F1
failures. Its non-injected tests establish:

- Pool marking is owned once, unused pools retain count/invariant, inactive members
  retain activity, and occurrences contain geometry/membership rather than semantic
  repetitions. Local endpoints stay local. All-inactive files remain inactive;
  removing declarations leaves equal local names disjoint.
- Root/member age multisets compare rather than age sums; omitted lists and explicit
  zeros agree. Different nonzero multisets disagree. A literal invariant equal to a
  constant reference numerically is refused on original XML. An invalid unused
  pool's strict zero invariant fails.
- Root count conflicts, unknown declaration attributes/content/text/comments,
  foreign namespaces, member attributes/namespaces, duplicate wire IDs, and
  wrong-kind membership collisions fail. Code inspection additionally confirms
  direct/unprefixed declarations, duplicate-name checks, nested/shared-transition
  refusal, original document-level inspection, and preservation of semantic
  subtrees into the authored inspector before numeric geometry adaptation.
- Root and member dot AST conflicts fail even when AST text and tree agree with
  each other. Constants declared after uses work. Weighted transport terms/routes,
  curved endpoints, inhibitor weight, transition rotation, labels, and hidden/default
  geometry behavior retain the existing codecs' contracts. Literal versus reference
  transport halves fail despite equal numeric weight.
- Local timing under `constructor`, `__proto__`, and the three F1 IDs normally
  roundtrips. Own-key timing maps prevent prototype-name confusion. Explicit
  optional geometry defaults can reopen without retaining redundant optional keys;
  the effective geometry agrees.
- Query XML roundtrips, protections capture unused global pools and all memberships,
  and local membership is explicitly null. A source with a valid smaller protection
  snapshot is refused on native export when native reimport would strengthen it;
  JSON preserves it exactly. This is a safe conservative refusal, not silent loss.
- V3 fractional geometry is preserved exactly in JSON and refused for native export
  with a JSON alternative. Unknown V3 fields/versions, malformed sources, envelope
  extras, clipboard format, and V2 shared payloads fail. Old-valid V2, numeric V1,
  and legacy single-net files migrate through existing readers. Existing authored
  and numeric readers continue to refuse shared XML.
- A generated file contains one XML declaration and is accepted by jsdom's XML
  DOMParser. This is browser-style XML parsing evidence, not a separate real-browser
  or GUI run.

The existing 43-test shared codec suite was also run unchanged and passes. It
adds coverage for prefixed/nested declarations, all-inactive behavior, untimed
shared files, rich layout, pool constant/reference spelling, arbitrary pool/
constant/component IDs, annotation identity refusal, and unrepresentable counts.

No second correctness finding or source-backed excessive refusal of common valid
native shared models was established. Documented unsupported feature gates,
integer geometry/bounds limits, annotation identity limitations, and staged
production dispatch are not findings. UI, execution, shared transitions, and
shared-aware clipboard integration remain deliberately unavailable.

## Reproduction and limits

From `web/`, final focused run:

```sh
./node_modules/.bin/vitest run src/app/core/shared-files-review.spec.ts src/app/core/shared-files.spec.ts
```

Result: **84 tests: 81 pass, 3 fail; 2 files: 1 passes, 1 fails; exit 1**.
All failures are F1 and remain unskipped. Formatting of the new spec passes.
No full suite, application typecheck, production build, dependency installation,
released Java oracle, existing disjoint native harnesses, browser UI, or nonzero-age
native IO was run in this review. The implementer's 844/34, typecheck/format/build,
578.87 kB bundle/500 kB warning, and released 4.0.4 assertions remain supplied prior
evidence rather than new review results.

The existing native oracle is appropriately bounded: zero-age loader/writer
assertions, native global object aliases, unused marking, inactive membership,
symbolic pool/transport terms, weighted inhibitors, and explicit node/arc
correspondence on its fixture. It records annotation rectangle increments and
member/inhibitor ID normalization. It does not establish arbitrary layout parity,
query execution, GUI behavior, shared execution, or released nonzero-age IO.
There are no review-owned processes or environments to clean up.

## Next required seam

First repair the shape-directed shared export comparator and turn the three F1
proofs green without weakening authored-reference equality or opaque-ID support.
Then rerun the existing focused codecs and appropriate regression gates. This
review does not authorize production fixes.

After that, document/UI integration must deliberately select the V3 adapter and
retain one shared source snapshot, membership protections, and pool-aware commands.
Execution still requires a separate compiler/session that consumes `SharedRevision`
and implements physical global authority plus active/dormant mappings. Private
wire projections must never become source state or executable engine input.
