# Native symbolic constants: authored documents, resolved execution

Design proposal, 2026-10-29. Only this new design file is delivered. No implementation, native execution, test run, server, commit, PR or deployment was performed. Coordinates below refer to this checkout, not necessarily the 4.0.4 binary. **Source** means inspected local primary source; **proposal** means intended web behavior; **unknown** requires an oracle check. The supplied 548-test/23-file baseline, engine observation counts and browser results are prior context, not results reproduced here. Keep the 500 kB initial-bundle budget; the reported 534.79 kB warning is not permission to raise it.

## Decision and smallest usable slice

Introduce one deep authored-model module at the document-to-core seam. A document owns literal-or-reference values and global declarations. The module validates references and resolves an entire candidate network into the existing numeric `Net`/`TimedModel` representation. Numeric results are disposable execution/editor projections, never another persisted model or a source for saving. A constant edit is one whole-network transaction, not a loop of component edits.

The first usable release is waves 1–3 together: open/save scalar integer constants in ordinary uncoloured timed and untimed networks; show names on arcs/invariants; edit declarations and symbolic fields; inspect uses; simulate resolved values; undo/redo atomically. Include ordinary, inhibitor and transport weights, input/transport interval endpoints and invariant upper bounds. Include multiple and inactive components. Clipboard operations involving symbols remain explicitly unavailable until wave 4; numeric-only operations remain available. Component duplication inside a document must preserve binding IDs from this first release, or be disabled for that component. A schema-only wave is not advertised as constants support.

Do not enable sharing, coloured nets, games, stochastic execution, real constants, parameter sets, arithmetic expressions, symbolic token counts, symbolic ages or query execution. Imported unsupported semantics fail before a document opens. Supporting constants must not remove any existing feature gate.

Two plausible Interfaces were considered:

1. Keep numeric `Network` plus sparse symbolic overrides. This minimizes immediate editor changes, but every numeric edit needs rules for whether it replaces an override. Numeric defaults, transport halves and clipboard then have two authorities. A cache invalidation bug becomes a silent save-time flattening bug. Rejected for poor locality and correctness.
2. Store authored scalar unions in document fields, with one whole-network resolution/transaction Interface. This requires deliberate editor adapters and a document schema migration, but removes parallel computed state. Chosen for depth: import, edit, undo, export and simulation share reference validation. Deleting this module would redistribute those rules across all those callers.

## Native evidence and exact scope

Paths in this section are relative to the repository root. Ranges identify the relevant implementation, not an executed compatibility assertion.

| Capability / restriction | Source evidence and consequence |
|---|---|
| Integer declarations | `src/main/java/dk/aau/cs/model/tapn/Constant.java:19–33,46–54,76–96,141–144`: nonnegative Java `int`, hence scalar range 0…2147483647; name regex `^[a-zA-Z_][a-zA-Z0-9_]*$`. Current source additionally has ordered value sets; do not mistake that for scalar arithmetic or assume 4.0.4 supports sets. |
| GUI name differs from model name | `src/main/java/net/tapaal/gui/petrinet/editor/ConstantsDialogPanel.java:526–547` requires a leading ASCII letter and rejects collisions with colours/types/variables. `ConstantStore.java:245–283,340–359` (under `src/main/java/dk/aau/cs/model/tapn/`) rejects exact lowercase `inf` on add and duplicate names; also rejects real-constant collisions. Its update path does not repeat the `inf` check. Proposal: accept model-valid leading underscore on import; use that same explicit regex in web editing, reserve exact `inf` on every entry path, and reject duplicate declarations instead of imitating loader/store inconsistencies. `Inf` is not the source's reserved spelling. No evidence here of a general query-keyword ban on constants. |
| Bounds are single names or literals | `src/main/java/dk/aau/cs/model/tapn/TimeInterval.java:111–153`, `TimeInvariant.java:45–74`, `Weight.java:9–21`: parse integer first, otherwise look up a single constant name; upper `inf` is special. `N+1`, decimals as native integer bounds, quoted identifiers and expression evaluation are not these grammars. Native intervals use word tokens, not an arithmetic AST. |
| Reference objects preserve spelling | `ConstantBound.java:8–37`, `ConstantWeight.java:10–52`: numeric value follows the bound declaration; formatting returns its name. Weight save can explicitly choose names. References are not source strings with cached numeric results. |
| Allowed model positions | `ConstantStore.java:42–85,87–130,168–243`: place invariants; input/transport endpoints; weights on input/output/inhibitor/transport arcs. Source also visits coloured bounds, transition probabilities and distribution parameters. These latter families stay gated. Initial marking is parsed separately as a number in `src/main/java/dk/aau/cs/io/TapnXmlLoader.java:636–710`; do not generalize constants to all numeric fields. |
| Interval constraints | `TimeInterval.java:19–50`: finite lower bound, ordered bounds; equality only when both ends closed; infinity must be an open upper end. `ConstantStore.java:195–232` computes declaration limits from neighbouring bounds, with integer gap 1 for an open endpoint, 0 for two closed endpoints. It skips different-name constraints when bound objects compare equal. Proposal validates actual resolved intervals, including `(K,K)` and `[K,K)`, rather than copying that shortcut or its integer-overflow behavior. |
| Invariant and weight constraints | `TimeInvariant.java:19–25`: `<0` and `<=inf` invalid; `<=0` permitted. `ConstantStore.java:87–101,235–242`: strict finite invariant requires constant ≥1; arc weight requires ≥1. `ConstantWeight` constructor itself only checks non-null. Web must validate the complete resolved use, not merely construction of a reference. |
| Urgent / inhibitor constraints | `src/main/java/pipe/gui/petrinet/editor/TAPNTransitionEditor.java:477–492`: urgent preset must be untimed; transport destinations may not have finite invariants. `TapnXmlLoader.java:1132–1140` replaces nontrivial inhibitor intervals with `[0,inf)` and warns. Web already refuses instead (`web/src/app/core/timed-files.ts:186`); preserve refusal, not native lossy repair. Initially refuse explicit constant references on urgent-input guards even if the current value is zero; label this a web capability restriction, pending native symbolic-zero oracle evidence. Literal canonical `[0,inf)` stays allowed. |
| Update, rename, delete, undo | `src/main/java/dk/aau/cs/model/tapn/TimedArcPetriNetNetwork.java:295–368` rebinds guards/weights across **all** templates by old name; `src/main/java/net/tapaal/gui/petrinet/undo/UpdateConstantEditCommand.java:23–34` reverses replacement/rebinding. Dialog `ConstantsDialogPanel.java:568–615` validates bounded values and adds one undo edit. `ConstantStore.java:286–304` refuses deletion when marked used. `ConstantsPane.java:761–791` reports unremovable declarations. Do not copy mutable Java object aliasing into immutable web history. |
| Uses presentation | `ConstantsPane.java:368–407` selects/focuses/blinks constants; `src/main/java/pipe/gui/petrinet/graphicElements/tapn/TimedInputArcComponent.java:125–150` highlights matching bounds/weights. `src/main/java/pipe/gui/petrinet/PetriNetTab.java:1645–1659,1726–1735` supplies a constants summary. Inspected source establishes highlights and a declaration summary, not a complete per-reference uses list. The structured web uses list below is a proposal, not an asserted native replica. |

### Native files, redundant expressions and queries

**Source:** `TapnXmlLoader.java:132–157` creates the global store before templates. `:369–398` skips `<constant>` descendants of `watch` and distinguishes real declarations; `:1178–1191` reads declaration `name`/`value`, with current-source comma-separated sets. `TimedArcPetriNetNetworkWriter.java:252–283` emits global declarations (real ones separately). `:593` writes symbolic place invariants; `:728–741,793–797` writes symbolic arc weight and guard, including transport `:group` suffix. References are ordinary XML attribute strings, e.g. `weight="Batch"`, `inscription="[0,Deadline)"`, `invariant="&lt;= Deadline"`. XML quotes delimit the attribute; they are not part of the reference token.

**Source:** native `writeTACPN.java:107–120` emits dot expression AST coefficients as `<numberconstant value="…"><positive/></numberconstant>`. Existing web `dot-expressions.ts:54–95` accepts a tightly specified numeric `numberof` plus dot tree and text such as `2'dot`; it allows arc coefficient 1 or the numeric plain weight, and requires marking agreement. `:98–145` currently generates coefficients using `Number(weight)`: calling that unchanged on `weight="Batch"` would emit NaN. The apostrophe in `2'dot` is multiset syntax, not a quoted constant name. **Proposal:** inspect the original XML AST, resolve the plain symbolic weight only for consistency checking, then accept the existing redundant numeric scaffolding (1 or resolved weight). Generate fresh numeric scaffolding from resolution on export while leaving authoritative `weight="Batch"` symbolic. Reject a symbolic `<numberconstant value="Batch">`, unknown AST, mismatched text/tree, or conflicting coefficient. Do not invent `Batch'dot` support or enable coloured evaluation. Do not retain stale redundant AST coefficients through a value edit.

**Source:** `src/main/javacc/dk/aau/cs/TCTL/Parsing/TAPAALQueryParser.jj:258`, `CTLParsing/TAPAALCTLQueryParser.jj:309`, `LTLParsing/TAPAALLTLQueryParser.jj:305` construct numeric `TCTLConstNode` from integer tokens; `src/main/java/dk/aau/cs/TCTL/TCTLConstNode.java:14–46,84` holds an integer, not a global binding. `QueryDialog.java:1526` under `src/main/java/net/tapaal/gui/petrinet/dialog/` edits numeric leaves. This is evidence against claiming general symbolic global references in those query arithmetic positions. It does **not** prove arbitrary retained query attributes, watches or future query dialects are independent of names. Watch `<constant>` is particularly not a model declaration.

**Proposal:** keep all saved query XML byte-for-byte at the stored string level; do not search-and-replace names inside XML, quoted formulas, comments, substring matches, AST text or options. Extend capture metadata with `protectedConstants: [{id,name}]` for **every existing declaration**, not guessed uses. Reject rename/removal of protected declarations. Value changes may proceed if the model is valid, preserving XML and names; changing model behavior is intended and no cached query truth is promised. Additions are allowed and get stable IDs; do not silently recapture protections during commits. Preserve existing protected components/nodes. Explicit existing remove-saved-queries action remains the only way to discard query protections, undoably; do not make constant editing discard queries automatically. Distinguish “model use” from “protected by saved queries” in the uses view. Unknown query dependency analysis remains an explicit limitation, not a claim that named references execute.

### Real fixtures rejected today

`src/main/resources/Example nets/webserver.tapn:3–6` declares deadline/min/periodA/periodB; `:13–19` uses invariants, `:26–42` point and lower-bound guards, `:46–64` paired transports; `:95` retains a numeric query and `:97` declares timed/uncoloured/non-game. This is the primary end-to-end candidate, not just synthetic XML. `alternating-bit-protocol-transport.tapn:3–4` supplies deadline/delay declarations; `train-level-crossing.tapn:4–9` supplies six integer declarations. `fair-coin-from-unfair.tapn:36–37` supplies probability constants and is a negative capability fixture, not a reason to enable stochastic support.

Current rejection is source-established, not executed here: `web/src/app/core/network-files.ts:263` rejects any model constant declaration before network construction; `:215` rejects symbolic weights; `timed-files.ts:21–25` rejects symbolic bounds. Other unsupported constructs may still block the larger examples after constants support. Keep original fixtures unmodified; identify each remaining rejection separately. Legacy `files.ts:66–68,151–152,206–209` instead expands constants and warns: no new public constants-capable import path may delegate ownership of symbolic fields to that path.

## Concrete authored schema

Proposed new `web/src/app/core/authored-model.ts` owns the types and pure resolution. Numeric types in `net.ts` and `timed.ts` remain execution types. Use `Omit` for geometry reuse; no extra optional `resolvedValue` and no override map on numeric arcs.

```ts
type ConstantId = string; // opaque, unique within the whole network, not a name
interface ConstantDecl { readonly id: ConstantId; readonly name: string; readonly value: number }
interface Ref { readonly constantId: ConstantId }
type WeightTerm = number | Readonly<Ref>;
type BoundTerm = Decimal | Readonly<Ref>; // literal Decimal retains existing web JSON timing
interface AuthoredInterval {
  readonly lower: BoundTerm;
  readonly upper: BoundTerm | null; // infinity only here
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
}
interface AuthoredInvariant { readonly upper: BoundTerm | null; readonly upperClosed: boolean }
type AuthoredArc = Omit<Arc, 'weight'> & { readonly weight: WeightTerm };
type AuthoredNet = Omit<Net, 'arcs'> & { readonly arcs: readonly AuthoredArc[] };
type AuthoredTiming = Omit<ComponentTiming, 'intervals' | 'invariants'> & {
  readonly intervals: Readonly<Record<string, AuthoredInterval>>;
  readonly invariants: Readonly<Record<string, AuthoredInvariant>>;
};
type AuthoredComponent = Omit<Component, 'net' | 'timing'> & {
  readonly net: AuthoredNet; readonly timing?: AuthoredTiming;
};
type AuthoredNetwork = Omit<Network, 'components' | 'savedQueries'> & {
  readonly constants: readonly ConstantDecl[];
  readonly components: readonly AuthoredComponent[];
  readonly savedQueries?: AuthoredSavedQueries;
};
```

These are schematic readonly shapes; implementation must deep-freeze/snapshot as documents already do. `AuthoredSavedQueries` extends the current metadata with required `protectedConstants` for v2. NetworkDocument `network/past/future/saved` all become authored; session remains navigation only. Do not keep a second numeric history. All no-constant documents normalize to `constants: []` internally.

IDs survive JSON, undo/redo and rename. TAPN names map to fresh document-local IDs once at import (deterministic declaration-order allocation is sufficient). Name lookup is exact/case-sensitive. IDs are not globally meaningful across documents; pair them with document identity at cross-document seams. Duplicate IDs/names, missing bindings, null terms, extra object keys, noninteger/negative/overflow declaration values and non-string names fail validation. Do not use prototype-inherited keys as bindings; Maps or own-property lookup handle names such as `__proto__` safely.

Transport halves must have the **same authored weight term**: same literal or same binding ID, not merely equal current values. Native transport is one weight, and two declarations equal today can diverge tomorrow. One edit operation assigns both halves. Timing guard belongs to the input pair as today, and export emits consistent paired inscriptions. This is a deliberate losslessness rule; reject ambiguous imported halves rather than choose one.

Canonical timing is based on authored structure. Omit literal `[0,inf)` and `<inf` only. Never omit `[Zero,inf)` because Zero currently resolves to 0: that would destroy the dependency. The resolved projection independently drops numeric defaults before calling existing validators (`documents.ts:118–159`). Reference-bearing default-equivalent guards remain authored and participate in uses/undo/export.

## The small transaction Interface and failure contract

```ts
interface Use {
  readonly constantId: ConstantId;
  readonly componentId?: string;
  readonly elementId?: string;
  readonly field: 'weight' | 'lower' | 'upper' | 'invariant' | 'saved-query-protection';
  readonly active?: boolean;
}
interface Issue {
  readonly code: 'shape' | 'name' | 'range' | 'unbound' | 'in-use' |
    'query-protected' | 'invalid-model' | 'unsupported' | 'stale-revision';
  readonly message: string;
  readonly uses: readonly Use[];
}
type Result<T> = { ok: true; value: T } | { ok: false; issues: readonly Issue[] };
// Opaque result: numeric projection cannot be committed or serialized as authored data.
interface ResolvedRevision { readonly source: AuthoredNetwork; readonly numeric: Network }
function resolveAuthored(source: AuthoredNetwork): Result<ResolvedRevision>;
function constantUses(source: AuthoredNetwork, id: ConstantId): readonly Use[];
function transactDocument(
  doc: AuthoredDocument,
  expected: AuthoredNetwork,
  edit: AuthoredEdit,
): Result<AuthoredDocument>;
```

`AuthoredEdit` is a closed discriminated union: add/update/delete declaration; set interval/invariant/weight term; existing document/element edits; paste after wave 4. Name and value update together are one operation. Geometry edits should be typed operations or an explicitly restricted projection patch, not an unrestricted replacement numeric Net. Pure parsing/formatting of draft strings belongs behind this module or its file/UI adapters: one name/literal tokenizer, no `eval`, no general expression parser. UI renders returned issues; it does not compute valid ranges or walk uses.

Transaction pseudocode:

```text
if doc.network !== expected: return stale-revision
candidate = apply authored edit to isolated snapshot
  // deletion refuses model uses; rename changes declaration name, IDs stay bound
  // component deletion removes its uses; transport-half removal keeps current refusal rules
  // update never replaces a term with its evaluated value
check saved-query metadata unchanged, and validate its protected identities
resolved = resolveAuthored(candidate) // every component, including inactive
if failure: return issues; leave doc, history, saved, session and simulation untouched
return commit one authored snapshot with existing no-op/future-clearing behavior
```

Resolution: check authored closed shapes and declarations → bind all terms → construct numeric graph/timing, preserving every unrelated field → canonicalize numeric defaults → run existing numeric graph/timing/network validators → return immutable projection tied to exact authored revision. Validate all components even when only active ones execute. The numeric execution projection omits saved-query metadata after separate authored query validation: the current numeric validator accepts only the old closed query shape (`saved-queries.ts:108–119`). It must not receive v2 protection fields accidentally. Query XML remains exclusively on the authored source and is never dropped from a document/export. Never re-use a projection after a revision changes. Complexity is linear in declarations plus elements/uses, plus existing validation; no persistent index is required initially. `constantUses` derives its result; range hints, if supplied later, are advisory and must not replace candidate validation.

Keep structural validity separate from explicit execution capacity: `documents.ts:121–122` already distinguishes them. Token ages remain Decimal literals; do not manufacture or zero them when a bound changes. Lowering an invariant below a recorded initial token age refuses the entire edit (`documents.ts:191–210`). Execution still enforces `MAX_TIMED_TOKENS = 100000` and Decimal limits (`timed.ts:53–70`); oversized otherwise valid models can remain editable/exportable but simulation must refuse with the existing capability explanation. No expansion into tokens during basic declaration validation.

`commitNetwork` already preserves saved-query metadata and snapshots once (`documents.ts:399–424`). Refactor its validation seam to accept authored candidates; keep undo/redo and dirty fingerprints over authored state. This catches binding errors regardless of entry point. Avoid dependency cycles: authored-model imports numeric types/validators; documents calls authored-model; the authored module does not import document mutation functions. Extract current numeric network/timing validation and its plain types into new `core/resolved-network.ts` (re-export old names where needed); otherwise importing `validateNetwork` back from documents would create a runtime cycle. This extraction belongs to wave 1 and must preserve numeric behavior. `transactDocument` may live in documents with private authored edit application delegated to the module.

`activeNet` currently returns a numeric writable projection and `commitComponentNet` accepts it (`documents.ts:426–448`). That round trip is dangerous with symbols. First-release adapter compares allowed geometry/topology edits against the captured revision, patches only explicitly changed nonsemantic fields and preserves authored terms by element ID. It refuses any unexpected numeric weight replacement of a symbolic arc; semantic weight changes use `setWeightTerm`. Never infer intent solely because a number differs. Clone annotations, bend arrays, curved ends, offsets, hidden labels, angles and timing; preserve extents/recompute existing extent calculations from geometry, not from a stripped replacement graph. No geometry narrowing casts that lose optional fields.

## Worked round trip and atomic edit

Illustrative minimal fragment (not a claimed executed fixture; surrounding valid TAPN scaffolding omitted):

```xml
<constant name="Batch" value="2"/>
<constant name="Deadline" value="5"/>
<place id="p" name="P" initialMarking="2" invariant="&lt;= Deadline"/>
<arc id="a" source="p" target="t" type="timed" weight="Batch" inscription="[0,Deadline)"/>
```

Authored JSON excerpt:

```json
{
  "constants": [
    {"id":"c1","name":"Batch","value":2},
    {"id":"c2","name":"Deadline","value":5}
  ],
  "arc": {"id":"a","weight":{"constantId":"c1"}},
  "interval": {"lower":"0","upper":{"constantId":"c2"},"lowerClosed":true,"upperClosed":false},
  "invariant": {"upper":{"constantId":"c2"},"upperClosed":true}
}
```

The excerpt is not the complete file schema: arc/interval/invariant live in component fields described above. Resolving yields numeric arc weight 2, guard `[0,5)`, invariant `<=5`. `DocumentSimulation` receives that numeric revision through its explicit timed/untimed dispatch (`web/src/app/timed-ui.ts:142–164`), while retaining the authored revision identity for invalidation and names. Editing Deadline to 7 validates all components then commits one authored snapshot. Simulation is ended/reset through the existing revision change path (`app.ts:1882–1896`); manual bindings, random choice state and elapsed global time cannot silently continue against the new model. Undo restores Deadline=5 and the exact refs/queries; it also invalidates execution, rather than resurrecting a stale simulator.

Export after edit emits `Deadline value="7"`, still `weight="Batch"`, `[0,Deadline)` and `<= Deadline`; it never serializes the numeric projection as the document. Editing Batch to 0 refuses (`weight >= 1`) with use `component/a/weight`, without changing history or execution. In a second inactive component containing `[Deadline,6]`, Deadline=7 refuses the whole transaction. Rename Deadline→Limit changes the declaration; binding IDs preserve all model references and formatting exports Limit. With saved queries protecting c2, the rename is refused without touching XML. Deleting Batch is refused while a references it. Nonzero initial ages survive JSON; TAPN export retains the existing warning about native 4.0.4 losing them, not a claim that constants fix that behavior.

## File adapters and compatibility gates

Network JSON v1 remains read-only-compatible: migrate numeric terms unchanged, add empty constants; migrate old saved-query metadata to an empty protected-constant list. New writer emits **network JSON v2** consistently, even without constants. Keep the legacy single-net JSON import route, normalizing it into an authored network. This is unrelated to clipboard v2. Reject unknown versions, unknown fields at every nesting level and malformed reference objects. Extend the existing closed whitelist (`network-files.ts:31–76,105–132`) with a version-specific schema, not an open bag. Strictly validate persisted protections; an arbitrary file cannot claim nonexistent or renamed protected IDs. Old v1 readers should refuse v2 rather than load and drop references. Do not write a v1 file containing constants.

Native TAPN adapter pipeline:

1. Inspect feature/namespace/unknown-field gates, retaining current XML entity/doctype refusal (`network-files.ts:407–424`). Recognize only direct root scalar `<constant name="…" value="…"/>` declarations in this feature. Reject real/set declarations and unsupported attributes. Never treat query/watch AST nodes as declarations.
2. Build bindings before reading all templates. Parse symbolic weights/intervals/invariants from the original XML into authored terms, with source locations in diagnostics. Validate paired transports by authored terms. Inspect dot scaffolding against resolved weights without removing uninspected XML.
3. Existing numeric geometry parser may operate on a private temporary clone with resolved weights and stripped timing/scaffolding **only after** inspection. Reattach authored terms by verified IDs; ensure the clone did not lose/change topology. This is a temporary adapter input, not permanent import flattening. Prefer extraction of geometry parsing over reusing the legacy constants warning/flattening path.
4. Capture saved queries after binding IDs exist; resolve/validate complete candidate; return no document on any error. A failed open leaves workspace and clipboard unchanged.
5. Export validates authored structure, native representability (integer native bounds, existing geometry limits, supported model type) and references first. Write declarations and authored names, numeric dot scaffolding from a fresh resolution, all components including inactive ones, matching transport halves, retained queries and existing warnings. Round-trip comparison checks authored structure modulo import-local binding IDs and existing native defaults, not equality of resolved numeric nets alone.

Do not widen `timed-files.ts` functions to accept arbitrary strings masquerading as Decimal. Add explicit authored read/write adapters with binding context. Decimal literal bounds currently permitted in web JSON retain their current native-export gate; constants do not make fractional native timing exportable. Transition probability `weight` and arc `weight` are different fields: accepting the latter must not relax stochastic-transition default checks.

## UI and clipboard staging

A dedicated constants pane/controller owns declaration drafts, uses display and rendering; `App` wires selection/actions only. Display name and value plus model uses grouped by component (including inactive), element and field; query protection is a separate reason deletion/rename is unavailable. Selecting a use navigates/focuses without editing. Add/edit/rename/delete call the transaction Interface. Element dialogs show authored names and choose a literal or declaration; validation errors identify all relevant conflicting uses. Switching documents or changing revision invalidates open drafts before submission. The same revision check protects async clipboard operations.

Until wave 4: copy/cut/duplicate of any selection whose preserved semantic content includes a reference refuses before writing clipboard or deleting anything. Copying an unrelated numeric-only selection remains available. Same-document component duplicate preserves global IDs in wave 3; if that adapter is not complete, disable that operation on symbolic components. Never take numeric projection into legacy native clipboard serialization. Native clipboard source (`src/main/java/net/tapaal/copypaste/CopyPastImportExport.kt:37–54,74–81,113–141`) stores guard/invariant/weight strings but uses `toString(false)`/`nameForSaving(false)` on copy; this native flattening behavior is not acceptable for the requested symbolic web transfer.

Wave 4 introduces a **web clipboard v3** envelope with authored terms and a closed dependency table `{sourceDocumentId, constants:[{id,name,value}]}` for exactly the referenced declarations. Existing numeric v1 and timed v2 remain readable unchanged (`clipboard.ts:530–552`); desktop timed transfer remains unavailable. Keep timed transport completeness and token ages from `timed-clipboard.ts`.

Same live source document: bind by ID to current declarations; refuse if missing (never re-create silently after deletion). Cross-document: source IDs have no target authority. Allocate fresh target IDs and preserve source names/values when names are free. Default refuse any same-name collision, including coincidentally equal values; a later explicit map-to-existing choice may bind intentionally. Add declarations, remap refs and paste elements as one transaction. No automatic rename, inline, drop or declaration merge. Native clipboard strings naming constants without declaration metadata remain unsupported until a separate explicit target-binding flow exists. Native export of a symbol-bearing selection remains unavailable; use the web envelope even for untimed symbols. Quoted JSON strings such as `"weight":"Batch"` are names, not arithmetic or evidence of a declaration.

Retain current cut semantics (`app.ts:1071–1086,1130–1177`): capture selection and exact document revision, write successfully, recheck identity/revision, then remove precisely the captured selection. A concurrent constant edit cancels cut/paste, including when numeric values happen to remain equal. Preserve route remapping, annotations, extents and complete transport pairs.

## Bounded implementation waves and file ownership

These are future allocations, not permission to edit them in this design task. Each wave has one integration owner; overlapping existing files are sequential handoffs. No delegation is performed here.

| Wave | Owned implementation files | Acceptance gate |
|---|---|---|
| 1 — schema and pure helpers | New `core/authored-model.ts`, `core/authored-model.spec.ts`, extracted `core/resolved-network.ts`; `core/documents.ts`, `documents.spec.ts`, `saved-queries.ts`, `saved-queries.spec.ts`. Numeric core types/engines stay unchanged. | IDs/names/ranges; all term positions; duplicate/dangling refs; strict bounds; zero weights; inactive conflicts; initial ages; canonical symbolic zero; transport binding equality; query protection. Invalid transaction preserves object/history/session/saved references; valid multi-component edit adds exactly one history entry; undo/redo restores symbols. Public import/UI still gated. |
| 2 — native files and JSON | `network-files.ts/spec.ts`, `timed-files.ts/spec.ts`, `dot-expressions.ts`; narrowly extracted geometry helper in `files.ts` only if necessary; new scalar fixtures under `core/test-fixtures/native-4.0.4/`; new constants oracle script under `scripts/native-reference/`. | v1→v2 migration and strict v2 failures; TAPN declaration/reference round trip; writer never emits NaN; quoted XML/text/AST agreement; 1-dot scaffolding accepted; conflicting coefficient refused; transport TV1/TV2 retained; saved queries and geometry survive. File support stays behind gate until safe editing/dispatch lands. |
| 3 — UI and simulation integration (first usable release) | New `constants-ui.ts/spec.ts` and dedicated pane/template as appropriate; `timed-ui.ts/spec.ts`; limited `app.ts`, template/styles; documents adapter integration tests and focused browser script. | Open webserver candidate or report remaining independent gate; change deadline, simulate changed enabled/delay behavior, save symbolic TAPN, undo once. Numeric editor movement retains refs and cloned geometry. Uses navigation works for inactive components. Revision changes terminate execution/manual selection. No-symbol behavior and keyboard numeric editing regressions covered. Clipboard symbol guard and component duplicate preservation/refusal ship in this wave. |
| 4 — clipboard and cross-document duplication | `clipboard.ts/spec.ts`, `timed-clipboard.ts/spec.ts`; authored paste transaction in documents; small `app.ts` wiring; focused clipboard browser scenarios. | v3 dependency closure, same-document identity, cross-document fresh IDs, collision refusal, atomic declaration+element undo, async cut cancellation on constant edit. Existing untimed native and timed v2 paths retained; no lossy native fallback. |

Meaningful regression seams are public parse→resolve→transaction→serialize and document→simulation dispatch, not tests of private maps. Keep the existing 548 tests/23 files as the supplied baseline; run appropriate suites during implementation, not claimed here. Preserve existing weighted transport/dot fixtures (`timed-weighted.native.tapn`, `control-hlinscription.native.tapn`, `Producer_cycle.native.tapn`). Add small authored TAPNs for each error rather than copying huge examples into every test. Browser cases should exercise one actual atomic edit, failed edit, undo, export text, simulation invalidation and cut cancellation; no need to repeat unrelated UI checks without changes.

## Differential native oracle plan and remaining unknowns

No oracle was executed for this design. Before qualifying Java compilation/execution, read `worker-job --help` and `/home/ubuntu/.local/share/worker-jobs/USAGE.md`, inspect capacity/list, then run a uniquely named finite foreground job against `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib`. No server is needed. Retain only requested proof artifacts, stop any owned resources and never bypass admission. Record jar hash/version and distinguish jar results from current-source results.

A small headless probe should load fixture XML through the real 4.0.4 loader and inspect bound/weight classes, declaration names/values, templates, numeric values and writer output. It should compare structural and execution observations, not GUI screenshots. Cover 0/MAX_INT/overflow, leading underscore versus GUI creation, `inf`/`Inf`, duplicate declarations, undefined name, `[K,K]` versus `(K,K)`, strict invariant K=0, weight K=0, urgent symbolic-zero guards, inhibitor nontrivial guards, transport equal-valued different-name halves, numeric dot AST with symbolic weights, and export/reload after update/rename. Exercise command undo where headless initialization permits; command code touches the current GUI tab, so report a headless limitation rather than silently skipping it.

Run the web path on the same supported fixtures, compare numeric values and enabled/fired/delayed observations before/after declaration changes, then compare symbolic exported names and reloaded references. Add a two-component case with an inactive conflicting use and a global-clock case; preserve oldest/youngest/manual/seeded-random token-selection behavior. Query XML/name protections get separate web regression checks; do not claim query execution equivalence. Native permissive/lossy behavior (inhibitor replacement, missing token ages, ambiguous transport halves) can deliberately differ: web must refuse or retain its visible warning, never call that a successful lossless round trip.

Unresolved release checks: exact 4.0.4 declaration grammar versus newer source's sets/reals; native GUI underscore acceptance and reserved-name inconsistencies; native symbolic-zero urgent preset equality; actual native file shapes for weighted symbolic transports and redundant AST after edits; whether larger example files contain independent unsupported fields; full query/watch dependency dialects; headless GUI-command feasibility. Conservative gates above cover these unknowns. They do not require a new approval workflow: implementation can proceed within its assigned wave, with evidence recorded and unsupported cases refused explicitly.
