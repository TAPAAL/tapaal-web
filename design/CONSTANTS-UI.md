# Constants: first usable authored workspace

Implementation and bounded validation, 2026-10-29. This supersedes the UI constants gates in the wave 1 staging document and older numeric UI/file reports. The foundation and codecs remain in `core/authored-model.ts`, `core/authored-documents.ts`, and `core/authored-files.ts`; native numeric engines and public numeric codecs were not broadened.

## Source ownership and editing Interface

`editor-workspace.ts` is the App's document Adapter. Every current, saved, past and future snapshot is authored, including documents with no declarations. Numeric import/factory data is explicitly migrated once. The App keeps no parallel numeric document history and no sparse symbolic overrides. `activeNet` and `numeric` create isolated projections for the drawing, drag algorithms, numeric-only clipboard encoding after authored dependency inspection, and simulation. They are never serialized or accepted as whole-network source replacements.

The canvas commit Interface takes a geometry/topology patch: retained arcs recover the exact authored weight by ID, while retained kind and endpoints must match. It never infers semantic intent from resolved equality or differences. New arcs get literal defaults. Dedicated element property edits express replacement intent, parsing one declared name or a literal behind `constants-editor.ts`. Unchanged decimal bounds are retained, symbolic zero guards stay authored, and invariant/interval/weight setters retain stable binding IDs.

The core closed command set now includes atomic `editElement`, `addElements`, and `reorderComponents` commands. Element edits combine graph, marking/ages, urgency, pairing, arc kind, and symbolic terms in one validated candidate. Transport weight changes update both halves without reconstructing either route. Addition commands check that every existing node/arc/note and timing entry is unchanged, while the Adapter supplies source terms for those existing elements. Query guards run on source, including inactive components. Component copies inside one document copy full source and retain global bindings; like the prior UI they become active and select the new component.

One migration correction was needed: numeric redo pops the last future entry, whereas authored redo shifts the first. `authoredDocumentFromNumeric` reverses that stack, retaining shared snapshot identities. A two-step redo proof covers the ordering.

## UI behavior

The Constants pane shows declaration name/value, uses grouped by component and labeled by element/field, inactive participation, and saved-query protection separately from actual model uses. A use selects its component/element and fits the drawing. Add/Edit dialogs use the source grammar `[A-Za-z_][A-Za-z0-9_]*`, exact case, reserved lowercase `inf`, and values 0–2147483647. Whole-network validation precedes publication. Errors include use locations and leave drafts open. Rename keeps IDs; in-use deletion is refused. Saved-query-protected rename/removal is refused, while valid value changes are allowed. Remove saved queries remains the only explicit undoable protection-removal action.

Drawings and property dialogs show declared names for all ordinary/inhibitor/transport weights, interval endpoints, and invariants. Untimed inline arc fields also show and parse names; timed inline fields direct users to the atomic properties dialog. No arithmetic evaluation exists. Native integer bound entry remains bounded; existing JSON decimal bounds survive unchanged. Numeric safe-integer weights retain the prior JSON capability, with native export enforcing its narrower Java integer limit.

All document operations retain initial markings and exact ages/delays. Simulation resolves the current authored revision explicitly, then constructs the existing timed/untimed network engines with isolated numeric data. Source query metadata is not part of that projection. Global timed execution, inactive views, random/manual/oldest/youngest token policies and history are preserved. Source identity and a separate App generation invalidate runs; component view changes do not. Modal drafts capture workspace identity, so undo/redo ABA, tab changes, or another edit cannot apply a stale draft. File-read and clipboard operations capture workspace identity and operation generation. Save captures one source revision and updates only that document's checkpoint.

## Clipboard boundary

Copy, cut and duplicate inspect the captured authored selection through `core/authored-clipboard.ts`. Reference-bearing selections use a closed web clipboard v3 envelope with model type, source document identity, authored fragment and exactly referenced declarations. Native text/plain is the same lossless web envelope; no numeric projection is serialized. Numeric-only selections retain native untimed/v1 and timed v2 formats. Partial transports refuse before copying.

Same-document paste uses current binding IDs, even after declaration rename/value changes, and refuses deleted IDs. Cross-document paste allocates fresh dependency IDs and refuses any name collision, including equal values. There is no implicit merge/rename/inline or mapping control. The closed `pasteElements` authored command validates existing element/timing preservation and combines imported declarations with elements in one undo transaction; redo retains those exact IDs. Cut removes elements only. Copy component keeps its existing source-preserving path.

Workspace/operation identity guards reject stale async operations, including constant edits and undo/redo ABA; cut also captures selection generation to reject selection ABA. Query-protected cut retains a recoverable copy while leaving source/history/selection/checkpoint unchanged. Existing query protections are retained and never attached to new nodes.

## Verification

The suite after integration passed **707 tests in 30 files**, including 25 public Adapter tests and 8 App integration tests added for this release. Existing App tests now construct authored workspaces and read v2 saves; the numeric file/engine tests remain unchanged. Application TypeScript checking, production build and full formatting checks passed in `worker-job run tapaal-constants-ui-final`. The production initial bundle is 570.63 kB (141.84 kB estimated transfer); the unchanged 500 kB warning remains. Logs are `/tmp/constants-ui-final-tests.log`, `/tmp/constants-ui-final-build.log`, and `/tmp/constants-ui-final-format.log`.

Adapter/App checks cover the unchanged native webserver; valid/invalid declaration edits across inactive components; rename/delete/query guards; all five scalar-fixture weight positions (ordinary input/output, inhibitor, transport input/output); symbolic endpoints/invariant/Zero; marking/ages/urgency/kind/pair edits; exact source undo/redo; native AST coefficient refresh; legacy migration/v2 gates; layout/copy preservation; numeric-only clipboard compatibility and symbolic fidelity/collision refusals; stale modal ABA; delayed file-open and clipboard cancellation. The existing 674-test regression baseline remains included.

Shared-preview browser smoke used real file upload, clicks, field typing and save download, with read-only DOM inspection and no App method/signal drives:

- Opened the repository's unchanged `src/main/resources/Example nets/webserver.tapn`: four declarations, symbolic labels, retained query, no import-repair prompt.
- Changed deadline 5→0: rejected with use locations, draft stayed open and source remained 5. Changed it to 4: accepted; toolbar Undo restored 5 and Redo restored 4.
- Entered simulation, delayed exactly 0.25, and downloaded TAPN mid-run. XML retained four named declarations and the query, and contained no simulated age 0.25. Uploaded that download: reopened in Edit with deadline 4 and symbolic declarations. Download evidence copied to `/tmp/tapaal-constants-ui-webserver-saved.tapn`.
- Opened the scalar constants fixture, double-clicked its ordinary input arc, observed weight `K` and interval `[K,D]`, entered `[Zero,D]`, and saved the dialog. The drawing showed `K [Zero,D]` with no alert.

The first preview connection attempt preceded server startup and returned `ERR_CONNECTION_REFUSED`; the shared preview worked after the managed server started. Both owned preview tabs and the managed server were closed/stopped after checks. No user demo, commit, PR or deployment was created. Independent browser review is still to be commissioned by the parent; this smoke does not claim exhaustive field-by-field browser parity.

## Remaining gates

Wave 4 symbolic web clipboard is implemented. Desktop symbolic transfer and explicit cross-document binding mapping remain unavailable; same-name collisions require an explicit user edit and a fresh copy. Symbolic urgent-input guards remain explicitly rejected pending native oracle evidence, even for a zero-valued reference. Real/set constants, arithmetic, coloured/game/stochastic semantics, shared elements, and query execution remain unavailable. The nested watch-constant query dialect is still rejected by the existing saved-query validator. Released native 4.0.4 loses nonzero initial ages; the visible warning and JSON alternative remain. No engine budget was raised and no native oracle was rerun for this UI integration; prior native codec/execution evidence remains in the earlier reports.
