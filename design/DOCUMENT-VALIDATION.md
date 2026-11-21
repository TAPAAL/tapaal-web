# Document, component and network-file validation

Browser run on 2026-10-28 against a frozen copy of the worktree's `web/` sources, taken at 22:23
(hash of `src/` files `02fd13bba529`). The live tree was being edited concurrently and briefly
failed to compile (`saved-queries.ts` TS4111). The copy was built with
`ng build --configuration development` and served from a temporary static server on port 4327.
Every action used real Playwright mouse, keyboard and file-chooser input in headless Chromium 156
(Playwright-core 1.64.1, already installed; nothing was added to the project). Controls were found by
their accessible names in the final DOM, such as `New model`, `Close <name>`,
`Include <component> in network`, `Move component up`, `Save as web JSON…`, `Model name` and
`Component name`. App state was only read, through Angular's dev-mode `ng.getComponent`, the
rendered DOM and downloaded files. Both servers were stopped afterwards.

Reproduce (needs a running development build):

```bash
PLAYWRIGHT_CORE=/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core \
  node scripts/check-documents.mjs http://127.0.0.1:4327 /tmp/tapaal-documents
# ONLY=T12,T15 restricts the run to those checks.
```

The script writes its own query-free fixtures into the output directory:

- `fixture-two-components.json`: two components with the same local IDs, one inactive, with
  bends, a curved end, an inhibitor, weights and markings.
- `garbage.tapn`: truncated XML.
- `timed.tapn`: `isTimed="true"`.

**Result: 12/16 checks passed. One critical defect, D1, causes all four failures.** No TAPN file
can be saved in Chromium. To check that nothing else hides behind it, a one-line candidate fix was
applied **only to a second `/tmp` copy** (`candidate-fix.diff`). Production code is unchanged. That
build, served on port 4328, passed **16/16**.

Evidence:

- Unpatched run: `/tmp/tapaal-documents/results.json`.
- Candidate-fix run: `/tmp/tapaal-documents-candidate-fix/`. It contains `results.json`, the saved
  `.tapn`/`.json` downloads, `T12-expected-network.json` and the screenshots
  `T2-two-tabs.png`, `T5-empty.png` and `T6-components.png`.

The exported TAPN was **not** opened in desktop TAPAAL. Desktop compatibility is not claimed.

## Working-tree integration follow-up

The parent fixed `serializeNetworkTapn` to serialize `document.documentElement` and add exactly one XML declaration. A declaration-count regression spec was added. The updated working-tree development build passed all **16/16 document browser checks**, including TAPN download/reopen, focused-field save, and save/close of a background tab. Evidence: `/tmp/tapaal-documents-all-fixed/results.json`.

The exported two-component `T12-two-part.tapn` was opened in the actual TAPAAL 4.0.4 Java application under a disposable virtual display. Native APIs confirmed Main active with two places/one transition, and Spare inactive with two places/one transition. This is one concrete compatibility fixture, not full-format certification. Screenshot: `/tmp/tapaal-native-reference/native-network-open.png`.

The original report below records the initial defect and temporary candidate test.

## Defects

### D1 — Save TAPAAL file always fails in Chromium: "The XML file is malformed." (critical)

- **Minimal reproduction:** load the app with the untouched demo tab, then press Ctrl+S, or click
  the toolbar `Save TAPAAL file` button.
- **Observed:** no download. The banner reads `The XML file is malformed.` and the tab stays
  modified/unsaved.
  - It fails for every model: pristine demo, new model, multi-component fixture.
  - `Save and close` in the dirty-close dialog also fails. The dialog stays open with the same
    alert, and the app has switched to the tab being closed. No data is lost.
  - `Save as web JSON…` works.
- **Cause:** `src/app/core/network-files.ts`, end of `serializeNetworkTapn` (about line 450).
  1. The document is built by parsing `serializeTapn(first.net)`, which starts with an XML
     declaration.
  2. In Chromium, `XMLSerializer.serializeToString(document)` re-emits that declaration.
  3. The code then prepends a second `<?xml …?>`.
  4. The export self-check `parseNetworkTapn(xml)` gets a `parsererror` and throws.

  Minimal browser proof:
  `new XMLSerializer().serializeToString(new DOMParser().parseFromString('<?xml version="1.0"?><a/>','application/xml'))`
  returns `<?xml version="1.0"?><a/>`. jsdom omits the declaration, so the vitest suites cannot see
  this.

- **Likely fix:** serialize `document.documentElement` instead of `document`, so neither
  environment emits a declaration, then prepend exactly one. The tested candidate kept `document`
  and only prepended a declaration when one was missing. A regression spec could assert that the
  serialized output contains exactly one `<?xml`, using a document parsed from a string that has a
  declaration.
- **Also affects:** `check-native-core.mjs` Q1 (Ctrl+S save) fails on the unpatched build and
  passes with the candidate fix.
- The message is misleading on save. Nothing the user opened is malformed. Consider wrapping the
  self-check failure in the existing "export verification failed … Save JSON instead" message.

## Checks (exact actions → observed)

Each check starts from a fresh page load: the demo `Producer cycle` tab, saved. Results below are
from the candidate-fix run. The unpatched run gave the same results, except where marked **D1**.

| ID  | Actions (real input)                                                                                                                                                                                                                                         | Observed                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | `p`, click canvas to create a place → toolbar `New model`, type, `Cancel`; again → Escape; File › New model › Cancel                                                                                                                                         | Dialog focuses `#new-model-name`. All three leave one tab, the same network, history length 1, and the tab still dirty.                                                                                                                                                                                                                                                                                                                                       |
| T2  | Dirty edit → `New model`, Model name `Second model`, Component `Worker`, `Create`; then New with name `   `                                                                                                                                                  | Second tab `Second model`/`Worker`, empty and unsaved. The first tab keeps 7 nodes and stays dirty. Tab labels are `Producer cycle (modified)` and `Second model (modified)`. A blank name is refused inside the dialog: "Model name is required…".                                                                                                                                                                                                           |
| T3  | Edit A; New B; two places in B → click tab A, toolbar Undo → Redo → Ctrl+S → tab B, Ctrl+Z → tab A, Undo, Redo                                                                                                                                               | Undo in A gives past 0/future 1, clean. B is untouched (past 2). After Ctrl+S, A is `(saved)` and B is `(modified)`. B's undo leaves A saved. Undo past A's checkpoint makes it dirty; Redo makes it clean again. **D1:** Ctrl+S downloaded nothing; checkpoint independence was verified with JSON save instead.                                                                                                                                             |
| T4  | Dirty → `Close Producer cycle` → `Cancel`; again → Escape; again → `Discard changes and close`                                                                                                                                                               | The dialog focuses `#cancel-close`. Cancel and Escape keep the content and history. Discard leaves zero tabs and shows the empty workspace.                                                                                                                                                                                                                                                                                                                   |
| T5  | Close clean demo tab → press `p`, Ctrl+Z, Ctrl+A, `m`, Delete, force-click Undo, Ctrl+S → empty-state `New model` → place → close/discard → empty-state `Open model…` with fixture                                                                           | No prompt for a clean tab. Empty workspace with no errors; Ctrl+S downloads nothing. New works and is editable. Open from empty adds `Two part model (saved)`.                                                                                                                                                                                                                                                                                                |
| T6  | Components `Add…` Worker; select Producer; `Copy…` Producer_2; Copy with a duplicate name, then `2bad`; `Rename…` Consumer; `Move component up` ×3; uncheck Producer and Worker, then Consumer; `Remove` on Consumer; select Worker, `Remove`; Undo to start | Order and viewed component correct after each step. Duplicate and invalid names are refused inside the dialog. Rename keeps the component UUID. Moving up at the top is a no-op with no history entry. The last active checkbox is refused and stays checked ("At least one component must be active."). Removing the only active component is refused. Removing inactive Worker works. Undo restores it, and undoing everything returns to clean `Producer`. |
| T7  | `Copy…` Copy; rename its Idle to CopyIdle in the inspector + Enter; drag it; switch to Producer; select Idle, Delete                                                                                                                                         | The components get different UUIDs but share local node ID `idle`. The copy's rename and drag (205,300) leave the original Idle at 160,240. Deleting `idle` in the original leaves the copy with 6 arcs.                                                                                                                                                                                                                                                      |
| T8  | Zoom in ×2, wheel scroll, select Processing; create P0, P1; delete P1 → `Add…` Other; create place → back to Producer; create place → New tab, back; create place                                                                                            | Other opens at the default view with no selection, and its first place is P0. Producer restores zoom 120 at y=100 with Processing selected. The next names are P2, then P3 after the tab switch: the high-water mark is never reused or reset.                                                                                                                                                                                                                |
| T9  | `a`, click Idle (arc pending) → click component row; `a`, click Idle → New tab; `a`, Idle, blank click (draft bend) → tab switch and back; type in the inspector name without Enter → click component row                                                    | Every switch cancels the pending or draft arc. No stray arc, unchanged history, select tool. The uncommitted inspector text is committed once to the correct component on blur. The other component is unaffected. Drag-then-switch cannot be reached with a real mouse, because the release ends the drag first.                                                                                                                                             |
| T10 | Add component → `Simulate`; uncheck the second component → `m`; Simulator menu toggle; remove the second → `Simulate`; fire Start; `m`                                                                                                                       | All multi-component attempts, including one active plus one inactive, stay in Edit with "Multi-component network execution is not implemented. The active component view is not a composed model." With a single component, simulation runs, and leaving it restores the initial marking.                                                                                                                                                                     |
| T11 | Dirty edit → toolbar `Open model` with fixture; open `garbage.tapn`; open `timed.tapn`; tab back; open fixture again                                                                                                                                         | Open adds a saved `Two part model` tab (`Main,Spare (inactive)`), and the first tab stays dirty. Malformed and timed files show a banner without changing the tabs, the active tab, or any network. Reopening the same file adds an independent third tab.                                                                                                                                                                                                    |
| T12 | Open fixture; select Spare; set Ready tokens to 9 + Enter; Ctrl+S; reopen the downloaded file                                                                                                                                                                | File: `<net id="Main" active="true">`, `<net id="Spare" active="false">`, markings 2 and 9, curved bend and curved-end arcpaths in both components, one untimed feature, no queries. The tab is clean. The reopened network matches the saved one (names, activation, nodes, arcs, bends). **D1:** no download.                                                                                                                                               |
| T13 | `Copy…` Mirror; uncheck Producer; delete Idle in Mirror; File › `Save as web JSON…`; reopen                                                                                                                                                                  | `tapaal-web-network` file. Component IDs, activation and nets are byte-identical to app state. The tab is clean. The reopened tab has a network identical to the saved one.                                                                                                                                                                                                                                                                                   |
| T14 | Select Idle; click the Name field, End, type `Now` (no Enter), Ctrl+S; click blank; Model name field → `Renamed model`, Ctrl+S; select Processing, clear Name, Ctrl+S                                                                                        | The typed value is committed before saving: the file has `IdleNow`, and the tab is clean. The model-name download is `Renamed_model.tapn`, and the tab is labelled `Renamed model (saved)`. An empty name shows a validation banner, produces no download, and keeps the old name. **D1:** the value commits, but nothing downloads.                                                                                                                          |
| T15 | Edit A; New Background + place; tab A, another place → `Close Background` → `Save and close`                                                                                                                                                                 | Only `Background.tapn` is downloaded, with Background content. Background closes. A stays dirty with both newer edits (past 2) and becomes active. Save is synchronous and keyed by document ID, so there is no async writer to race. **D1:** dialog stays open with the alert; both tabs keep their edits, and Background stays dirty.                                                                                                                       |
| T16 | New (dirty) tab, back to demo → reload, dismiss; discard dirty tab → reload                                                                                                                                                                                  | Reload prompts `beforeunload` while a background tab is dirty, and dismissing keeps both tabs. It does not prompt when all tabs are clean.                                                                                                                                                                                                                                                                                                                    |

## Core regression (`check-native-core.mjs`)

Run against the same unpatched snapshot (port 4327): **14/16**. Q1 fails because of D1. With the
candidate fix (port 4328): **15/16**. N7 (grid cycle 15 → 30 → off → 7.5, with integer snapping)
passed in both runs.

Q8 fails in both runs. The fault is in the harness, not the app. Ctrl+click Start after Idle now
selects `idle,start,a1`, because `app.ts` (around line 391) intentionally selects internal arcs
when both endpoints are selected ("Native selects internal arcs only when a node becomes
selected"). Q8 still expects `idle,start`. One question for whoever owns that change: after
Ctrl+click toggles Idle off, the selection is `start,a1`. Arc `a1` stays selected although its
source is no longer selected. Confirm this against native deselection before updating Q8.

## Minor observations (not graded)

- If Escape is pressed in the same frame as the `New model` click, before the dialog's
  `setTimeout` focus lands, it is ignored. A second Escape closes the dialog. A human cannot
  normally press it that fast.
- The timed-file refusal text names the element as `feature "?"`:
  `Only explicitly untimed TAPAAL files are supported (isTimed="true" on feature "?").`
- Saved-query preservation was not exercised: all fixtures are query-free. T12 only confirms that a
  query-free model writes no `<query>` element.

## Network simulation follow-up

The earlier T10 refusal expectation describes the previous single-component restriction. The
current harness instead checks multi-component simulation, retained marking/history across
component views, inactive canvas exclusion, and preservation of initial model markings.
Ctrl/Cmd+S again commits and saves focused inspector edits while rejecting invalid values;
modal dialog drafts remain protected. The updated full harness passes **16/16** against the
network-enabled build. Evidence: `/tmp/tapaal-network-final-documents/results.json`.
