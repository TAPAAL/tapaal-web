# Element layout: name labels, transition rotation, text annotations

Core support for the modelling geometry that desktop TAPAAL persists beyond node positions and arc
bends. It covers the model, file round trips, pure editing helpers and layout geometry. **The editing UI is wired.** The left rail includes annotations and token tools; see "UI integration" below.

Code: `core/net.ts` (schema, validation), `core/element-layout.ts` (helpers, geometry),
`core/arc-geometry.ts` (rotated ports), `core/selection.ts` (group edits), `core/files.ts` and
`core/network-files.ts` (TAPN/JSON).

## Schema (all optional, omitted at the default)

```ts
interface NetNode {
  // …existing fields
  nameOffsetX?: number; // existing; absent = 0
  nameOffsetY?: number; // existing; absent = 35
  nameVisible?: boolean; // native displayName; absent = shown; helpers only ever write `false`
  angle?: number; // transitions only; safe integer, |angle| < 360; absent = 0
}
interface Annotation {
  id: string; // web-only, unique among the net's node/arc/annotation IDs
  text: string; // ≤ 100,000 chars; XML 1.0 characters, no CR (LF line breaks)
  x: number;
  y: number; // native positionX/positionY (component top-left), ±1,000,000
  width: number;
  height: number; // native width/height (inner text area), 0…1,000,000
  border?: boolean; // absent = true; helpers only write `false`
  filled?: boolean; // absent = solid; helpers only write `false`; never saved by desktop
}
interface Net {
  /* … */ annotations?: Annotation[];
} // ≤ 10,000; absent when empty
```

Old fixtures and round trips keep their shape. A net without these features has no new keys, and
helpers remove a field again when it returns to its default. `validateNet` checks every field. The
closed JSON allowlist in `network-files.ts` accepts exactly these keys (`node`: `nameVisible`,
`angle`; `net`: `annotations`; `annotation`: the eight keys above). The network JSON format version
stays 1, because each addition is optional.

## Native evidence

| Feature              | Native source                                                                                                                                                                                   | Behaviour ported                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label offset         | `PetriNetObjectWithLabel` (int offsets), `LabelHandler.mouseDragged`                                                                                                                            | Drag adds the unzoomed delta. Offsets are integers.                                                                                                               |
| Label position       | `NameLabel.updatePosition`                                                                                                                                                                      | The label's right edge is at the node's top-left + offset. Its top is 12 above that.                                                                              |
| Undo of a label move | `LabelHandler.mouseReleased`                                                                                                                                                                    | Native records undo only when **both** axes change. This is a bug that is _not_ ported: any change is one commit.                                                 |
| Name visibility      | Writer `displayName`, `TapnXmlLoader` (`equals("false")`), `ShowHideInfoAction`, editor checkbox                                                                                                | Only the exact string `false` hides a name.                                                                                                                       |
| Rotation             | `Transition.rotate`: `angle = (angle + inc) % 360`, rotated about the centre of the 30×30 component                                                                                             | Uses Java `%` sign semantics. The 10×30 outline rotates about the node centre.                                                                                    |
| Rotation inputs      | `PetriNetTab.timedTranstionMouseWheelWithShift`: wheel up is +135° per notch, wheel down is +45° per notch, on a **selected** transition. `TAPNTransitionEditor`: 0°, +45°, +90°, −45° (= +135) | `wheelRotation`, `EDITOR_ROTATIONS`                                                                                                                               |
| Angle load           | `TapnXmlLoader.parseTransition`: `Integer.parseInt`, then `rotate(angle)`                                                                                                                       | Fractions and exponents are refused. `405` loads as 45 and `-45` stays −45.                                                                                       |
| Rotated ports        | `Transition.updateEndPoints`, `ArcAngleCompare.calcAngle`                                                                                                                                       | The side is chosen relative to `angle`, with the wrap at `30° + angle`. Ports are rotated by `toRadians(angle + π)`. The control angle is `angle + 0/90/180/270`. |
| Annotations          | Writer `createAnnotationNoteElement`, loader `parseAnnotation`, `Note`, `AnnotationNote`                                                                                                        | `<labels positionX positionY width height border>text</labels>`, written **before** places in each `<net>`. The element has no ID.                                |
| Annotation box       | `Note.updateBounds` (`RESERVED_BORDER` 12)                                                                                                                                                      | The drawn rectangle is `(x+6, y+6, w+12, h+12)`. The text area is `(x+12, y+12, w, h)`. Eight resize points sit on the rectangle.                                 |
| Resize               | `Note.adjustTop/Bottom/Left/Right`, `ANNOTATION_MIN_WIDTH` 40, min height = the text's preferred height                                                                                         | The opposite edge stays fixed. Native refuses each mouse event that would go below the minimum; the web clamps the total delta at the minimum.                    |
| Create               | `GuiModelManager.addAnnotationNote`                                                                                                                                                             | The top-left is at the grid-snapped click. Blank first text adds nothing. A later edit may make the text blank.                                                   |
| Border / fill        | `EditAnnotationBorderAction` (undoable), `EditAnnotationBackgroundAction` (no undo, **not saved**)                                                                                              | See the fill contract below.                                                                                                                                      |
| Marquee              | `SelectionManager.processSelection` visits places and transitions only                                                                                                                          | Notes are not marquee-selected by default.                                                                                                                        |
| Group move clamp     | `SelectionManager.getTopLeftMostPoint` (non-arc component locations)                                                                                                                            | Note top-lefts take part in the clamp at 0.                                                                                                                       |

A native quirk that is deliberately not reproduced: `parseAnnotation` adds 1 to each of
positionX/positionY/width/height, and the writer saves the incremented values, so every desktop
save and reopen drifts each value by +1. The web stores and writes the file values unchanged.

## Round-trip contracts

- **JSON (network and legacy):** exact. This covers IDs, `filled`, fractional or negative note
  geometry, and every field above.
- **TAPN import** (`parseTapn`, and through it `parseNetworkTapn` per component):
  - `displayName="false"` becomes `nameVisible: false`.
  - `angle` becomes `angle % 360`, and 0 is omitted.
  - Each `<labels>` becomes an `Annotation`, in document order. Its ID is the lowest free
    `annotation-N`, after node and arc IDs, so reopening the same file gives the same IDs.
  - Text is the element's text content, with CRLF normalised to LF.
  - The strict network allowlist refuses: negative, fractional or exponent annotation numbers;
    `border` other than true/false; any attribute other than the five above; child elements,
    comments or CDATA in `<labels>`; fractional angles; and a `displayName` other than
    `true`/`false`.
  - The legacy `parseTapn` no longer warns that annotations are dropped.
- **TAPN export:**
  - Writes the native attributes and order: `labels`, places, transitions, arcs.
  - `displayName` comes from `nameVisible`, and `angle` from `angle ?? 0`.
  - Text is XML-escaped by the serializer (`&`, `<`, `>`).
  - Annotation IDs are not written. The verification self-check compares annotations by order,
    ignoring IDs, so a reopened file renumbers them.
  - Saved-query XML and protections are untouched. Annotations are never query symbols.
  - Export refuses:
    - fractional annotation geometry;
    - a note at a negative position (the native writer would write `""`);
    - `filled: false`.
- **Fill contract:** desktop treats transparency as session-only. JSON keeps it. TAPN export
  refuses it ("make it solid or save JSON") rather than drop it silently. If the product prefers
  native's silent loss, make `filled` view state instead of a model field.

## Helper API (`core/element-layout.ts`)

All edits are immutable. Each one validates its input and its result, throws on an unknown ID, and
returns a new `Net`.

| Helper                                                                 | Purpose                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `labelOffset(node)`, `withLabel(node, offset?, visible?)`              | Read the offset with defaults, and normalise a node                                           |
| `moveNodeLabel(net, id, delta)`, `setNodeLabelOffset(net, id, offset)` | Label drag. Results round to integers.                                                        |
| `setNodeNameVisible(net, ids, visible)`                                | Show or hide names                                                                            |
| `nodeLabelBox(node, size?)`                                            | Native label rectangle, or `null` when hidden. Default size ≈ 6.5 × chars by 13.              |
| `rotateTransitions(net, ids, increment)`                               | Native rotation. Throws for places.                                                           |
| `wheelRotation(notches)`, `normalizeAngle(a)`, `EDITOR_ROTATIONS`      | Native rotation inputs                                                                        |
| `nodeOutline(node)`                                                    | Four corners; rotated for transitions                                                         |
| `createAnnotation(net, at, text, size?)`                               | Returns `{net, id}`. Text must not be blank. Default size is 100×16, minimum width 40.        |
| `editAnnotationText(net, id, text, size?)`                             | Text edit, with an optional measured size                                                     |
| `moveAnnotation(net, id, to)`                                          | Absolute top-left, rounded                                                                    |
| `resizeAnnotation(net, id, handle, delta, minHeight?)`                 | One handle drag from the pre-drag state                                                       |
| `setAnnotationBorder`, `setAnnotationFilled`                           | Style toggles                                                                                 |
| `annotationBox`, `annotationTextBox`, `annotationHandles`              | Rendering geometry                                                                            |
| `freshAnnotationIds(net, n)`                                           | Deterministic `annotation-N` IDs                                                              |
| `layoutBounds(net, labelSize?)`                                        | Fit-to-content: rotated outlines, visible labels, note boxes, arc vertices and curve controls |

`core/selection.ts`:

- `selectInRectangle(net, rect, { annotations: true })` adds notes whose drawn box intersects the
  rectangle, after the arcs. Without the option the result is unchanged.
- `deleteSelection` removes selected notes.
- `duplicateSelection` copies selected notes with fresh IDs and the offset. Node copies keep
  `angle`, `nameVisible` and their offsets.
- `moveSelection` moves selected notes and includes them in the origin clamp.
- Node IDs and names are never touched for annotations, so saved-query protections are unaffected.

`netArcGeometry` now reads `node.angle`. At angle 0 the output is identical to before.

## UI integration

`app.ts` uses the helpers above for native labels, rotated transitions, ports, fit, annotation
creation/editing/movement/resize and style edits. Pointer drags preview from the original snapshot
and commit once on release; Escape and pointer cancellation restore it. Persistent drag values
are rounded to integers. SVG interpolation escapes note text; notes wrap at word boundaries using
approximate Helvetica metrics and clip inside the stored text area. Eight handles resize the
native note rectangle. Marquee retains native node/arc selection; clicks, Shift-click, Select All,
move, duplicate, delete, copy and cut include notes.

N selects annotation creation. Cancel or blank initial text adds no history. Double-click or Enter
edits a selected note; later blank text is permitted. The context menu toggles borders. New notes
are solid; the UI does not offer the native session-only transparency toggle. Imported transparent
notes render transparently and show an explicit JSON-only notice with a "Make solid" action;
TAPN save still refuses them rather than silently losing fill state.

Node property dialogs offer name visibility and native rotation increments (0, 45, 90, 135).
Context menus offer name visibility and +45° rotation. Labels drag independently of node positions.
Selected transition wheel up rotates +135°, down +45°; selected place wheel up adds one token,
down removes one, including at non-default zoom. These element actions precede modifier canvas
zoom/scroll, matching `PetriNetTab` registration and handlers. Unselected elements forward wheel
to canvas. The +/− tools edit one place token per click with nonnegative safe-integer bounds.
Simulation blocks model edits, and text controls own their keyboard shortcuts.

Clipboard node allowlists accept `angle` and `nameVisible`; desktop payloads preserve rotation,
including negative rotation. Notes and hidden names require a web envelope because native's
clipboard has no fields for them. For such selections, **text/plain is itself the web envelope**,
so browser sessions with only plain-text access still preserve every selected note. The notice
explicitly says desktop TAPAAL cannot paste that selection. The custom format and internal copy
remain lossless, with annotation IDs remapped and offsets translated on paste.

Validation covers pointer/keyboard/context actions, drag commit/cancel/undo, all eight resize
handles, rotated arc ports, token wheel modifier precedence and bounds, escaped TAPN/JSON layout
round trips, and clipboard layout/note transfers. Subsequent real-input Chromium validation
passes 58/58 assertions after fixing wrapped-note clipping; see [ELEMENT-LAYOUT-VALIDATION.md](ELEMENT-LAYOUT-VALIDATION.md).
