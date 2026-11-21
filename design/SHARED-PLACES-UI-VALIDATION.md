# Independent shared PLACE browser/UI review

## Owner follow-up

All three UI findings are addressed. New-model help now distinguishes supported
shared places from unsupported shared transitions. Pool summaries explicitly label
their source count as “initial”. The sidebar presents time/token choice, enabled
transitions, navigation/totals and history immediately after Components, ahead of
source lists and support text. Token-age details follow those controls; compatibility
and nonzero-age warnings remain available. History has a bounded scroll area.

The full review harness passes **15 scenarios / 115 assertions** on the corrected
build. Two new assertions verify the initial-count label and that essential
simulation sections/history heading fit within the first sidebar viewport at
1440×1000. The original stale-help proof passes unchanged. Evidence:
`/tmp/tapaal-shared-ui-polish-final/results.json`.

The document harness now positively checks V3 all-inactive editing/removal and
whole-source undo rather than the obsolete last-active refusal. Its full run
passes **16/16 scenarios**; evidence is in
`/tmp/tapaal-shared-ui-polish-documents`. Full unit suite **989/989**, application
typecheck, formatting, development and production builds pass. Production initial
size is **634.23 kB**, retaining the existing 500 kB warning. These UI fixes do not
alter execution or codec semantics; native comparisons were not rerun for them.
The owned server and browser workloads were stopped after verification.

The original independent review, findings and evidence limits follow unchanged.

Reviewed 2026-10-29 against the integrated `SHARED-PLACES-UI.md`,
`SHARED-ELEMENTS.md`, foundation/files/simulation designs, and the three earlier
review reports including their owner follow-ups. This is an independent review,
not a repetition of the implementer's 22-assertion smoke report.

**No release-blocking source, file, clipboard, or simulation correctness defect
was reproduced in the exercised workflows.** Three nonblocking UI findings follow.
The new harness deliberately remains red for the stale New-model help text.
Coverage limits below are part of this conclusion; this is not an exhaustive
proof of every shared execution topology or native GUI parity.

## Findings

### F1 — P3: New-model dialog incorrectly says shared models are refused

`src/app/document-dialog.ts:56` still says “Shared, coloured, game and stochastic
models are refused.” Shared PLACE models now open, edit, save and simulate, and
New documents have the same V3 shared source authority. This contradicts the
adjacent Shared Places workflow and can discourage users from using the feature.

Reproduce: click the New model toolbar button. Read the paragraph below Timing.
No special fixture or capacity failure is required. The captured screenshot was
taken after the capacity check, so the unrelated capacity warning is also visible.
Narrow correction: distinguish unsupported shared transitions from supported
shared places in that paragraph.

- Retained failing proof: `R11-untimed-capacity-help`, final assertion.
- Screenshot: `/tmp/tapaal-independent-shared-review-1029/final/new-model-help.png`.
- Source and all existing tests/harnesses were left unchanged.

### F2 — P3: simulation pane count has no “initial” label

`src/app/shared-places-pane.ts:14` renders `◇ Pool · 2 · <= K` from authored initial
source in both modes. After Main.T and Side.T consume both tokens, the canvas
correctly shows an empty pool, but the pane still says `2`, with no indication
that the number is initial rather than live. The occurrence/global edit dialogs
explain initial values, but those editing actions are disabled in simulation.
This is presentation ambiguity, **not duplicated marking or incorrect firing**.

Reproduce `R04-simulation-files`: open the generated three-component model,
simulate, consume one pool token in Main and one in Side, then view Inactive.
The physical total and live canvas are correct; the summary remains an unlabeled
initial value. A narrow label such as “initial 2” would resolve the ambiguity
without changing source ownership or making this an editable live marking.

Evidence: `/tmp/tapaal-independent-shared-review-1029/final/simulation-inactive.png`
and `R04-simulation-files-state.json`. This is a visual finding, not an additional
failed assertion.

### F3 — P3: simulation controls are pushed below the first viewport

At 1440×1000, with three components, two collapsed pools and one collapsed
constant, the Components/Shared Places/Constants/capability text occupies nearly
the entire sidebar. In the inactive simulation screenshot, Global time is near
the bottom; delay, enabled transitions, physical totals and history require
sidebar scrolling. The nonzero-age warning is useful and must remain visible,
but its placement together with the long capability paragraph makes repeated
native-style firing/navigation cumbersome. This combines existing sidebar
layout with the new sharing section; it is not solely a new sharing regression.

Evidence: the same simulation screenshot. Compare the pre-existing
`/tmp/tapaal-native-reference/native-simulation.png`, where firing and history
controls are visible together at 1280×800. The models differ, so this comparison
establishes control placement, not pixel parity. Consider keeping the essential
simulation controls ahead of the explanatory content. No broad redesign is
proposed. Controls remain reachable and the automated input workflows work.

## Independent run and source binding

Owned repository changes are only this report and
`../scripts/check-shared-places-review.mjs`. Generated fixtures, downloads,
screenshots and state captures are under `/tmp/tapaal-independent-shared-review-1029`.
No production fixes, existing-test/harness edits, subagents, commits, PRs or
publication were performed.

The shared browser's `preview_status` returned `available: false`. Accordingly,
the permitted Playwright fallback used Chromium 1248 and playwright-core 1.63.0,
1440×1000 viewport. The new harness uses real mouse/keyboard/select/checkbox input,
file chooser and download events for actions. Angular signals and DOM are read
only. Clipboard contents are seeded by real Ctrl+C on a local place, not by an
app method or a clipboard write through evaluation. No app mutator is invoked.

A private copy of `src`, `public` and build configuration was built in development
mode in `/tmp/tapaal-independent-shared-review-1029/snapshot`. Its static server
ran under a 512 MiB managed job. Builds and browser suites ran under managed
finite jobs after help/USAGE and capacity/list checks. The development build
completed successfully at 2.31 MB; this is not the production bundle measurement.

Git HEAD is `28c9bd9174c052264db8af7a02a214dd1c37d4c4`. The pre-existing web tree
is untracked, so HEAD alone is insufficient evidence. The manifest covers all
118 existing source/harness files before review:

- `source-hashes-before.json`
- Manifest SHA-256: `2dec8aa51d13f725f69a80c7283e4a93b47de856b9717cb7b5be6c43d035c7d3`
- `source-hash-verification.json`: zero changed existing files; zero snapshot
  source mismatches. The manifest paths are relative to `web/`.

All paths in this section are beneath the evidence directory above. Source hashes
were checked again at completion. The test server was stopped, finite jobs ended,
and `worker-job list` was empty. Every new harness context/browser closes in
`finally`. No user demo was requested or left running.

## Final new harness results

**One complete final run: 15 scenarios, 113 assertions, 112 pass, 1 fails (F1),
zero scenario errors and zero uncaught browser errors.** Evidence:
`final/results.json`. Every scenario has an additional `final/R*-state.json`.
The final run is self-contained; counts are not assembled from separate reruns.

| Scenario | Assertions | Independently exercised                                                                                                                                                                                                                               |
| -------- | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01      |         10 | Equal numerical literal/reference adoption requires consent; duplicate membership refusal; remove/join without summing; geometry-only occurrence; whole-source undo/redo and clean checkpoint                                                         |
| R02      |          9 | Pool count/age edit across active/inactive occurrences; global local-name collision; deduplicated constant use and readable active count; click use opens pool; constant conflict atomic and dialog open; unused delete/undo and used delete disabled |
| R03      |         11 | Shared geometry and source preservation; local properties; symbolic arc display; explicit equal literal replaces reference; undo restores reference; member inline marking blocked; global properties; local token wheel                              |
| R04      |         12 | Two active competitors plus inactive view; physical totals; exact 0.1+0.2; Oldest/Manual; pool names; inactive local ages frozen; Back/Forward/jump/branch; JSON byte-identical initial save; source detach/fresh name                                |
| R05      |         10 | Actual local system copy; shared copy/cut/duplicate leave clipboard/source/history unchanged; selected incident arc alone refused; unrelated local paste across components and atomic undo                                                            |
| R06      |          2 | makeShared transfers count/ages/literal invariant and replaces local node by membership                                                                                                                                                               |
| R07      |          5 | Component copy retains one pool; independent geometry; occurrence deletion removes both transport halves; undo restores pair                                                                                                                          |
| R08      |         11 | Opaque query metadata unchanged; rename/detach/removal/unused deletion/conversion refused; values and geometry allowed; explicit query removal; undo restores metadata and protections                                                                |
| R09      |          9 | TAPN byte-identical before/midrun; reopen initial/inactive/unused meaning and symbolic invariant; visible 4.0.4 age warning; colored/game/stochastic/shared-transition/V2-shared refusal                                                              |
| R10      |          6 | All-inactive no events; dormant ages advance beyond invariant; inactive locals frozen; activation resets to initial; occupied invariant/urgent gates; empty invariant permits delay                                                                   |
| R11      | 4 (3 pass) | Untimed no delay; oversized source save; actionable execution capacity refusal; **F1 stale help fails**                                                                                                                                               |
| R12      |         10 | Hidden-name shared ring; label drag; rotation; annotation; Quick Draw local P/T/P plus arcs retaining references; focus/Tab/Shift-Tab/Escape                                                                                                          |
| R13      |          5 | Weighted guarded pool-to-local transport and ages; Manual eligibility; global inhibitor before/after; Youngest shared token choice                                                                                                                    |
| R14      |          5 | Symbolic local copy across documents; dependency import; atomic paste undo; generated names skip unused pool names, no implicit binding; clipboard preserved                                                                                          |
| R15      |          4 | Initial/New use V3 authority; scalar V2 and numeric V1 real file opens migrate to empty shared lists                                                                                                                                                  |

Implementation notes about early harness corrections: initial runs contained
locator errors (arc hit path covered by its visible line, component whitespace,
TAPN button name), premature visibility assertions before Angular render/focus,
and JSON object-key-order comparison of an unchanged copied component. These
were harness errors, not product findings. Final comparisons use deep structural
equality; the JSON/TAPN byte-for-byte assertions remain byte comparisons.

An early clipboard assertion expected a copied local source name to collide with
a target pool. Native-style paste allocates a new P-number name, and
`App.nextNodeName` skips **all** pool names. No colliding candidate reaches the
command through this UI. The final proof checks fresh local identity and unchanged
pools. `editor-workspace.pasteAuthoredSelection` also explicitly refuses a candidate
whose new local name equals a global pool name; this defensive refusal was
**source-inspected**, not falsely claimed as reached by normal browser input.

## Unchanged historical full runs

All eight requested historical harnesses ran without edits against this same
snapshot. Results are in `history-<suite>/results.json`, with matching sibling
`.log` files. Counts below include only actual boolean/OK/FAIL assertions, not
incidental textual observations.

| Suite              | Scenarios passed/executed | Assertions passed/executed |
| ------------------ | ------------------------: | -------------------------: |
| documents          |                     15/16 |                    101/104 |
| native-core        |                     16/16 |                      99/99 |
| element-layout     |                       7/7 |                      58/58 |
| timed-clipboard    |                     12/12 |                      86/86 |
| constants-ui       |                     17/17 |                    203/203 |
| symbolic-clipboard |                     18/18 |                    207/207 |
| token-selection    |                     17/17 |                    117/117 |
| timed-network-ui   |                     14/14 |                      99/99 |

The documents T6 failure comprises the old “last active refused” assertion,
“removing last active refused”, and a subsequent assertion based on that expected
refusal. V3 deliberately permits all-inactive models and removing the last active
component; R10 independently validates execution of that supported state. This
is a historical expectation mismatch, not a reproduced correctness regression.
No existing check was weakened. Therefore the historical collection is **not all
passing**, even though the other seven suites pass in complete runs.

Token-selection is a mixed harness: five P scenarios/37 assertions are direct
bundled-core checks; twelve B scenarios/80 assertions use the browser. Its injected
RNG checks are not browser-only evidence. The historical clipboard harnesses also
include their existing browser permission/delay instrumentation. Their async
selection/component/document ABA, recoverable query-protected cut, and earlier-state
copy notices passed. Those are regression evidence on their own existing fixtures,
not independent shared-member versions of every race.

`historical-summary.json` contains the machine-readable counts. None of the
implementer's previously reported test/build/native counts was counted as a new
independent pass. No full Vitest run, production build, released-native Java
oracle, `check-timed-ui`, or `check-shared-places-ui` rerun was performed in this
review. The eight historical suites above were full runs, not focused patches
combined into a claim that a full run passed.

## Adapter inspection and evidence limits

Inspected `editor-workspace.displaySource`, `numeric`, `geometryPatch`, shared
clipboard boundaries, `authored-shared` localEdit and query checks, shared dialogs,
App dispatch and the documented execution/codec seams. The localEdit path uses
scalar source terms as semantic sentinels, rejects direct member semantic edits,
checks retained count/name/timing against the pool, then strips member semantics
before committing the V3 snapshot. Geometry restores authored arc weights rather
than accepting numeric resolved weights. Activity is temporarily projected for
validation and explicitly restored; query metadata comes from source. Browser
R01–R03/R07/R08/R12 give concrete evidence at these boundaries.

The prior owner fixes for source validation/use diagnostics, file reference-field
comparison, and RNG/manual callback reentrancy remain in place in the inspected
source/reports. The callback fault-injection tests and native oracle were not rerun
here. The historical Manual browser cases passed, including focus restoration
and future-history handling; this does not establish every injected-callback case.

Limits: shared pool-to-pool and local-to-pool transport variants, transport identity
continuity beyond the browser's age/count/eligible-choice observations, direct
replay API and hostile forged bindings, every Random distribution, every inactive
namespace collision, unused-pool constant conflict variants, and every shared
query/clipboard race combination were not independently exercised in this new
browser suite. R13 samples weighted pool-to-local transport; historical token and
timed-network suites cover their existing local/disjoint cases. Document/view
regression tests passed except T6, but every view/tab/history permutation with
shared pools was not tested. No screen reader or mobile viewport audit was done.

Shared transitions, colored/game/stochastic execution, query execution, desktop
shared clipboard transfer and released 4.0.4 nonzero-age IO are explicit limits,
not newly discovered bugs. R09 confirms the relevant import refusals and visible
age warning. No flattening workaround was used. This review makes **no fresh
native GUI claim**. Visual comparisons use the already available native dialog
and simulation screenshots and the native source/design evidence.

## Screenshots and reproduction

Primary screenshots, all under `/tmp/tapaal-independent-shared-review-1029/final/`:

- `sharing-pane.png` — pool list, occurrences and constants.
- `pool-property-dialog.png` — count/ages/symbolic global properties.
- `adoption-preview.png` — explicit local/pool replacement preview.
- `canvas-local-edit.png`, `canvas-geometry.png` — membership and local editing.
- `simulation-inactive.png` — live shared pool versus frozen local view (F2/F3).
- `new-model-help.png` — retained F1 proof.

The new modal is readable and keyboard trapping/Escape work. The native reference
`native-dialog.png` also has a direct local-place “Make sh...” entry, matching the
web entry's discoverability. The web separates occurrence detachment and global
properties explicitly; that is coherent, though it adds a second dialog hop.

To reproduce, build a private development snapshot and serve its browser output
with a managed temporary static server, then run (from the repository root):

```sh
PLAYWRIGHT_CORE=/home/ubuntu/.cache/nub/pm/store/playwright-core@1.63.0-a8ac48ad88e9e7f8/node_modules/playwright-core \
CHROMIUM_PATH=/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
worker-job run shared-review-UNIQUE -- node web/scripts/check-shared-places-review.mjs \
  http://127.0.0.1:4429 /tmp/shared-review-UNIQUE
```

Read worker-job help/USAGE and check capacity/list before launching; stop the owned
server afterwards. `ONLY=R11-untimed-capacity-help` selects the retained failing
proof. Full invocation currently exits 1 for that expected outstanding finding.
