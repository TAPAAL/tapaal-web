# Native core workflow validation

Browser run on 2026-10-28 against the uncommitted worktree (HEAD `28c9bd9`, `app.ts` last modified
22:05). The app ran on a temporary `ng serve` on port 4317, which was stopped afterwards. Every
action used real Playwright mouse, wheel and keyboard input in headless Chromium 156 (Playwright-core
1.64.1, already installed; nothing was added to the project). Modifiers came from held keys
(`keyboard.down('Control')`). App state was only read, through Angular's dev-mode `ng.getComponent`,
the rendered SVG and a saved `.tapn` download.

Reproduce (needs a running dev server):

```bash
PLAYWRIGHT_CORE=/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core \
  node scripts/check-native-core.mjs http://127.0.0.1:4317 /tmp/tapaal-native-core
# ONLY=Q4,Q9 restricts the run to those checks.
```

Evidence lives in `/tmp/tapaal-native-core`: `results.json`, `Q1-chain.tapn` (saved with Ctrl+S),
and screenshots `N5-150-percent.png`, `Q1-chain.png`, `Q3-inhibitor.png` and `Q4-preview.png`.

**Initial result: 14/16 checks passed; 2 real defects.** Both reproduced consistently.

**Integration follow-up:** D1 and D2 were fixed in `app.ts`, with regression tests. The real-browser
Q4/Q9 rerun passed 2/2 against a development build served temporarily on port 4318.
Q4 now confirms live preview coordinates at 100%/150%, including same-kind hover; Q9 confirms
Delete edits the inspector text and leaves the pending arc intact. Evidence: `/tmp/tapaal-native-core-fixed/results.json`.
The complete post-fix browser suite then passed **16/16 checks** against the same integrated build.
Evidence: `/tmp/tapaal-native-core-all-fixed/results.json`. The temporary static server was stopped.
The original defect descriptions below are retained as diagnosis history.

## Defects

### D1 — the pending-arc preview never follows the pointer over blank canvas (Q4, critical for Quick Draw)

- **Steps:** Arc tool, click Idle, then move the mouse over empty canvas.
- **Observed:** no `path.prototype-arc` is rendered. `app.arcPointer()` is `{}`. The preview only
  appears while you hover an opposite-kind node, because then `nodeId` is set. Over a same-kind node
  it stays frozen at the last attached end. The same happens after a Ctrl create, and at 150%.
- **Cause:** `src/app/app.ts:888`, `this.arcPointer.set({ ...this.point(event), ... })`. `point()`
  returns a `DOMPoint`, whose `x`/`y` are prototype getters, so spreading it copies nothing. A
  minimal check in the browser, `JSON.stringify({ ...new DOMPoint(1, 2) })`, returns `{}`. The
  jsdom-based specs cannot see this.
- **Likely fix:** `const p = this.point(event); this.arcPointer.set({ x: p.x, y: p.y, ...(id ? { nodeId: id } : {}) });`
- This bug was already present before the bend work started (first run, about 22:01). It does not
  come from the pending-bend wiring.

### D2 — Delete in an inspector field is swallowed while an arc is pending (Q9, moderate)

- **Steps:** Select Idle. Arc tool, click Idle (an arc is now pending). Click the inspector Name
  field, press End, ArrowLeft, Delete.
- **Observed:** the field still reads `Idle` (expected `Idl`), and the pending arc was cancelled.
- **Cause:** `app.ts:1301` handles the pending-arc cancel keys before the input guard at
  `app.ts:1337`, and calls `preventDefault`. Native binds the cancel keys `WHEN_IN_FOCUSED_WINDOW`
  (`Arc.java:411-418`). A focused `JTextField` consumes DELETE through its own `WHEN_FOCUSED` keymap
  first, so the text is edited and the arc stays pending. Escape and Ctrl+Z still reach the native
  binding, because text fields don't bind them.
- **Likely fix:** for Delete/Backspace, skip the cancel when the target is an editable field.

### Minor observations (not graded)

- **Ctrl+J in the element dialog:** the keydown reaches `window` with `defaultPrevented: false`,
  because the handler returns at `app.ts:1281` while the dialog is open. In headed Chrome, Ctrl+J
  would open Downloads. Native modal dialogs block menu accelerators. No app state changed.
- **Ctrl+Z in the dialog name field:** the browser's own text undo runs. The value went
  `gpmsa → gpm → gpms`; document history was untouched (correct).
- **Meta+wheel and Cmd+J/K also zoom.** Native uses Ctrl only for the wheel, and the menu shortcut
  key for J/K. This is a deliberate web affordance for macOS.
- **Snapping at zoom levels other than 100% differs from native.** Native
  `adjustPointToGridAndZoom` unzooms twice (`DrawingSurfaceImpl.java:313-336` plus
  `Grid.align`), so at 150% model positions snap to 22.5-unit steps. A click at model (412,227)
  becomes centre (420,225) natively; the web gives (405,225), a consistent 15-unit grid in model
  space. The web choice is arguably better; the parent should decide whether to copy the quirk.
- **No typed percent field.** Native also has only a slider (`GuiFrame.java:1108-1124`). The web
  slider and its `NN%` label matched native.

## Known gap (not a failure)

Pending bends: a plain blank press while an arc is pending now adds a draft bend
(`draftBends().length === 1`, pending source kept). That integration was still being edited during
this run and was not graded. While it was mid-edit (around 22:03), `prototypeArcPath` threw
`Name must start with a letter…` from `validateNet` (the synthetic `'Draft target'` name). That
broke the template render, so new arcs stopped appearing. It was fixed by 22:05; Q3 passes on the
final run.

## Checks and observed output (final run)

| ID | Workflow (real input) | Result | Observed |
| --- | --- | --- | --- |
| N1 | Wheel without modifiers | PASS | Zoom stays 100. Wheel 100 moves y 0→100. Wheel up clamps at 0. Shift+wheel 120 moves x to 120. deltaX 80 moves x to 200. Page scale stays 1. |
| N2 | Ctrl+wheel | PASS | Rotation down zooms in 100→110, as native `zoomIn` on rotation>0 (`DrawingSurfaceImpl.java:385-390`). Two notches up give 90. No scroll. Clamps at 20. The browser page does not zoom. |
| N3 | Ctrl/Cmd J/K | PASS | J: 100→110. K twice: 90. Clamps at 300 and 20, with the toolbar button disabled at each bound. All 69 J/K keydowns `defaultPrevented`. |
| N4 | Slider | PASS | ArrowRight 101, End 300, Home 20; label `20%`. A click mid-track gives 160. At 295, Ctrl+J is rejected (stays 295), as native `setPercent` rejects it. |
| N5 | 100% / 150% mapping | PASS | Place is 30 px at 100% and 45 px at 150%. Model (160,240) maps to canvas px (240,360) at 150%. Place-tool click: model (412,157) gives centre (405,150) at 100%. Pixel (618,340.5) at 150% gives (405,225), rendered at px (607.5,337.5). |
| N6 | Middle drag | PASS | A drag of (−100,−50) px pans the view to (100,50). Selection [idle] is kept, the net is unchanged and no undo entry is added. Dragging from a node pans and the node doesn't move. At 150%, a 150 px drag pans 100 units. A pending arc survives the pan. |
| N7 | Grid cycle (G) | PASS | 15 → 30 → off → 7.5 → 15. Off: (212,113) stays exact. Spacing 7.5: (262,163) snaps to (262.5,165). Spacing 15: (352,163) snaps to (345,165). |
| Q1 | Ctrl canvas chain | PASS | Creates P0, T0, P1 with arcs P0→T0 and T0→P1; still pending from P1; Arc tool kept. P0 at (195,465). Saved `.tapn` has P1 `positionX="390"` and arc T0→P1. |
| Q2 | Endpoints | PASS | Plain press on Reset completes Idle→Reset and clears the pending arc. Place→place is ignored. Ctrl on a node chains. A duplicate is rejected with an error, and Ctrl still continues from Reset. |
| Q3 | Inhibitor | PASS | A transition press doesn't start an arc. Ctrl P0 then T0 makes P0 -o T0 and clears the pending arc. Ctrl on the target doesn't chain. 2 inhibitor heads rendered. |
| Q4 | Preview | **FAIL (D1)** | Attaches when hovering Start (end 315,241). Over blank canvas: no preview, `arcPointer = {}`. |
| Q5 | Cancel keys | PASS | Escape, Delete, Ctrl+Z, Ctrl+Y and Meta+Z each clear only the pending arc: tool, net, selection and undo are unchanged, and the preview is removed. The next Ctrl+Z undoes the document; Escape with no pending arc returns to Select. |
| Q6 | History granularity | PASS | Undo goes `P0+T0 / P0 / –` (arc, then node). Redo is symmetric. |
| Q7 | Name high-water | PASS | After undoing P1, Quick Draw makes P2. After deleting T0, the Transition tool makes T1. The Place tool continues with P3. |
| Q8 | Ctrl-select in Select | PASS | Ctrl toggles nodes in and out of the selection; Shift adds. Ctrl+blank creates nothing and opens no context menu. |
| Q9 | Inputs keep keys | **FAIL (D2)** | Dialog: typing `gpmsa`, Delete, Backspace, Ctrl+J and Ctrl+Z changes no app state (tool, zoom, grid, net). Inspector without a pending arc: G/P/Delete edit text only. With a pending arc: D2. |

Harness notes: Angular renders the SVG one frame after the signal changes. The script waits two
animation frames before every read. Early runs that did not wait reported a stale scale of 140%,
which was not an app bug.

## After document and clipboard integration

The working-tree browser harness passed **16/16** again after the TAPN XML-declaration fix and integer grid rounding. Q8 now includes native automatic arc selection and retained incident-arc selection on node deselection (PetriNetObjectWithLabel.deselect does not deselect arcs). Evidence: `/tmp/tapaal-native-core-selection-final/results.json`.
