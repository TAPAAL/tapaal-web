# Timed clipboard validation

Independent browser review of the timed web clipboard (`core/timed-clipboard.ts`, the app's
clipboard/duplicate routing, `design/CLIPBOARD.md`). Run on 2026-10-29 against a development build
of the working tree. Production code, unit tests and existing harnesses were not changed.

Harness: `scripts/check-timed-clipboard.mjs`. Real Playwright keyboard, mouse, context-menu and
file-chooser input; app signals and DOM are only read. System clipboard contents are set through
`navigator.clipboard.writeText` (as another application would). Denial (C08) and slow clipboard
I/O (C12) are injected by replacing `navigator.clipboard` in an init script. No App method or
signal setter is called.

```sh
PLAYWRIGHT_CORE=…/playwright-core CHROMIUM_PATH=…/chromium-1248/chrome-linux64/chrome \
  node scripts/check-timed-clipboard.mjs http://127.0.0.1:4397 /tmp/tapaal-tclip-review/final
```

Result: 11/12 checks, 85/86 assertions. Evidence: `/tmp/tapaal-tclip-review/final/`
(`results.json`, `console.log`, fixtures, `C01-envelope.json`).

## Findings

### F1 (medium): menu/context Cut deletes the selection current _after_ the clipboard write

Tested (C12). Source: `src/app/app.ts` `clipboardAction`. The payload is built from
`selectedIds()` before `await navigator.clipboard.write(…)`. After the await,
`removeComponentElements(doc, this.selectedIds())` reads the selection again. `unchanged()`
compares only the workspace, operation counter, mode and blocking state. Selection is a separate
signal, so a selection change in that window passes the guard.

Steps: open `rich.json`, select U, choose Edit → Cut. Click place S before the system write
resolves (700 ms delay injected; a real permission prompt or slow clipboard has the same effect).

- Expected: delete exactly the copied U, or cancel with the "Clipboard action cancelled" notice.
- Actual: the clipboard contains U only, but S and its arc are deleted, along with S's invariant
  `<4`. U remains, and the "Cut selection." notice is shown. Detail:
  `{"copied":["u"],"deletedU":false,"deletedS":true,"past":1}`.

Undo restores the document in one step, but the deleted elements were never copied. If the new
selection touches a transport, `removeComponentElements` deletes both halves and the pair timing
without copying them. This contradicts the CLIPBOARD.md claim that cut is atomic and recoverable.
Keyboard Ctrl+X is synchronous and unaffected. The untimed menu-cut path shares this code; it is
inferred from source and was not run separately.

Root fix: capture the selection once, use it for both `copySelection` and
`removeComponentElements`, or make `unchanged()` also require an identical selection. Add an app
spec with a deferred `clipboard.write` that changes selection before resolving.

### F2 (process): historical T15 is obsolete

`check-timed-ui.mjs` T15 still asserts the old "Timed subnet copy … not supported" gate, and now
fails 0/5 (`ONLY=T15` run, `/tmp/tapaal-tclip-review/t15/results.json`). This is
expected new behaviour, not a regression. C01–C11 replace that coverage. T15 should be replaced or
retired by the root, not weakened in place.

### Observation (no defect): lone transport endpoint copy is refused

Copying only Q, the destination of a transport, is refused (C06). Native would copy the place and
silently drop the transport. This follows the documented rule ("any selected endpoint touches
either half"). Users who copy a single place sometimes get this refusal; the message tells them
how to proceed.

## Coverage (passing)

| Check | Covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01   | Ctrl+A/C writes a v2 envelope (`modelType: timed`, `native: ''`) to text/plain. Ages are `{p:[0.1,2.50], r:[1.5]}`, so implicit zeros are not listed. The web-only notice is shown and the document is unchanged. Ctrl+V gives one history entry with an ID/name-independent fragment equal to the selection +30: invariants `<=3`/`<4`, intervals `[1,4]`/`(1,5)`, urgency, weighted 2 transport pair, bends, curved end, 45° rotation, hidden name, label offset and annotation. IDs and names are fresh, and the paste is selected. Undo/redo restores graph and timing together; a second paste gets fresh IDs again.                         |
| C02   | Edit-menu Copy+Paste, context Copy+Paste (asserts the context copy wrote v2), Ctrl+D, Edit Duplicate and context "Duplicate selection" each give the same faithful fragment and undo in one step.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C03   | In Simulate after a 1-unit delay, Ctrl+C/X/D/V change neither the clipboard nor the document, and the Edit Copy item is disabled. Back in Edit, copied ages are the saved initial ages.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C04   | New browser context with no internal copy and the envelope only as text/plain: keyboard paste and menu paste (`clipboard.read`) are faithful. Local ID clashes (`p,t,i,o,n1`) leave target timing untouched; the paste into another component (Beta) is faithful.                                                                                                                                                                                                                                                                                                                                                                                 |
| C05   | Timed → untimed refused with no change, including an all-default selection. Cross-document timed paste is faithful. Untimed copy still writes native `TAPAALCopyPastModel` JSON. Untimed → timed gets default timing; untimed → untimed still works.                                                                                                                                                                                                                                                                                                                                                                                              |
| C06   | Source+transition, transition+destination, lone destination, and an explicitly Shift-deselected half: Ctrl+C/X/D and Edit Cut are refused. The document, history and system clipboard (sentinel) are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C07   | Ctrl+X of a complete pair is one entry and removes the nodes, arcs and timing; a later paste restores them faithfully. A saved-query protected cut is refused atomically, its timed copy stays recoverable, and that copy pastes with transport and invariant into a new model.                                                                                                                                                                                                                                                                                                                                                                   |
| C08   | With denied `navigator.clipboard`, menu copy says "inside TAPAAL Web only…", and menu paste uses the internal timed copy faithfully and says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C09   | Readable unrelated text plus a stale internal copy: keyboard and menu paste refuse with "does not contain a TAPAAL selection".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C10   | 22 malformed or hostile envelopes, each refused with no document/history change and no `Object.prototype` pollution. They cover unknown keys at timing, interval and transport level; missing ages or timing; a removed transport half; weight mismatch; an output-arc interval; an explicit zero age; age beyond invariant; more ages than tokens; urgency with restricted input; a non-empty `native`; `modelType` untimed; versions 1 and 3; `__proto__` in timing, ages and the envelope; a `constructor` key; text over 4,000,000 chars; and truncated JSON. A node literally identified as `__proto__` is remapped to fresh IDs faithfully. |
| C11   | With a dialog name field focused, Ctrl+A/C/V/X/D use the browser text clipboard (clipboard = `Q`) and the model is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| C12   | Menu paste is cancelled after a tab switch (neither document changes) and after an intervening Delete (only the edit commits). The cut/selection race fails (F1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Limits

- Chromium 1248 headless only. Denial and delays are injected, not real permission prompts. The
  custom-format `ClipboardItem` path is exercised as written by Chromium; other browsers are not
  tested.
- No native TAPAAL runtime: desktop timed clipboard transfer is deliberately unsupported and was
  not differentially tested. Native source claims in CLIPBOARD.md were not re-audited here. This
  is not a native parity claim.
- Unit tests, full build and other historical harnesses were not re-run, because production code
  was unchanged; reported numbers (499 tests, 520.61 kB) were not re-verified.

## Owner follow-up — F1 fixed

`clipboardAction` now captures selected IDs before copying. Both copy and cut deletion use that
snapshot, and a changed selection during an asynchronous cut cancels the operation before any
mutation. The recoverable copy is retained. The cancellation notice names selection changes.
Two app regressions defer the system clipboard write, change selection, resolve the write and
assert unchanged workspace/history and retained new selection, for timed and untimed documents.
Full suite: **501 tests pass**. Development/production builds and formatting pass; the existing
500 kB budget warning remains (520.71 kB initial). Browser rerun results are recorded below.

Historical T15 no longer asserts the old unsupported gate. It now tests typed timed copy,
initial age/invariant preservation, fresh IDs, atomic paste/duplicate/cut and undo. Detailed
partial-pair and hostile-input coverage remains in the new clipboard harness.

The full real-input Chromium clipboard rerun passes **12/12 checks, 86/86 assertions**, including
C12 with delayed system I/O and an intervening selection change. Evidence:
`/tmp/tapaal-cut-race-browser/clipboard/results.json`. Updated historical T15 passes **7/7
assertions** at `/tmp/tapaal-cut-race-browser/t15/results.json`. These runs use the existing
independent review's browser fallback and real input, with state read only. Temporary server
and owned jobs are stopped; no native clipboard runtime interoperability is claimed.
