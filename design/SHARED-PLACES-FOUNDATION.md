# Internal shared-place foundation

Implemented 2026-10-29 against [SHARED-ELEMENTS.md](SHARED-ELEMENTS.md). This is an opt-in source/document increment. Shared places are **not usable in the app**. No UI, codecs, clipboard, execution, server, commit or PR was added. Shared transitions remain unsupported.

## Files and interface

- `src/app/core/authored-shared.ts`: `SharedSource`, `SharedComponent`, `SharedPlace`, geometry-only `SharedOccurrence`, `SharedQueries`, branded `SharedRevision`, `SharedDocument`, `SharedEdit`; `validateSharedSource`, `sharedFromAuthored`, `sharedConstantUses`, `captureSharedQueries`, `openSharedDocument`, `transactShared`.
- `src/app/core/authored-shared.spec.ts`: source validation, commands, protections, immutable history and hostile-input tests.
- `src/app/core/authored-model.ts`: exports the existing descriptor-first recursive inspector as `plainAuthoredTree`; extends `Use` with optional `poolId` and `activeMemberCount`. A pool use has neither component nor element IDs. Existing component/query use shapes and `Result`/`Issue` codes remain intact.
- `src/app/core/authored-documents.ts`: extracts the existing document shape as `SnapshotDocument<N>` and successful commit as `commitAuthoredSnapshot`. Existing V2 transactions call this helper. Undo/redo, dirty and saved markers operate on the same whole-snapshot shape for both adapters. There is no companion pool history or retained numeric history.

`sharedFromAuthored` first validates the old exact schema, then explicitly stages empty pools and membership protections. `SharedSource.shared` requires `places` and an empty `transitions` array. IDs are opaque stable strings, indexed with Map/Set or own-property-safe maps. Local IDs and names remain component-scoped; global pool names collide with every unrelated local place/transition, including inactive components.

Each timed declaration owns its count, sparse nonzero ages and authored invariant (`null` means default). Members contain only local ID, place kind, pool reference and geometry. Arcs/routes and transport pairs stay component-owned. All pools are validated, including unused ones. Constants uses count an invariant once per pool and report active-member count separately. Source validation does not allocate tokens or apply engine capacity limits.

The private `validationProjection` repeats effective pool values solely to reuse existing structural/timing/query validation. It is never exported, stored in source/history, returned on a revision, saved, or passed to an engine. Unused pools receive their own direct validation without fabricated component IDs. V3 source permits all-inactive components; the private check input temporarily marks the first component active only to satisfy the old structural validator. Source activity is preserved exactly. V2 behavior stays unchanged.

## Atomic commands

Call `transactShared(document, capturedSource, edit)`. Every command checks snapshot identity before inspecting the draft, validates the entire candidate, and commits through the existing document discipline. Success produces one whole-source snapshot; equal-source no-ops preserve document identity and redo. Failure preserves every input. Existing `undoAuthored`, `redoAuthored`, `markAuthoredSaved` and `isAuthoredDirty` accept `SharedDocument` directly.

Supported `SharedEdit.kind` values:

- `createPool {pool}`, `editPool {pool}` (including rename by stable ID), `deletePool {poolId}` (unused only).
- `makeShared {componentId, elementId, poolId, name}` transfers the exact local source count/ages/invariant into a new declaration.
- `usePool {componentId, elementId, poolId, acceptPoolValues}` joins an existing declaration without summing tokens. Differing authored values require explicit `true`; equal current numeric values do not erase symbolic differences.
- `addOccurrence {componentId, occurrence}`, `detach {componentId, elementId, name}`, `removeOccurrence {componentId, elementId}`. Detach copies pool **source** semantics with a valid fresh local name and retains the declaration. Removal deletes incident arcs and both halves/timing of affected transports.
- `copyComponent {componentId, id, template}` retains membership and pool marking once; copied geometry is independent. Copies are active, matching the existing workspace command.
- `updateConstant {id, name, value}`, `deleteConstant {id}` validate/protect unused declarations too.
- `patchGeometry {componentId, elementId, geometry}` accepts only position, label offsets and visibility. Semantic projections cannot enter this command.
- `removeQueries` explicitly drops XML and protections as its own undoable action.

`captureSharedQueries` retains opaque XML and captures all original constants, component symbols, pool symbols (including unused), and every original node's explicit local/shared membership. Protected rename/removal/conversion/detach fails until `removeQueries`. Added unprotected occurrences may be removed; protections are never recaptured during edits.

## Precise next-owner seam

This adapter is deliberately separate from `AuthoredNetwork` and the default `transactDocument` dispatch. Before UI integration, reconcile the V3 names/types at that existing document seam, then dispatch shared commands to this validator/adapter and continue storing one `SnapshotDocument<SharedSource>`. Do not keep a V2 document beside pool state or round-trip through a numeric network. Existing `editor-workspace`, files, clipboard, timed cores and App were left untouched.

Codec owners must implement strict V3 dispatch and preserve pool IDs/membership/terms/query protections. Current V2 imports still refuse a `shared` field. Native XML member repetitions require explicit agreement checks against declarations before constructing these geometry-only occurrences. This module is not a codec and allocates no native wire IDs.

Execution owners must consume a `SharedRevision` through a new deliberate compiler/session adapter. No numeric or resolved-engine field is exposed. Implement physical pool authority, active/dormant semantics, mappings and runtime capacity there; never execute the private validation projection. UI owners must use explicit pool semantic edits and geometry-only member patches, and add pool-aware use labels/navigation before displaying the new use locations. Clipboard shared-selection refusal remains a later integration task.

## Validation

Final checks: 777 tests / 32 files passing (32 new shared tests); TypeScript app check and repository formatting pass. Production build passes, initial bundle 578.74 kB, retaining the existing 500 kB warning/budget. Unchanged headless native harnesses pass 124/124 execution observations plus three web properties, and 213/213 timed-network observations. These verify preservation of existing disjoint paths; they do not establish shared execution or native GUI/file parity. No browser/server or manual environment was started; finite managed jobs were cleaned up.

Remaining integration work is intentional scope, not an enabled feature: V3 codec dispatch/roundtrip, execution/session semantics and native shared conformance, shared-aware workspace/UI/clipboard refusal. Parent should reconcile this staged interface before those owners proceed.
