# Final independent recheck: game F1–F3 fixes

Reviewer: Opus 5.5, independent of the implementation. 2026-11-01. This recheck is bounded to the fixes for F1–F3 in
[GAME-ARC-LABEL-REVIEW.md](GAME-ARC-LABEL-REVIEW.md). It adds no new feature scope.

- **Reviewed head:** `d27d38ec83c0a2142e49da95d75963eb289f3196`
- **Previous reviewed head:** `4312dce7522e4627b8e4cf979885e00521ab6861`
- **Production delta:** 4 files, 9 lines: `editor-workspace.ts`, `authored-shared.ts`, `shared-transitions.ts` and `app.html`. The rest of the commit is docs, the review spec and the browser harness.

All code was read-only. This report is the only new file, and it is not committed. Nothing was pushed or deployed. No subagents or user demo were used.

## Verdict

- **CODE: APPROVE.** F1 is fixed correctly. No regression was found.
- **UI/UX: APPROVE.** F2 and F3 are fixed. Two non-blocking nits remain (N1, N2 below).

## Fix verification

| ID  | Fix at `d27d38ec8`                                                                                                                                                                                       | Independent check                                                                                                                                                                                                                                                                                       | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | `setTransitionUrgent` strips `actor` before the scalar `editElement` command (`editor-workspace.ts:540`).                                                                                                | Read the transaction path: the `localEdit` merge restores the source role. The inverted spec covers an in-memory Environment transition and a native-reopened Controller transition with an explicit actor. For each it checks: urgency set, role kept, `game` flag kept and one history entry. Passes. | Fixed  |
| F2  | The footer (`role="status"`) renders `notice()` in Simulate too (`app.html:1211`).                                                                                                                       | Browser run on my own dev build of this head. With nothing selected, Step and Fire leave cursor 0. The footer shows "Choose a Controller or Environment transition." The screenshot shows "Fired C.E." after a fire.                                                                                    | Fixed  |
| F3  | Game adoption label reads "urgency and player if they differ". The refusal reads "Pool urgency or player differs. Select the adoption checkbox to use this pool." Non-game text is unchanged in meaning. | Browser dialog text and refusal detail were captured. The refusal is atomic: the source is unchanged. With explicit adoption, the member joins and the pool's Controller role wins.                                                                                                                     | Fixed  |

## Evidence (this recheck)

All workloads ran under `worker-job run`, at 1 GiB unless noted, and finished and were cleaned up. `worker-job list` is empty.

- **Focused specs:** `game-label-review.spec.ts` plus `authored-shared.spec.ts`: **49/49 pass**.
- **Full suite:** **1,107 tests / 50 files pass** (2 GiB).
- **Typecheck:** `tsc -p tsconfig.app.json --noEmit` passes.
- **Formatting:** Prettier passes on all changed source, spec and harness files.
- **Build:** I built my own development bundle of this head to `/tmp/tapaal-recheck-d27d-dev` (2 GiB) rather than trusting `/tmp/tapaal-game-review-fixed-dev`. The first attempt was refused admission (exit 75); it was retried once after capacity freed.
- **Browser:** the preview tool was unavailable (`preview_status`: `available:false`). I used the real-input Playwright harness instead: `scripts/check-game-label-review-ui.mjs`, with `DEV_BUILD` pointing at my bundle. Result: **38/38 assertions pass**, no uncaught errors. Evidence is in `/tmp/tapaal-recheck-d27d-browser/results.json`, with screenshots.
- **Demos:** the run includes the three originals opened unchanged: `package-delivery`, `untimedGame` and `game-harddisk`. Each was saved after one step and kept its initial source, roles and queries.

**Not rerun:**

- the production build
- the separate 17-assertion label run
- the 87/88-arc native offset probe
- any native GUI

Those remain owner claims. As before, no claim is made about native Swing pixel layout or 4.0.4 nonzero-age IO.

## Unresolved findings (non-blocking)

| ID  | Severity                         | Where                                   | Repro                                                                                                                                                                                                                                                                               | Suggested fix                                                                                                                             |
| --- | -------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Nit (copy)                       | `shared-transitions.ts:254`             | In a game, open Make shared → Create pool. The text reads "Source urgency … transfers to the pool." `makeShared` also transfers the player, which the text omits. The previous review's F3 fix proposed this too.                                                                   | Mirror the detach text at line 237: `urgency{{ source().type.game ? ' and player' : '' }} transfer(s)`.                                   |
| N2  | Nit (UX), newly visible after F2 | `app.ts` `back()` / `resetSimulation()` | In Simulate, fire C.E. The footer reads "Fired C.E.". Press Back or Reset: the status still reads "Fired C.E." although the marking was undone. When you enter Simulate, the notice also repeats the static first footer span ("Simulation: click an enabled transition to fire."). | Set or clear `notice` in `back`/`forward`/`resetSimulation`, for example "Back to step n." Optionally drop the duplicated entry sentence. |

Neither nit affects semantics, files or roles. Neither blocks merge.

Out of scope, pre-existing and not part of this iteration: the shared-**place** `usePool` refusal (`authored-shared.ts:1051`) still says "explicitly acceptPoolValues".
