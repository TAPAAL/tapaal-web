# Clipboard: cut, copy and paste

Cross-document and cross-component subnet reuse for untimed and timed uncoloured models.
Covers NATIVE-PARITY row C15. Timed execution still requires a single component.

Implementation: `src/app/core/clipboard.ts` (pure, framework-independent, immutable).
Tests: `src/app/core/clipboard.spec.ts`, `timed-clipboard.spec.ts` and app integration specs.
`timed-clipboard.ts` strictly validates, selects and remaps timing metadata.

Wired into `app.ts` / `app.html`: native clipboard events, Edit menu and canvas context actions.

## Timed web clipboard contract

Copy/cut/duplicate preserve the selected places' invariants, initial nonzero token ages (remaining
marking tokens implicitly have age zero), transition urgency, input intervals, weights and complete
transport pairs. Both routes, curved ends, labels, hidden names, rotation and annotations remain.
Only saved model timing is read; simulation marking/ages never enter a clipboard payload.

Timed text/plain and custom-format data use the same explicit envelope:
`{ format: 'tapaal-web-clipboard', version: 2, modelType: 'timed', native: '', nodes, arcs,
annotations?, timing }`. `timing` has exactly `intervals`, `invariants`, `ages`, `urgent` and
`transports`; nested keys and all component timing constraints are validated before mutation.
The empty `native` field is a reserved compatibility marker, not a projected untimed payload.
Version 1 remains the untimed envelope. The legacy payload property `nativeText` means the actual
text/plain string: for timed copies it is the version 2 envelope, never plain untimed JSON.

**Partial transport rule:** if any selected arc or selected endpoint touches either transport
half, both halves must be copied, with their source place, transition and destination place.
Otherwise copy/cut/duplicate refuses before writing the clipboard or changing the document, with
an instruction to select both halves and all endpoints. Explicitly deselecting a half also refuses.
Native emits a transport only after seeing both selected halves, silently omitting a lone half;
web deliberately refuses that lossy case. Untouched transports outside the selection are ignored.

Paste remaps every timing reference through freshly allocated element IDs and persistent native
P/T high-water names, then calls `commitTimedComponent` once. Untimed → timed receives default
timing. Timed → untimed explicitly refuses, including all-default timed selections. Cut stores the
immutable recoverable copy before `removeComponentElements`; saved-query guards and async
workspace/tab/component/revision guards remain atomic. Duplicate uses the same paste transaction.
Undo/redo restores the complete graph and timing together.

**Desktop boundary:** inspection of `CopyPastImportExport.kt` (not the file AST) confirms fields
for invariant, guard, urgency, weighted transport and both paths. It has no initial-age field:
`PlaceModel` contains only name/x/y/tokens/invariant and native paste calls `addTokens(tokens)`.
It also lacks annotations, hidden names and label offsets. This implementation keeps _all timed
clipboard transfer web-only_, even when a particular timed selection could fit native fields.
Desktop timed JSON import/export is unsupported and reported visibly; timed native guards,
invariants, urgency and transport payloads are refused instead of flattened. Untimed native JSON
interoperability and version 1 annotation/hidden-name envelopes are unchanged. No timed native
compatibility claim or desktop differential clipboard test is made.

## Native source evidence

All paths are under `src/main/java`.

| Behaviour                                                                                             | Source                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ctrl/Cmd+C/X/V actions (menu-shortcut key) in Edit menu and toolbar                                   | `pipe/gui/GuiFrame.java:185-199,702-704,941-943`                                                              |
| `copy()`: serialize the selection and write text/plain                                                | `pipe/gui/petrinet/PetriNetTab.java:1791-1795`                                                                |
| `cut()`: serialize, **then** `deleteSelection()`, then write the clipboard                            | `PetriNetTab.java:1797-1802`                                                                                  |
| `past()`: read text/plain (errors ignored), hand it to the importer                                   | `PetriNetTab.java:1804-1817`                                                                                  |
| Payload: `TAPAALCopyPastModel`, JSON although the method is named `toXML`                             | `net/tapaal/copypaste/CopyPastImportExport.kt:23-54,59-150`                                                   |
| Strict decode (default `Json`: unknown keys rejected); failure is a silent no-op                      | `CopyPastImportExport.kt:154-161`                                                                             |
| Paste is one transaction → one undo entry (`CompundCommand`)                                          | `CopyPastImportExport.kt:163,272`; `net/tapaal/gui/petrinet/model/GuiModelManager.java:35-47`                 |
| Nodes get **new** names from `NameGenerator` (P/T high-water counters per template)                   | `CopyPastImportExport.kt:175,184`; `GuiModelManager.java:64-90`; `net/tapaal/gui/petrinet/NameGenerator.java` |
| Position: stored top-left + `PLACE_TRANSITION_HEIGHT` (30), no grid snap, no viewport use             | `CopyPastImportExport.kt:175,184,301`                                                                         |
| Arc path: every point incl. both endpoint anchors, +30, endpoints recomputed by `updateArc()`         | `CopyPastImportExport.kt:298-305`                                                                             |
| Arcs whose endpoint is not in the payload, or whose guard/weight fails to parse, are skipped silently | `CopyPastImportExport.kt:191-270`                                                                             |
| Timed fields are dropped in untimed lenses; transport arcs become input+output arcs                   | `CopyPastImportExport.kt:169-173,184,251-268,286-295`                                                         |
| Pasted nodes are selected; selecting a node selects arcs to/from other selected nodes                 | `CopyPastImportExport.kt:273`; `pipe/gui/petrinet/graphicElements/PlaceTransitionObject.java:229-241`         |
| Delete: selected nodes with incident arcs, plus selected arcs (query impact prompt)                   | `GuiModelManager.java:334-411`                                                                                |

### What native copies

`toXML` walks the selection (`SelectionManager.getSelection()`): places, transitions and **selected**
arcs. Selecting a node auto-selects arcs whose other endpoint is already selected, so after a
marquee or a node-by-node selection every internal arc is selected. A user can also select an arc
whose other endpoint is unselected; native writes that arc and `past()` drops it because the
endpoint name is not in `nameToElementMap`. Transport arcs are written only if both halves are
selected.

### Field mapping

Native kotlinx `Json` encodes with `encodeDefaults = false`, so `path: []` and `curve: false` are
omitted, and decodes strictly (all non-default fields required, unknown keys fail).

| Native field                              | Web                                      | Notes                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `places[].name` / `transitions[].name`    | node name                                | Reference key inside the payload only; pasted nodes are renamed (native policy).                                                                                      |
| `x`, `y` (Int, top-left)                  | node centre − 15                         | Rounded when written; `x + 15` when read.                                                                                                                             |
| `tokens`                                  | `tokens`                                 |                                                                                                                                                                       |
| `invariant`                               | must be `< inf`                          | Anything else → `unsupported` (timed).                                                                                                                                |
| `uncontrollable`, `urgent`                | must be `false`                          | `true` → `unsupported` (game / timed).                                                                                                                                |
| `rotation`                                | transition angle                         | Integer rotation is preserved.                                                                                                                                        |
| `inputArcs` (place → transition, `guard`) | `normal` arc                             | Guard must be `[0,inf)`.                                                                                                                                              |
| `outputArc` (transition → place)          | `normal` arc                             |                                                                                                                                                                       |
| `inhibitorArc`                            | `inhibitor` arc                          | Native writes no guard for it.                                                                                                                                        |
| `weight` (String)                         | `weight`                                 | Positive integer literal only; constant names / multi-values → `unsupported`.                                                                                         |
| `path`                                    | `[sourceAnchor, ...bends, targetAnchor]` | Read like `TapnXmlLoader`: interior points become `bends`; the last point's `curve` becomes `curvedEnd`. Web writes node centres as anchors (native recomputes them). |
| `transportArcs`                           | —                                        | Any entry → `unsupported`. Native untimed paste would flatten to input+output; we refuse.                                                                             |

### Not representable in the native payload (kept only in the web envelope)

- Name label offsets (`nameOffsetX/Y`).
- Fractional coordinates (native is Int).
- Annotations and hidden names require explicit web-envelope text/plain. Timed model timing uses
  version 2, as above. Names are replaced on paste, matching native naming policy.

Native has no field for annotations, colours, shared places/transitions, arc label offsets, or
transition priority/player. A future schema must not claim those round-trip through native TAPAAL.

## Web behaviour (and where it differs)

- **Copy content:** the UI passes `{ selectedArcsOnly: true }`: selected nodes and selected internal
  arcs. Node selection changes auto-select arcs between selected endpoints, matching
  `PlaceTransitionObject.select()`. Explicit arc deselection persists through publication, copy and
  movement until an endpoint becomes newly selected. The helper's default still includes all
  internal arcs for existing callers. Selected arcs with an outside endpoint are omitted (native
  writes these, then drops them during paste).
- **Nothing selected / only arcs:** `ClipboardError('empty')`. Native copies an empty model. A cut
  with no nodes therefore does **not** delete anything.
- **Cut deletion:** `documents.ts#removeComponentElements`. It removes selected nodes with incident arcs,
  plus selected arcs. The document commit guard rejects deletion of saved-query protected symbols atomically; the clipboard copy remains recoverable.
- **Paste naming:** every node is renamed through `PasteOptions.nodeName` (default
  `quick-draw.ts#nativeNodeName`), places first, then transitions, in payload order (native order).
  For native `NameGenerator` counters that never go down, pass the document-owned allocator,
  as Quick Draw does.
- **IDs:** the app passes its persistent element allocator; pure callers default to
  `freshIds(net, n, idPrefix)`. Every pasted node, arc and annotation receives a fresh ID.
- **Position:** default `offset` is native +30,+30 from the copied coordinates. Repeated pastes
  land on the same spot, as in native. Optional `at` puts the fragment's top-left (node corners and
  bends) at a point. Optional `grid` snaps the first pasted node's top-left with
  `snapToNativeGrid` and moves the rest rigidly. Native pastes never snap. After that, the delta is
  pushed right/down (in whole grid steps when snapping) so no node corner or bend is negative, like
  `SelectionManager.translateSelection`.
- **Native dangling arcs:** arcs naming a node absent from a native payload are dropped and
  counted in `droppedArcs`, to accept real native payloads. Everything else that native would skip
  silently is rejected as a whole: wrong-kind endpoints, duplicate names, duplicate edges, bad
  weights. Malformed native JSON is reported, not a silent no-op.
- **Unsupported native input semantics:** timing, game, transport, constants and any unknown field
  are rejected with `code: 'unsupported'`. Nothing is flattened.

## API

```ts
copySelection(net, selectedIds, { selectedArcsOnly?, timing? }): ClipboardPayload
cutSelection(net, selectedIds, { selectedArcsOnly? }): { net: Net; clipboard: ClipboardPayload }   // nothing committed
readClipboard({ webText?, text?, internal? }): { content, source, droppedArcs }
pasteClipboard(net, content, { offset?, at?, grid?, idPrefix?, nodeName?, elementId?, timedTarget? }): {
  net, selectedIds, idMap
}
// Lower level: clipboardPayload, serializeNativeClipboard, serializeWebClipboard,
// parseNativeClipboard, parseWebClipboard.
```

- `ClipboardPayload = { content, nativeText, webText }`, deeply frozen. `content` is
  `{ nodes, arcs, annotations?, timing? }` with the original IDs and web centre coordinates.
- `nativeText` is native `TAPAALCopyPastModel` JSON for representable untimed selections; timed,
  annotation and hidden-name selections use an explicit web envelope in text/plain.
- `webText` is `{ format: 'tapaal-web-clipboard', version: 1, native: nativeText, nodes, arcs }`.
  It is a separate envelope, not a field added to the native JSON, because native decoding
  rejects unknown keys. Annotation/hidden-name selections put an explicit web envelope in text/plain
  too, with a visible desktop-transfer notice. Timed copies use version 2 as specified above.
- Errors: `ClipboardError` with `code` `'empty' | 'not-tapaal' | 'malformed' | 'unsupported' |
'too-large'` and a user-presentable message. Programming errors (invalid target net, non-finite
  options) throw a plain `Error`.
- Bounds: text ≤ 4,000,000 characters, ≤ 5,000 nodes, ≤ 20,000 arcs, ≤ 100,000 bends total, ≤
  `MAX_ARC_BENDS` per arc, coordinates within ±`COORDINATE_LIMIT`. Parsing is `JSON.parse` plus
  field-by-field copying of known keys (`__proto__` and other unknown keys are rejected). There is
  no eval, HTML or XML/entity handling.

## UI integration

The app owns one immutable internal clipboard shared by all tabs and components.

- **Keyboard:** Ctrl/Cmd+C/X/V use `document:copy/cut/paste` and synchronous
  `ClipboardEvent.clipboardData`. Keydown deliberately does not invoke clipboard actions or cancel
  these defaults, preventing duplicate transactions. Input, textarea, select and contenteditable
  targets retain their text clipboard. Open dialogs also retain their clipboard ownership.
- **Menu/context:** Edit and canvas context actions use `navigator.clipboard`. Copy/cut first try
  `text/plain` (native JSON or an explicit web envelope) and `WEB_CLIPBOARD_TYPE` items; unsupported custom formats fall back
  to `writeText(nativeText)`. Keyboard copy writes the same native JSON or explicit web envelope as text/plain. The web envelope is never
  added as unknown fields to native JSON. A matching internal payload preserves fractional coordinates and
  name label offsets even when only plain text is available.
- **Unavailable/denied/insecure:** copy/cut explicitly report “inside TAPAAL Web only” and that
  other apps cannot paste it. Paste reports when an unreadable system clipboard required the
  internal copy. A readable unrelated or malformed clipboard never silently uses stale memory.
- **Cut:** build the payload and candidate deletion, store the internal payload, attempt system
  write, then commit once. Saved-query protections use the real document guard; rejection leaves
  data, selection and history intact, retaining the recoverable copy.
- **Async safety:** capture the immutable workspace snapshot (document, component, network and
  history revision) plus an operation counter before awaiting permission/I/O. Any workspace change
  or newer clipboard action aborts with a notice. A cut also cancels when the selection changes
  during the write; copying and deletion both use the same captured selection. The app never commits into the newly active tab
  or replaces intervening edits. A system copy may already have completed when cancellation is
  reported; it does not delete or paste anything. This conservative guard can also cancel after
  harmless view/session changes.
- **Paste:** fixed native +30,+30, without grid snapping or cursor placement. Fresh IDs and the
  same per-document/component persistent P/T high-water allocator used by regular and Quick Draw
  creation. One document commit and one undo entry; pasted nodes and arcs become selected.
  Malformed/unsupported content changes nothing. Dropped dangling native arcs produce a notice.
- **Simulation:** all three actions are disabled, matching `GuiFrame.setGUIMode`, lines 1421–1446.
  Mutation also calls `requireEditableModelType` and commits through the document API.
- **Unsupported metadata:** clipboard serialization rejects unknown node/arc fields, rather than silently losing them. Supported hidden names and rotation have explicit mappings. Future schema fields require an
  explicit clipboard mapping and round-trip tests before they can be copied.

## Tests (clipboard.spec.ts)

Covered: internal vs incident arc inclusion; arc-only selection; exact native JSON shape; frozen and
detached content; cross-net paste with colliding names/IDs; P/T high-water naming; repeated pastes
unique; weighted, inhibitor and output arcs; bends/curved ends offset with no shared arrays; injected
allocator; `at`, grid snap and origin clamp; one commit = one undo for paste and cut; cut atomicity
and originals unchanged; native-authored payload acceptance; native round trip; dangling native
arcs dropped and counted; each unsupported native field rejected; malformed payloads rejected
without touching the target; non-TAPAAL and oversized text; web envelope round trip, dangling arcs,
unknown fields and `__proto__`; source precedence (web / internal / native / denied / stale).

## Open

- Native differential test: paste `nativeText` into native TAPAAL and paste a native-copied
  selection here (runtime clipboard transfer remains unverified; the mapping is from source only).
- Desktop timed/symbolic clipboard import/export and games remain unsupported. Symbolic web transfer uses version 3 below. Timed web transfer,
  rotation and annotations are supported as described above.
- Query-impact confirmation is represented by conservative saved-query deletion guards; remove saved queries explicitly before cutting protected nodes.
- No viewport/pointer paste action is offered; ordinary paste retains native fixed +30 placement.

App integration tests cover synchronous native events, denied system clipboard and recoverable cut,
external native text, lossless internal geometry, cross-document/component paste, real query-guard
rejection, one-undo paste, persistent names after undo, text focus, no keydown double handling,
async tab-switch/edit races and source-backed simulation gating.

## Timed implementation validation (2026-10-29)

- Full Vitest: 499/499 passing, 21 files. Strict TypeScript checks passed for the app and timed
  clipboard specs. Production build passed, initial size 520.61 kB; existing 500 kB warning retained
  without changing the budget. Full format check passed through `worker-job`.
- New core/app coverage includes frozen detached copies, implicit age-zero plus nonzero ages,
  strict intervals/invariants, urgency, weighted paired transports, routes/labels/rotation/notes,
  malformed timing and unknown keys, partial-pair refusal, local ID clashes, fresh names/IDs after
  undo, cross-component/document transfer, saved-query cut guards, denied clipboard recovery,
  async revision cancellation and timed/untimed direction gates. Existing untimed cases pass.
- Shared preview used real file upload and Ctrl+A/C/V/X/Z input, with read-only state inspection.
  Verified copied initial ages `0.1`, `2.50`, invariant `<=3`, implicit zero token, strict `(1,5)`,
  both routes and transport weight 2; fresh mapped pair IDs; one paste undo; partial-pair refusal
  with no history mutation; one-step cut and faithful subsequent paste. Fixture retained at
  `/tmp/tapaal-timed-clipboard-check/pair.json`. Preview tab closed and owned server stopped.
- Desktop timed clipboard transfer remains deliberately unsupported; browser smoke does not claim
  native runtime clipboard interoperability or substitute for the root's independent review.


## Authored symbolic clipboard v3 (constants wave 4)

`core/authored-clipboard.ts` owns the authored seam. `copyAuthoredSelection(document, ids)` returns the old numeric payload only after checking the preserved fragment has no references. Symbol-bearing fragments return an immutable v3 payload. `readSelectionClipboard` dispatches v3 from custom MIME, plain text in a fresh context, or unavailable-system internal fallback; legacy v1/v2/native readers remain unchanged. Readable unrelated/malformed data refuses instead of using stale memory.

The strictly closed envelope is `{format: "tapaal-web-clipboard", version: 3, modelType: "timed" | "untimed", sourceDocumentId, constants: [{id,name,value}], fragment: {nodes,arcs,annotations?,timing?}}`. This version is independent of file JSON v2. Timing is required exactly for timed fragments. Every weight, interval endpoint and invariant reference must bind exactly one included declaration, and unused declarations refuse. Initial ages, marking, urgency, complete paired transports, routes, labels, rotation and notes remain authored. No simulation marking is copied. Text/node/arc/bend/annotation limits and authored model constraints apply. Prototype, hidden/accessor and unknown fields refuse; prototype-looking IDs and names are data handled by Maps and own properties.

`prepareAuthoredPaste` checks binding policy before allocating placement. Same source document uses current IDs, independent of copied names/values, and refuses missing IDs without restoring declarations. Across documents every dependency receives a fresh ID and retains the copied name/value only if that name is free. Any same-name collision refuses atomically, even equal values. Repeating a cross-document paste can therefore refuse; copy the pasted target selection for same-document repetition. There is no automatic merging, renaming, inlining or mapping UI.

Placement reuses numeric geometry routines with inert weights, without encoding or saving that temporary geometry. Exact authored weights and timing are remapped from the fragment; every existing source term is retained. `editor-workspace.pasteAuthoredSelection` submits one closed `pasteElements` command combining declarations and graph/timing additions. Validation precedes publication; undo removes both, redo restores the same bindings. Query protections remain on original symbols only. Cut removes elements, never global declarations.

Symbolic `nativeText` and `webText` are identical v3 envelopes; the former field means text/plain, not a desktop compatibility claim. Custom MIME is attempted when supported. Copy/cut notices distinguish web-only transfer from unavailable-system internal recovery. Desktop native copy resolves constants and cannot provide this fidelity. Timed-to-untimed still refuses; untimed-to-timed gets default timing. Copy component retains its existing source-preserving behavior.

The App captures source and selection once. Workspace identity and operation generation reject async edits, tab/component switches and undo/redo ABA; a selection generation also rejects cut selection changes away and back. Query refusal retains the copy without source/history/selection/checkpoint mutation. Text fields and dialogs retain browser clipboard ownership, and simulation blocks source edits.

### Wave 4 validation (2026-10-29)

- Full Vitest: 743 tests / 31 files passed. Strict application and changed-spec TypeScript checks passed. Production build passed at 578.47 kB initial total; the existing 500 kB warning budget is unchanged. Full source formatting passed.
- Public tests cover dependency closure and malformed/closed/prototype data; every symbolic scalar position including Zero; same-document rename/value/deletion behavior; fresh cross-document bindings and equal/unequal name collision refusal; one dependency+element undo/redo; timing, initial age spelling, transport completeness/identity, routes, rotation and annotations; numeric native/v2 compatibility; fresh-context plain v3 and denied fallback; query cut recovery and async constant/selection/tab/undo ABA cancellation.
- Shared preview used real file upload and Ctrl+A/C/V/Z/Y on the scalar fixture and a blank timed target. Read-only probes confirmed same-document references and transport remapping, one-step undo, fresh cross-document IDs, unchanged source/history/selection/checkpoint after repeated-import collision, dependency+element undo, identical redo bindings, and successful repeat after copying the target selection. No App methods or signals drove the browser actions.
- Constants browser harness C11 now checks positive symbolic fidelity, dependency closure, equal-value collision refusal and existing numeric actions. This updated scripted case and the six historical harnesses were not rerun here; the shared-preview smoke above is the browser evidence from this implementation pass. The prior C01/C05 label fix is retained.
- Preview tab closed and owned smoke server stopped. No deployment, commit, PR or native runtime transfer was performed. Desktop symbolic/timed transfer and explicit mapping remain unavailable; no numeric-engine, authored-model validator, file codec or legacy-document Interface changes were needed.
