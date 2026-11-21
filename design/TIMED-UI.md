# Timed editing and disjoint network simulation UI

The UI explicitly opts timed-only networks into `openNetworkDocument` and `openDocument`.
New offers untimed or timed P/T nets. Opening adds a tab without changing an existing document.
Unsupported colour/game/stochastic/shared/constant content remains refused before workspace
mutation. `acceptPending` retains its catch/cancel/error path for warning imports.

## Source-grounded behaviour

Native source in this repository remains authoritative; the validated cores implement execution
and files. No core changes were needed for this slice. See [TIMED-FILES.md](TIMED-FILES.md),
[TIMED-SEMANTICS.md](TIMED-SEMANTICS.md) and [EXECUTION-CONFORMANCE.md](EXECUTION-CONFORMANCE.md).

- `TimeInterval.java:111` and `TimeInvariant.java:45` parse integer bounds or constants. UI
  interval/invariant edits accept integer literals 0–2147483647, with `inf` for an open upper
  endpoint. Validation delegates interval/invariant validity to the timed core. Existing JSON
  decimal bounds are retained unchanged if their field is untouched; TAPN export refuses them
  and recommends JSON. Decimal delays/ages never pass through JavaScript numbers.
- `TAPNTransitionEditor.java:477` requires unrestricted urgent inputs and no finite transport
  destination invariant. Atomic dialog commits enforce these rules through network validation.
- `Animator.java:800` permits zero delay and otherwise checks occupied-place invariants and
  enabled urgency. The sidebar displays `timedDelayInterval`, not future enabling intervals.
- `simulation/OldestFiringMode.java` and `YoungestFiringMode.java` order eligible tokens by age.
  The UI now defaults to Random, matching `Animator.java:77,182`; this intentionally replaces
  the previous web Oldest default. `RandomFiringMode.java` samples without replacement.
  Oldest and Youngest remain available. Transport eligibility
  includes the destination invariant; the core preserves transported ages and identities.
- `TimedArcPetriNetNetworkWriter.java:602` skips zero ages and writes nonzero ages as plain
  decimals. Place dialogs show the stored nonzero age prefix, with remaining marking implicit
  age-zero tokens. Values may include zero, which is canonicalized away. Counts and ages can be
  changed together. Nonzero ages require a loader supporting repository HEAD's
  `initialMarkingAge`; released 4.0.4 was subsequently tested and silently resets them to zero; 4.0.0–4.0.3 also ignore the extension. The UI warns whenever initial ages are present and on affected TAPN downloads.

## Editing transactions

`timed-ui.ts` is a UI adapter; timing validation stays in the existing document/core adapters.
`editTimedElement` constructs graph and timing drafts and calls `commitTimedComponent` once.
Place name, layout, count, invariant and ages are one undo step; transition urgency and ordinary
properties are one step. Saved-query node rename/delete guards remain active.

Input arc dialogs accept an interval and an output partner of the same transition. Draw both
normal halves before pairing. Pairing/unpairing and weight changes are atomic. Editing either
half's weight updates its partner. Each arc retains its original ID, bends and curved end.
Input dialogs remove pairing without deleting the ordinary arcs. Delete uses
`removeComponentElements`, so deleting either half or an incident node deletes both halves in
one undo step. Transport labels share a group number per transition. Invariants, intervals,
urgency and transport labels are visible on the drawing; ages appear in the inspector/simulator.

Generic graph edits use `commitComponentNet` reconciliation, so moves, names, bends, annotations,
rotation, hidden labels and token additions retain timing. Added tokens have age zero. A generic
removal that would discard nonzero ages refuses visibly and directs the user to the place dialog.
Invalid changes leave graph, timing, undo and dirty checkpoint unchanged.

Timed subnet copy, cut, paste and duplicate preserve model timing and layout in a typed version 2
web clipboard envelope, across components and documents, in one undo transaction. Touched transport
pairs require both halves and all endpoints; partial selections refuse with an actionable message.
Untimed → timed acquires defaults; timed → untimed refuses. Desktop timed clipboard transfer is
unsupported (native clipboard has no initial-age field); the visible notice identifies web-only
transfer. Simulation blocks model clipboard actions. See [CLIPBOARD.md](CLIPBOARD.md) for the exact
schema, native source evidence, strict validation and race/fallback behaviour. Untimed clipboard is unchanged. Component add/copy/rename/reorder/activation/removal retain timing
through existing document transactions, including in imported multi-component timed networks.

## Execution boundary and history

`DocumentSimulation` dispatches on the original network type. Supported timed networks enter `TimedNetworkSimulation`, including single-component documents.
The legacy `timedModelForNetwork` adapter still rejects multiple components. They never reach `NetworkSimulation` or
untimed enabling, including edit-mode highlighting. Untimed networks retain network-wide
active-component execution and inactive-view projection.

Disjoint active timed components share a global exact clock. The legal interval intersects occupied
active invariants and enabled urgency across the network. Inactive components retain frozen initial
ages for display, never fire, and never restrict delay. Duplicate local IDs and names do not share data. Exact
nonnegative plain decimal strings drive delay. The sidebar shows legal delay bounds and token
ages, and immediately enabled transitions remain distinct from future enabling. A marking with
no enabled transitions is labelled accordingly, without claiming timed deadlock.

Delay and component-qualified Fire history labels identify the action and global time. Back/Forward/jump replay snapshots; Reset
restores initial ages. A successful action after Back truncates the future; failed delay/fire
leaves cursor, marking and future unchanged. Document revisions invalidate simulation; changing
component views retains timed and untimed network history, while changing document tabs ends a run.
Simulation snapshots never enter document undo or saved markings. Save always serializes the
whole original network, including inactive components and initial ages, even mid-simulation.

## Remaining unsupported actions

- Shared timed execution and synchronization; verification/query editing.
- Desktop timed clipboard import/export; partial transport selections (explicit actionable refusal).
- Future transition-enabling interval unions, auto delay/firing and imported trace replay.
- Constants, colour, games and stochastic semantics; native decimal-bound export.
- General PNML dialects and legacy/single-element transport formats refused by the file adapters.
- Released 4.0.4 drops nonzero initial ages; retain web JSON or use a loader supporting initial token ages. Current HEAD support is source-derived.

Native integer geometry/count export limits, JSON-only transparent annotations, explicit-token
capacity and exact-decimal size limits still apply. Save errors remain visible with alternatives;
there is no lossy untimed fallback. Existing navigation, Quick Draw, arc bend tools, focused
inspector Ctrl+S, width-dependent annotation resizing and independent document histories remain.

## Validation

The later timed clipboard slice passed 499 tests and the production build (520.61 kB, existing
500 kB warning). Shared-preview keyboard copy/paste/cut/undo checked ages, invariants, strict
weighted transports and partial-pair refusal. See [CLIPBOARD.md](CLIPBOARD.md) for its evidence.
The earlier timed UI validation below remains the historical record for that slice.

Automated app, rendered dialog and UI adapter specs cover New/Open timing dispatch, integer
bounds/decimal JSON preservation, atomic transport pairing/weight/routes/delete/undo, urgency
and destination eligibility, oldest/youngest, exact decimal delay, failed-action immutability,
aged token display, replay/reset/branching, initial-state saving, component copy and inactive
execution limits, switching, and retained untimed network behaviour. Existing unsupported
coloured warning-import regression remains unchanged.

Validation on 2026-10-29:

- Full Vitest suite: **470/470 tests, 20/20 files passed** through `worker-job`.
- Production Angular build passed through `worker-job`. Initial bundle is 515.25 kB, producing
  the 500 kB budget warning (15.25 kB over); no build errors.
- Full `npm run format:check` passed through `worker-job`; focused strict TypeScript checks
  passed for the new adapter and timed/rendered-dialog specs.
- Shared-preview browser smoke used real controls/file input, with DOM-only reads and no App
  method/signal mutation. Confirmed timed New/Open; ages `0.1 + 0.1 + 0.2 = 0.4` and
  `2.50 + 0.1 + 0.2 = 2.8`; youngest firing with age-zero ordinary output; Back and blocked delay
  retaining Forward; transport pairing with separate routes; destination-invariant filtering
  (oldest eligible sends age `0.1`, retaining ineligible `2.50`); urgent-input refusal; an enabled
  urgent transition's legal delay `[0,0]`; deleting either transport half removes both, and Undo
  restores both; and byte-identical initial-state TAPN downloads before/after a simulation fire.
  Fixture, screenshot and observed results are in `/tmp/tapaal-timed-ui-check`; transient
  downloads were removed on preview close after the comparison. The verification server and
  preview tab were stopped.
- The existing document browser harness's timed-import expectation was updated from refusal to
  opt-in acceptance with prior-document preservation. Its complete historical suite was not rerun
  in this slice; independent browser regression review is still pending with the root agent.
- Native differential comparisons were not rerun: execution/file cores and their specs were
  unchanged. The existing 124 native observations and 3 properties remain core evidence, not
  evidence of native file IO for nonzero ages.

This is implementation validation; the root agent will commission independent browser review.

## Random and manual selection parity

Native authority: `Animator.java:941–962,976–1035`,
`AnimationTokenSelectDialog.java` and `RandomFiringMode.java`.
`DocumentSimulation` accepts an injected random source (default `Math.random`); the engine
validates each sample in [0,1), samples without replacement, and publishes only a complete
successful firing. Failed random/manual actions preserve the cursor and future snapshots.
Forward and Step when a future exists replay stored snapshots without asking for tokens or
sampling again. Initial marking and saved ages remain document data.

Manual drafts use `eligibleTimedInputs`, a detached read-only projection of the core's existing
`inputs()` computation. Source interval endpoints and transport destination invariants therefore
use exactly the firing eligibility rules. Inhibitors are omitted. The dialog groups checkboxes
by consuming input, shows ages and draft-local ordinal identities, and requires each exact
weight, including multiple inputs and weighted transports. Equal-age tokens remain distinct;
raw engine identities are not displayed. The engine revalidates bindings on Fire.

Web interaction choices: native skips its dialog when every choice is forced; web still shows
consuming inputs with forced selections prechecked and disabled so the complete atomic selection is visible. Native also disables forced choices.
Source/no-consuming-input firings are immediate. Cancel and Escape leave marking, cursor and
history unchanged. Native clears forward history before opening the dialog (Animator.java:745–760), so cancelling after Back loses the native future; the web deliberately preserves that future until a successful action. Focus starts in the dialog, Tab wraps through enabled controls, Escape cancels,
and focus returns on close. Dialog keyboard events and parent clipboard/global shortcuts are
isolated. Delay, reset, back, forward, history navigation, policy, mode and tab changes cancel
an open draft; document content, simulation identity and a monotonic generation guard reject
stale confirmations even after a cursor returns to the same position. Errors remain visible
without deleting future history. No future-enabling intervals are invented.

Shared/coloured/game/stochastic execution remains refused. Disjoint timed network execution is now supported through the new core. The UI uses the new timed network wrapper and its derived eligibility view; the underlying
single-model firing, delay and token allocation rules are unchanged.

Current selection validation (2026-10-29): shared preview browser used real file upload,
canvas/sidebar clicks, native policy selection, checkbox clicks, Shift+Tab and Escape.
The fixture had `(1,5)` input, `<4` transport destination, a weight-2 input with eligible
ages `2,2,3`, another weight-1 input, and an inhibitor. Only the five eligible choices
appeared in two groups; Fire stayed disabled until both counts were exact. Escape left
cursor 0 and one initial snapshot. Confirm moved both age-2 identities to the destination,
consumed the chosen second input, and Back/Forward replayed the same snapshot without a
dialog. The temporary server and both owned browser tabs were stopped/closed. Historical
browser harness totals above are prior baseline evidence; those full harnesses were not
rerun for this change. T07 now checks the Random default and explicitly selects Oldest
before its existing deterministic age assertion.

Final automated validation: 22 Vitest files / 518 tests passed; application TypeScript no-emit
check, production build and repository source format check passed through managed worker jobs.
Production initial size is 528.47 kB; the existing 500 kB warning remains and its budget was
not raised. No temporary jobs remain running. The asynchronous Cut selection capture and
selection-change cancellation regression tests remain passing.

## Timed network UI integration (2026-10-29)

`DocumentSimulation` dispatches supported timed documents directly to `TimedNetworkSimulation`.
It projects token counts and ages for the viewed original component, and adapts the global trace
without exposing private composed IDs. The sidebar shows exact global time and the intersection
of legal delay bounds; history records global time and qualified transition names. Enabled rows
retain component-qualified references even when local IDs or names repeat.

Manual drafts derive local consuming arc bindings and opaque global token identities through
`eligibleInputs(ref)` and resolve input/destination names against the origin component. A fire
from another view, including an inactive view, applies to that origin. Switching component views
cancels a draft but preserves the simulation identity, clock, cursor and history. Forward restores
snapshots without another token choice. Successful branching truncates the future; cancellation
and failed actions preserve it. Source revision changes and document navigation end the run.
Saves serialize every original component and initial age; simulation history is never migrated
into document state. The inactive frozen projection remains the documented native difference.

The implementation adds app coverage for three components with duplicate local IDs, active and
inactive age projections, exact 0.1 + 0.2 time, cross-view weighted manual transport, qualified
selection/Step, remote invariant and urgency constraints, history/branch/reset behavior, whole
initial-network saving during a run, revision invalidation and unsupported flag refusal.
See [TIMED-NETWORK-SIMULATION.md](TIMED-NETWORK-SIMULATION.md) for the unchanged core contract
and released-native differential evidence. Validation for this integration: **547/547 tests in 23 files**, application and owned-spec TypeScript no-emit,
production build and repository source format check passed through managed jobs. Production
initial size is **534.66 kB**; the existing 500 kB warning remains and the budget was not raised.
The token-selection pure harness passed **5/5 checks, 37/37 assertions**, including its new
positive multi-component execution assertion. Browser harness labels/API reads and the old
T14/B12 refusal expectations were updated; those full browser harnesses were not rerun here.

Shared-preview smoke used real file input, mode/policy selection, exact delay fields, component
rows, enabled-row double-click, manual Fire and Back/Forward buttons; DOM reads only, without
App methods or signal mutation. A three-component fixture with duplicate local IDs confirmed
0.1 + 0.2 = global time 0.3, active ages 0.4/2.8, inactive ages frozen at 0.1/2.5, global
enabled Alpha.T/Beta.T, legal interval [0,0.2], a weighted Beta transport with the correct
ages, qualified Fire Beta.T history, and Forward from an inactive view without a new dialog.
Fixture and pure-harness evidence are in `/tmp/tapaal-timed-integration`. Independent browser
review remains for the root agent. Core files and the legacy adapter were untouched; the
213 native observations supplied by the root were not rerun in this UI slice.
