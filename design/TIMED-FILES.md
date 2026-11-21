# Timed metadata, files and the timed execution adapter

Timed networks are represented, persisted and adapted to the timed engine (`timed.ts`,
TIMED-SEMANTICS.md). The UI is not switched over: all default type and execution gates stay
untimed until a timed UI explicitly opts in. This is not a claim of timed UI, verification,
constant, shared-element or composed-network parity.

## Data model

`Component.timing?: ComponentTiming` is present exactly when `network.type.timed` is true, and is
never present on untimed networks. The Net is not duplicated. Timing refers to the component's
own element IDs:

| Field        | Key → value                                     | Default when absent |
| ------------ | ----------------------------------------------- | ------------------- |
| `intervals`  | ordinary or transport _input_ arc ID → interval | `[0,inf)`           |
| `invariants` | place ID → finite invariant                     | `< inf`             |
| `urgent`     | transition IDs                                  | not urgent          |
| `transports` | `{inputArc, outputArc}` pairs of normal arcs    | ordinary arcs       |
| `ages`       | place ID → nonzero ages of its first tokens     | all ages `0`        |

Defaults are never stored. Validation rejects an explicit `[0,inf)`, `< inf` or zero age. As a
result, equal fingerprints (dirty/undo) mean equal timing. Inhibitor arcs never carry intervals;
they are always `[0,inf)`. A transport is two ordinary graph arcs of one transition with equal
weights. Each half keeps its own ID, bends and `curvedEnd`, so both route paths survive. The
interval lives on the input half. Bounds and ages are exact decimal strings (see TIMED-SEMANTICS.md); no
binary floating point is involved. `validateNetwork` checks, per component: references and
element kinds; interval/invariant validity; urgent inputs unrestricted; urgent transport
destinations without a finite invariant; unique transport membership; equal weights; at most
`tokens` ages per place; and ages satisfying their place's invariant. Explicit-token capacity is
checked only when executing, so large timed nets remain editable.

## Native sources (repository HEAD) and the file contract

Paths are relative to the repository root.

- `src/main/java/dk/aau/cs/model/tapn/TimeInterval.java` `parse` (111–150): regex
  `^(\[|\()\s*(\w+)\s*,\s*(\w+)(\]|\))$`, bounds through `Integer.parseInt`, otherwise a
  constant name, upper `inf`. `TimeInvariant.java` `parse` (45–70): `^(<|<=)\s*(\w+)$`; `< 0` and
  `<= inf` are invalid. Native bounds are therefore **whole numbers ≤ 2,147,483,647 only**.
  Import normalizes `007` to `7`. Constant bounds, decimal bounds and malformed text are refused
  with the element named. TAPN export refuses non-integer bounds ("Save JSON instead"). Network
  JSON may hold decimal bounds as a web superset. The adapter accepts them for web execution,
  but they never reach a native file.
- `src/main/java/dk/aau/cs/io/TimedArcPetriNetNetworkWriter.java`: place `invariant`
  (`toString`: `< inf`, `<= 5`), transition `urgent`, input arc `type="timed"` with an interval
  inscription, inhibitor `[0,inf)`. Transport halves are each written as
  `<arc type="transport" inscription="interval:group" transportID="n">` with their own arcpath.
  `writeInitialMarkingAges` (602–624) writes `<initialMarkingAge><token age="…"/>` with
  `toPlainString` and skips zero ages.
- `src/main/java/dk/aau/cs/io/TapnXmlLoader.java`:
  - `applyInitialMarkingAges` (784–831): more token elements than `initialMarking` is an error.
    Without a `color` attribute, each token element takes the next remaining token. Ages are
    `BigDecimal` and must be nonnegative. The web form is exactly this: nonzero ages for the
    first tokens, in order. Import keeps nonzero ages exactly (including `2.50`) and drops zero
    ages, which are implicit, exactly like the writer. Ages must be plain decimals: exponents,
    signs and `.5` forms are refused, not coerced. A token `color` attribute is refused: the
    uncoloured writer never emits one.
  - `parseAndAddTransportArc` (992–1100): halves pair **per transition in document order**.
    `transportID` is ignored. The interval comes from the input half; the weight comes from the
    later half. Import replays this pairing. It refuses a second pending half in the same
    direction (the loader would overwrite one) and unpaired halves. It also refuses halves with
    different intervals or weights, which the loader would silently discard. Group numbers are
    display labels and are renumbered per transition on export.
  - `parseAndAddTimedInhibitorArc`: the loader replaces a nontrivial inhibitor interval with a
    warning; import refuses it instead.
- Export writes halves in their drawn order when the loader's replay reproduces the pairing.
  Otherwise each output half is moved directly after its input half. Export verification
  therefore compares arcs of timed components independent of order (only drawing order).

Interoperability: `initialMarkingAge` arrived in commit `71bd04895` (2026-08-04).
Released **4.0.4 was tested and loads nonzero initial ages as 0, then drops them on resave**.
The `v4.0.0`–`v4.0.3` tags also lack the feature. HEAD has support by source inspection, but
was not built or run for these checks. JSON preserves ages. Nets without nonzero ages are
unaffected by this release limitation. EXECUTION-CONFORMANCE.md covers execution only.

### Dot expressions and transport weight (TV-1 / TV-2)

`writeTACPN.appendDeclarations`, `appendColoredPlaceDependencies`, and
`appendColoredArcsDependencies` are unconditional native-writer dependencies, even for
uncoloured nets. Timed web export now writes the dot declaration, a dot `type` on every place,
a single-term dot marking expression for markings above 1, and a `hlinscription` on **every
arc**, including both transport halves. Arc coefficients and expression text equal the weight.
`initialMarkingAge` remains separate and preserves the web/HEAD age semantics.

This is required for correct native transport weight: `TransportArc` synthesizes a missing
input/output expression and resets the weight to 1. Supplying both expressions prevents the
reset. The coefficient itself does not override the native uncoloured weight attribute; the
released writer's `1'dot` with `weight="2"` is therefore accepted and retains weight 2.
Import also accepts a matching coefficient, but refuses other conflicting coefficients rather
than evaluating arbitrary ASTs. Place marking expressions must agree with `initialMarking`.
See NETWORK-FILES.md for the exact closed shapes and rejection rules.

The single XML declaration/documentElement serialization and whole-network export/reopen
canonical guard remain in place. Queries, timing, both route paths, activity and other represented
metadata still pass through that guard. No weighted transport export refusal is necessary.

Still refused, with precise messages: constants (including bounds), shared places/transitions,
multiple `initialMarkingAge` elements, legacy `transportArc`/single-element transports with a
`transition` attribute, `tagged`, colour/game/stochastic content, duplicate or missing arc IDs in
timed components, and untimed files carrying timing. Untimed export retains the
legacy-reader-compatible dialect; both timed and untimed import now accept the strict redundant dot scaffolding described in NETWORK-FILES.md.

## Opt-in API and integration steps

`parseNetworkModel` / `parseNetworkTapn` / `parseNetworkJson` return timed-only networks directly
(`type.timed` and `components[i].timing`); nothing is unwrapped or stripped. Without opt-in:

- `openNetworkDocument`, `openDocument` and `createDocument` throw
  `Unsupported timed semantics…`.
- `legacyNetFromNetwork` and `networkCapabilities` report the type as uneditable.
- The untimed `Simulation`/`NetworkSimulation` never receive a timed net.

When the timed UI is validated:

1. Open: `openNetworkDocument(network, {saved: true, timed: true})`, then
   `openDocument(workspace, doc, {timed: true})`. New: `createTimedDocument({name, componentName?})`.
   Until then the app keeps its current calls. Note: `App.acceptPending` calls `loadNetwork`
   outside a `try`. Timed files currently produce no import warnings, but the app should catch
   gate errors there too.
2. Capabilities: `networkCapabilities(network, {timed: true})` → `{editable: true,
executable: false}` for timed-only networks. `executable` refers to the untimed simulators.
3. Execute: `new TimedSimulation(timedModelForNetwork(doc.network))`. The adapter requires a
   timed, uncoloured, nongame, nonstochastic network with exactly one component (shared elements
   are unrepresentable). Initial tokens have IDs `initial:<placeId>:<i>` and their recorded ages.
   It returns a caller-owned clone validated by `validateTimedModel`. Rebuild it after every
   commit.
4. Edits (each is one undo step; all accept a final `componentId`, defaulting to the viewed one):
   `setArcInterval(doc, arcId, interval | null)`, `setPlaceInvariant(doc, placeId, invariant | null)`,
   `setTransitionUrgent(doc, id, bool)`, `setTransport(doc, inputArc, outputArc)`,
   `removeTransport(doc, eitherArcId)`, `setPlaceTokenAges(doc, placeId, ages)` (sets the token
   count to `ages.length`), `commitTimedComponent(doc, net, timing)` (atomic net + timing, no
   reconciliation), and `removeComponentElements(doc, ids)` (native cascading delete for timed or
   untimed components).
5. Save: unchanged `serializeNetworkTapn` / `serializeNetworkJson`. Catch TAPN refusal of
   decimal bounds.

## Graph-edit restrictions on timed components

`commitComponentNet` reconciles timing against the new Net:

- Additions get defaults. Deleted elements lose their timing entries.
- Deleting only one transport half is refused, because it would silently turn the other half
  into an ordinary arc. Use `removeComponentElements`, which deletes the partner half, or call
  `removeTransport` first.
- Raising a place's token count adds age-0 tokens. Lowering it below the number of recorded
  nonzero ages is refused; use `setPlaceTokenAges` to choose the ages that remain.
- Changing an arc with an interval into an inhibitor, changing one transport half's weight,
  making an urgent transition's input timed, or violating an invariant with a recorded age fails
  validation. The document is unchanged.
- Saved-query protections still apply: protected node deletion or rename is refused before any
  timing change. Rename, copy (copies timing), add (default timing), reorder and activation keep
  timing keyed by local IDs.

## Checks

`timed-files.spec.ts` covers a writer-shaped fixture (weighted transport with strict `(1,5)`, both
route paths, `<=`/`<` invariants, ages `0.1`/`2.50`, urgency, inhibitor, labels, hidden names,
rotation, saved query). It also covers exact native output and identical reopening; five real
single-component desktop timed examples (intro-example, workflow-simple with transport
selfloops, producer-consumer, alternating-bit-protocol, fischer-protocol); refusals; transport
reordering; decimal JSON versus TAPN refusal; gates; engine mapping (`0.1+0.2`, strict lower
bound); and query protection. `documents.spec.ts` covers opt-in factories and gates, undo/redo,
fingerprints, refusals, graph reconciliation, cascading delete, ages and copying.
`model-types.spec.ts` covers capability opt-ins.
