# Timed multi-component simulation UI validation

Independent browser review on 2026-10-29 of the `DocumentSimulation` → `TimedNetworkSimulation`
integration ([TIMED-NETWORK-SIMULATION.md](TIMED-NETWORK-SIMULATION.md) "Application
integration", [TIMED-UI.md](TIMED-UI.md) "Timed network UI integration"). Production files,
existing specs and existing harnesses were not changed.

**Result: 12/14 new checks pass. Both failures are the same Low accessibility defect (TNV-1):
after a manual Fire, focus lands on `<body>` if the originating enabled row disappears. No
semantic, history, save or refusal defect was found in the tested coverage.** The existing
timed UI (20/20) and token-selection (17/17) harnesses pass against the same build. This is
tested coverage only, not a full native parity claim.

## Snapshot and method

- HEAD `28c9bd917` plus the uncommitted `web/` tree. `web/src` was copied to
  `/tmp/tapaal-tnui-snap` before building. Its SHA-256 manifest was unchanged at the end of
  the review. Development build under a finite `worker-job`, served by a 512M managed static
  server on 127.0.0.1:4397. The server was stopped after validation.

  ```text
  main.js     c7e72406abec920898ba21135c11a3bb318727007c2edf8a615dddd9504d5b64
  styles.css  3d28c678f6f37a0d8e3cfaedcc982cbcb250f1821077fab0d93d2787df7ec7b2
  ```

- `scripts/check-timed-network-ui.mjs` (new) drives Playwright with real clicks and
  double-clicks, typed delay amounts, `<select>` changes, checkbox clicks, Tab/Shift+Tab, Escape,
  Ctrl shortcuts, the file chooser and downloads. App signals and DOM are only read; no App
  method or signal setter is called. Only one input is not real: `locator.focus()` on an
  enabled-row button before a real Enter. A row click deliberately switches the view, so Enter
  is the UI's route for firing another component without leaving the current view.
- The whole-network marking is read from the current history row's `title`. That attribute
  lists every component's ages, so the harness can check components that are not on screen.
- Shared preview: `preview_status` first (no tab available), then one owned background tab
  repeated the fixture upload, Simulate, Manual policy, a weighted Beta transport selection and
  Fire, followed by ArrowLeft. It reproduced TNV-1 using mouse input alone. The screenshot is at
  `/tmp/tapaal-timed-network-ui/shared-preview-manual-beta.png`. The tab was closed afterwards.

```sh
worker-job capacity && worker-job list
worker-job start tapaal-tnui-server --memory 512M -- \
  python3 -m http.server 4397 --bind 127.0.0.1 --directory <dev-build>/browser
PLAYWRIGHT_CORE=… CHROMIUM_PATH=… worker-job run tapaal-tnui-harness -- \
  node web/scripts/check-timed-network-ui.mjs http://127.0.0.1:4397 /tmp/tapaal-timed-network-ui/final
worker-job stop tapaal-tnui-server
```

## Fixture

`trio.json` is generated in the output directory. Every component reuses local IDs
`p/t/q/i/o` and the names `P/T/Q`:

| Component        | Content                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alpha (active)   | P ages 0.1, 2.50, `<= 5` → T → Q                                                                                                                                 |
| Beta (active)    | P ages 0.5, 1, 1.5, 3 → weight-2 transport T → Q `<= 2`; S age 0.5 `< 2` (occupied strict); R empty `< 1`; Z → urgent U (Z empty; 1 token in `trio-urgent.json`) |
| Gamma (inactive) | P age 0.25 `< 1` → urgent T → Q                                                                                                                                  |

The expected initial legal delay is `[0,1.5)`, from Beta.S only. Each wrong source gives a
different value: Gamma urgency gives `[0,0]`, Gamma's invariant `[0,0.75)`, empty R `[0,1)`.

## Checks (`/tmp/tapaal-timed-network-ui/final`)

| ID  | Observed through the actual UI                                                                                                                                                                                                                                                                                                                                                                                                                           | Result     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| N01 | Rows `Alpha`, `Beta`, `Gamma (inactive)`. Simulate opens; time 0; legal `[0,1.5)`; enabled exactly `Alpha.T`, `Beta.T`. Gamma view shows the inactive note and frozen `P: 0.25` while global list and interval are unchanged. Beta shows its own ages. Activity checkboxes disabled. Document unchanged.                                                                                                                                                 | pass       |
| N02 | Delay `0.1` then `0.2` → `Global time: 0.3`. Every active age +0.3 (`2.50` → `2.8`), Gamma 0.25. History `Delay 0.1 · time 0.1`, `Delay 0.2 · time 0.3`. Legal `[0,1.2)` (remote strict S; empty R ignored). `1.2`, `abc` and (after Back) `5` are refused with cursor, marking and future unchanged; `1.19` after Back branches.                                                                                                                        | pass       |
| N03 | Enabled urgent Beta.U shows `[0,0]` in the Alpha view and refuses `0.1`; `0` is accepted. Enter on Beta.U from Alpha fires it without a view change. The interval reopens to `[0,1.5)` even though inactive urgent Gamma.T still has a token.                                                                                                                                                                                                            | pass       |
| N04 | Alpha.T (Oldest) consumes 2.6 and outputs age 0. Beta and Gamma ages are unchanged.                                                                                                                                                                                                                                                                                                                                                                      | pass       |
| N05 | Gamma view, Manual, Enter on Beta.T → `Select tokens for Beta.T`, legend `P → Beta.T → Q (transport)`, only ages 0.5/1/1.5 (3 violates `Q <= 2`), Fire disabled at `0 of 2`. Choose 1 and 1.5 → Beta Q 1, 1.5; Alpha/Gamma unchanged; view stays Gamma; legal `[0,0.5]`. Back/Forward restores without a dialog. **Focus ends on body (TNV-1).**                                                                                                         | fail TNV-1 |
| N06 | Escape after Back keeps cursor 0 and the future (documented web choice). With a draft open, the modal blocks a real click on a component row, so a view change cannot happen during a draft. After Escape, changing view keeps the run and its future.                                                                                                                                                                                                   | pass       |
| N07 | From Gamma/Beta/Alpha views: Oldest → Q 1.5, 1; Youngest → Q 0.5, 1 and Alpha keeps 2.50. Random, 12 Reset/fire rounds: never takes ineligible age 3, sampled 2+ distinct pairs, Back/Forward replays the identical choice with no dialog.                                                                                                                                                                                                               | pass       |
| N08 | Jumps to row 1 and row 4 restore global time and whole marking without prompting. Back/Back/Forward across a manual fire does not prompt. Reset gives time 0 and initial ages, and clears the trace (`TimedSimulation.reset`). The rebuilt run reaches the same marking. A jump to row 2 from the Gamma view, then `0.05`, truncates the future, with Gamma frozen.                                                                                      | pass       |
| N09 | Step in the Gamma view fires the global first enabled Alpha.T (`Network step 1`), and the view stays Gamma. With Manual policy and a future, the button (now labelled Forward) replays without a dialog.                                                                                                                                                                                                                                                 | pass       |
| N10 | Shows the 4.0.4 age-loss warning. TAPN and JSON saved mid-run are byte-identical to the initial saves, and the run continues. TAPN has `<net id="Gamma" active="false">`, all 8 nonzero ages (including inactive), both weight-2 `type="transport"` halves with `[0,inf):1`, strict/non-strict invariants and urgency. Reopened JSON components are exactly equal; reopened TAPN keeps activity, names, counts, ages, invariants, transport and weights. | pass       |
| N11 | In Simulate, Ctrl+A/C/X/V/D, Delete and Ctrl+Z/Y leave the document, undo depth and run unchanged. Switching tab ends the run; a new run starts with one history row at time 0.                                                                                                                                                                                                                                                                          | pass       |
| N12 | The saved TAPN plus `<query name="BetaQ" … "EF Beta.Q &gt;= 2">` opens. After a cross-view fire and delay, the saved TAPN keeps the query unchanged.                                                                                                                                                                                                                                                                                                     | pass       |
| N13 | Coloured, game and stochastic flags, `sharedPlaces` and `constants` are each refused on open (no new tab, error shown); no untimed fallback is reachable.                                                                                                                                                                                                                                                                                                | pass       |
| N14 | Urgent fixture, Manual, Enter on Beta.U: the forced token is prechecked and disabled, Fire enabled. Tab ×4 and Shift+Tab stay among the dialog's enabled buttons. Ctrl+A changes neither app selection nor DOM selection. Fire succeeds; Escape on a later draft returns focus. **Focus after the fired row disappears is body (TNV-1).**                                                                                                                | fail TNV-1 |

## Finding

**TNV-1 (Low, accessibility/keyboard).** After a confirmed manual Fire, focus is lost to
`<body>` whenever the originating enabled-transition row stops being enabled.

- Steps: open `trio.json`, Simulate, select Manual, double-click (or focus + Enter) `Beta.T`,
  check tokens 2 and 3, click Fire. Afterwards Beta.T is no longer enabled.
- Expected: focus returns to a live control, or falls back to the simulator canvas
  (TIMED-UI.md "focus returns on close"; the dialog's own canvas fallback).
- Actual: `document.activeElement === document.body`. The focus log shows focus going back to
  `button.enabled-row` while it is still connected; Angular then removes that row in the same
  update. Escape/Cancel, and fires that leave the row enabled, are unaffected. The global
  ArrowLeft/Right shortcuts still work. Tab order restarts from the top of the page.
- Root cause: `TokenSelectionDialog.ngOnDestroy` (`token-selection-dialog.ts:131–139`) restores
  focus synchronously, before `publishSimulation` re-renders the enabled list, so the
  `isConnected` and `activeElement` checks pass for a row that is about to be removed.
- Suggested root fix (not applied; production is read-only here): defer the restore/fallback
  until after the next render (for example `setTimeout`/`afterNextRender`), recheck
  `isConnected`, and otherwise focus `svg.net-canvas`. Add an app spec where the fired row
  disappears. N05/N14 are the browser regressions.
- Evidence: `/tmp/tapaal-timed-network-ui/final/results.json`, `/tmp/tapaal-timed-network-ui/focus-probe.mjs` (focus log printed to console during the review)
  and `/tmp/tapaal-timed-network-ui/shared-preview-manual-beta.png`.

## Regression harnesses (same build)

- `check-timed-ui.mjs`: **20/20 checks, 139/139 assertions**
  (`/tmp/tapaal-timed-network-ui/timed-ui`), including the updated T14 multi-component
  expectations.
- `check-token-selection.mjs`: **17/17 checks, 117/117 assertions** (P01–P05 pure, B01–B12
  browser; `/tmp/tapaal-timed-network-ui/token-selection`), including B06 Ctrl+A/focus trap,
  B08 forced choices and B12 two-component execution.
- `check-timed-clipboard.mjs` `ONLY=C12`: **1/1, 4/4**. Run because manual-modal and
  focus changes could affect asynchronous clipboard races; the full clipboard suite was not
  rerun.
- Not rerun: Vitest suite, production build, native-core/documents/layout/native-writer harnesses
  and the 213-observation native timed-network comparison. Their counts in the design docs are
  prior reports.

## Harness corrections during the review

The first run's failures were harness assumptions, corrected without weakening any semantic
check. Ages are canonical (`2.50 + 0.3` = `2.8`); history row text concatenates index and label;
oldest output order is `1.5, 1`; Reset clears the trace by design (core `TimedSimulation.reset`);
the Step button is labelled Forward when a future exists; TAPN attributes are written as
`id … active`; there are 8 nonzero ages; the app starts with a sample document, so document
counts are relative; a branch after Alpha.T must expect Alpha's 2.50 token to be consumed.

## Precise limits

- This is a source and browser review only; no native GUI was run. The 213 native engine
  observations in TIMED-NETWORK-SIMULATION.md are engine evidence. They are not browser
  evidence and do not show native file-IO age compatibility. Released 4.0.4 drops nonzero
  ages when it opens these TAPN files (TIMED-FILES.md); the UI warns about it.
- Intentional, documented differences, not bugs: inactive components show their frozen initial
  projection (native drops inactive markings); web Manual shows fully forced choices disabled
  (native skips the dialog); cancelling after Back keeps the future (native clears it first).
- Not reachable through the UI, so not tested: a view change while a draft is open (the modal
  blocks it, see N06); a revision change during simulation (editing, activity checkboxes and
  clipboard are blocked; only tab navigation ends a run, N11).
- Not covered: shared places/transitions inside native TAPN (only the JSON `sharedPlaces` field
  was refused), constants in TAPN, large networks/capacity limits, touch input, other browsers.

## Owner follow-up — TNV-1 fixed

Manual dialog teardown now defers focus restoration until the parent render has finished.
It rechecks the opening control's connectivity and focusability, falling back to the canvas
when a fired transition's enabled row disappeared. It also avoids taking focus from a newer
modal. A rendered-dialog regression removes the opening row after destruction and verifies
canvas focus after queued rendering work.

Full suite: **548 tests pass**, development/production builds and formatting pass. Initial
bundle is 534.79 kB, with the existing 500 kB warning retained. The full network browser harness
now passes **14/14 checks**, including both TNV-1 reproductions N05 and N14. Evidence:
`/tmp/tapaal-timed-network-ui-fixed/results.json`. Other independently passing historical
harnesses were not repeated for this focus-only change. No assertion was weakened. The
verification server was stopped and owned finite jobs completed; no manual demo remains.
