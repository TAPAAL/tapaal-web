# Arc label offsets

Arc geometry has one source authority: optional `Arc.nameOffsetX` / `nameOffsetY`, inherited by authored and shared-source arcs. Values are unzoomed relative displacements from the native polyline midpoint, never absolute coordinates or weight terms. Zero defaults are omitted by editing/import helpers. Existing documents without fields retain their shape and rendering. JSON retains exact finite fractions; values outside ±1,000,000 refuse. Closed authored, network and clipboard readers admit only these two additional keys; inherited/accessor/unknown authored fields still refuse.

## Native sources and adaptation

Paths below are relative to `src/main/java` (read only in this change).

- `pipe/gui/petrinet/graphicElements/Arc.java:147-153` adds zoomed integer name offsets to the path midpoint and applies `Grid.align`. `ArcPath.java:110-136` computes that midpoint using half the polyline length.
- `NameLabel.java:51-73` stores the position and places the Swing text area's left edge at `positionX - preferredWidth`, top at `positionY - NAMELABEL_OFFSET`; `pipe/gui/Constants.java:61` sets the latter to 12. It is a right-edge anchor, not a node/text centre.
- `handler/LabelHandler.java:49-70` captures offsets and translates by pointer deltas without snapping the stored values. `PetriNetObjectWithLabel.java:77-83` unzooms deltas into integer offsets. The web uses total model displacement, truncated toward zero, from the original snapshot; this avoids accumulating per-event integer rounding at zoom. It supports single-axis undo, fixing the desktop handler's both-axes-changed condition rather than reproducing it.
- `dk/aau/cs/io/TapnXmlLoader.java:860-869,957-963` reads both attributes as a pair via `(int)Double.parseDouble`, otherwise defaults both to zero, and assigns them to normal/inhibitor/transport components. The web preserves this old-file paired default. The strict network importer follows its existing integer-coordinate policy, refusing fractional native offsets instead of silently truncating them; JSON is the exact fractional alternative. The lower-level geometry reader uses native truncation.
- `TimedArcPetriNetNetworkWriter.java:712-713` writes the relative integer offsets. Web writing uses the same names and values, and source reopen verification includes normalized offsets alongside existing actors, identities, queries, shared membership, timing and routes. Original attribute inspection precedes private scalar inspection clones.
- `TimedInputArcComponent.updateLabel`, `TimedOutputArcComponent.updateLabel`, `TimedInhibitorArcComponent.updateLabel`, and `TimedTransportArcComponent.updateLabel` change text, not the offset origin. Weight presentation (`2x` / `W x`) stays separate from stored weights and bindings.

Rendering deliberately retains the existing SVG zero-offset baseline (`midpoint.y - 12`) and centred text anchoring, then adds the relative offset. Thus saved native offsets agree exactly, while Swing's right-aligned preferred-width text box/font metrics and grid-aligned label paint position are not reproduced. This is not full native GUI text-layout parity. No generic geometry framework or second label-position state was added.

## Editing and transfer

In Select/Edit, drag arc text to move just its label. This branch precedes bend/path gestures; middle-button pan, Quick Draw, node-label dragging and text-field shortcuts retain their existing handling. Model coordinates account for zoom. Previews stay out of history; release commits once through the existing source/history transaction, Escape and pointercancel restore the starting net. The semantic weight, constant reference, timing, actor and shared membership do not change. Fit includes label bounds in either direction, measuring rendered SVG width when available and retaining conservative text-size estimates for headless callers. Existing nonnegative viewport origin and minimum zoom still limit extreme negative/offscreen layouts.

Group movement, duplicate and paste translate endpoints/bends while keeping relative label offsets unchanged. Numeric, timed and symbolic web envelopes carry them exactly. Desktop `TAPAALCopyPastModel` does not carry arc-label offsets, so moved labels force a web envelope and an explicit desktop-transfer-unavailable notice. Direct native clipboard serialization refuses loss. Game subnet clipboard remains an atomic gate; component copying retains source membership and roles.

## Validation and reproducibility

- Permanent unchanged fixtures: `untimedGame.tapn` retains I4 `+23` in injection_components; `game-harddisk.tapn` retains A2 `-7` in harddisk_drive. Both now open through the gallery alongside package-delivery. Only catalog metadata changed: **19 openable / 10 gated**, all 29 originals hash checked.
- Unit coverage includes default shapes, positive/negative offsets on normal input/output, inhibitor and both transport halves; rotated/bent geometry; exact fractional JSON and native refusal; finite/range negatives; web clipboard/group/duplicate; fit in both directions; one drag/undo/redo/cancel. Existing game, authored/shared closed-record, timing, query and clipboard suites remain gates.
- `scripts/check-arc-labels-ui.mjs`: 17 real-input assertions for fresh text drags at 100%/150%, one history entry, undo/redo/Escape, constant reference preservation, fit, JSON save and native save/reopen. Evidence: `/tmp/tapaal-arc-label-ui/{before-100,after-100,before-150,after-150}.png`, downloaded source and `results.json`. Initial harness attempts targeted offscreen text; an explicit real middle-button pan resets the viewport before each drag.
- Updated `scripts/check-game-ui.mjs`: 39 real-input assertions, including both newly openable gallery originals, native/JSON saves, offsets, Environment roles and legal firing; existing package-delivery Manual/Back/Forward/Reset and new timed-game delay checks remain. Evidence: `/tmp/tapaal-arc-games-ui`.
- `scripts/native-reference/check-arc-labels.mjs` compiles and runs `ArcLabelReference.java`, which loads the two originals and browser-written symbolic-weight native file with released TAPAAL 4.0.4, asserts **88 arc offsets**, writes with the native writer and compares all offsets after native reopen. Match by component and endpoint names because the native loader reconstructs some IDs. True headless mode fails in native static Swing menu initialization; `xvfb-run -a java -Xmx128m -cp 'OUT:LIB/*' ArcLabelReference FILE...` passes without opening a GUI. This probes offsets, not Swing pixel layout, strategy synthesis or nonzero-age IO.

Existing colour/stochastic/verification gates, duplicate A43 in ERK, native initial-age IO limitations and game strategy synthesis gaps remain unchanged. No PR, push, deployment, subagent or user demo is part of this work. Managed validation environments are stopped before handoff.

## Changed paths

- Source and codecs: `core/net.ts`, `arc-geometry.ts`, `authored-model.ts`, `files.ts`, `network-files.ts`, `shared-files.ts`, `clipboard.ts`.
- Canvas and fit: `app.ts`, `core/element-layout.ts`.
- Tests: `app.spec.ts`, `core/arc-labels.spec.ts`, `core/game-nets.spec.ts`, `core/timed-files.spec.ts`, `core/network-files.spec.ts`, `core/authored-clipboard.spec.ts`, `core/timed-clipboard.spec.ts`.
- Evidence: `scripts/check-arc-labels-ui.mjs`, `scripts/check-game-ui.mjs`, `scripts/native-reference/ArcLabelReference.java`, `scripts/native-reference/check-arc-labels.mjs`.
- Catalog/docs: `src/app/example-catalog.json`, `README.md`, `NATIVE-PARITY.md`, `design/GAME-NETS.md`, this report. Code paths above are relative to `web/src/app`; evidence and docs paths are relative to `web`.

Native execution regressions rerun for this change: **124** core observations, **12 cases / 213** timed observations, **79 cases / 1,343** shared-place observations, **24 cases / 282** synchronized assertions, **56 cases / 1,056** game assertions, all passing. Browser risk checks: native core **16/16**, symbolic clipboard **18 scenarios / 207 assertions**, timed UI **20 scenarios / 139 assertions**, all **19** supported gallery originals native-save/reopened plus modal/fetch/focus checks. The gallery review harness's default evidence location is `/tmp/tapaal-independent-review/gallery`; other outputs use `/tmp/tapaal-arc-{native-core,symbolic-clipboard,timed-ui}`. These are bounded checks, not exhaustive native GUI coverage.

Final release checks: **1,093 tests / 49 files**, `examples:check`, TypeScript app typecheck and formatting pass. Production and development builds pass. Existing warning limits remain **500 kB initial / 20 kB app.css**; production initial output is **689.68 kB**, app.css **20.31 kB**. Additional final-browser risk checks pass: document T6/T8/T12/T13 **4/4**, constants C01/C06 **2/2** (symbolic weights/intervals/invariants and transport pair editing), synchronized shared transitions **14 assertions**. Their evidence lives in `/tmp/tapaal-arc-{documents,constants,shared-ui}`. Native Java/resources and all original example bytes are unchanged.

Source/build/screenshot SHA-256 manifest: `/tmp/tapaal-arc-evidence.json` (`03e6a9f35e09fa000bc2cf4d59dc059e64adf78e9da5c6ace8a62a653d2e086e`). It binds the final edited TypeScript, browser/native harnesses, development bundle and evidence PNGs to baseline `119cad62d7d3c4fff444eb5076609bda0621e7d5`.

Arc-label implementation commit: `bae4a27e776824409262980e6315b185a842deaa`. Parent independent review remains outstanding. All owned temporary validation jobs and browser contexts are closed.
