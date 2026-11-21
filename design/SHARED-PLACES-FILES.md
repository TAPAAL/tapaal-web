# Opt-in shared-place file codecs

Implemented 2026-10-29. This is a separate file adapter over the internal shared
source foundation. Production app dispatch remains on scalar authored V2. Shared
places are still unsupported in the app; shared transitions remain refused.

## Interface and ownership

New `src/app/core/shared-files.ts` exports:

- `parseSharedModel(source, filename?)`, `parseSharedJson(source)`, and
  `parseSharedTapn(source, filename?)`, returning `{ network: SharedSource, warnings: string[] }`.
- `serializeSharedJson(source)` and `serializeSharedTapn(source)`, returning strings.
- `SharedImportResult` as the result type.

All failures throw before returning a partial source or file. `validateSharedSource`
is the source authority. No existing production, app, test or design file was
changed. No reader factoring or broader public inspection contract was needed.
The other new files are `shared-files.spec.ts`,
`test-fixtures/shared-files/timed.tapn`, and the optional native oracle pair
`SharedFilesReference.java` / `check-shared-files.mjs` under
`scripts/native-reference/`.

JSON writes `tapaal-web-network`, version 3. Its envelope and source are closed.
It preserves exact IDs, references, fractional geometry, rich layout, ages and
query protections. V2 migrates only through `parseAuthoredJson` and
`sharedFromAuthored`, including the old closed-schema check: a V2 source with a
`shared` field fails. V1/legacy use those existing readers too. Unknown versions,
fields and clipboard formats fail. Neither old authored nor numeric gates changed.

## Native inspection and authority

Root shared declarations must be direct, unprefixed elements in the PNML namespace
dialect already accepted by the existing reader. Only `name`, `invariant` and
`initialMarking` attributes are accepted; a declaration has no native ID slot.
Unknown attributes, nested/foreign declarations and all shared transitions fail.
Document-level comments/processing instructions are refused before adapting XML.

The reader indexes membership on original component/local-wire-ID pairs by exact
place-kind/name matching against root declarations. Duplicate IDs, duplicate local
names and kind collisions fail. Equal local names without declarations stay local.
On the original elements, before cloning, it compares each member count, sparse
nonzero age multiset and authored invariant spelling with its pool. Missing ages
mean zeros. Literal bounds and constant references remain different even when
numerically equal. A second comparison checks the parsed authored values.

A private inspection adapter moves each intact declaration subtree into a synthetic
isolated place and gives members collision-free private names. Original semantic
attributes, age children and dot ASTs survive this adapter and enter the existing
scalar inspector. That inspector validates constants independently of XML order,
scalar bounds, original AST consistency, transport terms, namespaces, feature/lens
flags and geometry before its numeric geometry clone is used. No pool/member
semantics are simply stripped and trusted to the old reader. The temporary
synthetic active component permits all-inactive input; original activity survives.
The synthetic template and semantic repetitions never enter returned source.

Pool IDs are deterministic `tapn:shared-place:<declaration-index>`. Members retain
component-local wire IDs; arcs retain those local endpoints, routes and transport
pairs. Pool source owns marking/invariant/ages exactly once, including unused pools.
Opaque queries are captured only against the final validated source. Protections
include all original constants, components, nodes, pools (including unused pools)
and local/shared memberships. Query text is neither executed nor rewritten.

## Native writing and verification

The writer first validates source. A private disposable wire projection uses the
existing authored writer to enforce native bounds/integer geometry and generate
fresh resolved dot ASTs. It writes root declarations plus consistent redundant
member values, restores source constant spellings, local arc paths and transport
halves, original active flags and opaque queries, with one XML declaration.
It never saves the source as a flattened numeric model.

Every export reopens through the shared reader and compares source meaning:
explicit pool-name, constant-name and component-template correspondence is used
for IDs without native slots. Local node/arc IDs, endpoints, geometry, symbolic
terms, global authority, memberships and query protections are checked. Pool ages
compare as decimal multisets; harmless optional geometry defaults are normalized.
Annotation IDs are checked too: a custom ID that native XML cannot retain causes
refusal with a JSON alternative. Fractional layout, noninteger native bounds,
transparent/negative-position annotations and any other unrepresentable values
retain the existing refusal behavior, with a JSON alternative. Query protection
snapshots that would be recaptured differently also refuse rather than silently
changing protections.

Web self-reopen fidelity and released native resave fidelity are different claims.
Released 4.0.4 resaves shared-member wire IDs using pool names and generates
inhibitor IDs; the oracle establishes explicit injective node/arc correspondence
before comparing endpoints and geometry. Its annotation loader/writer also adds
one to x/y/width/height; this difference is asserted explicitly. During development,
an off-grid inactive member position was observed snapping on native resave; the
accepted oracle fixture uses grid coordinates. This increment preserves the
existing integer geometry policy and does not claim arbitrary native GUI layout
identity. JSON is the exact source/identity preservation format.

Nonzero ages roundtrip through the web codecs, but **released 4.0.4 nonzero-age IO
compatibility is not claimed**. Native conformance inputs intentionally use zero
ages. Shared execution, GUI behavior, query execution and composer behavior are
outside this file adapter.

## Validation and reproduction

From `web/`, focused checks:

```sh
./node_modules/.bin/vitest run src/app/core/shared-files.spec.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
npm run format:check
```

43 focused tests cover timed/untimed, multiple/inactive members, unused pools,
all-inactive activity, source marking/age/invariant authority, Zero constants and
strict invariants, weighted transport/inhibitor paths, rotation, hidden names,
labels/notes, prototype-like IDs, global query protections, hostile original XML,
strict JSON dispatch, old migration, and refusal gates. Application typecheck and
repository formatting pass. Standalone strict checking of the spec was attempted;
this checkout has no `@types/node`, so its existing `node:fs` fixture import cannot
be typechecked that way. No dependency installation was needed or performed.

Full suite: **844 tests / 34 files pass** (baseline 801/33). Production build passes;
initial bundle remains **578.87 kB**, retaining the existing 500 kB warning.
All pre-existing production core files stayed unchanged, so prior disjoint native
124/213 evidence was not rerun or claimed anew.

After reading worker-job help/USAGE and checking capacity/list, from repo root:

```sh
worker-job run tapaal-shared-files-native-UNIQUE --memory 512M -- node web/scripts/native-reference/check-shared-files.mjs
```

The new oracle passes the released loader/writer assertions on both the original
accepted fixture and the web-written file, and reimports both released resaves.
It verifies global object aliases, unused marking, inactive membership, symbolic
pool invariants (including Zero), weighted transports/inhibitors, and explicit
native correspondence for wire IDs/geometry. The released jar is the existing
4.0.4 reference at `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib`.
Transport construction touches Swing classes, so the oracle uses `xvfb-run` without
creating a frame, application tab or Animator. No engine or marking method is
substituted. This is headless loader/writer evidence, not GUI validation.
Temporary compiled classes/XML are removed in `finally`; managed finite jobs
finish and clean their processes. No server or manual environment was started.

## Next owner seam

The new interface is explicitly opt-in. Future document/UI integration must choose
V3 dispatch deliberately, keep one `SharedSource` snapshot with existing history,
use pool-aware commands/protections, and retain clipboard gates. Execution needs a
separate compiler/session consuming `SharedRevision` with physical global pool
authority and active/dormant mappings. Do not pass these private wire projections
to an engine or expose them as document state. No UI, execution, dispatch, commit,
PR or deployment is included here.
