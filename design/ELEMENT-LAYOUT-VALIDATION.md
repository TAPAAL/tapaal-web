# Element layout browser validation

Validated 2026-10-28 against the prebuilt development snapshot at
`/tmp/tapaal-layout-browser-build/browser`, served on localhost port 4187.
Production files were not changed. This work is independent of timed-semantics work.

**Result: one reproduced defect: narrowing an annotation clips its wrapped text.**
The other tested direct-manipulation workflows passed. The final harness intentionally exits 1
for the clipping assertion; a passing geometry assertion alone does not mean the text is usable.

## Evidence and method

- Browser input: shared preview first, an exclusively owned tab at 1280×800, then Playwright
  Chromium at 1280×800 for reproducible wheel input and the complete automated sequence.
- Every edit uses actual clicks, keyboard input, pointer drags or mouse wheel events. Angular
  component signals and DOM attributes are read for assertions. No App editing methods,
  synthetic DOM input dispatch, signal setters, or injected model mutations are used.
- Shared-preview annotation creation/edit/move/resize/delete/undo, horizontal label drag/undo,
  name hide, token tools, and context rotation were exercised before the automated run.
- The preview drag call initially returned `Preview automation drag received an invalid selector.`
  Using `css=` selectors resolved it. Preview scroll calls returned success, but repeated selected
  transition scroll attempts left both angle and viewport unchanged. The two failed wheel-input
  attempts triggered the permitted Playwright fallback. These preview observations are an
  automation limitation, not an application wheel defect: real Playwright wheel input passed.
- Installed Playwright default browser revisions were missing (`chromium_headless_shell-1223`,
  then `chromium_headless_shell-1243`); the final run explicitly uses installed Chromium 1248.
  No dependency/browser installation was needed.
- Reference screenshots were inspected as images, particularly
  `/tmp/tapaal-native-reference/native-4.0.4.png`. They are pre-existing native captures, not
  native sessions driven during this validation. No native annotation/rotated-transition
  reference capture was available. Native interaction expectations below are **source-derived**;
  none should be read as newly tested desktop interaction behavior.
- No full build or unit suite was rerun. The supplied snapshot was tested as-is; prior 426-test,
  build, typecheck and formatting results belong to the app owner.

Snapshot SHA-256:

```text
main.js     7421ecc43d8cc3ff6ef106b9cec235c0a23c8cd79259d3aee9cbe7c818abf175
styles.css  3d28c678f6f37a0d8e3cfaedcc982cbcb250f1821077fab0d93d2787df7ec7b2
```

## Reproduced defect

### EL-1 — Narrowing an annotation hides most of its text (P2)

Reproduce from the initial Producer cycle at 100% zoom:

1. Choose **Annotation**. Click browser position `(500,570)` on the empty canvas.
2. Enter two lines: `Layout validation` and `second line`; click **OK**, then **Select**.
3. The grid-snapped note is `{x:195,y:480,width:119,height:32}`.
4. Drag the right-middle resize handle 90 CSS pixels to the left, with no vertical motion.
   The handle starts near `(632,605)` in the 1280×800 viewport.

**Expected (native source):** the inner width reaches its minimum 40; the text area grows in
height to its new preferred wrapped-text height, so the content remains visible.
`Note.updateBounds()` reads `note.getPreferredSize().height` and grows the text component before
computing its border; `AnnotationNote.ResizePointHandler.mouseDragged()` calls `updateBounds()`
after resizing. The native exact font-dependent height was not measured in a running desktop.

**Actual (browser-tested):** width becomes 40, height remains 32. Seven rendered lines have
baselines `12,28,44,60,76,92,108`; the nested SVG clips at height 32. Only `Layou` and `t` remain
visible. The rest of the text is still in the model but cannot be read on the canvas. The focused
note also has a tall black outline below the small visible rectangle in the captured browser.

![Narrow annotation with clipped text](/tmp/tapaal-element-layout-validation/A2-minimum-width.png)

Evidence: scenario `A2-move-resize-undo`, final failed assertion in
[/tmp/tapaal-element-layout-validation/results.json](/tmp/tapaal-element-layout-validation/results.json).

Relevant source for the owner to inspect:

- Native: `src/main/java/pipe/gui/petrinet/graphicElements/Note.java`, `updateBounds` and
  `adjustLeft/Right`; `AnnotationNote.java`, `ResizePointHandler.mouseDragged`.
- Web: `web/src/app/app.ts`, resize branch in `pointerMove` measures lines from the pre-drag
  annotation; `core/element-layout.ts`, `resizeAnnotation` changes width without expanding height.
  This is a source explanation of the reproduced result, not a substitute for the browser test.

## Tested coverage

| Scenario                           | Browser result and concrete observations                                                                                                                                                                                                                                                                                                                       | Native comparison basis                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 — annotation create/edit/delete | Pass. Blank initial text creates no note. Two-line creation snaps to `(195,480)`, size `119×32`. Double-click edit preserves literal `<&>` text and LF. Delete removes it; one Undo restores edited text. Escape cancels a subsequent text draft.                                                                                                              | `GuiModelManager.addAnnotationNote`, `AnnotationNote.enableEditMode`, annotation undo commands; source-derived.                                                                                                                                  |
| A2 — annotation move/resize        | Move by `(60,-45)` reaches `(255,435)`; one Undo restores the original. Escape cancels a move. All eight resize handles expand the correct dimensions and move the appropriate origin while preserving opposite edges; each is undone in one step. Minimum width 40 passes. **Wrapped-content visibility fails (EL-1).**                                       | `Note.adjustTop/Bottom/Left/Right`, `AnnotationNote` resize points, `AnnotationResizeCommand`; source-derived.                                                                                                                                   |
| L1 — name labels                   | Pass. Right-anchored text uses local x `-15`, baseline y `18`. Horizontal drag by 90 changes offset X only, leaving node `(160,240)` fixed; Undo restores default. Drag `(45,30)` stores offsets `(45,65)`. Context Hide removes SVG text; Show restores it.                                                                                                   | `NameLabel.updatePosition`, `PetriNetObjectWithLabel`, `LabelHandler`, `ShowHideInfoAction`; source-derived. Horizontal-only Undo deliberately improves native's both-axes-change condition.                                                     |
| R1 — rotation and attached arcs    | Pass. Context +45 rotates Start; input path becomes `M 175 240 L 316 237`, output `M 323 244 L 485 240`. Undo restores both initial paths. Wheel up adds 135°. Ctrl+wheel down adds 45° without zoom; Shift+wheel down adds 45° without pan. Editor native +135 increment wraps 225° to zero.                                                                  | `Transition.rotate`, `updateEndPoints`, `PetriNetTab.timedTranstionMouseWheelWithShift`, `TAPNTransitionEditor`; source-derived. Endpoints assert the native-derived rounded port geometry for this sample, not desktop screenshot measurements. |
| T1 — tokens and wheel precedence   | Pass. Add tool changes Idle 1→2. Three Remove clicks clamp 2→0. Selected-place Ctrl+wheel up changes 0→1 without zoom; Shift+wheel down changes 1→0 without pan. Selected-place wheel also works at 150%.                                                                                                                                                      | `PetriNetTab.timedPlaceMouseWheelWithShift` and edit-mode event registration; source-derived.                                                                                                                                                    |
| C1 — clipboard layout transfer     | Pass. Ctrl+A/C/V produces 12 nodes, 12 arcs, 2 annotations. Hidden name, offsets `(45,65)`, and 45° transition rotation survive. Note text/size survive with fresh IDs; node and note use the same `(30,30)` translation. One Undo removes the paste. A fresh receiver tab independently tests system clipboard transfer without a pre-existing internal copy. | Desktop clipboard cannot represent annotations/hidden-name state; web envelope preservation is the web contract, not native interoperability proof.                                                                                              |
| N1 — navigation and fit            | Pass. Blank-canvas wheel sets y=100 at unchanged 100% zoom. Shift+wheel sets x=100. Ctrl+wheel increases zoom to 110%. Middle drag pans both axes. Fit contains all sample outlines and labels; toggle restores 100%. Fit also includes an annotation and a separately moved label (final 108%).                                                               | Canvas scrolling/zoom behavior and the existing viewport contract; bounds inclusion is directly checked against rendered screen rectangles.                                                                                                      |

## Screenshot comparison

The existing native 4.0.4 screenshot shows the same Producer topology: three circular places,
three narrow filled transitions, token in Idle, directed cycle edges and names positioned left
and slightly below the node centers. The unrotated web sample retains these visual relationships.
The web shell, canvas origin and font rendering differ, so this is a qualitative comparison,
not a pixel-identity claim.

- Native reference: [native-4.0.4.png](/tmp/tapaal-native-reference/native-4.0.4.png).
- Edited annotation: [A1-edited.png](/tmp/tapaal-element-layout-validation/A1-edited.png).
- Moved label: [L1-offset-label.png](/tmp/tapaal-element-layout-validation/L1-offset-label.png).
- Rotated transition and attached arcs:
  [R1-rotated.png](/tmp/tapaal-element-layout-validation/R1-rotated.png).
- Clipboard result: [C1-pasted.png](/tmp/tapaal-element-layout-validation/C1-pasted.png).
- Fit with moved name and annotation:
  [N1-fit-layout.png](/tmp/tapaal-element-layout-validation/N1-fit-layout.png).

No available native capture demonstrates the annotation case, moved labels, rotated ports or
the wheel modifiers. Those comparisons rely on the native source listed above, paired with
actual web input evidence.

## Reproduction harness

`web/scripts/check-element-layout.mjs` writes `results.json` and screenshots. Against an already
running server, invoke it as follows (adapt installed paths if necessary):

```bash
worker-job capacity
worker-job list
worker-job run tapaal-layout-recheck -- env \
  PLAYWRIGHT_CORE=/home/ubuntu/.cache/nub/pm/store/playwright-core@1.63.0-a8ac48ad88e9e7f8/node_modules/playwright-core \
  CHROMIUM_PATH=/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
  node web/scripts/check-element-layout.mjs \
  http://127.0.0.1:4187 /tmp/tapaal-element-layout-validation
```

The browser context grants clipboard access. This establishes browser/system transfer within
this machine, not denied-permission behavior or a desktop TAPAAL paste round trip. Fit coverage
uses a small positive-coordinate model; it does not establish correctness at zoom bounds,
negative layout extents, or extremely large diagrams. Rotation coverage uses straight sample
arcs; arbitrary angles and multiple curved/inhibitor attachments were not exhaustively tested.
No native application was launched or modified. Existing references and other sessions' jobs
were preserved. The owned browser tab and temporary server are closed/stopped before handback.

## Owner follow-up — EL-1 fixed

The resize helper now accepts a preferred-height measurement at the **new** width. The canvas
uses the same wrapping function for that measurement and for rendered lines, and grows height
after horizontal resizing. This remains one undoable resize. A pointer-level regression test
checks content height and complete undo.

The reusable real-input Chromium harness was rerun against `/tmp/tapaal-layout-fixed-build/browser`
using the previously documented Playwright fallback: **58/58 assertions, 7/7 scenarios pass**.
Evidence: `/tmp/tapaal-element-layout-fixed/results.json` and
`/tmp/tapaal-element-layout-fixed/A2-minimum-width.png`. The narrowed note now has width 40 and
height 112, containing all seven wrapped lines. Full unit suite: **427 tests pass**; development
build and formatting pass. The temporary server was stopped. Native desktop annotation behavior
remains source-derived; the fix does not establish pixel-identical font layout.

Combined timed/file owner follow-up: the full layout harness now passes **58/58 assertions**
on the combined timed/codec snapshot after awaiting rendered frames after undo and the second
fit. No expected geometry or visibility assertion changed. Evidence:
`/tmp/tapaal-final-recheck/layout/results.json`.
