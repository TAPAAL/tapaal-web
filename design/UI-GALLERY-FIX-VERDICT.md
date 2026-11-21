# Independent bounded gallery fix verdict

2026-11-01. Candidate **4daa013670d1a8c1c97e1e1d7904783b3c777de6**, compared directly with **b2244be6be0c307d56af5cf4b87d4e31ae503ffa**. Independent Sol review; no delegates. Production, existing tests and harnesses remained read only. This report is the only repository addition.

## Verdict

**CODE: APPROVE. UI/UX: APPROVE, within this bounded scope.**

**0 P1 / 0 P2 blockers. Both prior P2 findings are resolved.** No additional feature work is required by this verdict. This supersedes the two request-changes findings in `UI-GALLERY-INDEPENDENT-REVIEW.md`; it does not claim full native parity.

## Findings checked

- **Modal focus:** `showExamples()` captures the visible File summary before closing its menu. Dismissal restores focus after Angular clears background inert state, with a canvas fallback and a guard against stealing focus from another modal. Opening an example focuses stable Search before disabling Open. Gallery visibility now makes the background inert, and the document key handler covers Escape and forward/reverse Tab even when focus reaches BODY. Fresh real-browser input passed toolbar return, actual keyboard activation of File and its Example nets action, summary return, stable Search during HTTP 503 and a held request, and 14 forward plus 14 reverse Tab presses in each state. A second run added real backdrop clicks that moved focus outside the gallery: Tab and Shift+Tab recovered containment and Escape dismissed from outside focus in both states. No application methods or signal writes drove these actions.
- **Count meaning:** the card explicitly displays `24 place occurrences`, with transition occurrences and arc elements. The opened alternating-bit-protocol-components model has 12 physical places, 16 transitions and four components (three active). The footer retains its explicit physical-place label. The card no longer presents raw XML occurrences as physical-place counts.
- **Preservation and gates:** no diff touches native resources, bundled originals or parser/core semantics. All 29 originals remain unchanged: **12 supported, 17 gated with parser-derived reasons**. All 12 supported originals freshly opened into independent tabs through the ordinary warning pipeline, saved, and reopened with equal complete parsed network data. Every opening preserved the dirty original document's network, past and future; reopened cursors were zero. HTTP 503 and cancellation preserved the workspace. For cancellation, the proof released the held response and awaited its completion before checking for late mutation.

## Fresh evidence

- `npx vitest run src/app/example-gallery-focus.spec.ts src/app/example-gallery.spec.ts src/app/example-catalog.spec.ts`: gallery files **10/10 passed** (including all three new regressions); catalog initially exceeded its default five-second timeout. An isolated `npx vitest run src/app/example-catalog.spec.ts --testTimeout=30000` then passed **1/1**, without source edits. This verifies membership, license/model bytes and hashes, raw counts, and actual parser outcomes.
- Full real-browser proof: **12/12 open/save/reopen comparisons**, keyboard menu/toolbar, count, loading/failure and workspace checks passed. Results: `/tmp/tapaal-fix-review-1630/results.json` (SHA-256 `c606fab4b8cfffeb21eb2c695c70ccd6b885b13fc0e03590882fe1e2f6c1447d`).
- Additional modal-only outside-focus proof exited successfully: `/tmp/tapaal-fix-review-1631-outside/results.json`. Its added BODY/Tab/Shift+Tab/Escape assertions are in `/tmp/tapaal-fix-review-1630-proof.mjs`, SHA-256 `5ee0b53dc453820a83533e6c2dddb60cf3aff1cb404353622fda19181e1cfff3`. This new scratch proof derives from the existing harness, replacing mouse menu activation with actual keyboard activation, adding bidirectional Tab and outside-focus assertions, and awaiting the late response. The full run preceded the added outside-focus assertions; the second run skipped model roundtrips and tested those additions. Existing harnesses were not edited.
- Shared preview returned **`"available": false`**. Fallback used the requested Playwright 1.63.0 store path and Chromium 1248 executable. Browser actions were real keyboard, mouse, file-input and download operations; `ng` access was read only for comparisons.

## Candidate binding and limits

Reused `/tmp/tapaal-gallery-modal-dev/browser` only after independently comparing **all 50 application source-map inputs, including app.html**, with current candidate files, checking CSS source-map inputs and checking every bundled example byte against `web/public/examples`. All matched. Bundle `main.js` SHA-256: `8e6a79989f532a9aecc35bfbce474f3cc6b34644bc6f71165a5a069bf8cc01a2`. Sorted tracked input manifest over `git ls-files web/src web/public web/angular.json web/package.json`, hashed as path + NUL + bytes + NUL: **137 files**, SHA-256 `a644edb22a6e19def8a5ef11af5ef45bd7105bd79d917c74b7571055a0d93a41`. HEAD remained the candidate throughout validation.

The original acceptance evidence for quiet rounded controls, current-component versus active-checkbox distinction, shape-based focus, native weight notation with separate editable terms/constants, and middle-click Arc chaining/pan/Ctrl remains bounded as described in the prior independent report. Those implementations are unchanged by this fix. This re-review did not repeat the earlier 20 timed browser cases / 139 assertions or expand their coverage. The owner's 1,004-test suite, type/format checks and development/production builds are owner evidence, not newly repeated results. Reported bundle/CSS warnings (657.60 kB against 500 kB; 20.31 kB against 20 kB) remain acknowledged with unchanged limits.

Roundtrips compare parsed authored networks, not every unknown XML extension or native Java execution. Assistive technology and every editor gesture were not exhaustively exercised. Shared transitions, colored/game/stochastic semantics and the other documented native feature gaps remain gated or outstanding; advanced shared-transition demos are subsequent work.

## Cleanup

The first separate browser reservation was refused with exit 75 and was not bypassed or reduced. Stopped the review-owned 512 MiB server, then ran foreground server and browser together within one managed 1 GiB job. Both successful browser jobs completed; each closed its browser and stopped its server, with worker-job cleaning the process tree. No review environment remains for handoff. No other session's workload was stopped. No commits, PRs, pushes or deployments were made.
