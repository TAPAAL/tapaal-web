> Historical implementation notes from the desktop repository. For current setup and project status, see [README.md](README.md).

# TAPAAL Web — native-behaviour implementation

An Angular application in the native TAPAAL GUI repository. The current wired editor supports uncoloured timed and untimed P/T networks with multiple documents and components, symbolic integer constants, weighted/inhibitor arcs, native-style drawing/navigation, and lossless storage of supported geometry and saved queries. It is **not yet a complete native replacement**. The source-backed feature breakdown and remaining gaps are in [NATIVE-PARITY.md](NATIVE-PARITY.md).

Uncoloured timed/untimed games now support role-aware authoring, JSON/native files and manual exploration. New model offers Players; transition properties edit Controller/Environment. Strategy synthesis/verification is unavailable. Game subnet clipboard transfers refuse atomically; component copy preserves roles. The unchanged package-delivery, untimedGame and game-harddisk games open. Catalog: 19 openable / 10 gated. Arc labels retain signed offsets through files and web clipboard; drag their text in Select mode, undo/redo or Escape to cancel. See [ARC-LABELS.md](design/ARC-LABELS.md) for coordinate semantics and validation. See [GAME-NETS.md](design/GAME-NETS.md) for source semantics, validation and gaps.

Arc-label validation passes 1,093 tests, types/formatting and production/development builds with the existing 500/20 kB warning limits unchanged. Released native 4.0.4 checks 88 arc offsets through loader/writer/reopen; real-input browser checks cover dragging at 100%/150%, history, constant bindings, games and all 19 supported gallery saves. Swing text alignment, strategy synthesis and native nonzero-age IO parity remain outside this claim. Full changed paths, evidence and gaps: [ARC-LABELS.md](design/ARC-LABELS.md).

## Run

Use Node 24.15 or later in the Node 24 release line and npm:

```bash
cd web
npm ci
npm start
```

Open http://localhost:4200/workspace. The old `/prototype/workspace` URL redirects there. `npm start -- --host 0.0.0.0` exposes the development server when needed.

## Documents and components

- New opens a model/component-name dialog with a timed/untimed choice and adds a document tab. Open also adds a tab; it does not replace another document's unsaved work.
- Each document has independent whole-network undo/redo and a saved checkpoint. Closing a dirty tab supports Cancel, explicit Discard, and Save and close. The empty workspace retains New/Open.
- The Components panel adds, copies, renames, reorders, removes and activates components. Components may all be inactive; such a network has no fireable event. Local node names and IDs may repeat across components.
- Each component restores its viewport and selection. Pending drawing is cancelled before switching; focused inspector edits are committed to the original component.
- Saving writes the **whole network**, including inactive components. It never silently exports only the viewed component.

## Navigation and drawing

- Select `S` (`V` alias), pan `H` or middle-button drag, place `P`, transition `T`, arc `A`, inhibitor `I`. Native menus expose shortcuts and supported actions. `M` toggles simulation.
- Ordinary wheel/trackpad scrolls. Shift+wheel scrolls horizontally. Ctrl+wheel changes zoom in native 10-point steps; wheel down zooms in. Command also works as a web convenience. Ctrl/Cmd+J/K and the slider cover 20–300%; at 100%, one model unit is one CSS pixel.
- Ctrl/Cmd+Shift+F fits/restores; actual size is available in View. Fit is limited by native zoom bounds.
- `G` cycles grid 15 → 30 → off → 7.5; Shift+G aligns the net. Native integer rounding is applied even on the 7.5-unit grid.
- Drag empty canvas in Select for a marquee; Shift extends it. Shift/Ctrl-click toggles selection. Selecting both endpoints selects their arc; explicit arc deselection is respected. Drag selected nodes to move the group.
- In Arc/Inhibitor mode, Ctrl+click empty canvas creates a place and starts an arc. Further Ctrl+clicks create/connect alternating kinds. Ordinary arcs chain from the new endpoint; inhibitors stop after their transition. Names use per-component P0/T0 high-water counters that do not move backward on undo or deletion.
- While an arc is pending, ordinary empty-canvas clicks add bends; Shift makes the ending segment curved. The preview follows the pointer. Draft bends stay out of saves/history until the arc is committed.
- Selected arcs expose straight/curved handles and context actions for Insert Point, Split Point, type toggle and Delete. Group move and duplication preserve bends. Endpoint anchors follow nodes.
- Escape/Delete/Ctrl-or-Cmd+Z/Y on the canvas cancel a pending arc before changing document history. Focused text controls retain text-editing keys. Quick Draw creation undoes in native order: arc first, then node.

Only one arc is allowed in each direction between a place and transition. Inhibitors go from place to transition, enable below their threshold, and consume no tokens. Counts and weights must be nonnegative/positive safe integers as applicable.

## Editing and clipboard

Double-click an element, press F2/Enter, or use its context menu for a validated draft dialog. OK commits one edit; Cancel/Escape discards it. Quick inspector fields remain available: Enter commits by leaving the field; Escape restores the model value.

Ctrl/Cmd+C/X/V, Edit and context menus copy/cut/paste subnets across documents/components. Symbolic selections use web clipboard v3 with exactly their referenced declarations. Within the source document, paste binds current constant IDs after rename/value edits and refuses deleted bindings. Across documents, paste imports fresh IDs with original names/values and refuses every same-name collision, even equal values. Dependencies and elements undo/redo together. Copying the pasted target selection enables repeated same-document paste; repeated cross-document import can collide. No automatic merge, rename or inlining is offered. Numeric-only fragments retain existing formats. Timed clipboard and duplicate preserve invariants, initial ages, urgency, intervals, complete weighted transport pairs and layout in a typed web envelope. Select both transport halves and all endpoints; partial selections refuse before mutation. Untimed → timed acquires defaults; timed → untimed refuses. Desktop timed clipboard transfer is unsupported because its clipboard contract lacks initial ages; a visible notice identifies web-only transfer. Representable untimed selections retain native plain-text JSON; annotations and hidden names retain the explicit web-envelope rule. Paste renames nodes with the persistent counters, offsets by native 30,30 and is one undo transaction. Permission denial produces a visible internal-clipboard fallback notice. Async operations cancel when the target document/component/revision changes. Cut keeps a recoverable copy before deletion and obeys query-reference guards.

Labels can be dragged and hidden independently; transitions rotate through the editor, context menu and selected-object wheel. `N` creates an annotation with editable text, eight resize handles, move/delete/duplicate and undo. Narrowing a note grows its height to keep wrapped text visible. The +/− token tools and selected-place wheel edit markings, with object actions taking precedence over canvas zoom/scroll. Layout is preserved through files and supported clipboard transfers. See [ELEMENT-LAYOUT.md](design/ELEMENT-LAYOUT.md) and [browser validation](design/ELEMENT-LAYOUT-VALIDATION.md).

## Constants

The Constants pane adds and edits case-sensitive scalar declarations, lists uses by component (including inactive components), navigates to uses, and deletes unused declarations. Names follow `[A-Za-z_][A-Za-z0-9_]*`; exact `inf` is reserved. Values are integers 0–2147483647. Ordinary, inhibitor and paired transport weights, input/transport interval endpoints, and place invariants accept one declared name or a literal, without arithmetic.

Every edit validates the whole candidate network and commits one undo step. Invalid edits stay open with use locations; no-op edits preserve redo history. Renaming retains binding IDs. Saved queries separately protect existing declaration names against rename/removal; valid value changes are allowed. Only the explicit Remove saved queries action discards those protections, undoably. Simulation and canvas graphs are disposable projections; saves always retain complete initial source and symbolic references, even during a run.

The unchanged native `webserver.tapn` has been opened, edited, simulated, saved and reopened through real browser controls. See [CONSTANTS-UI.md](design/CONSTANTS-UI.md) for the bounded checks and remaining gates. Symbolic urgent-input guards, arithmetic, real/set constants, coloured/stochastic constant families, query execution, and desktop symbolic clipboard transfer remain unsupported.

## Shared places

The Shared Places pane creates unused pools, edits global names/initial markings/ages/invariants, lists total occurrences and active components, and navigates to each occurrence. Symbolic pool invariants appear once in Constants uses, including unused and inactive pools. A diamond and outer ring identify membership on the canvas. Pool values are authoritative; each occurrence retains independent geometry.

Local place properties offer **Make shared / use existing pool…**. Joining a pool previews both sets of values and requires explicit consent when they differ; tokens are never summed. Shared occurrence properties open global pool properties or detach under a fresh local name, copying authored initial values. Removing an occurrence removes its incident arcs and transport partner, retaining the pool. Only unused pools can be deleted. Component copy retains membership and a single pool marking. Saved-query protections block pool rename/deletion and membership conversion/detachment until explicit undoable query removal.

Shared selections and selected arcs touching shared places refuse copy/cut/duplicate before writing the clipboard or changing source. Unrelated local subsets still use existing numeric/timed/symbolic clipboard formats. Component copy is the supported membership-preserving copy. Desktop shared clipboard transfer is unavailable.

Shared simulation uses one physical pool marking and one exact global clock, with qualified local transitions and all four token policies. Inactive shared occurrences reflect the live pool; inactive local places stay frozen at initial state. Unused/all-inactive pool ages advance without constraining delay. The displayed physical total counts each pool once. Shared untimed models have no delay operation. Explicit shared-token execution is limited to 100,000 physical tokens; larger valid sources remain saveable. All edits invalidate the run; component view changes preserve it. See [SHARED-PLACES-UI.md](design/SHARED-PLACES-UI.md) for the source/history boundary and validation evidence. This does not claim native GUI parity or released 4.0.4 nonzero-age file compatibility.

## Files and saved queries

Open accepts native TAPAAL `.tapn`/attribute-based XML and versioned web JSON. General standard PNML is a different dialect and remains unsupported. New saves use authored `tapaal-web-network` JSON version 3, preserving declaration/pool IDs, memberships and symbolic references. Strict V2 scalar files still import. Numeric version 1 and legacy `tapaal-web-untimed` JSON still import; legacy single nets migrate to one component.

Supported names, coordinates, markings, weighted/inhibitor arcs, straight/curved paths, component activation, label offsets/visibility, transition angles, annotations and saved query XML are preserved. Saved queries are **preserved only**, never verified. Original component/node identities are conservatively protected against rename/removal; geometry/marking/arc edits and additions remain possible. The Queries panel explains this and offers explicit removal of all queries/protections in one undoable action.

Unsupported semantics/content are rejected before any document changes. Colour/stochastic semantics remain refused. Games use the explicit role-aware adapter for manual exploration. Shared places and synchronized transitions use the V3 adapter described below. Scalar integer constants use the authored file path described in [CONSTANTS-UI.md](design/CONSTANTS-UI.md); numeric public codecs remain gated. Timed-only imports explicitly opt into timing-aware editing. The strict file contract and exact refusals are in [NETWORK-FILES.md](design/NETWORK-FILES.md). Only malformed ID/path repairs produce import warnings; accepted imports do not deliberately discard semantic content.

TAPN export enforces Java integer token/weight limits (2,147,483,647) and whole-number geometry. JSON retains otherwise valid fractional layout. Transparent annotation backgrounds are JSON-only; TAPN export asks for solid notes or JSON rather than silently dropping the setting.

Save currently downloads a file; it does not hold a native writable file handle or confirm durable disk storage. There is no automatic persistent recovery yet. Files stay local. Closing/reloading warns if any document is dirty. Input size is limited to 5 MB.

## Simulation

The simulator runs supported disjoint untimed networks across all active components using `core/network-simulation.ts`. Enabled transitions are red on the viewed component; the sidebar lists enabled transitions across the active network with component-qualified names. Select a sidebar row to switch to its component, then Fire, double-click the row, or Step. Step chooses the first enabled transition in component/node order when there is no recorded future. Back/Forward/Reset and history rows navigate one network-wide history; firing after Back replaces the future branch. History names and marking tooltips identify the component as well as the local element. Switching component views preserves the run, cursor and history. Inactive views show their initial marking and an explicit inactive notice; their transitions cannot fire. Network controls can still execute active components from an inactive view. Leaving simulation restores initial markings and editing selections; saving always writes all original initial model data, including inactive components.

Switching document tabs, opening/creating a document or closing a tab ends the current simulation deliberately; returning starts in Edit mode. A changed document revision ends a run instead of migrating its history. Untimed execution requires all four type flags explicitly false. Timed documents dispatch through `DocumentSimulation` to `TimedSimulation`, never the untimed engine. Shared-place documents dispatch to the physical shared-pool session; repeated local names or IDs never imply sharing.

Timed simulation supports disjoint active components with one exact global clock. Repeated local IDs and names remain independent. Inactive components show frozen initial markings and ages, cannot fire, and do not constrain delay. Changing the component view preserves the run; document edits or tab changes end it. Shared transitions fuse active members into one atomic event, with conjunction enabling and qualified per-member manual inputs. The current authored revision is explicitly resolved before constructing the numeric execution engine. The sidebar accepts exact decimal delays and shows the legal delay interval, current token ages, and Random (default), Oldest, Youngest and Manual eligible-token policies. Random now matches the native Animator default and samples without replacement; deterministic checks explicitly choose Oldest. Manual opens an isolated dialog grouped by consuming input, including weighted transports, and requires exact counts. Equal-age tokens have separate draft-local numbers. Inhibitors have no picker and source transitions fire immediately. Cancel/Escape changes no simulation state; navigation, delay, policy, mode and tab changes cancel drafts, and revision/generation guards reject stale commits. History distinguishes Delay and component-qualified Fire actions with global time; replay uses stored snapshots and a new successful action after Back replaces the future. Failed actions preserve it.

Timed place dialogs edit literal-or-constant invariants and comma-separated initial token ages (unspecified tokens are age zero); transition dialogs edit urgency; input arc dialogs edit literal-or-constant intervals. To create a transport, draw both normal halves, open the input arc and choose its output partner. Either half's dialog edits both weights atomically; both routes survive. Unpair in the input dialog, or delete either half to delete both. Generic token tools add age-zero tokens and refuse removal that would drop recorded ages: use the place dialog to choose ages and count together. See [TIMED-UI.md](design/TIMED-UI.md) for source references, UI gates and validation.

Native bounds are integers ≤2,147,483,647; exact decimal ages and delays remain supported. Existing JSON decimal bounds survive unrelated edits, but TAPN save refuses them with a JSON alternative. Nonzero initial ages use repository HEAD's `initialMarkingAge` extension; released 4.0.4 was tested and silently resets nonzero ages to zero (4.0.0–4.0.3 also ignore it). The UI warns for affected models and TAPN downloads; retain web JSON or use a loader supporting initial token ages.

Deadlock indicates the current marking, not a verified property of the whole net. Verification engines, query editing/results, witness traces, coloured bindings, game synthesis and stochastic analysis remain future work.

## Validation

```bash
npm test
npm run build
npm run format:check
```

Core logic is independent of Angular. Tests cover rules/history, document/component isolation, files and real desktop fixtures, Quick Draw, bend editing, clipboard, query preservation, layout, and timed dialogs, atomic timing transactions, exact delay/history integration, and network execution.

Real Chromium harnesses in `scripts/check-native-core.mjs` and `scripts/check-documents.mjs` drive actual mouse, wheel, keyboard and file inputs. Their design reports record commands, limitations and defect fixes. The integrated untimed baseline passed 16/16 checks in each suite. These results must be rerun after later UI changes. Desktop TAPAAL 4.0.4 also opened an exported two-component fixture with the expected activation and node counts; that is one compatibility fixture, not full-format certification.

Fonts and icons are local/system assets. Dependencies are locked; generated builds and caches are ignored.

## Native example gallery

Use **File → Example nets…**. All 29 original native models are bundled unchanged; 19 currently open in independent tabs and 10 explain why they cannot open in the web editor. Search by name, family, constants or shared places. `npm run examples:check` checks source membership, bytes and real parser outcomes; `npm run examples:update` regenerates after intentional source/support changes. See [UI refinement and gallery report](design/UI-REFINEMENT-EXAMPLE-GALLERY.md).

In the Arc tool, middle-click chains alternating places/transitions or connects existing opposite-kind nodes. Middle-drag still pans. Physical Ctrl+click remains available. Arc properties accept an integer or declared constant name; suggestions come from Constants. Labels use native `2x` / `Name x` formatting without changing the editable term.

Synchronized shared transitions have a global pool pane and explicit local-transition sharing/adoption. Urgency belongs to the pool; geometry and arcs belong to members. Shared transitions cannot connect to any shared place, even in inactive components. JSON retains V3 identities; native TAPN validates root/member agreement. Nondefault native firing-mode metadata remains refused. See [the implementation and evidence](design/SHARED-TRANSITIONS.md).

Arc-label implementation commit: `bae4a27e776824409262980e6315b185a842deaa`. Parent independent review remains outstanding. All owned temporary validation jobs and browser contexts are closed.
