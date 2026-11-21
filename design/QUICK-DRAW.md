# Quick Draw

Native TAPAAL has no Quick Draw tool. Quick Draw is the set of **Ctrl-modified mouse presses inside
the Arc and Inhibitor arc tools**. It creates places/transitions and connects them without switching
tools. Smart Draw (`net/tapaal/gui/petrinet/smartdraw/*`, `SmartDrawDialog`/`SmartDrawWorker`) is a
separate automatic layout dialog and is not covered here.

Implementation: `src/app/core/quick-draw.ts` (framework-independent, existing `Net` schema).
Tests: `src/app/core/quick-draw.spec.ts`.

## Native source evidence

All paths are under `src/main/java`.

| Behaviour                                                                            | Source                                                                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Arc / Inhibitor / Transport tools install the controllers that handle Ctrl           | `pipe/gui/petrinet/PetriNetTab.java:1583-1591`                                                                   |
| Canvas press handler, both `// Quick draw` branches                                  | `PetriNetTab.java:2449-2476` (`AbstractCanvasArcDrawController.drawingSurfaceMousePressed`)                      |
| Arc tool: completing an arc continues from the target when Ctrl is down              | `PetriNetTab.java:2531-2603` (`CanvasArcDrawController.transitionClicked/placeClicked`)                          |
| Inhibitor tool: starts only at a place, completes at a transition, never continues   | `PetriNetTab.java:2339-2379`                                                                                     |
| Transport tool (timed only, three-click)                                             | `PetriNetTab.java:2643-2734`                                                                                     |
| Pending arc cancel keys: Escape, Delete, menu-shortcut+Z, menu-shortcut+Y            | `pipe/gui/petrinet/graphicElements/Arc.java:411-426`                                                             |
| Tool change clears the pending arc                                                   | `PetriNetTab.java:2436` (`teardownManager`)                                                                      |
| Canvas presses are mouse-_pressed_ events, with no button filter                     | `pipe/gui/canvas/DrawingSurfaceImpl.java:351-356`                                                                |
| Node position: centre → top-left (−15), unzoom, grid-align top-left                  | `DrawingSurfaceImpl.java:313-336`, `pipe/gui/canvas/Grid.java:16,42-56,87-94`                                    |
| Grid on at startup, default spacing 15; cycles 30 → off → 7.5 → 15                   | `pipe/gui/GuiFrame.java:548`, `Grid.java:42-51`                                                                  |
| Names: `P<n>`/`T<n>`, n = max existing (case-insensitive) + 1, from 0                | `net/tapaal/gui/petrinet/NameGenerator.java:29-41,66-109`                                                        |
| New node defaults: untimed place, non-urgent controllable transition                 | `net/tapaal/gui/petrinet/model/GuiModelManager.java:64-90`, called with `false,false` at `PetriNetTab.java:2466` |
| Arc rules: max one arc per place/transition direction (inhibitor included); weight 1 | `GuiModelManager.java:103-213`                                                                                   |
| Undo: node and arc are **separate** undo entries (no transaction)                    | `GuiModelManager.java:52-56`, no `startTransaction` on these paths                                               |

## Native contract

Modifier: `MouseEvent.isControlDown()`, the physical Ctrl key on every OS. Meta/Cmd does not count.
Shift during a canvas press only affects bend-point curvature, so it does not matter here.

Without a pending arc:

| Press                 | Arc tool                               | Inhibitor tool |
| --------------------- | -------------------------------------- | -------------- |
| place (any Ctrl)      | start from it                          | start from it  |
| transition (any Ctrl) | start from it                          | nothing        |
| empty canvas, no Ctrl | nothing                                | nothing        |
| empty canvas, Ctrl    | new place at grid point, start from it | same           |

With a pending arc from source `S`:

| Press                              | Arc tool                                                            | Inhibitor tool                         |
| ---------------------------------- | ------------------------------------------------------------------- | -------------------------------------- |
| node of S's kind, or S itself      | nothing (pending kept)                                              | nothing                                |
| opposite-kind node, no Ctrl        | add `S→N`, pending cleared                                          | add inhibitor `S→N`, cleared           |
| opposite-kind node, Ctrl           | add `S→N`, pending continues from `N`                               | add inhibitor, cleared                 |
| empty canvas, no Ctrl              | add bend point to the pending arc                                   | same                                   |
| empty canvas, Ctrl                 | new opposite-kind node at grid point, add `S→new`, continue from it | new transition, add inhibitor, cleared |
| Escape / Delete / Ctrl(Cmd)+Z / +Y | cancel pending arc only (no undo)                                   | same                                   |

If the arc is rejected (duplicate), native shows an error and clears the pending arc. With Ctrl held in
the Arc tool it **still** continues from the pressed node (`PetriNetTab.java:2548-2552,2584-2588`).
Holding Ctrl and pressing empty canvas therefore alternates P → T → P → T.

## Web API (`core/quick-draw.ts`)

```ts
type QuickDrawPress =
  | { target: 'node'; nodeId: string; ctrlKey: boolean }
  | { target: 'canvas'; point: Point; ctrlKey: boolean }; // model (unzoomed) coordinates

planQuickDraw(net, tool, sourceId, press): QuickDrawPlan // pure intention: start | create-and-start | connect | create-and-connect | ignore(reason)
applyQuickDraw(net, plan, options?): QuickDrawResult      // throws on 'ignore' plans and invalid input
quickDrawPress(net, tool, sourceId, press, options?): QuickDrawResult // plan + apply; use this from the UI

interface QuickDrawResult {
  plan; net; changed: boolean;          // net === input reference when !changed
  sourceId: string | null;              // next pending source
  createdNodeIds: string[]; createdArcIds: string[]; error?: string;
}
options: { gridSpacing?: number | null /* default 15 */; idPrefix?: string /* default 'web-' */; nodeName?: (net, kind) => string }

isQuickDrawModifier(event)  // event.ctrlKey
isQuickDrawCancelKey(event) // Escape, Delete, (ctrl|meta)+z/y
nativeNodeName(net, kind)   // P<n>/T<n>
snapToNativeGrid(point, spacing = 15)
freshIds(net, count, prefix = 'web-')
```

Guarantees: inputs are never mutated; every changed net passes `validateNet`. Ids never collide with
any node or arc id. One changing press yields one complete next net. The UI splits node-plus-arc creation into two
`NetEditor.commit` calls to match native history. Rejections return the original net plus `error`.

## Canvas integration

`App.pointerDown` calls `drawArcPress` for primary presses in the Arc and Inhibitor tools.
Middle-button panning runs first. Select tool Ctrl-selection stays independent. Only physical
Ctrl creates/chains nodes; Meta/Cmd remains supported for cancellation and normal shortcuts.
Ctrl context menus are suppressed in drawing tools to support macOS Ctrl-click.

`drawArcPress` calls the existing helper with model coordinates from `point(event)`, the current
`gridSpacing()` (`0` translated to `null`), and a document-owned `nodeName` allocator. For
create-and-connect, the UI commits the new node without its arc, then commits the helper's complete
net. Undo therefore removes the arc first and the node second, matching native. The helper retains
its atomic return value and standalone API; existing callers/tests are unchanged.

`App` retains separate place/transition naming high-water marks outside `NetEditor` history. Normal
creation and Quick Draw share them. Publishing edits/undo/redo can raise these marks; deletion and
undo never lower them. Document replacement resets and seeds them from the replacement names.

Pending prototype arcs update on pointer movement even without a drag, attach to opposite-kind
hovered nodes, and disappear on tool changes, mode changes, load, undo/redo, or drawing cancellation.
The window key handler checks pending-arc cancellation before document shortcuts, while focused
text controls retain Delete and text undo. Node Enter/Space handlers run earlier and stop propagation.
On the canvas, Escape/Delete/Ctrl(Cmd)+Z/Y cancel only the pending arc and leave tool, selection,
and document history intact. Pointer coordinates are copied explicitly from DOMPoint getters;
object spread does not retain them in real browsers.

## Pending bend integration seam

**Exact method: `App.addPendingArcBend(point: { x: number; y: number }, curved: boolean): boolean`.**
An ordinary blank primary press while an arc is pending reaches this method with unzoomed model
coordinates and `event.shiftKey`. Until the geometry owner integrates its schema, the method returns
`false`, preserves pending state/history, and reports that geometry integration is pending. It does
not store or render fake bend points. The parent should implement pending path storage here, render
that path in `prototypeArcPath`, attach it to successful arcs in `drawArcPress`, and clear it on all
pending-source changes/cancellation. Native blank presses add bends (they are not intentional no-ops).

## Acceptance scenarios

Canvas interaction tests in `app.spec.ts` cover Ctrl create/alternate/connect chains, existing-node
chains and same-kind no-op, ordinary completion, inhibitor termination, duplicate rejection and
continuation, two-entry history, all cancellation keys before global shortcuts, live hover preview,
physical Ctrl versus Meta, context suppression, zoom/grid/off coordinates, naming across
creation/deletion/undo/redo/replacement, and unchanged middle-pan and Ctrl-select behavior. Helper
unit tests continue to cover pure plan/apply semantics and validation.

## Supported / unsupported

Supported: Arc and Inhibitor tools in untimed single-template nets, Ctrl create-and-connect,
chaining, existing nodes, cancel keys, per-document names, current grid/zoom, prototype hover preview,
and native node/arc undo granularity.

Remaining native differences: pending bend storage/render/commit awaits the geometry integration
above; transport arcs (timed-only), shared nodes, urgent/uncontrollable variants are outside this
single-template untimed model. The canvas intentionally restricts drawing to primary presses so
middle-button navigation takes precedence, although Java's canvas controller has no button filter.
The standalone helper still defaults to stateless naming and an atomic result; UI integration supplies
the document lifetime and native history granularity. Web globally unique names skip collisions
across node kinds.
