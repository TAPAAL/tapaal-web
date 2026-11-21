# Network files

`src/app/core/network-files.ts` is a tested whole-network file layer for the `Network` type in `documents.ts`. The legacy `files.ts` contract does not change: it still opens exactly one active component and saves one `Net`. This module reuses `parseTapn`/`serializeTapn` for each component.

## Rule: open exactly or refuse

The importer accepts only native content that `Network` can represent and write back unchanged. Anything else causes a precise `Error`. The importer never imports a model while dropping content and adding a vague warning. `warnings` only reports malformed input that was repaired. Currently that means the legacy parser's duplicate-arc-ID repair and its single-point arc-path repair, prefixed with `Component <name>:`.

## API

| Function                                | Contract                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseNetworkModel(source, filename?)`  | Auto-detect: text starting with `{` is JSON; anything else is TAPN XML. Returns `{network, warnings}`.                                                                             |
| `parseNetworkTapn(source, filename?)`   | Native multi-component TAPN, including single-net files from the legacy web writer.                                                                                                |
| `parseNetworkJson(source)`              | `tapaal-web-network` v1 exactly, or legacy `tapaal-web-untimed` v1 migrated to one active component.                                                                               |
| `serializeNetworkTapn(network)`         | All components in explorer order with their `active` flags, then one `k-bound` and one `feature`. Reopens its own output and refuses to write it if the canonical content changes. |
| `serializeNetworkJson(network)`         | `{format: 'tapaal-web-network', version: 1, network}` exactly. Component IDs survive.                                                                                              |
| `tapnComponentId(name)` → `tapn:<name>` | Deterministic component ID for TAPN and legacy imports. It cannot collide with the UUIDs from `documents.ts`, and template names are unique.                                       |

Every parse and serialize call validates the network. Untimed and supported timed networks are represented without dropping their type or timing; at least one component must be active. Inactive components are kept and never removed. The default application gate still refuses timed editing/execution until its UI explicitly opts in. The allowlist below describes the untimed branch; see [TIMED-FILES.md](TIMED-FILES.md) for timed intervals, invariants, urgency, transport pairs, initial token ages, and the single-component timed-engine adapter.

## Names and identities

- **Title:** `Network.name` and every `Net.name` come from the root `<pnml name>`, which the web writes and desktop ignores. Without it, the title is the filename stem, or `Imported model` if the stem is blank.
- **Component identifier:** `Net.template` comes from `<net name>`, falling back to `id`, like `TapnXmlLoader.getTAPNName`. If `name` and `id` are both present and differ, the import is refused. The writer uses `id` only. The identifier must also pass the native `isNameAllowed` check (a leading letter) because desktop would otherwise rename it silently. JSON still allows a leading `_`.
- **Local element IDs and names:** these may repeat across components and are kept as they are.

## Accepted TAPN (allowlist)

Outside saved-query subtrees, element namespaces must match the root: either the ptNetb namespace or no namespace. Namespace declarations themselves are ignored. Text other than whitespace (except annotation and validated dot-scaffolding text), comments, CDATA, processing instructions, and DOCTYPE/entities are refused.

- `pnml`: `name`. Allowed children:
  - `net` (one or more)
  - `query` (opaque preservation, described below)
  - exactly one `feature`
  - at most one `k-bound bound=<n ≥ 0>`, which desktop also ignores; the writer writes `3`
  - at most one `declaration` that contains only the native default `dot` sort, or no sorts
- `feature` (untimed branch): `isTimed="false"` is required. `isColored`, `isGame` and `isStochastic` must be absent or `"false"`.
- `net`: `id`/`name`; `active` must be `true` or `false` (absent means `true`); `type` must be `P/T net` or absent. Allowed children: `labels`, `place`, `transition`, `arc`.
- `place`: `id`, `name`, whole-number `positionX`/`positionY` (required), whole-number `nameOffsetX`/`nameOffsetY` (an absent offset becomes 0, as in native), `initialMarking` (required, 0 to 2,147,483,647), `invariant` matching `< inf`, `displayName` `true`/`false` (case-sensitive, as native only hides on exactly `false`).
- `transition`: the same geometry and name attributes as a place, plus these attributes, each only with its default value:
  - `angle`: any whole number (`Integer.parseInt` syntax, 32-bit); stored as native `angle % 360`
  - `infiniteServer="false"`, `priority="0"`, `urgent="false"`, `player="0"`
  - the native writer's stochastic defaults: `weight=1`, `firingMode="Random"`, `distribution="constant"`, `value=1`
- `arc`: `id`, `source`, `target`, `type` (`timed` or `tapnInhibitor`/`inhibitor` from a place; `normal` from a transition), and `weight` (1 to 2,147,483,647, no constants).
  - Input arcs: `inscription` must be absent or `[0,inf)`. Output arcs: absent or `1`.
  - Arc label offsets must be 0.
  - Allowed children: whole-number `arcpath` points with `arcPointType` `true`/`false` (case-insensitive). The first and last points are automatic anchors; the interior points are bends.
- `labels` (text annotations): `positionX`, `positionY`, `width`, `height` as whole numbers 0 to 2,147,483,647 or empty (empty and absent mean 0), `border` `true`/`false` (case-insensitive; absent means true), and text content only — no child elements, comments or CDATA. See design/ELEMENT-LAYOUT.md.

In the untimed branch, refused with a specific message: constants, shared places and transitions, custom distributions, nontrivial colour declarations and expressions, transport arcs and legacy `inputArc`/`outputArc`/`inhibitorArc` elements, token ages, non-dot place types and guards, timed invariants and intervals, fractional angles, negative or fractional annotation geometry, urgency/priority/game/infinite-server/stochastic values other than the defaults, moved arc labels, fractional or exponential numbers, missing required attributes, and any unknown element or attribute. The real `two-phase-locking` and `home-construction` examples open with their saved queries intact.

### Redundant native dot scaffolding

The released 4.0.4 writer writes colour-shaped XML even with `isColored="false"`.
`dot-expressions.ts` accepts only these redundant forms, on timed and untimed networks:

- A place `type` has exactly `text` equal to `dot` and `structure/usersort declaration="dot"`.
- A `hlinitialMarking` or `hlinscription` has exactly a matching `text` (`n'dot`) and
  `structure/numberof`, with two `subterm` children: `numberconstant value="n"/positive` and
  either `dotconstant` or `useroperator declaration="dot"`. A marking may wrap that one
  numberof in `add/subterm`, as the native loader/writer does for plain markings above 1.
- A marking coefficient must equal `initialMarking`. An arc coefficient must be positive and
  either equal its `weight` (default 1), or be the native constructor's default 1. Native
  uncoloured execution uses the weight attribute: **`1'dot` with weight 2 means weight 2**,
  including transports when both expressions are present. It is not flattened to weight 1.
- Counts are canonical nonnegative decimal integers within the native 32-bit range. Every
  attribute, namespace, text value, child count and wrapper is checked. Duplicate dependencies,
  multiple summands, extra structures/subterms, foreign namespaces, custom sorts, constants,
  guards, other operators, hidden text/comments/CDATA and conflicting values are refused.

Only after validation are these dependencies removed from a standalone copy for the legacy
geometry reader. The original network and queries are never stripped. Export uses full dot
scaffolding for timed networks (including matching coefficients on every arc); untimed export
keeps its existing legacy-reader-compatible dialect, whose normal/inhibitor weights load
correctly without expressions. Import supports either dialect. This is not general colour
expression support.

**Change from legacy:** the legacy parser opens fractional positions and truncates fractional bends. Network import refuses both.

## JSON

The shape is closed: unknown keys at any level are refused, including `__proto__`. Optional fields are written exactly as stored. JSON has no 2,147,483,647 limit and allows fractional geometry.

## TAPN export restrictions

Desktop truncates node positions and label offsets to integers and parses markings and weights as 32-bit integers. Export therefore refuses these cases, and the user should snap the elements or save JSON instead:

- fractional coordinates, label offsets, bends or annotation geometry
- annotations at a negative position (the writer would save `""`) or with a transparent background (desktop never saves it)
- values above 2,147,483,647
- unknown fields, including fields added by future UI features
- unsupported types or identifiers

Fields left out of the XML are the endpoint anchors and the defaults `nameOffsetX 0`, `nameOffsetY 35`, `bends []` and `curvedEnd false`. The self-check treats each default (also `nameVisible true`, `angle 0`, annotation `border`/`filled` true) as equal to an absent field. Annotation IDs are not written; the self-check compares annotations by order, so a reopened file renumbers them `annotation-1…n`.

## Integrating with the document UI

1. Open: `const {network, warnings} = parseNetworkModel(text, file.name)`, then `openDocument(workspace, openNetworkDocument(network, {saved: true}))`. Show any warnings. On error, keep the current state and show the message.
2. Save: call the serializer on the exact `doc.network` snapshot being written. If it throws, offer JSON. Call `markSaved` only after the UI's file contract accepts the write of that snapshot.
3. Use `.tapn` for `serializeNetworkTapn` and `.json` for `serializeNetworkJson`. Legacy single-net save and open paths can switch to this module once the UI shows components. Do not export only the active component under a network filename.
4. Grid-off dragging can produce fractional node centres (`snapNodeCenter` with spacing 0), which TAPN export will refuse. Either round node positions on commit, which is what bends already do, or present JSON as the alternative.
5. Component IDs from TAPN are `tapn:<name>`. After renaming, a reopened file gets the new derived ID. Use JSON when IDs must persist across sessions.

## Verification

`network-files.spec.ts` (jsdom) covers:

- a native-shaped two-component file with overlapping local IDs and names, an inactive component, a dot declaration, stochastic defaults, label offsets, and straight and curved bends
- native default attributes
- titles and identifiers
- repair warnings
- malformed feature, active, identity and structure
- numeric syntax and bounds
- more than 35 kinds of unsupported content
- real desktop examples
- export order, active flags and a single feature
- reopening after rename, copy, reorder, activation, edit and undo
- export refusals
- JSON round trips, legacy JSON and TAPN migration, and closed-shape rejection

Released-writer fixtures in `src/app/core/test-fixtures/native-4.0.4/` cover Producer_cycle,
the original weighted transport control, and a weighted timed model. The first two are copied
from the TV-2 evidence; the third is a released-writer resave of the timed spec fixture with input/output/inhibitor
weights 3/5/4 and complete query options adapted from intro-example (the writer emitted its
formula AST). All reopen and web-round-trip
with their model and geometry intact. Malformed scaffolding mutations are rejected. Native
headless load/resave checks are recorded in [TIMED-UI-VALIDATION.md](TIMED-UI-VALIDATION.md);
they do not demonstrate a desktop Save click or browser interaction.

## Saved queries: preservation, not verification

`Network.savedQueries?: SavedQueries` has exactly two fields: `xml: readonly string[]` (ordered standalone native `<query>` XML) and `protectedComponents: readonly { id, name, nodes: readonly { id, name, kind }[] }[]`. It is optional in version 1 network JSON; old readers reject this new field rather than silently discard it. Public file function signatures are unchanged.

The native `TimedArcPetriNetNetworkWriter.createCTLQueryElement` and `createLTLQueryElement` write nested formula ASTs plus query attributes; `TAPNQueryLoader` also reads the legacy `query` string attribute. Both forms are retained, including names, attribute values, formula/option subtrees, text, comments and CDATA within a query. Preservation is XML-content lossless, not source-byte lossless: the XML serializer may change quoting, entity spellings and namespace declarations. Query order is retained, but queries are emitted after the network declarations. No query is evaluated, verified, rewritten or given a result.

On TAPN import every original component ID/template name and node ID/name/kind is protected, even when no formula is known to mention it. `validateNetwork` rejects changes to those pairs, including removal, rename, ID changes and node-kind replacement. Geometry, markings, arcs, activation, ordering, title changes and additions are allowed. Adding/copying does not rewrite or duplicate queries; new symbols remain unprotected until a TAPN reopen takes a new conservative snapshot of all symbols. TAPN component IDs derive from template names again on reopen; JSON retains IDs and the original protection snapshot. This is protection against dangling symbolic references, not a guarantee that edits preserve query truth or applicability.

`commitNetwork` additionally rejects changing/dropping metadata or weakening its protections. `removeSavedQueries(doc)` is the explicit document action to remove **all** queries and protections in one undoable transaction. No import/save or failed edit calls it implicitly. Undo restores queries and restrictions together. A legacy-Net save is refused while queries exist.

Metadata has a closed typed shape and limits: 1–1000 queries, 4,000,000 total XML characters, 50,000 XML nodes per query, nesting depth 128, 10,000 protected components, 100,000 protected nodes, and 10,000 characters per protected ID/name. Each XML string must contain exactly one query root in the native or absent namespace. DTDs, entities, processing instructions, foreign namespaces/attributes, extra roots, and model declarations nested as query content are refused. Formula `place`/`transition` references must be text-only elements without attributes. Escaped strings are never reparsed as XML. No constants, timing declarations or other root semantic content are retained under this feature; existing model restrictions remain in force.
