# Timed UI browser and native file-IO validation

Independent validation on 2026-10-29 of the timed editing and single-component simulation UI
([TIMED-UI.md](TIMED-UI.md)), with native 4.0.4 file-IO observations for timed TAPN files.
Production files and existing tests were not changed.

**Result: every tested timed UI workflow behaves as designed (19/19 checks, 131/131 assertions).
The native file-IO check found two High interoperability defects (TV-1, TV-2) and confirmed
that released 4.0.4 drops nonzero initial ages (TV-3).** The historical harnesses pass apart
from two intermittent element-layout assertions that are traced to harness timing (TV-6).

## Snapshot and method

- Working tree at HEAD `28c9bd917` plus the uncommitted `web/` tree. Development build
  (`ng build --configuration development`) into `/tmp/tapaal-timed-ui-validation/build` under a
  finite `worker-job`. It was served by a 512M managed static server on 127.0.0.1:4391, stopped
  after validation.

  ```text
  main.js     ba1d854ce1c45ff27a759935c2e73ec2bca92fae4e8a51e67a02ec83ec32bb27
  styles.css  3d28c678f6f37a0d8e3cfaedcc982cbcb250f1821077fab0d93d2787df7ec7b2
  ```

- Browser input: `preview_status` first (it reported no available tab), then one owned shared
  preview tab at 1280×800. It covered timed New, drawing with keyboard tools and clicks,
  double-click dialogs, decimal-bound refusal, transport pairing with weight 2, real file-input
  uploads, and a rotation-undo recheck. One locator click on an arc hit path timed out; a
  coordinate double-click on the same arc worked. The tab was closed afterwards.
- `scripts/check-timed-ui.mjs` is the reusable harness. Like the historical harnesses, it uses
  Playwright with real mouse clicks/double-clicks, keyboard shortcuts, `fill` into focused
  fields, select controls, mouse wheel, the file chooser and downloads. Angular signals and DOM
  are only read; no App method or signal setter is called. The single page-evaluated write is
  `navigator.clipboard.writeText('SENTINEL')` in T15. It seeds the browser clipboard so the
  check can prove gated actions do not write to it.
- Fixtures are generated into the output directory and opened through the file chooser. Two
  first-run failures were harness errors and were corrected: component `net.name` must equal the
  network name, which the app refused with a precise message, and ages are normalized
  (`2.50 + 0.3` shows `2.8`).
- Native: released jars in `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib`, Java 17.
  The new `scripts/native-reference/TimedFileReference.java` loads files with the released
  `TapnXmlLoader` and prints components, markings with ages, invariants, urgency, arcs and
  transports. With `RESAVE_DIR`, it writes them back through the released
  `TimedArcPetriNetNetworkWriter`. Loading transports initialises Swing classes
  (`HeadlessException` from `TimedTransportArcComponent.updateLabel`), so it ran under
  `xvfb-run` in managed jobs. No frame, Animator or desktop click session was used.

## Findings

### TV-1 — Weighted transport arcs exported as TAPN load with weight 1 in native 4.0.4 (High)

- **Reproduce:** open `transport.json` (T08/T12 fixture: transport `R → W → S` with weight 2).
  Save TAPAAL file. The download has `weight="2"` on both halves `ri`/`so` and no
  `<hlinscription>`. Then run `TimedFileReference` on it.
- **Expected:** native keeps weight 2. The web model, file and simulation (T08) use weight 2.
- **Actual (4.0.4, observed):** `TRANSPORT R->W->S interval=[0,inf) weight=1`
  (`/tmp/tapaal-timed-ui-validation/native-io/observations.txt`). It opens with no message, so
  native would move one token where the web moves two.
- **Control (observed):** adding the native writer's `1'dot` `<hlinscription>` to each transport
  half of the same file keeps `weight=2` (`control-hlinscription.txt`).
- **Cause (source):** without an expression, `TapnXmlLoader.java:885-903` leaves `expr` null.
  `TransportArc(...)` (`TapnXmlLoader.java:1039,1083`) then calls
  `createNewInputArcExpression`, which runs `setWeight(new IntWeight(1))`
  (`TransportArc.java:46-48,197-204`). Ordinary input/output arcs create an expression without
  resetting weight (`TimedInputArc.java:45,175-181`, `TimedOutputArc.java:31,58-63`).
  The writer emits the expression for every arc (`writeTACPN.java:53-63`,
  `TimedArcPetriNetNetworkWriter.java:741`; observed in TV-2). Web export writes only
  attributes (`src/app/core/timed-files.ts:266-272`).
- **Root fix:** make TAPN export emit the native writer's dot-only declaration and expression
  scaffolding, at least for transport halves. That requires TV-2's importer change. Until then,
  refuse weighted-transport TAPN export with a JSON alternative rather than writing a file that
  native loads with different behaviour. Re-run `TimedFileReference` on a weight-2 transport;
  this check needs no new native fixture.
- EXECUTION-CONFORMANCE.md says loaded models keep their weight. That holds only when the file
  carries expressions.

### TV-2 — The web refuses files saved by the 4.0.4 writer, including plain untimed nets (High, pre-existing, not timed-specific)

- **Reproduce:** with `RESAVE_DIR`, `TimedFileReference` loads
  `/tmp/tapaal-native-reference/Producer_cycle.tapn` and writes it back with the released
  writer. That uses the same constructor arguments as the desktop save
  (`PetriNetTab.java:2115-2121`). Open `native-io/resaved/Producer_cycle.native.tapn` in the web.
- **Expected:** a native-saved uncoloured untimed net opens. The native feature says
  `isColored="false"`.
- **Actual (observed):** the error is
  `Coloured place types are not supported (in place "Idle" in component "Producer").`
  The workspace is unchanged. Resaved timed files (`T12-midrun.native.tapn`) are refused the
  same way. `control-hlinscription.tapn` is refused as
  `Coloured expressions are not supported (in arc "i" ...)`.
- **Cause:** the writer unconditionally adds a `dot` declaration, a `<type>` on every place, an
  `<hlinscription>` on every arc and, for timed nets, `hlinitialMarking`
  (`TimedArcPetriNetNetworkWriter.java:113,233,594,741`). The resaved Producer cycle has 3
  `<type>`, 6 `<hlinscription>`. The web's file contract (NETWORK-FILES.md:37) accepts the
  `dot` declaration but refuses those children (`src/app/core/network-files.ts:268-273`). The
  repository example nets predate this scaffolding, which is why earlier fixtures opened.
- **Root fix:** accept dot-only `type`, `hlinscription` and `hlinitialMarking` as
  uncoloured-equivalent only when they agree with `initialMarking`/`weight`. Keep refusing
  every other colour construct. Verify it with resaved native fixtures.
- **Evidence limit:** the files came from a headless writer call, not a desktop Save click.

### TV-3 — Released 4.0.4 loads nonzero initial ages as 0 and drops them on resave (Medium, documented limit now confirmed)

- The web TAPN file has `initialMarking="2"` with `<initialMarkingAge><token age="0.1"/>
<token age="2.50"/>`. 4.0.4 loads `PLACE P tokens=2 ages=[0,0]` without a loader message.
  Its resave contains no `initialMarkingAge` (count 0), so a web → 4.0.4 → save round trip
  loses the ages permanently. JSON is unaffected.
- Supporting evidence: the 4.0.4 `tapaal.jar` contains no `initialMarkingAge` string. Its
  classes are dated 2026-06-03, before `71bd04895` (2026-08-04). Tags `v4.0.0`–`v4.0.3` exist
  in this repository; there is no 4.0.4 tag. The HEAD loader was not built or run.
  Compatibility with a future release containing `71bd04895` is source-derived only.
- **Recommendation:** replace "Released 4.0.4 file IO is not validated" (app sidebar,
  README, TIMED-UI.md) with the observed fact. Warn when a TAPN save contains nonzero ages.
  JSON already preserves them.

### TV-4 — Blocked delay message does not name the blocker (Low)

The web shows `Delay blocked by an invariant or an enabled urgent transition.` Native
`reportBlockingPlaces` names the enabled urgent transitions or blocking places
(`Animator.java:819-840`). This is source-derived; no desktop capture shows it.

### TV-5 — Timed drawing conventions differ from native (Low, presentation)

These are source-derived; available native captures show only untimed nets. Web observations
are from `run3/T05-decimal.png` and DOM text.

| Element               | Native source                                                                                                  | Web                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Transport input label | `2x (1,3] : 1` (`TimedTransportArcComponent.java:105-162`, `IntWeight.java:22-28`); output `2x  : 1`           | `2 Transport 1 (1,3]`, output `2 Transport 1` (`src/app/app.ts:670-683`) |
| Unbounded interval    | `[0,∞)` with the default display setting (`TimedInputArcComponent.java:115-121`, `GuiFrameController.java:66`) | `[0,inf)`                                                                |
| Place invariant       | `Inv: <= 3`, hidden for `< inf` (`TimedPlaceComponent.java:497-500`)                                           | `<= 3`; `< inf` drawn under every place                                  |
| Token ages            | `Ages: {0.4, 2.8}` in the label and ages painted in the place (`TimedPlaceComponent.java:270-351,503-505`)     | Inspector/sidebar only, as documented; the place shows a count           |

The displayed age value matches native: `DecimalFormat` shows BigDecimal `2.80` as `2.8`
(`TimedPlaceComponent.java:119-121`).

### TV-6 — Intermittent historical element-layout assertions (harness timing, not a product defect)

`check-element-layout.mjs` failed 1 assertion of 58 in each of three runs: R1 "Rotation undo
restores both arc paths" in two runs, and N1 "Fit includes annotation and moved label" in one.
R1 reads paths right after Ctrl+Z without the `settle()` used by `state()`
(`scripts/check-element-layout.mjs:253-256`). A shared-preview recheck of the same input
(context Rotate +45°, Ctrl+Z) restored both paths exactly:
`M 175 240 L 315 241`, `M 325 240 L 485 240`. No expectation was rebaselined. Adding a
settle before the read would make it deterministic.

### TV-7 — Harness environment note

`check-native-core.mjs` ignores `CHROMIUM_PATH`. With playwright-core 1.63 it fails to launch
(headless shell 1243 is missing). It ran with playwright-core 1.50.0 and the installed
Chromium 1155.

## Timed UI checks (final run)

Evidence: `/tmp/tapaal-timed-ui-validation/final/results.json`, fixtures, downloads and
screenshots alongside.

| ID  | Workflow (real input)                                                                                                                                                                                                                                                                                        | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T01 | New untimed/timed via dialog select. Untimed has no timing or time section. Timed canvas is `Editable timed Petri net` with empty default timing and legal delay `[0,inf)`. Existing tab untouched.                                                                                                          | Pass   |
| T02 | Open timed JSON adds a saved tab; prior document unchanged; inspector `Initial ages: 0.1, 2.50`; invariant and interval drawn.                                                                                                                                                                               | Pass   |
| T03 | 11 place and 8 interval drafts refused with precise messages and no document, undo or dirty change: decimal, `< 0`, `>=`, 2^31, empty/reversed, `[0,inf]`, ages over count, `-1`/`1e2`/`.5`, invariant-violating age. Cancel discards. Valid edits commit once; one undo restores invariant, count and ages. | Pass   |
| T04 | Urgent with restricted input refused (`TAPNTransitionEditor.java:477`). Unrestricted urgent gives legal delay `[0,0]`; positive delay refused; zero delay recorded as `Delay 0` (matches `Animator.java:807-811`).                                                                                           | Pass   |
| T05 | `0.1 + 0.2` gives `0.3` exactly; `2.50 + 0.3` gives `2.8`. Delays `-1`, `1e-1`, `.5`, `abc`, empty refused without history change. Delay labels distinct.                                                                                                                                                    | Pass   |
| T06 | `[1,3)` vs `(1,3]` at ages 0, 1, 1.5, 3, 3.0001: none, T1, both, T2, none.                                                                                                                                                                                                                                   | Pass   |
| T07 | Ages 1, 2.5, 3.5, 5 with `[2,4]`: oldest eligible 3.5, youngest eligible 2.5. Default oldest; native defaults to Random (`Animator.java:182`), as documented.                                                                                                                                                | Pass   |
| T08 | Destination `<= 1` makes 2.50 ineligible, so 0.1 is transported. A weight-2 transport moves 0.5 and 1.5. Routes unchanged; both halves share the group label.                                                                                                                                                | Pass   |
| T09 | Pair + weight is one step; editing the output half's weight updates the input; undo restores both. Delete key on either half deletes both, and one undo restores pair, bends and interval. Deleting the transition and undo also work. Unpair keeps arcs; re-pairing copies weight only to the new partner.  | Pass   |
| T10 | After Back, an illegal delay is refused; cursor, ages and Forward are kept, and Forward replays. Native clears forward steps first (`Animator.java:802`); this intentional deviation is documented.                                                                                                          | Pass   |
| T11 | History `Initial marking / Delay 0.1 / Fire T / Delay 0.2`. Row jump, ArrowRight/Left, and a new delay after Back truncates the future. Reset restores initial ages and leaves only `Initial marking`. No document history entry.                                                                            | Pass   |
| T12 | TAPN before and mid-run are byte-identical. Saving keeps the run. TAPN and JSON carry initial ages and invariants and reopen with identical timing (JSON: identical graph). A decimal bound refuses TAPN with a JSON alternative; JSON keeps it.                                                             | Pass   |
| T13 | Switching tabs and New end a run; returning starts in Edit with initial timing. Closing a dirty timed tab asks; Cancel keeps it. Ctrl+Z during simulation changes nothing.                                                                                                                                   | Pass   |
| T14 | Two components (one inactive) refuse simulation with the exact component-count message. Editing Beta leaves Alpha (same local IDs) untouched. Copy component keeps timing. Whole network saves to JSON and TAPN (3 nets, inactive kept). After removals, the single component runs with ages `1.5, 0`.       | Pass   |
| T15 | Ctrl+C/X/D/V refused with the actionable message; document and browser clipboard unchanged. Edit-menu Copy and context Duplicate also refused.                                                                                                                                                               | Pass   |
| T16 | Timed TAPN with a saved query: renaming or deleting the query node is refused; a timing edit is allowed; the query is preserved on export.                                                                                                                                                                   | Pass   |
| T17 | Remove-token that would drop an age is refused; Add adds age 0; removing that token is allowed. Selected-place wheel adds age-0 tokens and refuses dropping recorded ages.                                                                                                                                   | Pass   |
| T18 | No edit-mode enabled highlight. In simulation, an age-0 token highlights nothing, and the message is "No transitions enabled now. A legal delay may enable a transition.", not deadlock.                                                                                                                     | Pass   |
| T19 | An output already in a transport is not offered as a partner. Changing a transport input to an inhibitor is refused. Urgent requires the destination `< inf`; a finite invariant on an urgent destination is then refused.                                                                                   | Pass   |

## Historical harnesses against this snapshot

| Harness                    | Result                                                           | Evidence (`/tmp/tapaal-timed-ui-validation/historical/`) |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `check-documents.mjs`      | **16/16**, including the updated timed-import opt-in expectation | `documents/results.json`, `documents.log`                |
| `check-native-core.mjs`    | **16/16** (playwright-core 1.50, see TV-7)                       | `native-core/`, `native-core.log`                        |
| `check-element-layout.mjs` | 57/58 in each of 3 runs; varying assertion, see TV-6             | `element-layout*/results.json`                           |

## Native file-IO observations (4.0.4, headless loader/writer under Xvfb)

All files are in `/tmp/tapaal-timed-ui-validation/native-io/`.

| File                                    | Observation                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `T12-midrun.tapn` (web)                 | Loads. Invariants `<= 1`/`<= 2` kept; both transports paired; ages `[0,0]` (TV-3); weight-2 transport becomes 1 (TV-1).                                            |
| `T14-multi.tapn` (web, 3 nets)          | Loads. Activity `true/false/true`; Beta urgent; invariants and `(1,inf)` transport interval kept; ages lost (TV-3).                                                |
| `control-hlinscription.tapn`            | The same as T12 plus native transport expressions: weight 2 kept.                                                                                                  |
| `fixture-query.tapn` / `T16-query.tapn` | Native refuses both: "One or more necessary attributes were not found". The hand-written query lacks native options. This is a fixture artefact, not a web defect. |
| `resaved/*.native.tapn`                 | The 4.0.4 writer adds the dot declaration, place `type` and arc `hlinscription`, and drops `initialMarkingAge`. The web refuses them (TV-2).                       |

## Evidence limits

- No desktop GUI session was driven; native observations are headless model-level loads and
  writes from the released jar. Source expectations are labelled as such. The only native
  screenshots are pre-existing untimed captures (`/tmp/tapaal-native-reference/*.png`).
- The HEAD native loader (with `initialMarkingAge`) was not built.
- Random token policy, manual token selection, timed shared/composed execution and verification
  are explicitly unsupported in this UI; they were checked only as gates.
- No unit tests, production build, typecheck or format check were rerun; the owner's 470 tests
  and 515.25 kB bundle warning are not independently confirmed here. The budget was not raised.
- The engine conformance (124 observations) is core evidence and was not rerun.

## Reproduce

Requires a served development build. From `web`:

```sh
PLAYWRIGHT_CORE=/home/ubuntu/.cache/nub/pm/store/playwright-core@1.63.0-a8ac48ad88e9e7f8/node_modules/playwright-core \
CHROMIUM_PATH=/home/ubuntu/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
  node scripts/check-timed-ui.mjs http://127.0.0.1:4391 /tmp/tapaal-timed-ui-validation/final
```

`ONLY=T08,T12` restricts the checks. The exit status is 1 on any failure.

Native IO (Java 17, Xvfb):

```sh
L=/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib
javac -cp "$L/*" -d /tmp/tfr scripts/native-reference/TimedFileReference.java
RESAVE_DIR=/tmp/resaved xvfb-run -a java -cp "/tmp/tfr:$L/*" TimedFileReference exported.tapn
```

The temporary server, managed jobs and preview tab were stopped or closed before handback.

## Owner follow-up — TV-1 / TV-2 implementation (2026-10-29)

TV-1 and TV-2 are fixed in the network file layer. The historical observations above describe
the pre-fix snapshot. `dot-expressions.ts` now checks the closed native dot-only shapes before
passing a stripped standalone copy to the legacy geometry reader. It does not evaluate or
flatten general colour ASTs. Unknown attributes/elements, custom declarations/constants,
duplicate or extra structures, multiple summands, foreign namespaces and conflicting marking,
coefficient or text values still fail before a network is returned.

Timed export emits the native dot declaration, dot place types, marking expressions above one
token, and matching `n'dot` inscriptions on every arc, including both transport halves.
Both expressions keep the native `TransportArc` constructor from resetting its actual weight.
Import also accepts the native constructor/writer default `1'dot` on a weighted arc: the
uncoloured weight attribute drives execution, so coefficient 1 with weight 2 retains weight 2.
Other mismatching coefficients are refused. Untimed export keeps the prior legacy-reader
compatible dialect; normal/inhibitor weights do not require expressions. Both importer branches
accept the released writer's redundant dot scaffolding. The single XML declaration,
`documentElement` serialization and whole-network canonical round-trip guard remain intact.

### Reproduction and native differential evidence

Re-ran the existing `web/scripts/native-reference/TimedFileReference.java` against the released
4.0.4 jars, under `xvfb-run` in finite 512M worker jobs. No desktop window or manual demo was
started. Fresh outputs/resaves are in `/tmp/tapaal-native-io-fix/`.

- Before: the original `native-io/T12-midrun.tapn` loaded
  `TRANSPORT R->W->S interval=[0,inf) weight=1`; the original expression control loaded weight 2.
- After: fresh `transport.tapn`, exported by the patched web serializer from the original
  T12 fixture, loaded `TRANSPORT R->W->S interval=[0,inf) weight=2`.
  `observations.txt` records this, the multi-component fixture's active flags/invariants/urgency,
  weighted untimed input 3/inhibitor 2, and the Producer cycle.
- Fresh `timed-weighted.tapn` loaded `INPUT Moved->Go interval=[2,inf) weight=3`,
  `OUTPUT Now->Block weight=5`, `INHIBITOR Block->Now weight=4`, and
  `TRANSPORT Start->Go->Moved interval=(1,5) weight=2` (`timed-weighted.txt`). Its query uses
  complete native options adapted from intro-example; the released writer resaved it as a
  formula AST with `Clock.Moved` and the comparison bound 2.
- A temporary automated differential check reopened four fresh released-writer resaves
  (`transport`, `multi`, `weighted`, `Producer`) through the web parser and verified named
  topology, weights, intervals, invariants, urgency, transports and component activity.
  Each resaved graph also passed an identical web export/reopen check. The temporary check
  was removed afterwards.
- Three permanent released-writer fixtures are copied into
  `src/app/core/test-fixtures/native-4.0.4/`: Producer_cycle and the original weighted transport
  control from the earlier evidence, plus the fresh weighted timed model with native query AST.
  Regression tests reopen and web-round-trip their full represented graphs, geometry/routes,
  timing and query metadata. The weighted control explicitly proves coefficient 1 / weight 2
  remains accepted. Mutation tests refuse 25 malformed/conflicting scaffolding variants.
- Existing timed tests still prove exact `0.1`/`2.50` age preservation alongside the new marking
  scaffolding, queries, inactive components, route curves and geometry; ordinary desktop
  examples and unsupported-input gates still pass.

### Verification and limits

- The focused regression command initially failed on both released-writer imports and missing
  transport inscriptions; it passes after the fix.
- Full `npm test`: **476/476**, 20 files, including **108 App tests**.
- Production `npm run build`: passes, **518.49 kB initial**, retaining the existing **500 kB**
  warning (18.49 kB over). The budget was not raised.
- `npm run format:check`: passes.
- **4.0.4 still drops nonzero ages to 0** and omits them on resave. HEAD support is established
  by source and web codec tests only; the HEAD Java loader was not built or run.
- The released loader/writer also regenerates node/inhibitor IDs, orders places before
  transitions, and snaps some geometry/routes to its grid. These native normalizations were
  observed during differential checks; an entire web → native → save graph is not claimed to
  be byte- or geometry-identical. The web preserves the geometry actually present in a native
  resave. Query preservation is metadata preservation, not verification.
- No browser harness was rerun in this file-layer follow-up. TV-3 App warning work and TV-6
  harness settling changes are outside these edits and were preserved. No App, HTML, CSS,
  App spec, other existing core module, historical script or native source was edited.
- All finite jobs completed and their process trees were cleaned up. No owned demo/server was
  started or left running; no commit, PR, deployment or delegated reviewer was created.

## Combined owner browser follow-up (2026-10-29)

Reran real-input Chromium checks on a fresh development snapshot after the TV-1/TV-2 codec
fixes, TV-3 age-loss UI notice, and TV-6 harness settling fixes:

- Timed UI: **19/19 checks, 132/132 assertions**, including a new assertion for the initial-age
  TAPN download warning.
- Native-writer browser import: **1/1 check, 5/5 assertions**. All three permanent 4.0.4 writer
  fixtures open through real file input without replacing existing tabs; both timed fixtures
  preserve weight 2 on each transport half.
- Documents: **16/16 checks**.
- Native navigation/Quick Draw: **16/16 checks**.
- Element layout: **7/7 scenarios, 58/58 assertions**, including rotation undo and fit.

Evidence: `/tmp/tapaal-final-recheck/{timed,native-writer,documents,native,layout}/results.json`.
The snapshot is `/tmp/tapaal-browser-final-build/browser`. The new permanent T20 browser case
is in `scripts/check-timed-ui.mjs`. Native core harness now accepts `CHROMIUM_PATH`, matching the
other harnesses. The timed harness opens the app root and lets Angular route to the workspace;
a discarded first attempt hit a static-server 404 at `/workspace`, before app interactions.
This was a test-server setup issue, not a product regression. No assertions were weakened.

The Playwright fallback follows the shared-preview input failures already documented in the
independent review. No new native GUI session was driven. The released native weight/IO
observations above remain headless loader/writer evidence. Nonzero ages still require a newer
loader; 4.0.4 loses them. The UI now states this for affected models and TAPN downloads.
The temporary server was stopped; all owned finite jobs completed. Source/build verification
remains the codec implementer's 476-test suite and production build, with the existing bundle
budget warning. Browser reruns do not claim full native feature parity.
