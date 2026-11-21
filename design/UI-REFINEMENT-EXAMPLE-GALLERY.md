# UI refinement and native example gallery

Baseline: `dc4714bd1`. Native resources remain authoritative and unchanged.

## Implemented

File → Example nets and the toolbar entry open a searchable family-filtered modal. Every native resource is copied byte-for-byte into `public/examples`; SHA-256, XML member counts, feature dimensions and actual `parseSharedModel` outcome are recorded in `example-catalog.json`. Unsupported entries are disabled with the exact parser reason and an original-file download. No semantic flags, constants, queries or unknown content are removed to obtain support.

Open uses the normal `offer` / `loadNetwork` flow: independent tab, preserved documents/history, warning confirmation, fit and title. Failed, cancelled and stale asynchronous loads never insert partial documents. Modal search focus, Tab wrapping, Escape and return focus are handled. Resource checks compare the complete source membership, copied bytes, licensing notice, counts and current parser outcomes. Run `npm run examples:update` from `web/` after deliberately changing native resources or parser support, then review the generated diff; `npm run examples:check` is read-only.

Component controls use quiet rounded buttons. Exactly one viewed component has an accent bar, stronger contrast and `aria-current`; active-network checkboxes remain separate and inactive components are labelled. Footer counts distinguish the viewed component from the network, count shared pools once as physical places and show active/total components. SVG groups suppress the browser outline while keyboard focus has a shape-specific dashed stroke; labels remain draggable.

Arc property weights accept text with declared-name suggestions and an explicit integer-or-name hint. The existing authored edit path retains symbolic terms and atomic paired transport weights. Display labels are separate from editable terms: integer 2 becomes `2x`, declared W becomes `W x`, literal 1 is hidden. Native `IntWeight.toString`, `ConstantWeight.toString(boolean)`, and the input/output/inhibitor/transport `updateLabel` methods are the source authority; inhibitor labels do not acquire an invented `<` prefix.

Middle-click in the Arc tool reuses the physical-Ctrl Quick Draw planner, alternating P/T and continuing from existing opposite-kind nodes with the same grid, naming and undo behavior. Creation happens on release; movement over four screen pixels remains panning, including out-and-back gestures. Pointer cancellation draws nothing. The Ctrl path and middle-drag in other tools/simulation remain available. This is a requested web convenience: native `PetriNetTab.AbstractCanvasArcDrawController` and `CanvasArcDrawController` use physical Ctrl. See `QUICK-DRAW.md` for exact source anchors.

## Source grounding and scope

`pipe/gui/GuiFrame.java:1752–1840` defines eight menu families from the timed/game/colored/stochastic lens. `loadTestNets` sorts by Java filename order with intro-example first and game-harddisk last; the catalog follows that family and filename order (intro first within its family). Labels retain native basenames. Native resource XML is read only; copies preserve distribution provenance in `PROVENANCE.txt` and the unchanged `tools/distribution-info/LICENSE.txt` notice.

Semantic codecs, simulation, schemas and native Java were read only. No colored/game/stochastic flattening or new claimed execution support. Existing HTTP IDs, strict file gates, query protections and asynchronous clipboard guards were retained.

## Inventory

12 openable, 17 gated, 29 total. Counts are raw XML place occurrences, transitions, arc elements and components; transport elements are not guessed into a semantic arc count. Network physical counts in the UI come from the authored model.

| Native file | Family | Web opening |
| --- | --- | --- |
| ERK.tapn | P/T nets | Missing or ambiguous node/arc ID A43. |
| home-construction.tapn | P/T nets | Openable |
| two-phase-locking.tapn | P/T nets | Openable |
| intro-example.tapn | Timed-Arc Petri nets | Openable |
| alternating-bit-protocol-components.tapn | Timed-Arc Petri nets | Openable |
| alternating-bit-protocol-transport.tapn | Timed-Arc Petri nets | Openable |
| alternating-bit-protocol.tapn | Timed-Arc Petri nets | Openable |
| fischer-protocol.tapn | Timed-Arc Petri nets | Openable |
| producer-consumer.tapn | Timed-Arc Petri nets | Openable |
| shortest-path.tapn | Timed-Arc Petri nets | Openable |
| train-level-crossing.tapn | Timed-Arc Petri nets | Shared transitions are unsupported. |
| webserver.tapn | Timed-Arc Petri nets | Openable |
| workflow-advanced.tapn | Timed-Arc Petri nets | Shared transitions are unsupported. |
| workflow-complaint.tapn | Timed-Arc Petri nets | Shared transitions are unsupported. |
| workflow-medical.tapn | Timed-Arc Petri nets | Shared transitions are unsupported. |
| workflow-payment.tapn | Timed-Arc Petri nets | Openable |
| workflow-simple.tapn | Timed-Arc Petri nets | Openable |
| package-delivery.tapn | P/T net games | Game nets are not supported (isGame="true" on feature "?"). |
| untimedGame.tapn | P/T net games | Shared transitions are unsupported. |
| game-harddisk.tapn | Timed-Arc Petri net games | Game nets are not supported (isGame="true" on feature "?"). |
| philosophers.tapn | Colored P/T nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| referendum-colored.tapn | Colored P/T nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| token-ring.tapn | Colored P/T nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| cpn-packet.tapn | Timed-Arc Colored Petri nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| referendum-timed-colored.tapn | Timed-Arc Colored Petri nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| euler-number.tapn | Timed-Arc Stochastic Petri nets | Stochastic nets are not supported (isStochastic="true" on feature "?"). |
| stochastic-consumer-producer.tapn | Timed-Arc Stochastic Petri nets | Stochastic nets are not supported (isStochastic="true" on feature "?"). |
| fair-coin-from-unfair.tapn | Timed-Arc Stochastic Colored Petri nets | Coloured nets are not supported (isColored="true" on feature "?"). |
| fireflies.tapn | Timed-Arc Stochastic Colored Petri nets | Coloured nets are not supported (isColored="true" on feature "?"). |

## Validation and gaps

Full suite: 1001 tests across 42 files passed. An integration test opens all 12 advertised supported originals through the normal warning/document pipeline. Production/development builds, TypeScript and formatting passed. Native-core browser: 16/16; documents: 16/16; constants: 17/17; shared UI: 22 assertions. Historical timed UI: 19/20 cases and 138/139 assertions; T05 reads `[aria-label="Time and token selection"] p` for ages, but ages now render under `[aria-label="Token ages"]`. Exact decimal arithmetic and the remaining timed checks pass. That historical script was left unchanged for the parent to reconcile. Gallery browser checks also passed real middle-click chains, middle-drag pan and physical Ctrl input. The 500 kB warning budget was retained: production initial bundle is about 657 kB; App CSS also warns above 20 kB. Neither warning threshold was raised.

`check-example-gallery.mjs` drives real Chromium input (no application method calls or signal writes): open native untimed/timed/constants/shared-component examples in independent tabs, disable unsupported entries without changing the workspace, assign a named constant, delay/fire, save and reopen initial state. Screenshots and JSON are in `/tmp/tapaal-gallery-evidence`. Historical native-core/documents/constants/shared/timed browser scripts are rerun separately, with individual outcomes recorded in the handoff.

Remaining semantic gates are listed above rather than softened. Query verification/editing, shared transitions, colored/game/stochastic execution, native automatic layout and complete semantic coverage remain parent-level work. Raw native examples may retain overlapping annotations and labels; this slice does not relayout bundled models. Gallery fetch cancellation ignores late results without inserting a document; it does not abort the underlying network transfer. Browser evidence uses the local Playwright fallback because the shared preview tool reported `available: false`.
