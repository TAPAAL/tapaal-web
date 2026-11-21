# Token-selection validation

Independent source and browser review of the Random/Oldest/Youngest/Manual token-selection
slice described in [TIMED-UI.md § Random and manual selection parity](TIMED-UI.md#random-and-manual-selection-parity).
Reviewed on 2026-10-29. This is tested behaviour only, not a claim of full native parity.

**Result: no Critical/High/Medium defects found. Three Low findings (TS-1 to TS-3) below.**
New harness 17/17 checks (116 assertions), existing timed UI harness 20/20 (138), timed
clipboard race C12 1/1 (4). Shared-preview real-input smoke passed.

## Snapshot and method

- HEAD `28c9bd917` plus the uncommitted `web/` tree. `web/src` content hash (sorted
  `sha256sum` of every file, hashed again) `b541a373…66d`, unchanged at the end of review.
  Copied to `/tmp/tapaal-token-selection-review/web`; `ng build --configuration development`
  ran under a finite `worker-job` into `/tmp/tapaal-token-selection-review/build`
  (`main.js` `bf448e6c…f305`). It was served by a 512M managed static server on
  127.0.0.1:4393. The server was stopped after validation; no job remains.
- Shared preview: `preview_status` first (no tab). One owned background tab used real
  file upload, canvas click, native `<select>`, checkbox clicks, Fire, and arrow keys. It was
  closed afterwards. Screenshot: `/tmp/tapaal-token-selection-review/shared-preview-manual-dialog.png`.
- Matrix: `scripts/check-token-selection.mjs` (new). The B cases use Playwright with real
  mouse, keyboard, checkbox and file-chooser input against the same build. The harness reads App
  signals and DOM only. An init script wraps `Math.random` only to count calls. The P cases use
  esbuild to bundle `src/app/timed-ui.ts` and drive `DocumentSimulation` with an injected
  random source. The browser cannot do this without mutating the app.
- Production code, existing specs and existing harnesses were not edited.

```sh
cd web
PLAYWRIGHT_CORE=…/playwright-core CHROMIUM_PATH=…/chrome \
  node scripts/check-token-selection.mjs http://127.0.0.1:4393 /tmp/tapaal-token-selection-review/final
node scripts/check-token-selection.mjs - /tmp/out   # P cases only, no browser
```

Fixture (written by the script, `token-selection.json`), one active component:

| Element                      | Setup                      | Purpose                                                          |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `P -(2,6)-> T`               | P ages 0.5, 2, 2.5, 3, 6   | strict bounds: only 2.5 and 3 eligible                           |
| `R =2=> T =2=> D`, transport | R ages 1, 1, 1, 4; D `< 3` | weighted transport, destination invariant excludes 4, equal ages |
| `H -o T`                     | inhibitor, H empty         | no chooser group                                                 |
| `T -> Q`                     | ordinary output            | age-0 output                                                     |
| `S -> Q`                     | source transition          | immediate fire                                                   |
| `H -o U -> Q`                | inhibitor-only             | immediate fire                                                   |
| `X =2=> F`                   | X ages 0, 0                | forced choice                                                    |

## Results

Evidence: `/tmp/tapaal-token-selection-review/{final,timed-ui,clipboard-c12}/results.json`.

| ID  | Check                                                                                                                                                                                                                                                                                                                                                               | Result         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P01 | Random: one sample per required token. With 6000 seeded firings, each equal-age R pair has frequency ≈1/3 and each P choice ≈1/2. `floor(r*remaining)` reaches every ordered pair, like native `nextInt(size)` with removal.                                                                                                                                        | pass           |
| P02 | Random samples 1, -0.1, NaN, ∞, `'0.5'`, `undefined` at the first and third draw are refused. Cursor, trace and future stay unchanged.                                                                                                                                                                                                                              | pass           |
| P03 | Oldest picks 3, not 6, and Youngest picks 2.5, not 2. Deterministic policies and Forward make zero random calls.                                                                                                                                                                                                                                                    | pass           |
| P04 | The engine refuses manual bindings with a missing input, extra inhibitor key, too few or too many tokens, duplicates, strict-bound age 2 or 6, destination-invariant age 4, another place's token or an unknown ID, with no mutation. Exact IDs are consumed and the old future is truncated.                                                                       | pass           |
| P05 | The `eligibleInputs` projection matches firing rules, omits inhibitors and is detached from the simulation. A two-component timed network is refused.                                                                                                                                                                                                               | pass           |
| B01 | Random is the default (`random` select value). Twenty sidebar fires showed no dialog and exactly 3 `Math.random` calls each. Both P choices and several R pairs occurred.                                                                                                                                                                                           | pass           |
| B02 | Explicit Oldest and Youngest give the same results as P03 through the UI.                                                                                                                                                                                                                                                                                           | pass           |
| B03 | The Manual dialog shows two groups, names the transport destination and omits H. Only eligible tokens appear, labelled `Token n · age a`. No `@timed` or raw ID appears. Fire stays disabled until the selection is exactly 1+2, including after a 3-of-2 over-selection. The engine binding equals the clicked identities. The document stays unchanged and clean. | pass           |
| B04 | Back, Forward, history-row jumps, arrow keys and Simulator → Next marking replay the snapshot without a dialog. Forward under Random makes no sampling call. A new Manual confirm after Back truncates the future.                                                                                                                                                  | pass           |
| B05 | Cancel (with a complete selection) and Escape (opened by row Enter) change nothing. The future survives, and focus returns to the row.                                                                                                                                                                                                                              | pass           |
| B06 | Focus starts on the first checkbox. Tab cycles 5 checkboxes and Cancel, skips the disabled Fire and wraps. Shift+Tab wraps. `m g v a ←/→ Delete Backspace F2`, Ctrl+Z/Shift+Z/Y/D/J and Ctrl+S are inert. Ctrl+C/X/V leave the clipboard sentinel and the document unchanged. Space toggles. Enter submits a complete form.                                         | pass, see TS-2 |
| B07 | Clicks, right-clicks and wheel outside the dialog are inert: Back, Forward, Reset, policy, Edit, history, Delay, Simulator menu. The point at U lay under the dialog and was skipped.                                                                                                                                                                               | pass           |
| B08 | Forced X: the web shows the dialog with both tokens prechecked, enabled and Fire ready. Unchecking one disables Fire. Unforced inputs start unchecked.                                                                                                                                                                                                              | pass, see TS-1 |
| B09 | Source S and inhibitor-only U fire immediately in Manual without random calls.                                                                                                                                                                                                                                                                                      | pass           |
| B10 | Ten entry points open the same T draft with focus inside and nothing pre-toggled: canvas click, canvas Enter, canvas Space, inspector Fire, sidebar Fire, row double-click, row Enter, Step, Simulator → Next marking and context-menu Fire. Escape on each leaves the state unchanged.                                                                             | pass, see TS-3 |
| B11 | TAPN and JSON saved after a manual fire plus delay 0.5 are byte-identical to the pre-simulation saves and carry the initial marking and ages. The 4.0.4 initial-age-loss note is still shown. Ctrl+C with P selected in Simulate wrote nothing; the clipboard kept its sentinel.                                                                                    | pass           |
| B12 | Two-component timed Simulate is refused with a message, and no policy control is shown.                                                                                                                                                                                                                                                                             | pass           |

Shared-preview smoke used the same fixture with T at the viewport centre. A real pointer press
on T opened the dialog under the pointer, and the release over a fieldset toggled nothing. Clicks
on Token 2 · age 3 and Tokens 2 and 3 · age 1, then Fire, produced engine bindings
`pi: [initial:p:3]` and `ri: [initial:r:1, initial:r:2]`. The marking became P 0.5, 2, 2.5, 6;
R 1, 4; D 1, 1; Q 0. ArrowLeft/ArrowRight from the canvas replayed the step without a dialog.

Existing suites on this build: `check-timed-ui.mjs` **20/20, 138/138**. With Random as the
default, T07 now checks it and then explicitly selects Oldest. The other cases' firings were
forced or single-eligible in this run, and nothing was rebaselined. `check-timed-clipboard.mjs`
`ONLY=C12` (async cut/selection/tab/edit races) passed **1/1, 4/4**. Other historical suites were
not rerun.

## Findings

### TS-1 (Low, parity documentation): two native differences are not called out

Native source expectations:

- `Animator.fireTransition` calls `clearStepsForward()` before `getTokensToConsume` shows the
  dialog (`Animator.java:745–760`). So native Manual Cancel after Back has already discarded the
  forward history.
- `ArcTokenSelector` disables a forced group (`setEnabled(false)` when weight equals the
  eligible count). Native skips the dialog entirely only when every group is forced (`fillList`).

Web (B05, B08): Cancel keeps the future, which is safer. Forced groups are prechecked but remain
editable, so the user can uncheck them and disable Fire. TIMED-UI.md documents the forced-dialog
difference but not these two points. Recommended: list both under "Web interaction choices", or
disable forced checkboxes to match native.

### TS-2 (Low): Ctrl+A inside the dialog selects the whole page

To reproduce, open the Manual dialog, focus a checkbox and press Ctrl+A, then Ctrl+C. The dialog
correctly stops the app's Select All and clipboard handlers, so no TAPAAL payload is written.
However, the browser default then selects all page text (1823 characters, including content
behind the modal). Ctrl+C then puts that text on the system clipboard, including the sidebar's
current simulated token ages. Expected: Select All is inert or confined to the dialog. Fix: have
the dialog `preventDefault` Ctrl/Cmd+A outside text fields, or disable selection behind the
backdrop. Whether other app dialogs behave the same way was not tested.

### TS-3 (Low, accessibility): focus is lost after cancelling a draft opened from the Simulator menu

To reproduce, choose Simulator → Next marking in Manual mode, then press Escape or Cancel. Focus
lands on `<body>`. `previousFocus` is the menu button inside a now-closed `<details>`: it is
connected but not focusable, so the `isConnected` check passes and `focus()` silently fails.
Other entry points restore focus to the row, the button, the node or the context-menu Fire
button. Fix: fall back to the canvas when focus did not move.

### Observations, not findings

- After a canvas fire, focus returns to the transition node, where the existing `role=button`
  exclusion ignores ←/→ history keys. This is the same as before this slice. Clicking the empty
  canvas restores arrow navigation.
- Enter on a checkbox submits a complete selection (implicit form submission). It is ignored
  while the selection is incomplete.

## Coverage limits

- The modal backdrop blocks every UI path to Delay, Back, Forward, Reset, policy, mode, tab and
  document edits while a draft is open (B06, B07). So the stale-confirmation guards cannot be
  reached with real input. This includes the generation check after the cursor returns to the
  same position and the revision-change check. Those guards are source-reviewed
  (`App.confirmTokenSelection`) and covered by the implementer's specs
  (`app.spec.ts` "invalidates drafts…" and "rejects a stale generation…"). They are not
  browser-proven here.
- An engine-revalidation error inside the dialog (`role=alert`, future kept) cannot be produced
  through the UI. Engine refusal and immutability are covered by P02 and P04.
- Browser randomness is a 20-trial sanity check; distribution evidence comes from P01.
- No native GUI was executed for this review. Native statements are source expectations from
  `Animator.java`, `AnimationTokenSelectDialog.java`, `ArcTokenSelector.java` and
  `RandomFiringMode.java`. The 124/124 native execution observations are the root agent's run.
  They are engine evidence and were not rerun here.
- Only the two-component refusal was exercised. Shared-transition, coloured, game and stochastic
  refusals were not constructed in this review.
- The full Vitest suite, typecheck, production build and the documents, native, layout and
  native-writer harnesses were not rerun. Their figures come from the implementer and earlier
  reviews.

## Owner follow-up (2026-10-29)

TS-2: the dialog prevents Ctrl/Cmd+A outside text controls, leaving page text and system
clipboard unchanged. TS-3: closing the dialog falls back to canvas focus when the opening
control is disconnected or cannot take focus (including the closed Simulator menu).
Forced choices are now checked and disabled, as in native; the web still shows the entirely
forced dialog as documented. TS-1: TIMED-UI.md now explicitly distinguishes the web's retained
forward history on cancellation from native's eager history truncation.

Full suite **519 tests pass**; development/production builds and formatting pass. Initial
production size is 528.89 kB, with the existing 500 kB warning retained. A new rendered-dialog
regression covers focus fallback; existing dialog tests assert blocked Ctrl/Cmd+A and disabled
forced choices. Targeted real-input Chromium reruns B06/B08/B10 pass **3/3 checks, 33/33
assertions**, including Simulator-menu focus restoration. Evidence:
`/tmp/tapaal-token-dialog-final/results.json`. No assertions were weakened: former editable
forced-choice expectations were replaced with native-style disabled-choice assertions.
The temporary server and owned jobs are stopped. Prior full review results remain prior
baseline evidence; unrelated historical suites were not repeated for these dialog-only fixes.
