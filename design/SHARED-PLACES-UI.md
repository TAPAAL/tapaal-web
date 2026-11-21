# Shared PLACE workspace integration

Implemented 2026-10-29. This slice enables the bounded shared PLACE source, codecs
and execution core in the application. Shared transitions remain unsupported.
The source-backed scope and native limitations remain those in
[SHARED-ELEMENTS.md](SHARED-ELEMENTS.md), the foundation, file and simulation
reports, and their fixed owner follow-ups. No native GUI or released 4.0.4
nonzero-age file compatibility claim is added.

## Authoritative state and command boundary

Every workspace document is now `SharedDocument`, including New, old numeric files
and old scalar files. `openNetworkDocument` explicitly migrates V1/V2 through the
existing strict readers and `sharedFromAuthored`; malformed old payloads never
acquire sharing by migration. App opens/saves through `parseSharedModel`,
`serializeSharedJson` and `serializeSharedTapn`. New JSON saves intentionally use
V3 even for an empty pool list. JSON preserves exact IDs/references; native output
retains the shared codec's redundancy agreement and independent reopen checks.
There is no parallel pool store or V2 history beside source.

`SharedDocument` uses the existing generic `SnapshotDocument`,
`commitAuthoredSnapshot`, undo/redo and saved checkpoint discipline. Commands
validate the entire candidate and expected source identity before a single commit.
App retains its workspace-identity draft guards and source-generation ABA guard.
Session-only component/view changes preserve source identity. Authored edits,
constants and activation invalidate a run; changing component view preserves it.

`displaySource`/`numeric` in `editor-workspace.ts` derive disposable scalar canvas
and clipboard-placement inputs. These duplicate effective member values only for
display and existing clipboard naming/placement. They are never document snapshots,
codec inputs or shared execution inputs. `activeNet` supplies this canvas boundary.

The small required core extension is `SharedEdit.localEdit { edit: AuthoredEdit }`.
It reuses existing scalar source-command validation, with shared members acting as
semantic sentinels. Direct member property/invariant edits refuse. Retained member
name/count and timing must match their captured pool; only geometry is recovered
into geometry-only occurrences. Scalar timing sentinels are supplied from source
for add/paste validation, then stripped before final V3 validation/commit. Local
weights/bounds retain authored terms; existing geometry helpers restore arc weights
from source. Component copy goes through the existing shared copy command rather
than scalar cloning. Temporary scalar activity is used only to validate commands;
original/explicit activity is restored before final V3 validation, allowing removal
of the last active component. No numeric semantic projection is accepted as a
replacement source. The scalar document/model/clipboard cores, shared codecs and
execution cores remain unchanged.

`sharedTransact` exposes pool/membership commands with readable constant-use
locations. `transact` routes scalar intents to the guarded local-command adapter;
constant edits use shared uses/protections. Pool invariant uses appear exactly once
with `poolId` and active-member count, never synthetic component references.

## Usable workflows

`SharedPlacesPane` lives below Components, preserving the left tools and menus.
It lists name, authored initial count, symbolic invariant, occurrence count and
active-component count. New creates an unused declaration. Properties edits the
pool, including ages and constant-bound invariants. Delete unused is disabled
while occurrences exist; source/query guards remain authoritative. Occurrence
buttons select and fit the corresponding component view.

`shared-places.ts` owns isolated draft preparation, explicit source commands and
adoption comparison. `SharedPlaceDialog` offers pool properties, conversion/join
and detachment. Local properties expose Make shared / use existing pool. Joining
previews local and pool counts/ages/invariants and requires consent when their
source values differ. Tokens are never summed. Detachment suggests a fresh global-
namespace-safe local name and previews copying AUTHORED initial values. Removing
an occurrence removes incident arcs and both transport halves without deleting
the pool. Copying a component retains membership and one global initial marking.
A diamond label and independent outer ring identify members even with hidden names.
Quick local name/count controls are disabled for members; global properties remain
available. Canvas geometry, local nodes/arcs, annotations, labels, transitions,
constants and unrelated clipboard edits remain usable in shared models.

Saved queries conservatively protect symbols and membership. Conversion, detachment,
protected pool rename/removal and protected occurrence removal refuse until the
explicit Remove all queries action. Numeric/geometry edits remain allowed. Query
removal and every subsequent command undo independently. Dialogs validate without
closing on failure, isolate drafts, trap Tab, handle Escape, focus on entry/target
change, and restore focus on close. Workspace changes reject stale drafts.

## Simulation, files and clipboard

`DocumentSimulation` selects `SharedNetworkSimulation` whenever pools exist or all
components are inactive. Ordinary active no-pool networks retain the established
disjoint aggregate/timed sessions. Its revision type is an honest numeric/shared
union. Shared construction revalidates source; `assertRevision` checks the current
document against both the adapter and shared session before App actions.

Qualified local transition refs and arc IDs support Random, Oldest, Youngest and
Manual policies; display labels use pool names. Manual token identities remain
opaque. Timed delay uses the exact global clock and active invariant/urgency gates.
Unused/all-inactive pools age outside those gates; inactive local places stay
frozen. All occurrences, including inactive views, reflect the physical live pool.
The sidebar displays physical `totalTokens`, never a sum of repeated projections.
Untimed shared sessions expose no delay UI/operation. Capacity errors explain the
100,000-token execution limit and leave valid oversized source saveable. Saving
mid-run serializes complete authored initial source, not runtime marking/history.

The workspace clipboard gate rejects a selected shared occurrence OR any selected
arc touching one before encoding, system clipboard write, cut or duplicate.
Unrelated local subsets still use the unchanged v1/v2/v3 clipboard formats and
constant dependency closure. Global pool names, including unused/inactive pools,
participate in target name validation. Source validation prevents accidental name
binding/merging. Paste, including imported dependencies, commits one whole snapshot.
Existing recoverable cut, asynchronous race guards and earlier-state notices remain.
No desktop shared transfer or new clipboard envelope is claimed.

## Validation evidence

The new real-input `scripts/check-shared-places-ui.mjs` passes 22 assertions in
Chromium against a temporary managed development server. It covers pool creation,
source-only authority, membership glyph, adoption consent/preview, detach values,
copy/cut/duplicate clipboard refusal, target-change focus/Escape, actual V3 file
open, physical totals, dormant delay, manual pool-name binding, inactive live pool
versus frozen locals, cross-view history/time, and exact authored JSON mid-run save.
App state is inspected read-only; mutations use actual mouse/keyboard/file chooser
input. Evidence is in `/tmp/tapaal-shared-ui3-1029/results.json` and its screenshot.

Focused tests include shared workspace/source/history/protections, symbolic uses,
local/arc/layout edits, exact save fidelity, component copy, dormant/inactive/manual
simulation, untimed capacity/refusal, App pool constant conflicts/stale drafts,
and rendered dialog keyboard/consent/pane navigation tests. Existing integration
assertions were deliberately migrated to V3 with positive whole-source fidelity;
old scalar and numeric core codec gates stay strict. Final totals and regression
results are recorded below after validation finishes.

No manual demo was requested. The owned server is stopped after automated checks;
no commits, PRs, deployment, subagents or independent browser review are included.
The parent's independent browser review remains a separate release gate.

### Final results

- Managed full suite: **989 tests / 39 files pass**. App TypeScript check and full
  repository source formatting pass. Production build passes at **633.91 kB**
  initial total (baseline 578.87 kB); the existing **500 kB warning is unchanged**.
- Shared UI smoke: **22/22 assertions**. Rendered dialog/pane tests additionally
  exercise consent reset, keyboard trapping, target reset and occurrence navigation.
- Historical timed-network browser harness: 13/14 scenarios passed in the full
  run; N08 had an initial file-open locator timeout and passed all nine assertions
  in its isolated rerun. Together all 14 scenarios / 99 assertions pass.
  Evidence: `/tmp/tapaal-shared-history-1029/results.json` and
  `/tmp/tapaal-shared-history-n08-1029/results.json`.
- Historical constants browser harness: the full run passed 15/17 scenarios.
  C04/C05 exposed loss of the previous named constant diagnostics; the shared
  command now explicitly preserves those messages/protection guards. Both pass
  on rerun. Together all 17 scenarios / 203 assertions pass. The only harness
  expectations migrated are obsolete save-version assertions, strengthened with
  explicit empty pool lists and existing whole-source reopen equality.
  Evidence: `/tmp/tapaal-shared-constants-1029/results.json` and
  `/tmp/tapaal-shared-constants-rerun-1029/results.json`.
- Historical symbolic clipboard browser harness: **18/18 scenarios, 207/207
  assertions**, including recoverable cut, denied permissions, delayed operations,
  selection/component/document ABA, and accurate earlier-state copy notice.
  Evidence: `/tmp/tapaal-shared-symbolic-1029/results.json`.
- Native regressions rerun: **124 native / 124 web disjoint observations**, zero
  failures; **12 timed-network cases / 213 observations**; **79 shared cases /
  1,343 observations**, all pass. The shared oracle still substitutes only its
  documented GUI delay predicate and independently checks native invariant/urgency
  gates. This remains model age/multiplicity evidence, not GUI/Java-identity/age-IO
  parity. The codecs and execution production modules were unchanged.
- Owned jobs all completed/stopped; `worker-job list` was empty after final checks.
  No browser context/tab/server remains from this task.

### Changed files and APIs

| Files                                                                                                    | Responsibility                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/editor-workspace.ts`, `.spec.ts`                                                                | All-V3 document seam, `displaySource`, `isSharedOccurrence`, `sharedTransact`, pool-aware `constantUses`/`useLabel`, shared clipboard gate and source/history integration |
| `src/app/core/authored-shared.ts`, `.spec.ts`                                                            | Required `SharedEdit.localEdit` adapter; named constant protections/diagnostics; stale nested draft, symbolic local command and last-active-component removal proofs      |
| `src/app/timed-ui.ts`                                                                                    | Shared session dispatch, honest revision union, `assertRevision`, physical `totalTokens`, shared count/age/input/history/policy adaptation                                |
| `src/app/app.ts`, `.html`, `.css`, `.spec.ts`                                                            | Pane/dialog coordination, stale guards, file dispatch, membership display, pool semantics, totals, inactive labels, all-inactive regression                               |
| `src/app/shared-places.ts`, `.spec.ts`                                                                   | `SharedPlaceTarget`, `SharedPlaceDraft`, `sharedDraft`, `placePool`, `adoptionDiffers`, `sharedPlaceCommand`; integrated workspace/App/simulation tests                   |
| `src/app/shared-places-pane.ts`, `src/app/shared-place-dialog.ts`, `src/app/shared-place-dialog.spec.ts` | Focused native-oriented shared PLACE UI and rendered behavior tests                                                                                                       |
| `src/app/constants-editor.ts`, `src/app/constants-pane.ts`, `src/app/element-dialog.ts`                  | Constant parsing accepts the declaration interface; pool-use grouping/navigation; local properties sharing entry point                                                    |
| `src/app/core/authored-clipboard.spec.ts`                                                                | V3 workspace save/query integration expectations; production clipboard unchanged                                                                                          |
| `scripts/check-shared-places-ui.mjs`, `scripts/check-constants-ui.mjs`                                   | New real-input smoke; positive V3 save expectations in historical harness                                                                                                 |
| `design/SHARED-PLACES-UI.md`, `README.md`, `NATIVE-PARITY.md`, root `../README.md`                       | Workflow, state seam, evidence and bounded support documentation                                                                                                          |

Remaining release work is the parent's independent browser review. Shared
transitions, query execution, desktop shared selection transfer and native GUI
parity remain explicit unsupported scope; no corresponding gates were removed.
