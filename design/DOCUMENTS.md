# Document/network core

The app now wires this tested core API into document tabs, component controls, and whole-network history. `documents.ts` provides immutable document/workspace transactions around the existing `Net`; `model-types.ts` represents native dimensions and separately declares capabilities. The separate `network-files.ts` adapter handles whole-network persistence. Shared elements, composition execution, and expanded simulation semantics remain unsupported.

## Native basis

Sources are relative to the repository root:

- `src/main/java/pipe/gui/petrinet/PetriNetTab.java`: template GUI/zoom maps (142–146), add/remove (995–1011), switching (1405–1421). Component model and view state are distinct.
- `src/main/java/net/tapaal/gui/petrinet/editor/TemplateExplorer.java`: ordering (228–287), add/rename/copy/remove (295–416), activation (789–876). At least one component must remain active. Removing the last active component is refused here; another is not silently activated.
- `src/main/java/net/tapaal/gui/GuiFrameController.java` (128–177): multiple tabs and close handling.
- `src/main/java/net/tapaal/gui/petrinet/TAPNLens.java` (20–33): constructor preserves time/game/color and clears stochastic unless timed and nongame. `normalizeModelType` follows this rule.
- `src/main/java/net/tapaal/gui/petrinet/dialog/NewTAPNPanel.java` (354–370): selecting stochastic forces timed/nongame; selecting game or untimed clears stochastic. `selectModelDimension` implements this separate last-choice rule. Color remains independent.

See `NATIVE-PARITY.md` A1–A8 and E1–E6 for broader requirements. This module establishes a data/editing boundary, not native feature parity.

## Identity, persistence, and sessions

`Network.name` is a display title: nonblank, at most 200 characters, spaces allowed. Each component's `net.template` is its unique identifier name, using existing `validateName`: letters/underscore first; then letters, digits, underscores; true/false reserved. Its UUID `Component.id` survives rename/reorder. Document IDs survive all operations. `Net.name` mirrors the root title because legacy Net APIs require it. `renameDocument` updates all mirrors atomically; `commitComponentNet` refuses accidental title/component renaming.

Node/arc IDs and node names are local to each component. Copy retains local identities and geometry but assigns a new component UUID and a caller-supplied unique identifier name. Address elements across components by `(documentId, componentId, elementId)`.

`Network` holds `name`, `type`, and ordered `components`; a component holds `id`, `active`, and complete `net`. Validation calls `validateNet` per component and requires unique component IDs/names, at least one component, and at least one active. There is no flat union or invented shared element.

`NetworkDocument` holds `id`, current `network`, whole-network `past`/`future`, `saved`, and `session`. A new document has `saved: null`, hence is dirty even when empty. Dirty compares persistent content with the saved snapshot, ignoring object-key insertion order. Undo back to saved content becomes clean. Commit after undo drops redo; no-op commits preserve it. History is currently unbounded.

`DocumentSession` holds viewed `componentId` and per-component `views`. Viewing an inactive component is allowed. Switching and viewport/selection changes never dirty the document or enter history. Removing the viewed component selects the first remaining component. Undo restores structure without rewinding session navigation. Dormant views survive deletion for undo reuse. The UI must filter stale selection IDs against current elements before acting on them. Simulation, tools, gesture previews, dialogs, and file handles stay outside persistent `Network`.

Returned snapshots are recursively frozen at runtime. Nested Net types remain compatible with legacy APIs. Inputs are deeply cloned at storage seams using `structuredClone`; `activeNet` and `legacyNetFromNetwork` return writable isolated clones. Clone/spread retains optional nested geometry unknown to this layer. The contract is plain serializable Net data, not Maps, class instances, or cyclic extension data. Geometry preservation here does not imply unknown XML or semantic preservation by existing writers.

## Exact API

Mutations return a new value: assign it. They never mutate the input. Invalid operations throw `Error`; retain the original state and show its message. Factories reject unsupported types instead of normalizing away requested semantics.

| Function                                                                          | Contract                                                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `normalizeModelType(type)`                                                        | Frozen metadata using native TAPNLens normalization.                                                                                       |
| `selectModelDimension(type, dimension, value)`                                    | Frozen metadata using native dialog last-choice normalization.                                                                             |
| `validateModelType(type)`                                                         | Requires booleans and legal stochastic combination; does not coerce.                                                                       |
| `modelCapabilities(type)`                                                         | `{editable, executable, reason}`; only all-false dimensions qualify. Execution means local P/T simulation, not verification.               |
| `requireEditableModelType(type)`                                                  | Throws with unsupported dimensions and precise implemented-subset explanation.                                                             |
| `validateNetwork(network)`                                                        | Validates structure, legal metadata, and each Net; grants no capabilities.                                                                 |
| `networkCapabilities(network)`                                                    | Same capability shape for supported disjoint untimed networks, including multiple active/inactive components.                              |
| `createDocument({name, componentName = 'Net', type = SUPPORTED_MODEL_TYPE, id?})` | New unsaved editable document with one active component; UUID IDs by default.                                                              |
| `openNetworkDocument(network, {id?, saved = false}?)`                             | Cloned editable document; `saved: true` for successfully loaded supported content.                                                         |
| `networkFromLegacyNet(net)`                                                       | Validated cloned one-active-component network; fresh component UUID.                                                                       |
| `legacyNetFromNetwork(network)`                                                   | Writable clone only for exactly one component and supported type. Refuses lossy multi-component extraction, including inactive components. |
| `activeNet(doc)`                                                                  | Writable clone of viewed component; not network save/composition.                                                                          |
| `commitComponentNet(doc, net, componentId = doc.session.componentId)`             | One whole-network history entry; retains component identity/activation. Names must match.                                                  |
| `commitNetwork(doc, network)`                                                     | Validated atomic grouped transaction; caller preserves intended IDs and name mirrors.                                                      |
| `renameDocument(doc, name)`                                                       | Rename title/all mirrors in one undo step.                                                                                                 |
| `addComponent(doc, name, sourceNet?)`                                             | Add active empty/copied component with fresh ID; switch to it.                                                                             |
| `copyComponent(doc, sourceId, name)`                                              | Deep copy with fresh component ID/supplied identifier; switch to copy.                                                                     |
| `renameComponent(doc, id, name)`                                                  | Rename identifier without changing ID.                                                                                                     |
| `removeComponent(doc, id)`                                                        | Remove unless last component/last active component.                                                                                        |
| `setComponentActive(doc, id, active)`                                             | Undoable activation; refuses last deactivation.                                                                                            |
| `reorderComponents(doc, ids)`                                                     | Requires full permutation of component IDs.                                                                                                |
| `switchComponent(doc, id)`                                                        | Session view only.                                                                                                                         |
| `setComponentView(doc, view, id = doc.session.componentId)`                       | Clone `{viewport: {x,y,zoom}, selectedIds}`; finite coordinates, positive zoom. UI helpers enforce native zoom range.                      |
| `undoDocument(doc)` / `redoDocument(doc)`                                         | Restore entire network; no-op at boundaries. Button availability uses `past.length`/`future.length`.                                       |
| `isDirty(doc)` / `markSaved(doc)`                                                 | Read dirty / checkpoint current network, retaining history.                                                                                |
| `createWorkspace()`                                                               | Empty workspace, `activeDocumentId: null`.                                                                                                 |
| `getDocument(workspace, id = workspace.activeDocumentId)`                         | Frozen document; throws if empty/missing.                                                                                                  |
| `openDocument(workspace, doc)`                                                    | Add and activate; reject duplicate IDs.                                                                                                    |
| `switchDocument(workspace, id)`                                                   | Activate tab with histories/sessions intact.                                                                                               |
| `updateDocument(workspace, id, edit)`                                             | Apply `(doc) => nextDoc`, preserving ID and other documents.                                                                               |
| `closeDocument(workspace, id, {discard?}?)`                                       | Refuse dirty close unless `discard: true`; select nearest remaining tab or null.                                                           |

## Smallest UI integration

1. Own a workspace. Load parsed legacy content with `openDocument(workspace, openNetworkDocument(networkFromLegacyNet(parsedNet), {saved: true}))`; use `createDocument` for New. Parse/validate before assigning state. No hollow semantics toggles are needed.
2. Draw from `activeNet(getDocument(workspace))`. Existing NetEditor may temporarily help stage a gesture, but document history must be authoritative: commit once per completed edit. Do not keep two independent undo stacks or use NetEditor's local dirty flag for document saving.
3. Route tabs/component actions through the matching functions. Commit or cancel pending gestures before switching. Refresh drawing/session views; reset simulation or key it to a matching document/network revision.
4. Route Undo/Redo and dirty/close prompts through the document. Catch close refusal; Cancel retains workspace; explicit Discard calls `closeDocument(..., {discard: true})`.
5. Check `networkCapabilities(doc.network).executable` before simulation. Use `NetworkSimulation` for supported disjoint untimed networks, preserving original component identities and one network history. Never execute only the viewed component as though it represented the whole network.
6. App saves call `serializeNetworkTapn` / `serializeNetworkJson` with the entire `Network`. `legacyNetFromNetwork` remains the guarded adapter for explicitly legacy consumers. Mark saved only after the outcome accepted by the UI's file contract. For asynchronous saving, capture the exact snapshot being written; do not mark newer edits saved. This API supplies neither durable-download confirmation nor file handles.

```ts
let workspace = openDocument(createWorkspace(), createDocument({ name: 'My model' }));
const doc = getDocument(workspace);
const edited = activeNet(doc);
// Apply a completed gesture to edited, preserving name/template.
workspace = updateDocument(workspace, doc.id, (current) => commitComponentNet(current, edited));
workspace = updateDocument(workspace, doc.id, (current) => addComponent(current, 'Worker'));
workspace = updateDocument(workspace, doc.id, undoDocument);
```

## Explicit gaps and validation

No recovery persistence, shared identities, constants/declarations, query execution or reference rewriting, semantic conversion, composed execution, timed UI or composed timed execution, colored bindings, game synthesis, stochastic distributions, or verification engines. Metadata can represent future legal types, but unsupported documents cannot enter editable factories. Future importers need semantic schemas and preservation restrictions, not just four booleans. Opaque query reference protections are described below; no semantic verification is claimed.

Focused tests cover independent documents/checkpoints/history/close refusal, overlapping local identities, component operations/undo, invalid-operation atomicity, session separation, all sixteen lens inputs, capability gating, legacy round trips with bends, unknown nested geometry preservation, and clone isolation/frozen snapshots. App integration tests additionally cover tabs, New cancellation, additive Open, component sessions, and saving the correct document checkpoint. They do not demonstrate browser behaviour or composed network execution.

## Timed metadata (opt-in, not wired into the UI)

Timed-only networks carry `Component.timing` (intervals, invariants, urgency, transport pairs, exact initial ages), keyed by local element IDs; see TIMED-FILES.md for the schema, native file contract and graph-edit restrictions. Every default gate is unchanged: `openNetworkDocument`, `openDocument`, `createDocument`, `legacyNetFromNetwork` and `networkCapabilities` refuse or report timed types as unsupported unless the caller passes `{timed: true}` (or uses `createTimedDocument`). Opted-in timed documents remain editable through `commitNetwork`/`updateDocument`; untimed documents can never become timed by commit. `networkCapabilities(network, {timed: true})` is `{editable: true, executable: false}`: the untimed simulators cannot run timed nets. `timedModelForNetwork` is the only timed execution entry point (one timed-only component, no shared elements). Timing edits (`setArcInterval`, `setPlaceInvariant`, `setTransitionUrgent`, `setTransport`, `removeTransport`, `setPlaceTokenAges`, `commitTimedComponent`, `removeComponentElements`) are single undoable whole-network commits; copy copies timing, add gives default timing, rename keeps it.

## App session and file integration

`App.workspace` is authoritative. There is no `NetEditor` history: canvas previews remain in a temporary Net signal until completion, and edits commit through `commitComponentNet`. Rename, activation, copying, removal and ordering use whole-network transactions. Document/component switching cancels incomplete drags and drafts, stores viewport/selection, filters stale selections, and resets simulation. Per-component grid/fit state and naming high-water counters live in App session maps keyed by document/component IDs; counters survive undo and switching. Inactive components can be viewed. Multi-component simulation is refused with the core capability explanation, including when only one component is active.

New opens a keyboard-accessible draft dialog, offering only the actually supported untimed uncoloured P/T capability. Cancel retains the existing document and gesture. Successful New and Open add tabs; warnings acknowledge only the incoming file and never ask to discard another tab. Dirty close requires Save and close or explicit Discard; Cancel/Escape retains workspace state. Closing the last tab exposes New/Open. Before-unload checks every tab.

Open uses `parseNetworkModel` and supports its explicit legacy warnings. Save writes a captured whole-network snapshot through the network adapter and updates `saved` by the originating document ID, even if a download callback switches tabs or edits the document. The browser download initiation is the checkpoint contract; it cannot confirm that the user retained the downloaded file. TAPN adapter refusal (including fractional desktop coordinates) leaves dirty state unchanged; JSON is available for lossless web geometry. No flattening fallback exists.

## Preserved native queries

Optional `Network.savedQueries` is typed in `saved-queries.ts`. Document snapshots, component commits/copies, title rename, undo and redo retain it. `validateNetwork` enforces the original component/node identity-name-kind snapshot. Protected component/node rename, deletion, ID changes and node-kind replacement throw an actionable error before committing; the previous document, dirty state and history remain untouched. All original symbols are protected conservatively, regardless of whether an opaque formula actually references them. New components/nodes, geometry, token/arc changes, activation and ordering remain editable; query truth is not preserved or checked.

UI integration: read `doc.network.savedQueries?.xml.length ?? 0` for the saved-query count. Label these as preserved, not executable or verified. Catch commit errors and show their messages. `removeSavedQueries(doc)` is a separate explicit action removing all queries and their protections as one transaction; it supports undo/redo. Ordinary `commitNetwork` rejects altered or omitted query metadata. A copied component does not gain a duplicate set of queries. The root display title may change freely. Whole-network save uses the existing network file APIs; `legacyNetFromNetwork` refuses query-bearing documents to prevent data loss. For single-component simulation, a separately capability-checked `activeNet` is a view, not a save adapter or query execution path.

See NETWORK-FILES.md for XML preservation limits, JSON schema, reopen behavior and native serialization audit. Tests include unmodified `two-phase-locking` and `home-construction` queries, both formats, conservative edit refusals, additive changes, undo/redo, explicit removal and malformed metadata.
