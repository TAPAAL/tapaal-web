# Wave 2 authored file codecs: independent review

Review of `src/app/core/authored-files.ts` and its spec against [CONSTANTS.md](CONSTANTS.md), [CONSTANTS-WAVE1-STAGING.md](CONSTANTS-WAVE1-STAGING.md), the wave 1 review owner fixes, and the `network-files.ts` scalar hooks. Date: 2026-10-29. The native oracle results in `/tmp/tapaal-constants-complete-96722a31/results.json` and `TimeInterval.java`/`TimeInvariant.java` were read but not rerun. No native execution was needed, because no finding depends on a native ambiguity. Production code and existing specs were not edited.

The proof is the new `src/app/core/authored-files-review.spec.ts`, 32 tests. It was run alone and directly, as a lightweight focused test: **23 pass, 9 fail. The suite is red until F1 is fixed.** All 9 failures come from F1. The broad suite, build and native comparisons were not rerun. The implementation's counts (638/27, 124/213) are prior evidence, not reproduced here.

## F1 (medium): node or arc IDs that are `Object.prototype` names break authored TAPN export and refuse symbolic import

`validateName` (`net.ts:90`) accepts IDs such as `constructor`, `toString`, `hasOwnProperty` and `__proto__`. The numeric codec exports these IDs. The authored codec reads its timing records with plain bracket lookups, so inherited members are treated as authored terms:

- **Export.** `authored-files.ts:369` (`component.timing?.intervals[...]`) and `:379` (`component.timing?.invariants[id(place)]`) return `Object.prototype.constructor`/`toString`/the prototype object when the record has no own entry. `formatInterval`/`formatInvariant` then write `(undefined,undefined)` or `< undefined`.
  - Place `q` renamed to `constructor`, with a literal `< inf` invariant: `serializeAuthoredTapn` throws `Undefined constant or unsupported scalar "undefined" in place constructor`.
  - Output arc `out` renamed to `toString`: it throws `Unsupported output arc inscription "(undefined,undefined)"`.
  - Expected: an exact round trip. The numeric control exports the same network.
  - It fails closed, so nothing is lost silently. But a valid document cannot be saved as TAPN, and the diagnostic is misleading.
- **Import.** `:251–252` build the records by object spread, and `:262`/`:266` assign `record[arc.id]` / `record[id(element)]`. For `__proto__`, that assignment sets the record's prototype instead of creating an own key. `resolveAuthored` then refuses with `Inherited model fields are unsupported.`
  - Repro: place `p` renamed `__proto__` with `<= D`. Expected: an own key, as `Object.fromEntries` produces.

**Fix (verified on a temporary patched copy, since deleted).** Collect the parse records in `Map`s and emit them with `Object.fromEntries`. At export, look up with `Object.hasOwn(record, key) ? record[key] : undefined`. With that patch, 31/32 proofs passed. The remaining `__proto__` symbolic case then refused at the authored verification guard (`TAPN export verification failed`). The proof accepts that outcome, because of O1 below. Expected after the fix: 32/32.

## Observation O1 (pre-existing numeric codec, outside wave 2)

`timed-files.ts:119–129` (and intervals at `:173`, `:188`) use `{}` records with bracket assignment. A numeric TAPN with `<place id="__proto__" … invariant="&lt;= 5"/>` opens with `Object.keys(invariants) = []` and a non-Object prototype on the record. `serializeNetworkTapn` re-exports `invariant="&lt; inf"`: this is silent semantic loss in the currently shipped numeric path. Its internal round-trip guard compares numeric meaning, which has already lost the invariant on both sides. Fixing it means using own-key records in the numeric reader, plus a `validateComponentTiming` prototype check. This is not caused by constants work. It is reported here only because the authored guard depends on that reader.

## Contracts verified with focused proofs (pass)

- **Dot AST.** A redundant AST is accepted with coefficient 1 or the resolved weight (`2'dot`, K=2). A stale coefficient (`3'dot`/3), a symbolic `K'dot`/`numberconstant value="K"`, and a text/tree conflict (`2'dot`/1, `1'dot`/2) are refused.
- **Declaration gates.**
  - A `<constant>` inside `<net>` is refused.
  - A foreign namespace, a namespaced extra attribute and comment content on a constant are each refused.
  - A lower bound of `inf` is refused.
  - An upper bound of `Inf` binds a declared constant. This matches native `TimeInterval.parse`, which special-cases only exact `inf`.
- **Ambiguous inputs.** A transport pair with a literal `2` against reference `K` (equal value) is refused. So is the guard pair `[0,D]` against `[Zero,D]`, and an arc without an ID.
- **Untimed networks.** Symbolic weights and an unused declaration round-trip. A symbolic guard in an untimed network is refused.
- **Edit chain through `authored-documents`.** The chain was: copy a component, make the copy inactive, rename protected D (refused, `query-protected`), `removeSavedQueries`, rename D→Limit with value 6, set a literal weight 3, set `<= Zero` on the inactive copy, add an unused declaration.
  - The TAPN export contains names only: `[K,Limit]` in both components, `<= Zero`, and `Unused`. It contains no `D`, `NaN` or `undefined`.
  - Reload gives the same declarations and active flags, and the copy's `out` weight still references K.
  - The JSON v2 round trip is deep-equal.
  - Seven undos return the exact imported snapshot.
- **Prototype-like constant.** An ID/name `__proto__` survives JSON v2 as own data and exports `<constant name="__proto__"/>`.

## Read without separate proof (no defect found)

- **Inspection order.** `inspectNativeTapn` runs on the original document with the scalar hooks before the clone is resolved. Only root `<constant>` children are declarations. Query/watch content goes to the unchanged saved-query validator; a watch `<constant>` is refused there, which is the known capability gate. DOCTYPE/ENTITY, comments and PIs are refused. Character references decode to ordinary names.
- **Scalar grammar.** Declarations accept `^\+?\d+$` (Java `parseInt`-compatible) up to 2147483647; names match the model regex and exact `inf` is reserved. Uses accept unsigned digits or an exact declared name, so a native-permissive `+2` weight is refused.
- **ID repair.** Node/arc IDs are checked for uniqueness per component before parsing. After parsing, node and arc IDs are checked against the original, so a repair by the geometry parser fails rather than rebinding.
- **Export guard.** The guard maps references to declaration names in the `bindings`, alongside the numeric canonical meaning, the declarations, the query XML and the protections. Flattening a reference to an equal literal would therefore change the fingerprint. That is not a numeric-equality-only check. The output has a single XML declaration.
- **JSON.**
  - The top level is closed (`format`, `version`, `network`), and v2 delegates to `resolveAuthored`'s closed-shape checks.
  - v1 and legacy single-net files go through the closed numeric readers, then `authoredFromNumeric`. There is no constants-flattening fallback: `files.ts` `parseJson` only validates a numeric net.
  - Numeric `parseNetworkJson` refuses v2, and the numeric serializers refuse authored data (existing spec).

## Limits

There is no claim of native parity, interoperability, public support, UI behavior or query execution. Proofs use the scalar fixture and small variants only. Coloured, game, stochastic, sets/reals and symbolic-zero urgent cases were checked by reading the existing gates and spec, not with new proofs. No worker-job, server or browser was used; no jobs are left running.

## Owner follow-up — F1 and numeric O1 fixed

Authored parse records now use Maps and become own data entries via Object.fromEntries.
Export reads only own interval/invariant keys, so prototype members cannot become terms.
The numeric timing reader also collects invariants, intervals and initial ages in Maps before
creating records, fixing the pre-existing silent loss for **proto** IDs.

All **32 review proof tests pass**. The symbolic **proto** test now requires exact round trip;
it no longer accepts refusal by the verification guard. Four additional numeric codec tests
exercise prototype-named places and input arcs, including own invariant, initial-age and
interval entries and exact export/reopen equality. All 46 focused codec tests pass.

The full suite passes **674 tests in 28 files**; application typecheck, production build and
formatting pass. The released 4.0.4 scalar constants oracle was rerun successfully; evidence is
`/tmp/tapaal-constants-codec-review-native/results.json`. The existing 500 kB warning remains
(initial 535.43 kB); no budget was changed. No browser/server was needed and no owned workload
remains. Public UI constants support is still gated pending integration.
