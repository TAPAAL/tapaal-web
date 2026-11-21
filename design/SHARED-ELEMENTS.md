# Shared elements: bounded native replacement design

Status: design only, 2026-10-29. No sharing support or existing refusal gate changes are delivered here. Scope is the current explicit `timed`, `colored`, `game`, `stochastic` model flags, with only timed/untimed, uncoloured, nongame, nonstochastic models enabled. No synthesis dimension is added.

Recommend **shared places first, then synchronized transitions with native's prohibition on shared-place/shared-transition incidence**. One authored pool owns semantics; component occurrences own identity and geometry. A new opt-in compiler/session Module privately lowers this supported subset to the existing validated engines. Existing disjoint execution stays intact. Do not fuse equal local names or IDs.

## Evidence and reproducibility

Source inspected at checkout HEAD `28c9bd9174c052264db8af7a02a214dd1c37d4c4`; web work is pre-existing untracked work, not represented by that commit. Native source is newer than the released binary; source and binary observations below are deliberately separate.

Released oracle: `/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib/tapaal.jar`, SHA-256 `60914b11e6fffa6f9be8f481c51b945fd16c8f4fef9d31bc2d8d5db93f88cd5d`. New observation harness: [SharedElementsReference.java](../scripts/native-reference/SharedElementsReference.java). Existing ExecutionReference/TimedFileReference and all production/tests/docs were read-only.

The harness is **not an assertion suite**. It prints supported behavior and deliberately invalid model experiments. It replaces only `NetworkMarking.isDelayPossible` with a headless predicate using the supplied network, because native uses `TAPAALGUI.getCurrentTab()`. Cloning, selection, consumption, production and file IO remain jar code. Delay observations therefore verify native delay traversal under an explicitly substituted predicate, not a GUI integration run. Invalid incidence cases construct arcs before calling `makeShared`, exploiting the model mutator loophole; they are not native-supported nets.

Run from repo root, after reading worker-job help/USAGE and inspecting capacity/list:

```sh
worker-job run tapaal-shared-reference-UNIQUE --memory 512M -- bash -c '
  out=$(mktemp -d /tmp/tapaal-shared-classes.XXXXXX)
  trap '\''rm -rf "$out"'\'' EXIT
  lib=/tmp/tapaal-native-reference/tapaal-4.0.4-linux64/lib
  javac -J-Xmx128m -cp "$lib/*" -d "$out" web/scripts/native-reference/SharedElementsReference.java &&
  java -Xmx128m -Djava.awt.headless=true -cp "$out:$lib/*" SharedElementsReference
'
```

The final harness compiled and exited 0. Temporary classes/XML were cleaned; no display, browser, server or manual environment was started. Initial development runs exposed the native constructor guard and then a constructor-overload compile error; both are resolved in the final harness. This work did not rerun the existing web baseline.

### Native source map (paths relative to repository root)

| Evidence                           | Exact source locations and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared place ownership             | `src/main/java/dk/aau/cs/model/tapn/SharedPlace.java`: constructors, `equals`, `setNetwork`; `LocalTimedMarking.java`: `add`, `remove`, `getTokensFor`; `NetworkMarking.java`: `sharedPlacesTokens`, `delay`. Occurrences refer to one object; shared tokens live only in the network marking. Native equality is name-based; do not copy that identity scheme into authored state.                                                                                                                                                      |
| Membership, active synchronization | `SharedTransition.java`: `makeShared`, `templateDoesNotContainSharedTransition`, `isEnabled`, `calculateDInterval`; `TimedTransition.java`: `makeShared`, `unshare`, `isEnabledAlone`, `isEnabledBy`, `calculateConsumedTokens`, `calculateProducedTokensFrom`. One member per template; conjunction across active members.                                                                                                                                                                                                              |
| Global names and active usage      | `TimedArcPetriNetNetwork.java`: `add(SharedPlace,boolean)`, `add(SharedTransition,boolean)`, `isNameUsedForShared`, `isNameUsedInTemplates`, `isSharedPlaceUsedInTemplates` (line 721); `TimedArcPetriNet.java`: `add`, `isNameUsed`. Pool names occupy the place/transition namespace across all templates, including inactive ones. Multishare is an explicit bypass used by conversion commands, not permission to infer sharing.                                                                                                     |
| Firing and delay                   | `NetworkMarking.java`: `fireSharedTransition` overloads, `distributeTokensToIndividualTransitions`, `clone`, `isDelayPossible`, `delay`; `LocalTimedMarking.java`: both `fireTransition` overloads. Automatic firing loops members sequentially; selection consults model tokens. Manual distribution casts token places to `LocalTimedPlace`.                                                                                                                                                                                           |
| Forbidden incidence                | `TimedInputArc.java:39`, `TimedOutputArc.java:27`, `TransportArc.java:38-39`; `TimedInhibitorArc` inherits the input constructor guard. A shared transition cannot have any shared place input/output, including inhibitors or either transport endpoint.                                                                                                                                                                                                                                                                                |
| Timing/selection                   | `TransportArc.java:101-104` checks interval AND destination invariant; `TimedTransition.java:424-463` creates ordinary age-zero tokens and transports age; `simulation/{OldestFiringMode,YoungestFiringMode,RandomFiringMode}.java` selects per input, not a joint matching algorithm. `SharedTransition.setUrgent` cascades to existing members; `TimedTransition.makeShared` itself does not copy urgency.                                                                                                                             |
| Composition                        | `src/main/java/dk/aau/cs/verification/TAPNComposer.java`: `createSharedPlaces` (167), transition creation (279-324), input/output/transport/inhibitor loops (386/451/503/614). Active-used shared places and shared transition names map once; each original arc is added separately. There is no general aggregation or conflict-solving proof here.                                                                                                                                                                                    |
| Native TAPN IO                     | `src/main/java/dk/aau/cs/io/TapnXmlLoader.java`: shared declarations (245-330), member transition (575-634), member place (639-701), `addColoredDependencies`, `initialMarkingAge` (785). Also inspected corresponding `TapnEngineXmlLoader` paths. `TimedArcPetriNetNetworkWriter.java`: root namespace (109), pool declarations (225-253), member places (580-600), ages (602), transitions (680+), arc weights (730+).                                                                                                                |
| Queries                            | `io/queries/QueryLoader.java:75-103` includes all template-qualified names AND pool symbols with template `""`; `TAPNQueryLoader.java` includes Shared handling and global place lookup. `TCTL/visitors/{MakePlaceSharedVisitor,MakeTransitionSharedVisitor,RenameSharedPlaceVisitor,RenameSharedTransitionVisitor}` distinguish global and local references.                                                                                                                                                                            |
| GUI/undo                           | `net/tapaal/gui/petrinet/editor/SharedPlacesAndTransitionsPanel.java`: pool creation/rename/remove/list/sort; `SharedPlaceNamePanel`, `SharedTransitionNamePanel`: name dialogs; `DeleteSharedPlaceOrTransitionAction.java`: remove occurrences versus unshare, query inspection and deletion. `pipe/gui/petrinet/editor/PlaceEditorPanel.java:197-248,787-875`, `TAPNTransitionEditor.java`: `setupInitialState`, `hasArcsToSharedPlaces`, OK handler. Both forbid making a node shared when already incident to the other shared kind. |
| Undo and copy                      | `net/tapaal/gui/petrinet/undo/{MakePlaceSharedCommand,MakePlaceNewSharedCommand,MakeTransitionSharedCommand,UnsharePlaceCommand,UnshareTransitionCommand,DeleteSharedPlaceCommand,DeleteSharedTransitionCommand,RenameSharedPlaceCommand,RenameSharedTransitionCommand}.java`; `TimedArcPetriNet.copy:350-384`, `Template.copy:40-43`. Copy reuses shared places and rejoins the same shared transition; GUI geometry is separately copied.                                                                                              |

### Observed released results versus interpretation

| Experiment                                                         | Released 4.0.4 observation                                                               | Design consequence                                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Construct shared-place → shared-transition input                   | `RequireException: You cannot draw an arc between a shared transition and shared place.` | Structural refusal, not a numerical corner case. Apply to normal/output/inhibitor/transport and inactive components too.                                          |
| Invalid mutator bypass; one shared token, two synchronized demands | Enabled true; consumed ages `[1,1]`, remaining empty; original count remains 1           | No aggregate demand check; same original token selected twice, second removal silently ineffective. Never emulate.                                                |
| Invalid bypass; ages 1,2; oldest/youngest                          | Oldest consumes `[2,2]`, leaves `[1]`; youngest consumes `[1,1]`, leaves `[2]`           | Sequential mutation is not sequential fresh selection from the cloned marking. Summing weights changes behavior; neither behavior is a supported native contract. |
| Invalid bypass; random, one token                                  | Consumed `[1,1]`                                                                         | Random mode does not repair aliasing.                                                                                                                             |
| Invalid bypass; manual shared token                                | `ClassCastException SharedPlace cannot be cast to LocalTimedPlace`                       | Manual bindings must not use native's place-cast distribution scheme.                                                                                             |
| Invalid bypass; self-loops on both members                         | One original age-1 token yields two age-zero tokens                                      | Gate the topology rather than reproduce token creation.                                                                                                           |
| One member inactive                                                | Only active member consumes                                                              | Filter synchronization by captured active set.                                                                                                                    |
| Members exist, all inactive / empty pool                           | `isEnabled=true` / `false`                                                               | All-inactive true is vacuous model-predicate behavior. No active occurrence means no selectable event and no urgency blocker.                                     |
| Active source synchronization, no inputs                           | Enabled; consumes nothing                                                                | Valid event, including a trace step if marking stays unchanged. Capacity still checked for outputs.                                                               |
| Delay 2 on shared age 1 with two occurrences                       | Age 3 once                                                                               | One physical token pool, not two delays.                                                                                                                          |
| All occurrences inactive; invariant <=1, age 1, delay 2            | Age 3 under substituted active-use predicate                                             | Native advances all pool tokens, but checks only active-used pool invariants. Preserve this deliberately in runtime-only dormant pool state.                      |
| Urgency set after membership                                       | Both member flags true                                                                   | Global setter must validate all members and act atomically.                                                                                                       |
| Membership added after pool already urgent                         | Pool true, new member false                                                              | Native model insertion alone does not guarantee consistency. Web owns one urgency value; reject conflicting imported redundancies.                                |
| Valid sync with local inputs, manual tokens ages 2/3               | Both local inputs become empty                                                           | Supported synchronization path has disjoint physical inputs.                                                                                                      |
| Local transition transports shared age 1 to local <=1              | Source empty, destination age 1; changing destination to <1 disables                     | Shared endpoints are valid with a LOCAL transition; preserve age and web token identity.                                                                          |
| XML root Pool count 2, invariant <=K (K=7); member count 9, <=1    | Model count 2, invariant <=K                                                             | Root place authority wins natively; web must reject ignored conflicting source values before cloning.                                                             |
| XML root Sync urgent=true; member urgent=false                     | Both contradictory values survive load and resave                                        | Do not assume transition root declaration overrides member semantics on load.                                                                                     |
| Resave member IDs p1/t1, names Pool/Sync                           | Writer emits IDs Pool/Sync, names unchanged                                              | Native GUI-backed IO normalizes IDs; use a semantic/geometry comparison, not literal ID equality, for native roundtrips. Web JSON preserves stable IDs.           |

No GUI editor/undo execution was attempted: those commands require a current tab. Command source establishes operations and query rewriting, not a tested whole-dialog result. Native source now reads/writes initial ages; released 4.0.4 IO is known from the existing timed-file work to drop nonzero ages. That prior result is not retested by this harness. Direct model age results above do NOT establish released IO age fidelity. Keep the existing warning/preservation policy; never erase ages to satisfy a released roundtrip.

## Authoritative web architecture and Interface alternatives

Read `authored-model.ts`, `authored-documents.ts`, `authored-files.ts`, `editor-workspace.ts`, `authored-clipboard.ts`, `resolved-network.ts`, `saved-queries.ts`, `net.ts`, `timed.ts`, both network simulation modules and their reference harnesses. Current authored JSON is strict v2. Clipboard v3 is unrelated. `resolveAuthored` first checks original shape, resolves constant terms, then validates numeric projections. Documents keep immutable source snapshots and use expected snapshot identity for transactions. `patchNet` is not an unrestricted semantic replacement. Saves use source, not simulation state.

Two plausible Interfaces were compared without delegation:

1. **Add shared IDs to existing numeric Network/Net, teach each engine/editor/file helper to resolve them.** Small-looking schema delta, but a shallow Module: each caller must know global authority, local geometry, duplicate demand rules, query protection and active-member logic. Current `CompositionMapping.fromComposed` returns one ElementRef, which cannot represent multiple occurrences. Numeric editors risk writing projected global values into every member. Reject.
2. **Extend authored source with an explicit pool and discriminated occurrences; add one shared compiler/session Module and shared transaction variants.** More explicit types at the seam, but deep behavior: one resolver handles all callers, one transaction validates all references, one compiler owns many-to-one mapping. Keep ordinary engines as existing concrete implementations; the new compiler is an Adapter at the execution seam, not a new public graph language. Recommend.

Do not introduce a generic execution framework or rewrite App. `editor-workspace` selects the existing no-shared path or new shared session from a validated revision; focused UI Modules present drafts and effects. App coordinates dialogs and session replacement only.

## Source schema (authored JSON v3)

The following is normative pseudocode. `Geometry` is the existing node coordinate/name-offset/name-visible data; transition geometry additionally has angle. Existing local node shape remains unchanged. Types with `never` also require runtime closed-record checks.

```ts
type PoolId = string;
type OccurrenceRef = { componentId: string; elementId: string };
type PoolRef = { kind: 'place' | 'transition'; poolId: PoolId };
type PlaceRef = { scope: 'local'; occurrence: OccurrenceRef } | { scope: 'shared'; poolId: PoolId };
type EventRef = { scope: 'local'; occurrence: OccurrenceRef } | { scope: 'shared'; poolId: PoolId };

type SharedPlaceDecl = {
  id: PoolId;
  name: string;
  tokens: number; // count, NOT a constant term (same rule as existing local marking)
  timing?: { invariant: AuthoredInvariant | null; ages: readonly Decimal[] };
  // timing present exactly for timed networks; ages use current sparse nonzero-age convention.
};
type SharedTransitionDecl = {
  id: PoolId;
  name: string;
  urgent: boolean; // false for untimed
  firingMode: 'Random' | 'Oldest' | 'Youngest';
};
type SharedOccurrence = Geometry & {
  id: string;
  kind: 'place' | 'transition';
  sharedId: PoolId;
  name?: never;
  tokens?: never; // display comes from pool
};
type SourceV3 = Omit<AuthoredNetwork, 'components' | 'savedQueries'> & {
  shared: {
    places: readonly SharedPlaceDecl[];
    transitions: readonly SharedTransitionDecl[];
  };
  components: readonly ComponentV3[]; // nodes: existing local nodes | SharedOccurrence
  savedQueries?: QueriesV3;
};
```

Pool IDs are unique across both pool kinds within a document, immutable across rename and unrelated to names. Local node/arc IDs remain component-scoped; cross-component equality is disjoint. A node is either local or an explicit member, never both. `kind` must match the referenced declaration. At most one occurrence of each pool declaration in each component, active or inactive. Membership is derived from node references; do not persist a second pool member list. Arcs still reference local occurrence IDs, with their own routes and authored `WeightTerm`; transport pairs still reference two local arc IDs. No shared arc pool exists.

For shared places, component timing cannot contain member invariant/ages entries; for shared transitions it cannot contain member urgency. Pool initial count/ages, invariant and urgency have ONE authority. Resolved render nodes may repeat effective values; they are disposable read-only views, never `AuthoredNet` and never accepted as semantic drafts. This requires replacing broad editor `activeNet`/`commitComponentNet` paths for shared nodes with geometry-only patches or explicit pool edits.

Validation ordering:

1. Inspect original objects recursively: own enumerable data, plain records/arrays, exact keys, no accessors/prototype state; discriminate node union before cloning. Strictly validate model flags and all constants.
2. Index pool IDs/names and component/local IDs. Reject dangling/wrong-kind refs, duplicate membership, reserved native names, and collisions with every unrelated local place/transition in every component. Native place `true`/`false` rewrite is rejected, not performed. Preserve existing local/local disjoint-name policy. Do not add speculative constant-versus-node namespace restrictions; constants retain their existing scoped rules.
3. Resolve authored terms globally, including unused declarations/inactive components. Check count/ages/invariant compatibility, arc weights, intervals, transport pairing with identical AUTHORED terms, urgent restrictions and current capacity-independent structure rules.
4. Reject shared-place/shared-transition incidence in ALL components, for both ends of transport. Existing disallowed parallel local arcs stay disallowed. Reject per-member semantic duplicates even if equal in JSON. Native XML is a separate redundant-wire format with explicit checking below.
5. Check captured query protections and feature availability for this implementation wave. Return branded frozen revision only on success. Source validity and engine capacity remain separate; an over-capacity source can still be saved.

`firingMode` preserves the native pool field; it is not a stochastic type flag and is not a probability weight. Source normalization defaults absent native firingMode to Random. Wave 1 keeps all shared transitions refused; Wave 2 initially permits Random source policy only unless the nondefault field roundtrip and UI selection tests below are delivered. Runtime user oldest/youngest/manual selection remains an independent per-step choice, as in current simulation.

### Constants and query references

Extend `Use` deliberately rather than encoding a pool as a fake component:

```ts
type UseSite =
  | { scope: 'component'; componentId: string; elementId: string; active: boolean }
  | { scope: 'shared-place'; poolId: string; activeMemberCount: number }
  | { scope: 'saved-query' };
type UseV3 = {
  constantId: ConstantId;
  site: UseSite;
  field: 'weight' | 'lower' | 'upper' | 'invariant' | 'saved-query-protection';
};
```

Invariant constant use is listed once for the pool, even with zero occurrences. Arc weights/intervals stay component uses. `constantUses` and update/delete validation include both; a constant invalidating an unused shared invariant still fails atomically. UI labels: “Shared place Buffer · invariant · 0 active occurrences”; navigation opens pool editor with occurrence links, while local uses navigate to their component/arc. Query protection is labeled separately, never as an editable value use.

`QueriesV3` retains opaque XML, existing protected constants/components, and adds `protectedShared: {id,kind,name}[]`; protected component node entries additionally capture membership (`sharedId` or explicit local). At import capture **all original pool symbols**, including unused/all-inactive declarations, all original local refs and occurrence memberships conservatively. Native supports empty-template global symbols and template-qualified member refs; do not guess which spelling an opaque query uses. Rename/delete, conversion, detach, or removal of protected refs is blocked. Geometry and numeric parameter changes can retain the original symbols as under current policy. Adding a new occurrence must not invalidate previously captured membership refs; removing an unprotected newly added occurrence is allowed.

Only explicit `removeSavedQueries` drops opaque XML and protections, as its own undoable action. No automatic capture refresh, text substitution, guessed XML rewrite, or query deletion on pool removal. Query checks belong in source validation, not UI callbacks.

## Transaction Interface and editing workflows

Extend the existing `transactDocument(doc, expectedSource, edit): Result<Document>` seam. Do not create a parallel shared undo stack. Shared editing implementation can live in `authored-shared.ts` and be called by the existing document Module.

```ts
type SharedEdit =
  | {
      kind: 'createPool';
      declaration: SharedPlaceDecl | SharedTransitionDecl;
      poolKind: 'place' | 'transition';
    }
  | {
      kind: 'makeShared';
      occurrence: OccurrenceRef;
      declaration: SharedPlaceDecl | SharedTransitionDecl;
    }
  | { kind: 'useShared'; occurrence: OccurrenceRef; target: PoolRef; acceptPoolValues: boolean }
  | { kind: 'addOccurrence'; componentId: string; target: PoolRef; geometry: Geometry; id: string }
  | {
      kind: 'detachShared';
      occurrence: OccurrenceRef;
      localName: string;
      values: 'copy-source-pool';
    }
  | { kind: 'editPool'; target: PoolRef; declaration: SharedPlaceDecl | SharedTransitionDecl }
  | { kind: 'deletePool'; target: PoolRef }
  | { kind: 'removeOccurrence'; occurrence: OccurrenceRef };
```

`makeShared` constructs a new pool from the selected local element's authored semantics (including symbolic invariant and initial ages), preserves its occurrence ID/geometry/arcs, removes local authority, then validates the whole candidate. The supplied declaration must match those transferred semantics; arbitrary marking replacement is an explicit subsequent pool edit. Only the selected node converts. A name collision elsewhere is an error listing locations, never automatic multi-share.

`useShared` adopts existing pool semantics; it does NOT add local tokens to the pool, overwrite its invariant, or import the current simulation marking. Preview shows local values being replaced and pool values. If they differ, `acceptPoolValues` must be true from that explicit editor choice. The transaction rechecks the expected source and the comparison. Joining a transition adopts global urgency; all its input and transport restrictions are rechecked before commit.

`detachShared` creates a local node with the SAME occurrence ID/geometry/arcs and a fresh noncolliding local name. Copy the authored source pool marking/invariant/urgency into local semantics; leave the pool and other members unchanged. This intentional duplication of initial marking is shown in the preview. Native single-place editor applies further marking/invariant commands after `UnsharePlaceCommand`, while bulk deletion creates default local nodes; we do not claim these two native workflows are identical. Web uses the explicit copy-source rule, never silently resets to empty/default. Undo restores membership exactly.

`deletePool` is in-use guarded, including inactive occurrences and captured queries. No initial cascading delete/unshare-all feature. User removes occurrences (and their incident arcs/complete transport pairs) or detaches individually, then deletes the unused pool. Pool creation with zero occurrences is valid. Removing the last occurrence retains the unused pool and initial state. `editPool` preserves pool ID/kind and atomically validates all members. Component removal/copy/activation and constants edits also go through whole-network validation, so they cannot bypass sharing gates.

Same-document component copy preserves pool references, clones local authored terms and geometry, and creates a new component ID. Existing component-local IDs may remain the same because identity is qualified. No new pool or shared tokens are created. Native `TimedArcPetriNet.copy` supports reference preservation; its local token-age reset is not adopted. Cross-document component transfer involving sharing is initially refused. A future explicit import operation must remap IDs, import dependency closure of constants/pools, and require the user to choose create-renamed versus bind-existing after semantic comparison; equal names never imply equivalence, and differing values never silently overwrite a pool.

Every successful non-no-op edit records one immutable whole-network history entry, clears redo, and invalidates simulation, numeric/render caches and open drafts based on exact source identity. Failed edits return issues without changing source/history/session/dirty marker. Undo/redo restores whole snapshots, including query protections and pool values; it does not re-execute a series of mutating native-style commands. In-flight drafts bind to expected source identity, so rename, constants update or undo makes them stale even if numerical values happen to match.

Failures use existing `Result`/`Issue` codes where meaningful (`shape`, `name`, `unbound`, `range`, `in-use`, `query-protected`, `unsupported`, `invalid-model`, `stale-revision`). Extend locations to `UseSite` plus affected pool/member/arc refs; do not fabricate a constant ID for a membership error. Return a specific reason such as “Shared transition Sync cannot connect to shared place Buffer (A/input7)” with navigation. No best-effort partial change.

## Execution seam: opt-in validated shared compiler

Use new `shared-network-simulation.ts` with a private `compileSharedRevision` implementation. Inputs are branded resolved source revisions, never `Network` with silently erased sharing. Return the existing no-shared session unchanged when pool arrays and memberships are empty. Keep both old disjoint composers and their refusal gates as defense in depth.

Why reuse is safe for the gated subset: `net.ts:137-174` forbids duplicate endpoint pairs regardless of kind. `timed.ts:210` explicitly relies on that to ensure one consuming arc per physical place per event; manual selection tracks consumed token IDs. Disjoint composition can preserve those facts. Unrestricted fusion could destroy both facts: multiple intervals, inhibitor and normal input, transports with distinct destinations, and several member demands cannot be represented by summing a weight. Under native's no-shared/shared incidence restriction, every synchronized input is a distinct component-local physical place, and each local transition has at most one occurrence of each global place. Therefore the compiled supported graph still satisfies current validation. Check this postcondition with `validateNet`/`validateTimedModel`; never assume it.

Physical IDs use injective tuple encoding with disjoint tags:

```ts
placeKey = ['shared-place', poolId] | ['local-place', componentId, nodeId];
eventKey = ['shared-transition', poolId] | ['local-transition', componentId, nodeId];
arcKey = ['arc', componentId, arcId];
tokenKey = ['initial', physicalPlaceKey, ordinal];
```

Compile each active local node once, each active-used shared place once, each shared event with at least one active member once. Copy each active arc once with qualified identity and authored-reference provenance; keep transport pairs paired within the original component. Pool invariants/initial tokens are added once; urgency is taken once from pool. Projected numeric names use injective symbols, never native display names. Do not copy queries into execution.

Mapping is many-to-one, with immutable membership snapshots:

```ts
interface SharedSession {
  readonly revision: ResolvedSharedRevision;
  inspect(state: State): Readonly<{ events: EventView[]; projections: ComponentView[] }>;
  eligible(state: State, event: EventRef): Result<readonly InputChoice[]>;
  step(state: State, action: Action): Result<State>;
  replay(actions: readonly RecordedAction[]): Result<readonly State[]>;
}
type InputChoice = {
  member: OccurrenceRef;
  arcId: string;
  place: PlaceRef;
  weight: number;
  eligibleTokenIds: readonly string[];
};
type Binding = { member: OccurrenceRef; arcId: string; tokenIds: readonly string[] };
type Action =
  | { kind: 'delay'; amount: Decimal }
  | {
      kind: 'fire';
      event: EventRef;
      selection:
        | { mode: 'manual'; bindings: readonly Binding[] }
        | { mode: 'oldest' | 'youngest' | 'random' };
    };
```

The concrete implementation may retain current session cursor methods; these types specify the observable immutable state/action contract, not an obligation to add a second history controller. The compiled graph is private and never becomes editable source. `eventMembers(event)` and `occurrences(place)` return arrays, replacing the single `fromComposed` assumption only for this Adapter.

Fire algorithm:

1. Validate captured revision, event kind/ID and at least one active member. An inactive occurrence cannot be clicked to fire an active sibling implicitly; UI selects the explicit global event.
2. Evaluate all ordinary/transport eligibility and inhibitor thresholds against ONE pre-state. Source transitions are enabled vacuously only when an active member exists. Transport destination invariant uses the physical destination, shared or local; ordinary outputs start at age zero.
3. Manual selection covers exactly every active consuming input, identified by member plus arc. Reject extras, omissions, stale/foreign IDs, duplicate bindings and ANY repeated physical token ID. Automatic modes pick per input in stable qualified order; native random sequence equality is not promised. Record actual bindings, not RNG calls. Oldest/youngest ties use stable token order.
4. Compute all removals and outputs, check destination invariants and total capacity, then publish a single new state, clock and trace entry. No member intermediate state is observable. Transport retains the web token ID/age across endpoints; ordinary output gets a new deterministic identity. Native creates new Java token objects during transport, so differential comparison checks age/multiplicity, while web tests assert identity continuity.
5. Failure preserves state, clock, trace, cursor and RNG-visible committed choices. Replay uses recorded bindings and applies into a temporary history; any failure leaves the existing history intact. Zero-effect source firings still produce a trace event.

Delay advances each physical active token once, checks invariants of active local places and active-used pools, and blocks positive delay if any active enabled urgent event exists. Current zero-delay policy remains. Empty/all-inactive transition pools are not events and do not block delay, despite native's vacuous `isEnabled` result.

**Inactive projection is explicit:** inactive local places remain at initial marking as in current web sessions. Every occurrence of a shared place, including an inactive occurrence, displays the SAME current global marking when the pool is active-used elsewhere, labeled shared/live. Unused or entirely inactive pools have runtime ages equal to initial age plus elapsed time, matching native traversal, but their invariants do not constrain delay; keep these dormant tokens outside the validated active TimedModel. They never feed firing. They remain initial in source saves. Activation changes source revision and restarts execution from authored initial state, never promotes possibly over-invariant dormant runtime tokens. Budget dormant metadata separately by existing document limits; no per-step materialization is needed (derive ages from captured initial ages and clock).

Trace stores event global ID, snapshot name, active member refs/names, qualified arc bindings, immutable physical marking and time. Component display projections are derived immutable views: count global tokens once in totals, display them in every occurrence. Trace export/replay validates version, revision/fingerprint, qualified refs and recorded binding membership. Source rename cannot retroactively rename an older trace. Selected earlier-state notice and all initial/source save behavior remain intact.

## Native file grammar and preservation

Native writer emits `<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">`; pool declarations are direct root children, as are constants, nets, queries and feature metadata. Shared pool declarations have **name, not an identity ID**. Component members are ordinary `<place id="local-wire-id" name="PoolName" ...>` or `<transition ... name="SyncName" ...>`; matching a root declaration of the correct kind gives membership. There is no `sharedId` native member attribute. Arc endpoint refs refer to component-local wire IDs. Repeated local names WITHOUT a root declaration remain disjoint. Opposite-kind collisions, duplicate declarations/members and ambiguous ID/name fallback are refused.

Native loader uses descendant `getElementsByTagName` for pool declarations and name fallback/normalization; the web parser must be stricter. Only direct root declarations in the accepted existing namespace dialect are allowed; reject nested declarations, foreign namespaces/prefix tricks, unknown semantics and malformed attrs before any numeric clone. Keep current XML/entity/size protections. Do not broaden accepted legacy dialects merely because the native loader is permissive.

Native shared place wire values: `name`, `invariant`, `initialMarking`, optional initial ages and accepted dot-only AST/type representation. Pool marking and invariant own semantics. Writer repeats effective values on every member; these repetitions are wire projections, not authored authorities. Root/member place values must be inspected and agree in count, age multiset and authored invariant term (a literal equal today to constant K is NOT the same authored reference). Verify existing redundant dot AST representations with current constants rules. A missing optional age list means native default zero ages; do not silently reinterpret a contradictory member as inheritance. Native ignores a conflicting member value; web rejects it with both source locations. Canonical export emits consistent redundancies.

Native shared transition root and members can carry `urgent`, `player`, distribution/value/weight and firingMode. All semantic repetitions must agree after defined defaults; native does not reliably enforce this. Preserve only current accepted nongame/nonstochastic default metadata plus explicitly supported firingMode; reject unsupported nondefault stochastic/player fields rather than stripping them. Transition probability `weight` is not an arc `WeightTerm`. No new probability/real-constant support is implied. Urgency is one authored boolean, not one per member.

Shared invariant bounds use existing `BoundTerm`/constant refs; incident arc weights and guards use existing authored terms. Pool declaration name map is built before member parsing, but constants are indexed independently of XML order. Validate symbolic transport weights before numerical projection and preserve current symbolic urgent-input refusal until its separate oracle gate is satisfied.

Parser stages: inspect original grammar and semantics → record stable pool/member IDs and authored terms/protections → create a disposable geometry/numeric clone if needed → reconstruct source → resolve and compare. Do not simply delete pool declarations from a clone and invoke the old parser: that can silently turn membership into local state. Prefer a factored geometry reader whose input is already-validated geometry, or an explicitly indexed projection with synthetic safe names and complete reverse mapping. Every attribute/AST discarded from a clone must have been inspected first.

Writer stages: validate source → create canonical root pools and member projections → write geometry/arcs with explicit per-component wire-ID maps → restore constant spelling → retain original opaque queries → parse output through shared source parser and compare semantic fingerprint, geometry, membership and symbolic refs. Native normalization can change wire IDs, so compare stable topology via member mapping for the native oracle, while web self-roundtrip must retain authored IDs whenever the format can encode them. Pool IDs have no TAPN slot; TAPN import allocates fresh IDs deterministically by declaration order/kind, and roundtrip comparison uses explicit pool-name correspondence. JSON is the identity-preserving format.

JSON dispatch is strict: v1 numeric remains its existing migration route; v2 is validated by its OLD exact schema first, then gets `shared:{places:[],transitions:[]}` and empty shared-query protections. v2 containing a shared field is an error, not a migration hint. v3 accepts only the new exact schema; unknown versions/fields refuse. Always write v3 after this feature lands; an optional v2 export may exist only for truly empty pools/members and losslessly representable metadata, never implicit downgrade. Clipboard's `format`/v3 stays separate: do not increment or reinterpret it with document versioning.

Initial shared clipboard policy: reject a selection that includes a shared occurrence or an arc whose selected endpoint is shared, before creating a flattened payload. Unrelated numeric and symbolic local subsets in the same document still copy/paste through existing v1/v2/v3 clipboard paths. Dependencies and destination pool-name collisions are checked before commit. No membership flattening or opportunistic name binding. Pool-aware cross-document clipboard is a later explicit schema design.

## Bounded implementation waves and acceptance

These are proposed ownership scopes, not edits made by this design. Keep the application budget warning unchanged; baseline supplied by parent is 745 tests/31 files, typecheck/build/format passing, symbolic clipboard 18 checks/207 assertions, timed clipboard 12/86, constants UI 197 plus historical harnesses; native/disjoint 124/213 checks remain mandatory. None of those totals were independently rerun here. Preserve the 578.73 kB initial bundle/500 kB warning; do not raise the configured budget.

### Wave 1: smallest genuinely usable slice — shared places

Own `core/authored-model.ts`, new `core/authored-shared.ts`, `authored-documents.ts`, `authored-files.ts`, narrow `editor-workspace.ts` adaptations, new `shared-network-simulation.ts`, focused pool/occurrence editor UI Modules and their tests. `App` only wires commands/view/session selection. Shared transitions remain refused at source import/edit/execution. Deliver create pool, convert/use existing/detach, rename, delete-unused, occurrence deletion, initial marking/ages/invariant edit, constants use navigation, source JSON/TAPN save, same-document component copy, undo/redo, and simulation across components. Without roundtrip/edit/simulation this is an internal increment, not the usable slice.

Acceptance examples (Interface-level tests, plus UI smoke):

- Two components reference Pool with one age-2 token, invariant <=K=5. Both display one physical token; delay 1 gives age 3, not 4; local transition A consumes it and B updates in one trace step. Source/initial save still contains age 2 and K ref after firing/history selection.
- A and B have equal local IDs/names without declarations: all existing disjoint results unchanged. Duplicate shared occurrence in A, wrong-kind/dangling reference, extra member tokens/name/invariant all fail before mutation.
- Pool used only in inactive B or unused entirely still has validated initial state and constants uses; its invariant does not block active A delay. Dormant ages advance once; B local ages stay initial. Activating B restarts from source; all-inactive network has no fireable event.
- Local transition ordinary self-loop on shared Pool consumes once, produces fresh age-zero identity. Transport shared→local, local→shared, shared→different-shared and same-shared self-loop preserves ID/age and destination-invariant legality; no more than one consuming input per physical place/event. Test lower/upper closed/open guards, weighted transport, paired route geometry and shared destination constants.
- Local shared-place inhibitor compares total global count with weight (below threshold enabled; equal blocked), consumes nothing, unrestricted interval only. Attempting normal and inhibitor parallel endpoints remains refused.
- All four token modes on a LOCAL transition with shared inputs; manual IDs qualified by member/arc, repeated/foreign/missing IDs rejected. Oldest/youngest unique-age differential; random checks eligibility/conservation rather than sequence.
- Changing K below an initial shared token age fails even if the pool is unused; delete K reports one global use. Renaming K retains ID and symbolic shared invariant on save. Stale pool draft after constants edit or undo fails.
- Convert/use/detach tests with differing initial ages/invariants prove explicit adoption, exact undo/redo, geometry independence and no token summation. Copy component retains membership and pool count; moving copied member does not move original.
- Native fixture matrix: default and constant invariant; root/member differing IDs; inactive occurrence; duplicate root declaration; kind collision; member count/invariant/ages/AST mismatch; undefined constant; unknown fields/namespaces/nested declarations; query globals only in unused pools. Verify native normalization only after our source validation accepts the file.
- v1/v2 migration, v2 shared-field refusal, v3 unknown-key refusal, JSON stable-ID roundtrip, TAPN pool-name/geometry roundtrip; unrelated clipboard subsets still work and shared selections fail without loss. Query protected rename/delete/detach/conversion fails, explicit remove-queries then operation succeeds, undo restores XML/protections.

### Wave 2: synchronized transitions, local incidence only

Extend the same source/transaction/file/session Modules and focused transition pool UI; add no independent authoritative model. Deliver pool creation/join/detach/rename/delete-unused, global urgency with all-member constraints, active member list, atomic fire/trace and selection dialog grouped by member. Permit native nondefault firingMode source fields only with explicit source save and selection-policy tests; otherwise give an unsupported-field diagnostic.

Acceptance examples:

- A.Sync and B.Sync each consume distinct local inputs; one missing token disables both. One click consumes/produces both atomically. Inactive B neither blocks nor consumes; no active members means no event, not a zero-effect infinite source.
- Active source member and input-bearing member, all source members, local self-loops and local transport members. Inhibitors observe pre-state. Output/transport failure or capacity overflow leaves ALL members, time/history and bindings unchanged.
- Shared urgency blocks positive delay only when the whole active synchronized event is enabled; inactive urgent members alone do not block. Joining a timed guarded local transition to urgent pool is rejected atomically; pool urgent edit checks every member including inactive ones.
- Oldest/youngest/manual/random across disjoint local inputs, equal token IDs in different components, arc IDs repeated across components; trace records qualified bindings and stable snapshot names. Local transport IDs survive synchronization and replay. Activation/rename/pool edit/constant edit invalidates a captured session.
- Reject ANY shared-place incidence on shared transition, including output-only, inhibitor-only, either transport endpoint, shared self-loop, inactive-only incidence, and incidence introduced by conversion after arc creation. Check via transaction, JSON, TAPN and session constructor. This closes the native mutator loophole.
- Binary differential for valid local synchronization, active filtering, source transitions, urgency and transport destination bounds. Run invalid harness cases only as evidence that the gate remains necessary, never as expected web semantics.
- Native XML global/member urgency mismatch and nondefault field mismatch refuse without modification; matching declarations normalize consistently. Saved global transition queries protect unused pools and qualified local members.

### Later wave, explicitly not enabled

Pool-aware selection/cross-document clipboard, bulk detach/delete workflows and broader source firing-policy fidelity can follow separately. Unrestricted shared-place/synchronized-transition incidence requires a new semantic decision and native compatibility policy, not removal of one gate. If ever pursued, design a joint matching engine over qualified input demands, inhibitors on pre-state and explicit transport destinations; fail if a token would satisfy two demands. Compare against formal semantics/appropriate native verifier, not the corrupt simulator bypass. This cannot be implemented as duplicate-arc weight summation and is not part of the native-compatible first release.

## Remaining evidence gates and finish criteria

The harness directly observed supported local synchronization/manual consumption, shared delay traversal under the described substitute predicate, a local shared transport and IO conflict/normalization behavior. It did not execute native GUI undo, native composer on every shared case, all inhibitor/weighted/transport combinations, GUI urgency enforcement, or released file nonzero ages anew. Those are explicitly unverified here. Wave acceptance tests requiring them are release gates, not claims of present conformance.

Before merging either wave: old native/disjoint 124/213 and existing 745-test baseline (plus new tests) remain passing; typecheck, format and build retain budgets; focused source/engine/native comparisons pass; existing constants and clipboard harnesses remain passing; browser/UI validation is a future implementation task with temporary environment cleanup. A design or parser-only increment must not announce sharing support. Unsupported combinations must preserve the file/source and explain their gate; never partially open a numerically flattened shared model.
