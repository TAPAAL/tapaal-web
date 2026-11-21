# Independent Sol/high review — native example gallery

## Owner follow-up

Both findings are fixed. Opening from File captures its visible summary before
closing the menu, and restores it after the modal/background inert state clears.
Selecting an example focuses Search before disabling Open, keeping keyboard focus
stable during loading and failed fetches. The background is inert while the gallery
is open; Escape and Tab remain handled even if focus is lost outside the panel.
Card statistics now explicitly say place/transition occurrences and arc elements.

Three regression tests cover menu return focus, loading/error focus and occurrence
labels. All **1,004 tests / 43 files**, typecheck, formatting, and production and
development builds pass. Initial bundle is **657.60 kB** and App CSS **20.31 kB**;
the existing warning budgets remain unchanged.

The independent browser harness now asserts its keyboard observations instead of
only recording booleans. A complete owner rerun passes all 12 original model
open/save/reopen comparisons and the menu, toolbar, delayed/failed-fetch Escape/Tab,
workspace preservation and count-label checks. Evidence:
`/tmp/tapaal-gallery-modal-final/results.json`. The temporary server is stopped.
The previous timed harness selector correction is validated by the independent
20/20 timed checks below; it does not relax the age equality assertion.

This follow-up records owner fixes and verification, not a fresh independent
approval. Original findings and their bounded evidence remain below.

Review date: 2026-11-01. Baseline `dc4714bd1`; candidate `b2244be6be0c307d56af5cf4b87d4e31ae503ffa`. Production/native sources and existing harnesses were read only. The parent-owned timed harness selector correction was included; no production fixes, commits, pushes, deployments or delegates were made.

## Verdict

**CODE: request changes for modal focus handling.** No model-data regression found in the tested cases. **UI/UX: request changes for modal keyboard behavior and ambiguous gallery counts.** These are bounded findings, not an aesthetic redesign request or a claim of full native parity.

## Findings

### P2 — Keep focus inside the gallery across loading/error states and restore a visible trigger

Locations: `src/app/example-gallery.ts` (disabled Open buttons and host-only key handler), `src/app/app.ts:2491–2501` (capture/restore), `src/app/app.html:1` (background inert conditions).

Reproduce with real browser input: open File → Example nets, wait for the search input to receive focus, then press Escape. Focus ends on BODY, rather than the visible File summary. The captured menu action is inside the now-closed details element and cannot receive visible focus. Toolbar entry → Escape restores focus correctly.

Second reproduction: intercept `examples/home-construction.tapn` with HTTP 503, search for home-construction and click Open. After the error is displayed, press Escape. The gallery stays open and focus is BODY. The clicked Open control is disabled during loading, losing focus; enabling it after failure does not restore focus. The gallery handles keys only on its own host, and the background is not inert while the gallery is open. A keyboard user loses the promised Escape behavior and modal focus containment. The visible Close button remains usable, and the failed fetch did not change the workspace.

Minimal fix: capture a visible return target before closing a menu (its summary for menu actions), retain/move focus to a stable modal control when disabling Open, and include gallery visibility in background inert/focus containment. Test keyboard return from both entry points and Escape/Tab during a delayed and failed fetch. No semantic/parser change is needed.

### P2 — Identify gallery statistics as XML occurrences

Location: `src/app/example-gallery.ts:51–52`.

Reproduce: search for `alternating-bit-protocol-components`. Its gallery card says **24 places**. Open it; the network footer correctly says **12 physical places**, 16 transitions, 4 components (3 active). The original has 24 `<net><place>` occurrences, including 16 occurrences of four shared pools: `24 - 16 + 4 = 12` physical places.

Impact: the gallery uses an unqualified model count for a different quantity from the physical network count, contrary to the explicit requirement to distinguish them. The generated data and footer calculation are correct.

Minimal fix: label these card values “place occurrences” and, where applicable, “transition occurrences”; retain “arc elements” or explicitly call the whole line raw XML statistics. Alternatively add a separately computed, clearly named physical count. Do not silently reinterpret transport XML element counts as semantic arc counts.

## Independent evidence

- `npm run examples:check`: **1/1 test passed**, read-only. Checks complete native membership, identical copied bytes, SHA-256, license bytes, raw XML counts and actual parser outcome. Native Java/resources have no diff from the baseline.
- Focused `example-gallery.spec.ts` + `app.spec.ts`: **141/141 tests passed**. Includes all supported originals through normal offer/load warnings, failed/malformed fetch, cancellation and stale workspace guards. Stale-workspace mutation is a unit-level check; not a browser-proven concurrent-human-edit scenario.
- Full existing `check-timed-ui.mjs`, with only the parent's selector correction: **20/20 cases, 139/139 assertions passed**. T05 exact decimal age assertion passes. Includes weighted transports, paired atomic edits, initial-state save/reopen, query protections and timing/history behavior. No semantic assertion was relaxed.
- New `scripts/check-gallery-review.mjs`: real mouse/keyboard/file-input/download actions, application signals read only. **12/12 advertised examples opened independently and saved/reopened with equal complete parsed network data**, including initial timing/constants/shared declarations and stored query data present in that network. Every open preserved a dirty original document's network/past/future. Reopened cursor was zero. Existing parse/offer/warning confirmation was used; no direct application calls or signal writes.
- All 12 successful comparisons are recorded in `/tmp/tapaal-independent-review/gallery/results.json`, with downloaded TAPNs in that directory. A subsequent modal phase of that run stopped because a menu key was sent before modal focus had settled; it is not counted as a model-open failure. A separate modal-only run waited for actual search focus and independently demonstrated the focus findings. Its completed stdout observations are preserved in `/tmp/tapaal-independent-review/modal/completed-proof-observations.json`. A later retry raced with server cleanup and failed connection setup, overwriting the scratch modal results/screenshot; that attempt is not counted as a product failure.
- Modal-only checks verified initial search focus, disabled unsupported referendum entries, toolbar focus return, failed-fetch workspace preservation and delayed-fetch cancellation via the visible Close button. Probe output records focus/closure observations; a zero probe exit does not mean its false keyboard observations passed acceptance.
- Independent development build passed to `/tmp/tapaal-independent-review/dev`. Full 1001-test suite, production build, types/format and historical native-core/documents/constants/shared harness totals in the implementation report were **not independently repeated** here. Their claims are not promoted to new review results. Existing 500 kB and 20 kB warning budgets are unchanged; no threshold increase is endorsed.

The shared preview tool returned `available: false`. Browser fallback used `/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core` and `/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`. Qualifying builds/browser jobs and servers used worker-job. Capacity refusals were respected. Review-created browser contexts were closed in finally blocks. All review-created servers/jobs are stopped or completed. Final worker-job listing contained only other sessions' IPC jobs, which were preserved.

## Native grounding and limits

Read native `GuiFrame.buildExampleMenu` / family construction, `IntWeight.toString`, `ConstantWeight.toString(boolean)` and timed input/output/inhibitor/transport label implementations. The changed weight renderer follows the requested native integer `2x`, named `W x`, hidden literal-one convention, including inhibitors without an invented `<` prefix. Editable terms remain separate from display text. Production diff retains the authored edit path; timed browser checks prove paired transport weight atomicity. Exhaustive symbolic assignment through every arc dialog was not independently browser-tested in this review.

Component controls now have a distinct selected style and `aria-current`, separate from network-active checkboxes. Focus CSS targets node shapes rather than the enclosing SVG group's bounding box. Qualitative screenshot inspection found quiet rounded controls and a readable gallery. Keyboard-driven node-shape focus, all label/arc drag combinations, middle out-and-back pan, real pointer cancellation, every zoom/grid/high-water combination and assistive technology were not all independently browser-exercised. Middle release/cancel and native undo behavior have focused app-test coverage; this is not a blanket runtime parity claim.

Inventory remains **29 unchanged originals: 12 openable, 17 explicitly gated**. Two P/T examples and ten timed examples open. Shared-transition support blocks `train-level-crossing`, `workflow-advanced`, `workflow-complaint`, `workflow-medical`, and `untimedGame`. Eleven more are blocked by colored/game/stochastic family semantics; ERK is separately blocked by ambiguous/missing node/arc ID A43. No flag stripping or semantic flattening was found in the gallery path.

Highest remaining native gaps are synchronized shared transitions, colored/game/stochastic semantics, query editing/engine verification/result/trace workflows and native automatic layout. The existing parser restrictions remain meaningful gates; this gallery does not implement those features. Source+reopen tests compare parsed authored models, not a native Java GUI execution of every example or an exhaustive proof of preservation of all unknown XML extensions.

## Source binding

HEAD at validation: `b2244be6be0c307d56af5cf4b87d4e31ae503ffa`.

Tracked input manifest over sorted paths returned by `git ls-files web/src web/public web/angular.json web/package.json`, each hashed as path + NUL + bytes + NUL, **136 files**: SHA-256 `f2273177855bade41bdbe969e0a39b7e3456a4db79d018794941ba8af6722ca3`.

Parent-owned timed harness working-tree SHA-256: `99e202d0fcbd3eeac4f9799651f34b17e2d8496f2b19070a207084d9ab086a54`. Its sole diff changes the ages selector from `[aria-label="Time and token selection"] p` to `[aria-label="Token ages"] p`.

Review-owned additions: this report and `scripts/check-gallery-review.mjs`. No hard documented coding-standard violation was identified in the bounded production diff; the two acceptance findings above remain open.
