# Arc paths (bend points)

Desktop TAPAAL stores each arc as a path of points. The first and last points are the endpoints and
are always recomputed from the nodes. The points in between are bend points the user placed. Each
point has a straight/curved type. The web model stores only what native files really carry: the
interior points and the type of the target endpoint. Endpoint anchors stay automatic.

Native sources are cited as `path:line` relative to `src/main/java/`.

## Coordinate contract

| Concept              | Native                                                                                                                           | Web (`Arc` in `core/net.ts`)                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Node position        | top-left `positionX/Y`                                                                                                           | centre `x/y` = `positionX/Y + 15` (existing rule)                                                        |
| Interior point       | `<arcpath>` 1..n-1, absolute unzoomed canvas coords (`getOriginalX/Y`, `pipe/gui/petrinet/graphicElements/ArcPath.java:572-585`) | `bends[i] = { x, y, curved }`, **the same absolute coordinates, unchanged** (same frame as node centres) |
| Point type           | `arcPointType` (`true` = curved, `ArcPathPoint.java:30-31`)                                                                      | `curved` on the bend: the segment _ending_ at that point belongs to a curve                              |
| Source endpoint      | `<arcpath id="0">`, type forced straight (`ArcPath.java:81,188`)                                                                 | not stored                                                                                               |
| Target endpoint      | last `<arcpath>`; its type is user-toggleable (`ArcPathPoint.java:73-88` only excludes index 0)                                  | `curvedEnd?: true` (the final segment is curved)                                                         |
| Endpoint coordinates | written but overwritten on load by `Arc.updateArcPosition` (`Arc.java:204-219`)                                                  | written as node centres; ignored on import                                                               |

- `bends` absent or empty and `curvedEnd` absent/false mean the old straight arc. Helpers omit both
  fields when they are default, so old JSON/TAPN documents and fixtures keep their exact shape.
- Validation (`validateNet`): `bends` is an array of at most `MAX_ARC_BENDS` (1000) objects with
  finite `x`, `y` within ±`COORDINATE_LIMIT` (1,000,000) and a boolean `curved`; `curvedEnd` is
  boolean when present. Invalid documents are rejected at every editing/file seam.
- Native coordinates are integers. Import truncates like the Java `(int)` cast
  (`ArcPathPoint.java:55-60`); `moveArcBend` rounds like `ArcPath.setPointLocation`
  (`ArcPath.java:373-377`); `insertArcBend` truncates like the native constructor. Grid snapping is
  the caller's job (see Integration).
- Weight, kind (normal/inhibitor), IDs and timing handling are untouched by every geometry helper.

## Native → web file conversion (`core/files.ts`)

Import follows `dk/aau/cs/io/TapnXmlLoader.java:1151-1177`:

- All `arcpath` descendants of an arc, in document order. 0 points → straight default. ≥2 points →
  points 1..n-2 become `bends`; the last point's type becomes `curvedEnd`; the first point's
  coordinates and type are ignored.
- `xCoord`/`yCoord` are required on every point. Missing, empty, non-numeric, `NaN`, infinite or
  out-of-range values reject the file (Java's `Double.parseDouble` would fail or produce garbage).
- `arcPointType` is curved iff it equals `true` case-insensitively (`Boolean.parseBoolean`).
- A path with exactly one point cannot be drawn natively; it imports as a straight arc with the
  warning "Arc paths with a single point were replaced with straight connections."
- The previous "Arc bend points will be replaced with straight connections" warning is gone: bends
  are no longer discarded.

Export mirrors `dk/aau/cs/io/TimedArcPetriNetNetworkWriter.java:332-345,801-811`: per arc,
`arcpath` elements with sequential `id` 0..n+1: source centre (`false`), each bend, target centre
(`curvedEnd`). JSON stores `bends`/`curvedEnd` verbatim in the existing version 1 format; older web
builds would ignore the fields rather than refuse the file.

Not ported: desktop snaps loaded interior points to the grid when the grid is enabled (the point
is not yet in the list, so `isEndPoint` is false; `ArcPathPoint.java:106-126`,
`PetriNetObject.java:207-210`). The web keeps file coordinates exactly. Standard PNML
`<graphics><position>` (`dk/aau/cs/io/PNMLoader.java:380-405`, which adds an offset of 4) stays
out of scope because the web importer only accepts TAPAAL's own untimed dialect.

## Geometry for SVG (`core/arc-geometry.ts`)

`netArcGeometry(net): Map<arcId, ArcGeometry>` computes every arc at once. Transition ports depend
on all arcs that meet a transition. `arcGeometry(net, arcId)` is a convenience wrapper for one arc.

```ts
interface ArcGeometry {
  vertices: ArcPathVertex[]; // source anchor, bends, target anchor; each with curved, control1, control2
  d: string; // SVG path: M start, then `L p` (straight) or `C c1 c2 p` (curved) per vertex
  start: Point;
  end: Point; // automatic anchors
  endAngle: number; // travel direction into the target, atan2(dy, dx), SVG y-down radians
  midpoint: Point; // native label anchor
}
```

Ported behaviour:

- Control points: `ArcPath.setCurveControlPoints/setStraightControlPoints/setEndControlPoints`
  (`ArcPath.java:143-329`), including the natural cubic spline over runs of curved points with
  integer-truncated knots (`ArcPath.java:194-232, 510-548`) and the `modAB < 7` degenerate case
  (`ArcPath.java:164-171`).
- Place anchors: the rounded circumference point facing the adjacent control point
  (`Place.java:126-145`, rounding through `ArcPath.setPointLocation`). The source uses vertex 1's
  `control2`; a target place uses the last vertex's `control1` (`ArcPath.java:439-455`).
- Transition anchors: each arc is assigned to a side by the angle to its neighbouring path point,
  measured relative to the transition's `angle` (the `30° + angle` wrap of
  `ArcAngleCompare.calcAngle` included), with ±30° around the rotated vertical going to the
  bottom/top centre. Left/right arcs are spread
  evenly in angle order with native integer spacing, `+1` fudge and the `toRadians(angle + Math.PI)`
  ≈3.14° skew added to the rotation (`Transition.java:219-343, 377-392`). The side also sets the
  `transitionAngle` (`angle + 0/90/180/270`) used for curved segments that touch the transition.
  See design/ELEMENT-LAYOUT.md for rotation editing.
- `Arc.updateArcPosition` updates the endpoints twice (`Arc.java:204-219`). The web runs two
  anchor/control passes, which converges to the same result in practice.
- Mid-point: half of the vertex polyline length, ignoring curvature (`ArcPath.java:110-136`).
- `bendBounds(net)` gives the extent of all bends. Desktop includes path points in canvas extents
  (`pipe/gui/petrinet/PetriNetTab.java:1985-2025`).

Known differences: Zoom is
an SVG transform, so geometry is always computed at 100%. The arrowhead shortening and marker
remain the renderer's responsibility.

## Editing API (`core/arc-geometry.ts`, `core/selection.ts`)

All helpers are pure. They validate input and output, throw on an unknown arc, a bad bend index or
non-finite coordinates, and return a new `Net` without mutating their input.

| Helper                                                              | Native counterpart                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insertArcBend(net, arcId, point, curved = false) → { net, index }` | `ArcPath.insertPoint` / `findPoint` (`ArcPath.java:608-645`): split the segment whose vertex midpoint is nearest; ties go to the earliest segment. Desktop triggers: arc context menu _Insert Point_ (`Arc.java:99-100`, `SplitArcAction.java:22-40`, straight) and Ctrl+double-click on an arc (`PetriNetTab.java:3051-3061`, Alt = curved).                                                                                            |
| `splitArcBend(net, arcId, index)`                                   | `ArcPathPoint.splitPoint` (`ArcPathPoint.java:213-220`): same type, +10 px in x, inserted after.                                                                                                                                                                                                                                                                                                                                         |
| `moveArcBend(net, arcId, index, point)`                             | dragging an `ArcPathPoint`. Rounded.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `deleteArcBend(net, arcId, index)`                                  | deleting a path point (only interior points are deletable: `ArcPathPoint.java:229-232`).                                                                                                                                                                                                                                                                                                                                                 |
| `toggleArcBendCurved(net, arcId, index)`                            | _Change to Curved / Straight_ (`ArcPathPoint.java:146-151`).                                                                                                                                                                                                                                                                                                                                                                             |
| `toggleArcEndCurved(net, arcId)`                                    | the same menu on the target endpoint.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `translateArcBends(arc, dx, dy) → Arc`                              | translating selected path points.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `withBends(arc, bends, curvedEnd?) → Arc`                           | normalising constructor for new arcs.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `moveSelection(net, selectedIds, delta)` (selection.ts)             | `SelectionManager.translateSelection` (`pipe/gui/canvas/SelectionManager.java:153-182`). Moves selected nodes and _all_ bends of selected arcs. Selecting an arc selects all its points (`Arc.java:381-390`), and marquee selection adds internal arcs (`PlaceTransitionObject.java:221-241`). Unselected arcs keep their bends while their endpoints follow nodes. The delta is reduced so no moved node top-left or bend goes below 0. |
| `duplicateSelection` (selection.ts)                                 | copied internal arcs keep their bends, translated by the duplicate offset, without sharing arrays with the original.                                                                                                                                                                                                                                                                                                                     |

`deleteSelection` and `selectInRectangle` need no change. Bends go with their arc, and desktop
marquee selection only hits places and transitions.

## Canvas integration (`App`)

- `arcGeometries` is a computed map, recalculated once when the net changes. The rendered line
  and hit area use `d`; weight labels use the native polyline `midpoint` with a 12-unit upward
  text offset. Explicit routes also replace the old automatic paired-arc quadratic offset. There
  is no hidden routing rule for parallel arcs; native transition ports distinguish their ends.
- Arrow tips meet the automatic endpoint (`refX=10`). The inhibitor marker uses its outer
  circumference (`refX=10.75`, including its stroke) as the endpoint, so its circle stays outside
  the target. Both markers use model units; the path continues beneath the opaque inhibitor
  marker so there is no gap between the line and circle.
- Selected arcs in Select/Edit mode expose square straight and circular curved interior handles.
  Pointer drag snaps the absolute point to the current grid (15/30/off/7.5), rounded by the native
  point helper. Live previews do not publish editor history; release commits once, Escape or
  pointercancel restores the starting net. A point context menu exposes _Change to Curved/Straight_,
  _Split Point_ (+10 x, same type), and _Delete_. A target endpoint handle exposes only the curve
  toggle; source endpoints stay automatic and straight.
- Arc context _Insert Point_ and Ctrl+double-click insert at the grid-snapped model pointer;
  Alt+Ctrl+double-click inserts a curved point. These use the native nearest-segment-midpoint
  insertion helper, not a new nearest-curve algorithm. Native sources: `Arc.java:99-100`,
  `SplitArcAction.java:22-40`, `PetriNetTab.java:3051-3061`. Point menus/types come from
  `ArcPathPoint.java:73-88,146-151,176-180,213-232`.
- Group dragging calls `moveSelection` from the original net at each snapped delta. Selected
  arcs carry their bends; unselected arc bends stay fixed. The helper's origin clamp applies to
  both nodes and selected bend points.
- While an arc is pending, an empty plain press appends a draft bend, Shift makes it curved;
  moving with Shift curves the preview's final segment (`PetriNetTab.java:2440-2457`). Drafts
  live outside the net/editor and never appear in saves or undo history. Both ordinary completion
  and Ctrl Quick Draw completion retain the accumulated bends. Ctrl finishes with a straight
  final segment, then clears the draft for the next chained source. Node-plus-arc Quick Draw
  remains two undo entries. Rejected connections, completed arcs, tool/mode changes, load,
  undo/redo and cancellation clear the draft; ignored same-kind presses preserve it.
- Fit includes `bendBounds` and curved segment controls as a conservative Bézier convex hull.
  Existing native-style viewport constraints still apply: the minimum zoom is 20%, and navigation
  keeps the origin nonnegative. Extremely large paths or imported negative coordinates therefore
  cannot always be shown completely in one view.

Preview difference: a pending path uses an isolated two-node geometry calculation, with its free
endpoint placed at the pointer. It includes the actual draft bends and cubic controls, but does not
redistribute existing transition ports until commit. Committed paths always use whole-net ports.
Native's Swing hover visibility/selection of individual point sets is not reproduced: web point
handles appear for selected arcs in Select/Edit mode. Neither difference changes saved geometry.

## Verification

`app.spec.ts` exercises App pointer/key/context transactions: snapped single-bend release/undo,
Escape and pointercancel rollback, native point and endpoint menus, both insertion modifiers,
straight/curved rendering data and midpoint labels, group translation versus unselected bends,
distant bend/control fit, pending versus committed TAPN/JSON persistence, two-step Quick Draw
undo and fresh chained paths, draft cancellation, and model coordinates at 200% zoom.
