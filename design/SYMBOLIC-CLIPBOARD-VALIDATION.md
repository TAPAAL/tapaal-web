# Symbolic clipboard v3 browser validation (constants wave 4)

Independent browser and source review of the authored clipboard v3 (`core/authored-clipboard.ts`,
`editor-workspace.pasteAuthoredSelection`, the `pasteElements` command in
`core/authored-documents.ts`, App clipboard and duplicate routing, `CLIPBOARD.md` "Authored symbolic
clipboard v3", `CONSTANTS.md`). Run on 2026-10-29. Production code, unit specs and existing
harnesses were not changed.

Harness: `scripts/check-symbolic-clipboard.mjs`. It uses real Playwright keyboard, mouse,
context-menu, component-list, constants-pane and file-chooser input. App signals and the DOM are only
read. No App method or signal setter is called. Other applications are simulated through
`navigator.clipboard`. Denial, missing `read()` and 1.2 s clipboard I/O are injected by init scripts.
Fixtures are generated web JSON v2 files plus one saved-query `.tapn`. They are written to the
output directory.

```sh
PLAYWRIGHT_CORE=…/playwright-core@1.63.0-…/node_modules/playwright-core \
CHROMIUM_PATH=…/chromium-1248/chrome-linux64/chrome \
  node scripts/check-symbolic-clipboard.mjs http://127.0.0.1:4431 /tmp/tapaal-symclip/final
```

Environment: the shared preview reported `"available": false`, so the harness used the headless
Chromium fallback. Development build of a `/tmp/tapaal-symclip-snap` source snapshot. The `src`
tree hash was identical before the build and after all runs. The build and harness runs used
`worker-job`. The static server was a managed 512M job. It is stopped.

## Result

**17/18 checks, 206/207 assertions.** The one red assertion is deliberate (F1). The suite stays
red until F1 is fixed or the assertion is changed to accept the current behaviour. Evidence:
`/tmp/tapaal-symclip/final/` (`results.json`, `S01-envelope.json`, fixtures) and
`/tmp/tapaal-symclip/final.log`.

Related existing harnesses, run against the same build:

- `check-constants-ui.mjs` with `ONLY=C11`: **1/1 pass**.
- `check-timed-clipboard.mjs`, all checks: **11/12 checks, 85/86 assertions**. C12 (async races)
  passes. C01 fails only on a stale notice regex (F2). Evidence:
  `/tmp/tapaal-symclip/timed-clipboard/`.
- The documents smoke and other historical suites were not rerun.

## Findings

### F1 (low, pre-existing in shared code): a delayed copy reports "cancelled" after writing the clipboard

Tested (S18). Source: `src/app/app.ts` `clipboardAction`. It sets `this.internalClipboard =
payload` before the awaited system write, then writes the system clipboard. Only after that does it
call `unchanged()`. For `copy`, an intervening edit makes `unchanged()` set the notice "Clipboard
action cancelled because the document, component, selection, or edits changed." By then, both the
internal and the system clipboard already hold the pre-edit v3 payload.

Reproduce: use a slow `navigator.clipboard.write`, select all, choose Edit → Copy, then rename
`Spare` in the constants pane before the write resolves.

- Expected: either an accurate notice (the copy was made from the earlier state) or no clipboard
  change.
- Actual: the "cancelled" notice is shown, and the system clipboard holds the v3 envelope (with the
  old names). A later paste works.

Impact: the notice is misleading only. Same-document paste binds IDs, not names. A cross-document
paste uses the names from before the rename. Source, history and selection are never mutated. The
same path existed for timed v2 copies before wave 4.

Minimal fix options: make the copy notice say the copy was made from the earlier state, or skip the
`unchanged()` notice for `copy`.

### F2 (low, harness drift): historical timed C01 notice regex predates the wave 4 wording

`check-timed-clipboard.mjs:450` expects `/Web envelope preserves timing.*desktop…/`. The App now
says "Web envelope preserves constant references, timing, annotations and hidden names where
present; desktop TAPAAL clipboard transfer is unavailable for this selection." All other C01
assertions pass.

The same wording is also shown for numeric-only timed v2 copies, which contain no constant
references. "Where present" keeps the claim technically true. Updating the regex (for example,
`/Web envelope preserves .*timing.*desktop TAPAAL clipboard transfer is unavailable/`) is a parent
decision. This review did not edit existing harnesses.

No other defect was reproduced.

## Coverage (all passing unless noted)

| Check | What it proves through public UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01   | Ctrl+A/Ctrl+C writes a closed v3 envelope. Top-level keys are exactly `constants, format, fragment, modelType, sourceDocumentId, version`. Fragment keys are `nodes, arcs, annotations, timing`. There is no native or numeric snapshot. Dependencies are exactly K, D, Z (Zero), L, W, X. Spare is excluded: it is declared and used only by the inactive Side component. Declarations are unchanged, and every one is referenced. Age spelling `['0.1','2.50']` is kept. Source, checkpoint and history are untouched. The notice says the transfer is web-only. A same-document paste creates one history entry, adds no declarations and binds refs to current IDs. Fragment fidelity covers transport weights W, interval [Z,D], [L,inf), invariants ≤X, ≤Z and <D, urgency, ages, bends, curved end, rotation, hidden name with offsets, and the note. Elements get fresh IDs and are selected. One undo restores the source exactly, and redo gives an identical source. |
| S02   | Edit-menu Copy+Paste, context Copy + canvas Paste, Ctrl+D, Edit Duplicate and context "Duplicate selection" each give the identical fragment in one entry, with no declarations added. Duplicates leave the system clipboard alone. Ctrl+X, Edit Cut and context Cut remove every element but keep all seven declarations, now unused. A paste after cut restores the fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S03   | Closure per selection: Zero invariant → {Z}; z+u → {K, L, Z}; u+s → {K}. A lone transport endpoint (p, t, q) or p+t refuses copy, cut and duplicate before writing anything. A lone `u`, whose symbolic arcs have outside endpoints, gives timed v2 with no constants. The numeric island gives v2 with urgency and pastes. Untimed: v3 has no timing and exactly UW, UH (inhibitor weight included). The untimed numeric island still writes legacy native text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S04   | Rename D→Dur and change X 4→3 in the pane, then paste: the paste binds `cW`, `cX` and `cD` with the current names and values, and no declaration is added. Cut p/t/q keeps X. Then X is deleted while unused. A paste then refuses with "Constant X no longer exists…": X is not resurrected, and source, checkpoint, history and selection are unchanged. Undoing the deletion restores the same ID, and the paste binds again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S05   | A cross-document paste into a new model adds W, Z, D, X with fresh IDs and the copied names and values. The fragment is equal by name and value, and no source ID remains. One undo removes the declarations and elements together. Redo gives the identical source (same fresh IDs). A repeated external paste refuses atomically. Recopying from the target sets `sourceDocumentId` to the target, and two further pastes succeed without new declarations. The source document is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S06   | Equal-value collision (the same file opened in a second tab) and unequal collision (D=7 alongside the non-colliding Other) both refuse through keyboard, menu and context paste. Neither adds a partial declaration, and history, checkpoint and selection are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S07   | Timed v3 into an untimed document refuses atomically. Untimed v3 into a timed document pastes 10 elements and UW/UH with default timing: no intervals, invariants, ages, urgency or transports. The inhibitor kind and three symbolic weights are kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S08   | Readable unrelated text and malformed v3 text refuse, with no stale internal fallback. A custom-MIME v3 with mismatched text/plain refuses. Menu Copy writes both `web application/x-tapaal-clipboard+json` and `text/plain`, and menu Paste via `read()` works. In a fresh browser context with no internal copy, plain-text v3 pastes with full fidelity and six fresh declarations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| S09   | With a denied clipboard, Copy shows "Copied inside TAPAAL Web only…". Paste in another document recovers the internal v3 copy and gives the "System clipboard unavailable … pasted internal TAPAAL Web copy" notice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S10   | Without `read()`/`write()`, writeText/readText round-trips v3 with full fidelity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S11   | 32 hostile envelopes pasted as text are each refused with no source, checkpoint or history change. Cases: unknown top-level, fragment, constant and ref keys; own `__proto__` key; version 4 and `"3"`; missing dependency; unreferenced extra declaration; duplicate declaration; duplicate name with different IDs; empty, undeclared, string-name and arithmetic refs; string, arithmetic, negative and fractional values; Zero as transport weight; invalid name and `inf`; mismatched transport weights; partial transport; pair to an unknown arc; timed without timing; untimed with timing; unknown timing key; age violating a changed invariant; empty source ID; text over 4,000,000 characters; no nodes. The unmodified envelope still pastes afterwards.                                                                                                                                                                                                          |
| S12   | A constant with ID `__proto__` and name `constructor`, used by a place with ID `__proto__` and name `hasOwnProperty`, copies with an own `__proto__` invariant key. The same-document paste binds that ID. A cross-document paste gives a fresh ID. Every check also asserts no prototype pollution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S13   | Cutting the saved-query-referenced place refuses atomically, but the v3 copy stays on the clipboard and pastes elsewhere. The pasted Q is not protected in the target. A same-document paste keeps `protectedConstants` exactly. Pasting into the protected query document keeps its protections and leaves the pasted W, Z, D, X unprotected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| S14   | Ctrl+V in the constant dialog's text field stays in the field, with no model change. Ctrl+V and menu Paste in Simulate are no-ops. A copy after a simulated delay carries only the authored initial ages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S15   | With 1.2 s clipboard I/O: menu Cut, then deselect and Ctrl+A back to the same IDs, cancels (new selection generation) with no mutation, and the payload is still written. A delayed paste is cancelled by a constant rename with identical resolved values (only the rename commits), by undo+redo ABA (source and history are identical), and by switching tab away and back. Two overlapping pastes commit exactly once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| S16   | Orphan or wrong-kind timing refuses. Cases: orphan invariant (numeric and symbolic), interval, age and urgent key; invariant on a transition; interval on a node; ages on a transition; urgent place; more ages than tokens; negative, `1e1` and non-string ages; duplicate node ID; arc to a missing node; token count given as a ref.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| S17   | Copying z+u in Main and pasting into the inactive Side component binds the same-document IDs (K, L, Z) with no new declarations. Main is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S18   | A component switch away and back cancels a delayed paste (pass). A delayed menu Copy followed by a constant rename: **F1 (deliberate red)**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Source review notes (no defect reproduced)

- `copyAuthoredSelection` hands only reference-free fragments to the numeric encoders. The
  transport guard covers selected endpoints, so lone endpoints refuse, as in timed v2.
- `prepareAuthoredPaste` checks all bindings and collisions before placement. Same-document
  identity is `doc.id === sourceDocumentId`. An envelope that claims the target's ID can therefore
  bind to existing declaration IDs if it names them. That only binds to declarations that already
  exist, and it follows the documented policy. It was not treated as a defect.
- `pasteElements` validates declarations as own data before resolving them. It preserves existing
  elements, timing, urgency and transports, and adds no protections.
- `readSelectionClipboard` checks `'version' in parsed` only on parsed JSON values. Unrelated text
  falls through to the legacy reader, never to a stale v3 internal copy.

## Limits

- Accessor, inherited, hidden and non-plain fields cannot be expressed in clipboard text. Here they
  are covered only by the unit spec, not by the browser. Deliberately forged internal document
  objects were out of scope.
- The bend, annotation and node count limits were not exercised in the browser. Only the text
  length limit was.
- Component copy ("Copy…") and use-label rendering were not separately asserted. The pane rendering
  was checked only for the renamed declaration (S04).
- File JSON v2 was used only to load fixtures. File/clipboard independence was checked through
  envelope shape, not through a file round trip.
- Desktop symbolic/timed clipboard transfer is intentionally unsupported. No native runtime was
  used, and no native parity or IO-age support is claimed.
- Unit tests, typecheck, production build and format were not rerun. The reported 743 tests and
  578.47 kB are prior evidence, not verified here.

## Owner follow-up — copy notice and timed wording fixed

A completed asynchronous Copy now reports that it copied the earlier state if the document
or view changed during the write. A denied write reports the earlier internal-only copy.
Cut/Paste cancellation and all mutation guards remain unchanged. Two app regressions defer
copy completion across an edit, for successful and denied system writes, and check accurate
notices without additional source/history mutation. The timed harness now accepts the updated
web-envelope wording while still requiring the desktop-transfer limitation.

Full suite: **745 tests pass**; typecheck, development/production builds and formatting pass.
Initial bundle is 578.73 kB, retaining the existing 500 kB warning. The full real-input symbolic
harness passes **18/18 checks, 207/207 assertions**, including a strengthened S18 assertion that
requires both the earlier-state notice and the actual v3 clipboard. The full timed clipboard
harness passes **12/12 checks, 86/86 assertions**. Evidence:
`/tmp/tapaal-symbolic-clipboard-final/{symbolic,timed}/results.json`.
The independent review's unavailable shared preview justified its Chromium fallback, reused
for these regression scripts. The temporary verification server is stopped and owned jobs are
complete. No native clipboard or broader native parity claim is added by these checks.
