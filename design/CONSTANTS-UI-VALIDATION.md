# Constants UI: independent browser validation

Independent review, 2026-10-29, of the authored constants workspace described in
`CONSTANTS-UI.md`. The only deliverables are this document and `scripts/check-constants-ui.mjs`.
Production code and existing specs/harnesses were read-only. No commit, PR, deploy, subagent, or
user demo was created.

**Result: no defects found in the tested scope.** One low-severity UX observation (O1) follows.
The reported counts are for the tested web behavior only. They are not a native parity claim.

## Snapshot and method

- HEAD `28c9bd917` plus the uncommitted `web/` tree. Before building, `web/src` (79 files) was
  copied to `/tmp/tapaal-constants-ui-snap`. Its SHA-256 manifest
  (`/tmp/tapaal-constants-ui-src.sha256`) still matched both the snapshot and the worktree at the
  end of the review.
- The development build ran in a finite `worker-job`. Output went to
  `/tmp/tapaal-constants-ui-dist`; `main.js` SHA-256 is
  `b2a4ad102d2665e2512294a766072a6f36be771a7c9f06fcaa944a3e3e441551`. A 512M managed static
  server served it on 127.0.0.1:4411 and was stopped after validation.
- `scripts/check-constants-ui.mjs` (new) drives Playwright with real mouse clicks, double-clicks,
  drags and rubber-band selections. It also uses typed fields, Enter/Escape, Ctrl+Z/Y/C/X/V/D,
  Shift+G, Delete, the file chooser and downloads. App signals and DOM are only read; no App
  method or signal setter is called. The system clipboard is seeded with `SENTINEL` through
  `navigator.clipboard`, as another application would, so the harness can tell whether a refused
  copy wrote anything.
- Shared preview: I called `preview_status` first (no tab). One owned background tab uploaded the
  unchanged `webserver.tapn` with the real file picker. It confirmed four declarations, the
  symbolic labels and the grouped uses. Clicking Delete on `deadline` was refused with "Saved
  queries protect deadline". The screenshot is at
  `/tmp/tapaal-constants-ui-validation/shared-preview-webserver-delete-refused.png`. The tab was
  closed afterwards.

```sh
worker-job run tapaal-constants-ui-devbuild -- npx ng build --configuration development \
  --output-path /tmp/tapaal-constants-ui-dist            # in the /tmp snapshot
worker-job start tapaal-constants-ui-server --memory 512M -- \
  python3 -m http.server 4411 --bind 127.0.0.1 --directory /tmp/tapaal-constants-ui-dist/browser
PLAYWRIGHT_CORE=… CHROMIUM_PATH=… worker-job run tapaal-constants-ui-final-c -- \
  node scripts/check-constants-ui.mjs http://127.0.0.1:4411 /tmp/tapaal-constants-ui-validation/final-c
worker-job stop tapaal-constants-ui-server
```

## Fixtures

- Unchanged repository files: `src/main/resources/Example nets/webserver.tapn` and
  `web/src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn`. The scalar fixture holds K,
  D and Zero, and covers ordinary input/output, inhibitor and transport-pair weights, `[K,D]`,
  `[Zero,D]` and `<= D`.
- Generated in the output directory:
  - `multi.tapn`: timed. Active Main uses K in a weight, D in an interval and an invariant. It also
    has a numeric-only island n1→nt→n2. **Side** is inactive and has `[D,6]` and `<= K`. Spare is
    unused.
  - `untimed.tapn`: untimed. W is the input and output weight; H is an inhibitor weight.
  - `legacy-v1.json`: network JSON v1 with nonzero ages.

## Results

The final run had **17/17 checks and 197/197 assertions passing**
(`/tmp/tapaal-constants-ui-validation/final-c.log`, `results.json`, screenshots). Run `final-b`
was also 17/17. Run `final-a` was 16/17 because of a harness flake; see Limits.

| ID  | Behavior validated in the browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | `webserver.tapn` opens clean, with no repair prompt and empty history. It has four declarations in order (deadline 5, min 3, periodA 7, periodB 5), retains its query, and all four declarations are captured as query-protected. The canvas shows `[deadline,deadline]`, `[periodA,periodA]`, `[periodB,periodB]`, `[min,inf)`, `Transport 1 [0,deadline)`, `Transport 1 [0,deadline]`, `<= deadline`, `<= periodA` and `<= periodB`. Uses are labelled component/element/field, and query protection is shown apart from model uses. Clicking a use selects the element without editing the source. |
| C02 | Add is refused for `inf`, duplicate `min`, `1abc`, `a-b`, the empty name, and the values -1, 2147483648, 1.5 and `1+1`. The draft stays open and its text is kept; source, saved checkpoint, past and future are byte-unchanged. `Inf` = 2147483647 and `inf2` = 0 are accepted. Rename and delete of unused declarations work. Undo restores a deleted declaration with the same ID. Escape cancels.                                                                                                                                                                                                 |
| C03 | deadline=0 is refused with use locations; the dialog stays open and source, checkpoint and history are unchanged. deadline=4 makes exactly one history entry, and labels stay symbolic. Toolbar Undo restores the exact source and the clean state; Redo, Ctrl+Z and Ctrl+Y round-trip.                                                                                                                                                                                                                                                                                                               |
| C04 | Renaming a query-protected declaration is refused unchanged, while a value change is allowed and leaves the query XML byte-identical. Delete is refused. After "Remove all queries", rename works and the canvas follows it (`[minimum,inf)`). Two undos restore the queries and all four protections, and rename is refused again.                                                                                                                                                                                                                                                                   |
| C05 | The inactive Side's use is grouped as "Side (inactive)". Clicking it switches to Side and selects `su`. D=7 is refused, naming the Side use, with source, checkpoint and history unchanged. D=6 is one entry. A K value edit updates the Main weight and the Side invariant in one entry. In-use delete is refused; the unused Spare deletes.                                                                                                                                                                                                                                                         |
| C06 | The property dialog covers all five weight positions (input, output, inhibitor, transport in/out), both interval endpoints and the invariant. Each shows the declared name; edits store references; untouched fields keep their references. An unknown name or `2*K` is refused with the dialog open and no change. A zero-valued `Zero` output weight is refused. An explicit literal `3` replaces a reference. A transport weight change updates both halves in one entry. A symbolic `Zero` lower bound is retained as a reference, not canonicalised. Undo returns to the exact opened source.    |
| C07 | Untouched OK, transition rotation, mouse drag, Shift+G align, inline place rename, place drawing and Copy component all keep every authored weight, interval and invariant. A copy is active and selected, one entry, and matches nodes/arcs/timing exactly. It appears under K's uses.                                                                                                                                                                                                                                                                                                               |
| C08 | Untimed inline weight shows `W`. Focus/blur without a change makes no edit. W=2 enables t; W=3 disables it in simulation. Inline `1` replaces the reference, inline `H` parses to a reference, and an unknown inline name is refused with the field restored.                                                                                                                                                                                                                                                                                                                                         |
| C09 | Timed resolution: with K=2, o is enabled at age 2. After K=3, o is disabled at age 2 and enabled at age 3. The legal delay follows D=5.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C10 | The pre-run TAPN save keeps `<constant name="D" value="6"/>`, `weight="K"`, `[0,D]`, `<= K` and the inactive Side. A **mid-run save after a 1.5 delay is byte-equal** to the pre-run save, and the source is unchanged after simulation. JSON is v2 and reopens deep-equal to the authored source. Reopening the TAPN keeps the authored meaning.                                                                                                                                                                                                                                                     |
| C11 | A symbolic selection (rubber band over p, t and `pt`, or `p` alone with its symbolic invariant) refuses Ctrl+C, Ctrl+X and Ctrl+D with the documented message. The source is unchanged and the clipboard still holds `SENTINEL`. A numeric-only island in the same constants document copies to the system clipboard, pastes 3 nodes in one entry, duplicates and cuts. Existing references are retained.                                                                                                                                                                                             |
| C12 | With either dialog open, the element under Undo is the modal backdrop, so mouse undo/redo cannot reach the document, and Ctrl+Z inside the dialog does not undo. A real-input undo/redo ABA is therefore **not reachable**; the stale-origin refusal path is covered only by the implementation's unit tests.                                                                                                                                                                                                                                                                                         |
| C13 | Two tabs keep separate sources, histories and dirty state across switches during simulation. Edit mode returns the unchanged source, and Undo then restores the clean state.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| C14 | Legacy v1 JSON migrates with `constants: []` and exact ages `0.5, 1.25`, and saves as v2. The TAPN save shows the 4.0.4 nonzero-age loss warning and emits no `<constant>`. A W declaration added afterwards binds both the weight and the interval upper; ages are retained.                                                                                                                                                                                                                                                                                                                         |
| C15 | Marking 4 with ages `0,1,2,3` is one atomic entry (stored canonically as `1,2,3` plus one implicit zero) and keeps the symbolic invariant. An age above `<= D` is refused. Urgent on a transition with a symbolic input interval is refused (documented gate). Transport unpairing is one atomic edit or a refusal, and the weight reference is retained.                                                                                                                                                                                                                                             |
| C16 | Activating Side and reordering components keep all terms and declarations. After activation, D=7 is still refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C17 | Delete on a symbolic arc is allowed and undoable; the declaration stays and its uses update. A newly drawn arc gets a literal weight of 1. `[0,inf]`, `[inf,D]` and `<= inf` are refused; `[K,inf)` is accepted.                                                                                                                                                                                                                                                                                                                                                                                      |

### Historical harnesses on the same snapshot

Because the workspace migration is broad, all six existing browser harnesses were run unchanged
against the same build: documents 16/16, timed-clipboard 12/12 (86 assertions), timed-ui 20/20
(139), element-layout 7/7, token-selection 17/17 (117) and timed-network-ui 14/14. Logs are in
`/tmp/tapaal-constants-ui-validation/historical/`. Together they cover saved-query cut guards,
partial timed transport selection, Cut cancellation on selection change, recoverable copies, and
layout, notes and rotation. **No obsolete JSON v1 or raw-numeric assertion failed**, so no
assertion needed to be classed as obsolete. `check-native-core.mjs` and
`check-execution-conformance.mjs` need the native runtime and were not rerun.

## Observation

**O1 (low, UX):** model-use labels for arcs show the raw arc ID, not a readable connection. In
`multi.tapn`, D's arc use reads `Side (inactive) / su / lower`; web-drawn arcs would read
`… / web-7 / weight`. Webserver labels only look descriptive because its native arc IDs are
"Requests to Drop" and similar. Source: `editor-workspace.ts` `useLabel` looks the element up
only in `c.net.nodes`, so arcs fall back to `use.elementId`. Navigation still selects the correct
arc. A possible fix is to fall back to `source name → target name` for arcs.

## Source review notes (no defect)

- Web TAPN export writes `<hlinscription>` with the resolved count beside `weight="K"`. For
  example, `pt` exports `weight="K"` with `2'dot`. Native 4.0.4's own files carry no
  `hlinscription` on these arcs. The value is regenerated from the current revision, so it stays
  consistent. The earlier native oracle (`/tmp/tapaal-constants-codec-review-native`) covers the
  symbolic classes. This review did not rerun native and makes no new native claim.
- `saveConstant` and `applyAuthoredElement` compare the captured workspace identity, and the
  canvas commit takes retained arc weights from the source by ID.
  `requireNumericSelection` runs before `copySelection` and any clipboard write in copy, cut and
  duplicate. Its scope is the selected elements of the current component.

## Limits

- **Tested web:** the behavior in the table, on one dev build, in headless Chromium.
- **Source expectations only:** file-read and clipboard generation races, the stale-origin
  refusal after an ABA, and numeric→authored redo ordering. A UI-created document has no numeric
  history, so the last one was not reachable through the UI. These rely on the implementation's
  unit tests.
- **Prior native oracle:** earlier evidence (K 2→4 execution and symbolic classes), not
  reproduced here.
- **Known IO-age loss:** the 4.0.4 warning is shown (C14); the JSON alternative was checked (C10,
  C14).
- **Documented gates, not bugs:** symbolic urgent inputs, the wave 4 clipboard, real/set/arithmetic
  constants, query watch constants, and shared/coloured/game/stochastic models. Only urgency and
  arithmetic were probed.
- **Harness flake:** run `final-a` failed only C07's inline rename, which produced `bbb` after
  Playwright `fill`. The field is now set by click, Ctrl+A and typing, and checked before Enter.
  C07 then passed five isolated repeats and the final full run. I attribute this to input timing
  in the harness, not product behavior, but did not prove the cause.
- No full field-by-field native GUI parity is claimed. No exhaustive fuzzing of declaration names
  or values beyond the listed cases.

## Resources

Shared preview tab closed. Managed server `tapaal-constants-ui-server` and all finite jobs have
stopped; `worker-job list` is empty. Snapshot, build and artifacts remain under `/tmp` as
evidence.

## Owner label follow-up

Arc uses now display their source and target node names (source → target), retaining the
component/activity prefix and field. They no longer expose raw IDs such as web-7. Navigation
still targets the original arc ID. Focused Adapter tests pass (25); the development build
passes. Real-input C01/C05 browser reruns pass **2/2 checks, 32 assertions**, including native
webserver labels and navigation to the inactive component's arc by its endpoint label.
Evidence: `/tmp/tapaal-use-label-check/results.json`. The full independent 197-assertion run
and six historical runs above remain the prior combined baseline, not repeated for this label
change. Temporary server stopped, no owned jobs remain.
