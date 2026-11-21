# Native TAPAAL design iteration — 28 October 2026

The brief was to make the Angular editor feel like native TAPAAL while keeping a comfortable web UI. Preserve the left tool rail, drag selection, undo/redo, validated modal editing and the untimed MVP scope. Do not restore the bottom analysis panel or add unsupported controls.

## Reference and method

Initial comparison used the [official editor screenshot](https://www.tapaal.net/screenshots/). Subsequent rounds used the current [TAPAAL 4.0.4 Linux release](https://www.tapaal.net/download/) running under a temporary virtual display. The native app successfully opened the Producer cycle `.tapn` exported from this web editor. Native and web screenshots therefore show the same net.

Ten sequential read-only feedback subthreads used Claude Opus 5.5, Claude Sonnet 5.5 and GPT-6 Astra. Changes were applied between reviews, followed by a final independent screenshot recheck. Scores are subjective design opinions, not usability measurements or feature-parity claims.

| Round | Reviewer | Evidence and feedback | Result |
| --- | --- | --- | --- |
| 1 | Opus 5.5 | Official native screenshot versus initial web editor: oversized grey symbols, redundant header rows, generic inspector. | Native 30px places and 10×30px transitions, black arcs, square grid, shorter chrome. |
| 2 | Astra | Revised canvas: substantially closer; fields looked like static values; Reset label crowded an arc. | Visible input borders, tighter groups, label adjustment. |
| 3 | Sonnet 5.5 | Property panel lacked the component hierarchy and had excessive single-field cards. | Components and a compact property sheet beside the preserved left rail. |
| 4 | Opus 5.5 | Current native 4.0.4: web branding/actions still dominated, file tab named the component. | Functional File/Edit/View/Draw/Simulator menus, compact toolbar, filename tab, neutral/blue selection. |
| 5 | Astra | Browser click timed out; capture showed the inspector, not the intended dialog. Reviewer explicitly caught this. | Inspector feedback retained; compact dialog and numeric affordances prepared. No dialog-parity claim from this capture. |
| 6 | Sonnet 5.5 | Second capture still showed inspector. Reviewer again declined to score unseen dialog. | Unified Marking wording, removed redundant heading; corrected capture procedure. Unsupported name-visibility suggestion not adopted. |
| 7 | Opus 5.5 | Confirmed open native/web dialogs: excessive header lines, wide number field, weak name focus. | Shorter dialog, right-aligned labels, narrow marking spinner, selected Name text, Cancel/OK. |
| 8 | Astra | Actual native/web context menus: useful actions; rows too airy and Delete insufficiently separated. | Tighter menu, darker shortcuts, separate Delete group. |
| 9 | Sonnet 5.5 | Actual native/web simulation: editing inspector remained visible; controls occupied a bottom strip. | Enabled Transitions, Simulation Control and Simulation History replace edit properties; red enabled transitions; no bottom strip. |
| 10 | Opus 5.5 | Much closer (3/10 initial → 7.5/10 revised), but labels differed and Fire started disabled. | Native label offsets retained in TAPN/JSON; below-left defaults; enabled transition selected automatically and Fire available. |
| Recheck | Astra | Final editor and simulation screenshots: clearly closer, no visual blockers (subjective 9/10). | Minor remaining polish: small/faint helper text and labels close to arrowheads. |

## Final implementation and checks

### Review subthreads

- [Round 1](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3Aea972f6f-37a9-425f-8353-4537449b1826)
- [Round 2](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3Aead86d79-d4c1-4241-bf7a-85f9b3252bb6)
- [Round 3](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A06569ee7-5055-49d2-b85c-0096ec900203)
- [Round 4](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A8c4a4005-1904-46b3-be33-91280cb23c55)
- [Round 5](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3Acc94bcb2-446e-4e2e-a0d9-92bbc2ae00fb)
- [Round 6](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A92b0793e-e03f-4293-be01-014f6fb35694)
- [Round 7](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3Aaed146b8-3411-41d1-b4e2-93ec77c229ae)
- [Round 8](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A240108e3-c687-4498-9b70-6711e28f6439)
- [Round 9](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A88260a84-e998-414e-b4f8-47341115ff8a)
- [Round 10](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A2318d2d0-a54a-44d5-b70a-a354e860ed0e)
- [Final recheck](t3-thread://v1/thread:delegated-task:command%3Amcp%3A1e1d205c-604e-4f3b-9241-47f5410dd141%3Adelegate-task%3A6bdf74f4-bf21-41fe-adcc-a8c482399a10)

### Validation

- Desktop command menus with arrow-key navigation, Home/End, and Escape focus restoration.
- Left tool rail retained; Components and quick-edit property sheet beside the canvas.
- Dialog drafts remain isolated until OK. Name text is selected after Angular initializes its value; Escape/Cancel restores focus. Numeric controls visibly support stepping.
- Native-sized black net geometry, square grid, below-left labels and preserved imported name offsets. Native/web font metrics and grid alignment can still differ.
- Simulation sidebar with enabled transitions, Fire, Back/Forward/Step/Reset, step/token counts and selectable history. History navigation restores recorded markings without firing or discarding future states.
- Responsive toolbar wraps at phone widths. A resize bug was fixed by observing the HTML canvas container rather than SVG drawing-space bounds.
- 127 tests pass; production build and formatting checks pass.
- Browser DOM/event checks: dialog apply/undo and selected Name text; menu keyboard focus; right-click actions; automatic enabled selection and Fire; two firings; backward/forward history jumps; unchanged initial marking; 390px layout without horizontal overflow; restored desktop canvas aspect ratio.
- All environments created for these checks were stopped after validation. No manual demo environment was requested.

## Saved screenshots

All captures are in [design/screenshots](design/screenshots/): `before.png`, `native-editor.png`, `web-editor.png`, `native-place-dialog.png`, `web-place-dialog.png`, `native-simulation.png`, `web-simulation.png`.

The design is closer to native, but remains a single-template, uncoloured untimed editor. It does not implement native verification, shared elements, multiple components, timing or colour.
