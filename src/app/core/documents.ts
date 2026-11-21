import { newId } from './ids';
import { Net, validateName, validateNet } from './net';
import {
  CapabilityOptions,
  ModelType,
  SUPPORTED_MODEL_TYPE,
  TIMED_MODEL_TYPE,
  modelCapabilities,
  requireEditableModelType,
} from './model-types';
import {
  Decimal,
  MAX_TIMED_TOKENS,
  TimeInterval,
  TimeInvariant,
  TimedModel,
  compareAges,
  validateInterval,
  validateInvariant,
  validateTimedModel,
} from './timed';

import {
  ComponentTiming,
  Component,
  Network,
  emptyTiming,
  validateComponentTiming,
  validateNetwork,
} from './resolved-network';
export type { ComponentTiming, Component, Network } from './resolved-network';
export { emptyTiming, validateComponentTiming, validateNetwork } from './resolved-network';
export interface ComponentView {
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly selectedIds: readonly string[];
}
export interface DocumentSession {
  /** Viewed component is independent of participation in the network. */
  readonly componentId: string;
  readonly views: Readonly<Record<string, ComponentView>>;
}
export interface NetworkDocument {
  readonly id: string;
  readonly network: Network;
  readonly past: readonly Network[];
  readonly future: readonly Network[];
  /** null means a new document has never been saved. */
  readonly saved: Network | null;
  readonly session: DocumentSession;
}
export interface DocumentWorkspace {
  readonly documents: readonly NetworkDocument[];
  readonly activeDocumentId: string | null;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Clone all optional geometry, including fields unknown to this module. */
function snapshot<T>(value: T): T {
  return freeze(structuredClone(value));
}
// Net data is plain serializable model data. Sort object keys so insertion order is immaterial.
function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
function component(network: Network, id: string): Component {
  const result = network.components.find((item) => item.id === id);
  check(result, `Unknown component: ${id}.`);
  return result;
}
function unrestricted(interval: TimeInterval): boolean {
  return compareAges(interval.lower, '0') === 0 && interval.lowerClosed && interval.upper === null;
}
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
export function networkFromLegacyNet(net: Net): Network {
  validateNet(net);
  return snapshot({
    name: net.name,
    type: SUPPORTED_MODEL_TYPE,
    components: [{ id: newId(), active: true, net }],
  });
}
/** Supported disjoint networks execute through NetworkSimulation, including multiple components. */
export function networkCapabilities(
  network: Network,
  options: CapabilityOptions = {},
): {
  readonly editable: boolean;
  readonly executable: boolean;
  readonly reason: string | null;
} {
  validateNetwork(network);
  return modelCapabilities(network.type, options);
}
/**
 * The only timed execution entry point: one uncoloured, nongame, nonstochastic component. Network
 * has no shared places/transitions (parsers refuse them), hence sharedElementIds is empty.
 */
export function timedModelForNetwork(network: Network): TimedModel {
  validateNetwork(network);
  check(network.type.timed, 'This network is untimed; use the untimed simulator.');
  const unsupported = (['colored', 'game', 'stochastic'] as const).filter((k) => network.type[k]);
  check(
    !unsupported.length,
    `Timed execution does not support ${unsupported.join(', ')} semantics.`,
  );
  check(
    network.components.length === 1,
    `Timed execution supports exactly one component; this network has ${network.components.length}. Composed timed networks are not implemented.`,
  );
  const [{ net, timing }] = network.components;
  const places = net.nodes.filter((n) => n.kind === 'place');
  check(
    places.reduce((sum, place) => sum + place.tokens, 0) <= MAX_TIMED_TOKENS,
    `Timed execution supports at most ${MAX_TIMED_TOKENS} initial tokens.`,
  );
  const model: TimedModel = structuredClone({
    net,
    type: { ...TIMED_MODEL_TYPE },
    componentCount: 1,
    sharedElementIds: [],
    intervals: timing!.intervals,
    invariants: timing!.invariants,
    urgent: [...timing!.urgent],
    transports: [...timing!.transports],
    // Token IDs cannot collide: place IDs are unique and the index contains no colon.
    initial: places.flatMap((place) =>
      Array.from({ length: place.tokens }, (_, i) => ({
        id: `initial:${place.id}:${i}`,
        place: place.id,
        age: own(timing!.ages, place.id)?.[i] ?? '0',
      })),
    ),
  });
  validateTimedModel(model);
  return model;
}
/** A save adapter, never an implicit flatten/export-current-component operation. */
export function legacyNetFromNetwork(network: Network): Net {
  validateNetwork(network);
  requireEditableModelType(network.type);
  check(
    network.components.length === 1,
    'Cannot save a multi-component network as a legacy Net: extraction would lose components.',
  );
  check(
    !network.savedQueries,
    'Legacy Net export would lose saved queries; save the whole network instead.',
  );
  return structuredClone(network.components[0].net);
}
export function createDocument(options: {
  name: string;
  componentName?: string;
  type?: ModelType;
  id?: string;
}): NetworkDocument {
  const type = options.type ?? SUPPORTED_MODEL_TYPE;
  requireEditableModelType(type);
  const net: Net = {
    name: options.name,
    template: options.componentName ?? 'Net',
    nodes: [],
    arcs: [],
  };
  const network = { ...networkFromLegacyNet(net), type };
  return openNetworkDocument(network, { id: options.id, saved: false });
}
/** Dedicated opt-in factory: timed-only type, one active component, all-default timing. */
export function createTimedDocument(options: {
  name: string;
  componentName?: string;
  id?: string;
}): NetworkDocument {
  const net: Net = {
    name: options.name,
    template: options.componentName ?? 'Net',
    nodes: [],
    arcs: [],
  };
  const network: Network = {
    name: net.name,
    type: TIMED_MODEL_TYPE,
    components: [{ id: newId(), active: true, net, timing: emptyTiming() }],
  };
  return openNetworkDocument(network, { id: options.id, saved: false, timed: true });
}
/** Use saved:true only for a successfully loaded, supported document. Timed requires timed:true. */
export function openNetworkDocument(
  network: Network,
  options: { id?: string; saved?: boolean } & CapabilityOptions = {},
): NetworkDocument {
  validateNetwork(network);
  requireEditableModelType(network.type, options);
  const id = options.id ?? newId();
  check(id.length > 0, 'Document ID must be nonempty.');
  return snapshot({
    id,
    network,
    past: [],
    future: [],
    saved: options.saved ? network : null,
    session: { componentId: network.components[0].id, views: {} },
  });
}
export function isDirty(doc: NetworkDocument): boolean {
  return doc.saved === null || fingerprint(doc.network) !== fingerprint(doc.saved);
}
export function markSaved(doc: NetworkDocument): NetworkDocument {
  return freeze({ ...doc, saved: doc.network });
}
function reconcileSession(doc: NetworkDocument, network: Network): DocumentSession {
  const exists = network.components.some((item) => item.id === doc.session.componentId);
  // Keep dormant views for undo restoration. They never enter persistent network data.
  return {
    ...doc.session,
    componentId: exists ? doc.session.componentId : network.components[0].id,
  };
}
/** Atomic whole-network commit; validation failure leaves the input and history untouched. */
export function commitNetwork(doc: NetworkDocument, network: Network): NetworkDocument {
  check(
    fingerprint(doc.network.savedQueries) === fingerprint(network.savedQueries),
    'Saved queries and their protections must be retained. Use removeSavedQueries explicitly.',
  );
  return commitNetworkSnapshot(doc, network);
}
/** Explicit, undoable removal of all saved queries and their protections in one action. */
export function removeSavedQueries(doc: NetworkDocument): NetworkDocument {
  const { savedQueries: _removed, ...network } = doc.network;
  return commitNetworkSnapshot(doc, network);
}
function commitNetworkSnapshot(doc: NetworkDocument, network: Network): NetworkDocument {
  validateNetwork(network);
  // An opened timed document stays editable; commits never turn an untimed one timed.
  requireEditableModelType(network.type, { timed: doc.network.type.timed });
  if (fingerprint(doc.network) === fingerprint(network)) return doc;
  const next = snapshot(network);
  return freeze({
    ...doc,
    network: next,
    past: [...doc.past, doc.network],
    future: [],
    session: reconcileSession(doc, next),
  });
}
/** Writable isolated projection for NetEditor. This is a view, not a network save. */
export function activeNet(doc: NetworkDocument): Net {
  return structuredClone(component(doc.network, doc.session.componentId).net);
}
export function commitComponentNet(
  doc: NetworkDocument,
  net: Net,
  componentId = doc.session.componentId,
): NetworkDocument {
  const current = component(doc.network, componentId);
  validateNet(net);
  check(
    net.name === doc.network.name && net.template === current.net.template,
    'Use renameDocument/renameComponent to change names; component commits must retain network and component names.',
  );
  return commitNetwork(doc, {
    ...doc.network,
    components: doc.network.components.map((item) =>
      item.id === componentId
        ? { ...item, net, ...(item.timing ? { timing: reconcileTiming(item.timing, net) } : {}) }
        : item,
    ),
  });
}
/**
 * Drops timing of deleted elements. Refuses edits that would silently change timing meaning:
 * deleting one transport half, or reducing tokens below the recorded nonzero ages.
 */
function reconcileTiming(timing: ComponentTiming, net: Net): ComponentTiming {
  const ids = new Set([...net.nodes, ...net.arcs].map((item) => item.id));
  for (const pair of timing.transports)
    check(
      ids.has(pair.inputArc) === ids.has(pair.outputArc),
      `Deleting one half of transport ${pair.inputArc}/${pair.outputArc} would turn the other half into an ordinary arc. Use removeComponentElements to delete both, or removeTransport first.`,
    );
  const keep = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  const ages = keep(timing.ages);
  for (const [id, list] of Object.entries(ages)) {
    const place = net.nodes.find((n) => n.id === id)!;
    check(
      place.kind !== 'place' || place.tokens >= list.length,
      `Place ${place.name} has ${list.length} nonzero initial token ages; use setPlaceTokenAges to choose which tokens to remove.`,
    );
  }
  return {
    intervals: keep(timing.intervals),
    invariants: keep(timing.invariants),
    urgent: timing.urgent.filter((id) => ids.has(id)),
    transports: timing.transports.filter((pair) => ids.has(pair.inputArc)),
    ages,
  };
}
/** Native-style cascading delete: connected arcs, transport partner halves and their timing. */
export function removeComponentElements(
  doc: NetworkDocument,
  ids: readonly string[],
  componentId = doc.session.componentId,
): NetworkDocument {
  const { net, timing } = component(doc.network, componentId);
  const removed = new Set(ids);
  for (const arc of net.arcs)
    if (removed.has(arc.source) || removed.has(arc.target)) removed.add(arc.id);
  for (const pair of timing?.transports ?? [])
    if (removed.has(pair.inputArc) || removed.has(pair.outputArc)) {
      removed.add(pair.inputArc);
      removed.add(pair.outputArc);
    }
  const { annotations, ...rest } = net;
  const notes = annotations?.filter((note) => !removed.has(note.id));
  return commitComponentNet(
    doc,
    {
      ...rest,
      nodes: net.nodes.filter((n) => !removed.has(n.id)),
      arcs: net.arcs.filter((a) => !removed.has(a.id)),
      ...(notes?.length ? { annotations: notes } : {}),
    },
    componentId,
  );
}
function timingOf(doc: NetworkDocument, componentId: string): ComponentTiming {
  const { timing } = component(doc.network, componentId);
  check(timing, 'Timing metadata requires a timed network.');
  return timing;
}
/** One undo step replacing a timed component's Net and timing together, without reconciliation. */
export function commitTimedComponent(
  doc: NetworkDocument,
  net: Net,
  timing: ComponentTiming,
  componentId = doc.session.componentId,
): NetworkDocument {
  const current = component(doc.network, componentId);
  timingOf(doc, componentId);
  validateNet(net);
  check(
    net.name === doc.network.name && net.template === current.net.template,
    'Use renameDocument/renameComponent to change names; component commits must retain network and component names.',
  );
  return commitNetwork(doc, {
    ...doc.network,
    components: doc.network.components.map((item) =>
      item.id === componentId ? { ...item, net, timing } : item,
    ),
  });
}
function commitTiming(
  doc: NetworkDocument,
  componentId: string,
  timing: ComponentTiming,
): NetworkDocument {
  return commitTimedComponent(doc, component(doc.network, componentId).net, timing, componentId);
}
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}
/** null or [0,inf) restores the default. */
export function setArcInterval(
  doc: NetworkDocument,
  arcId: string,
  interval: TimeInterval | null,
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  if (interval) validateInterval(interval);
  const intervals = without(timing.intervals, arcId);
  if (interval && !unrestricted(interval)) intervals[arcId] = interval;
  return commitTiming(doc, componentId, { ...timing, intervals });
}
/** null or < inf restores the default. */
export function setPlaceInvariant(
  doc: NetworkDocument,
  placeId: string,
  invariant: TimeInvariant | null,
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  if (invariant) validateInvariant(invariant);
  const invariants = without(timing.invariants, placeId);
  if (invariant && invariant.upper !== null) invariants[placeId] = invariant;
  return commitTiming(doc, componentId, { ...timing, invariants });
}
export function setTransitionUrgent(
  doc: NetworkDocument,
  transitionId: string,
  urgent: boolean,
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  const others = timing.urgent.filter((id) => id !== transitionId);
  return commitTiming(doc, componentId, {
    ...timing,
    urgent: urgent ? [...others, transitionId] : others,
  });
}
/** Pairs two existing ordinary arcs of one transition into a transport arc. */
export function setTransport(
  doc: NetworkDocument,
  inputArc: string,
  outputArc: string,
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  return commitTiming(doc, componentId, {
    ...timing,
    transports: [...timing.transports, { inputArc, outputArc }],
  });
}
/** Unpairs the transport containing either half; both arcs remain as ordinary arcs. */
export function removeTransport(
  doc: NetworkDocument,
  arcId: string,
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  const transports = timing.transports.filter(
    (pair) => pair.inputArc !== arcId && pair.outputArc !== arcId,
  );
  check(transports.length < timing.transports.length, `Arc ${arcId} is not part of a transport.`);
  return commitTiming(doc, componentId, { ...timing, transports });
}
/** The controlled token-count edit for timed places: one exact age per resulting token. */
export function setPlaceTokenAges(
  doc: NetworkDocument,
  placeId: string,
  ages: readonly Decimal[],
  componentId = doc.session.componentId,
): NetworkDocument {
  const timing = timingOf(doc, componentId);
  const { net } = component(doc.network, componentId);
  check(
    net.nodes.some((n) => n.id === placeId && n.kind === 'place'),
    `Unknown place: ${placeId}.`,
  );
  check(Array.isArray(ages), 'Token ages must be a list.');
  const nonzero = ages.filter((age) => compareAges(age, '0') > 0);
  const rest = without(timing.ages, placeId);
  return commitTimedComponent(
    doc,
    {
      ...net,
      nodes: net.nodes.map((n) => (n.id === placeId ? { ...n, tokens: ages.length } : n)),
    },
    { ...timing, ages: nonzero.length ? { ...rest, [placeId]: [...nonzero] } : rest },
    componentId,
  );
}
export function renameDocument(doc: NetworkDocument, name: string): NetworkDocument {
  return commitNetwork(doc, {
    ...doc.network,
    name,
    components: doc.network.components.map((item) => ({ ...item, net: { ...item.net, name } })),
  });
}
export function renameComponent(doc: NetworkDocument, id: string, name: string): NetworkDocument {
  component(doc.network, id);
  validateName(name, 'Component identifier');
  return commitNetwork(doc, {
    ...doc.network,
    components: doc.network.components.map((item) =>
      item.id === id ? { ...item, net: { ...item.net, template: name } } : item,
    ),
  });
}
/**
 * Adds an active component and switches the view to it. Supplied Net geometry is cloned. In a timed
 * network the new component has default timing.
 */
export function addComponent(doc: NetworkDocument, name: string, source?: Net): NetworkDocument {
  return insertComponent(doc, name, source, doc.network.type.timed ? emptyTiming() : undefined);
}
function insertComponent(
  doc: NetworkDocument,
  name: string,
  source: Net | undefined,
  timing: ComponentTiming | undefined,
): NetworkDocument {
  const id = newId();
  const net: Net = source
    ? { ...source, name: doc.network.name, template: name }
    : { name: doc.network.name, template: name, nodes: [], arcs: [] };
  return switchComponent(
    commitNetwork(doc, {
      ...doc.network,
      components: [
        ...doc.network.components,
        { id, active: true, net, ...(timing ? { timing } : {}) },
      ],
    }),
    id,
  );
}
/** Copies the Net and its timing; local element IDs stay valid timing keys. */
export function copyComponent(doc: NetworkDocument, id: string, name: string): NetworkDocument {
  const source = component(doc.network, id);
  return insertComponent(doc, name, source.net, source.timing);
}
export function removeComponent(doc: NetworkDocument, id: string): NetworkDocument {
  component(doc.network, id);
  return commitNetwork(doc, {
    ...doc.network,
    components: doc.network.components.filter((item) => item.id !== id),
  });
}
export function setComponentActive(
  doc: NetworkDocument,
  id: string,
  active: boolean,
): NetworkDocument {
  component(doc.network, id);
  return commitNetwork(doc, {
    ...doc.network,
    components: doc.network.components.map((item) => (item.id === id ? { ...item, active } : item)),
  });
}
export function reorderComponents(doc: NetworkDocument, ids: readonly string[]): NetworkDocument {
  check(
    ids.length === doc.network.components.length && new Set(ids).size === ids.length,
    'Component order must be a permutation of all component IDs.',
  );
  return commitNetwork(doc, {
    ...doc.network,
    components: ids.map((id) => component(doc.network, id)),
  });
}
export function switchComponent(doc: NetworkDocument, id: string): NetworkDocument {
  component(doc.network, id);
  return freeze({ ...doc, session: { ...doc.session, componentId: id } });
}
export function setComponentView(
  doc: NetworkDocument,
  view: ComponentView,
  id = doc.session.componentId,
): NetworkDocument {
  component(doc.network, id);
  check(
    Number.isFinite(view.viewport.x) &&
      Number.isFinite(view.viewport.y) &&
      Number.isFinite(view.viewport.zoom) &&
      view.viewport.zoom > 0,
    'Viewport requires finite coordinates and positive zoom.',
  );
  return freeze({
    ...doc,
    session: { ...doc.session, views: { ...doc.session.views, [id]: snapshot(view) } },
  });
}
export function undoDocument(doc: NetworkDocument): NetworkDocument {
  const network = doc.past.at(-1);
  return network
    ? freeze({
        ...doc,
        network,
        past: doc.past.slice(0, -1),
        future: [...doc.future, doc.network],
        session: reconcileSession(doc, network),
      })
    : doc;
}
export function redoDocument(doc: NetworkDocument): NetworkDocument {
  const network = doc.future.at(-1);
  return network
    ? freeze({
        ...doc,
        network,
        past: [...doc.past, doc.network],
        future: doc.future.slice(0, -1),
        session: reconcileSession(doc, network),
      })
    : doc;
}

export function createWorkspace(): DocumentWorkspace {
  return freeze({ documents: [], activeDocumentId: null });
}
export function getDocument(
  workspace: DocumentWorkspace,
  id = workspace.activeDocumentId,
): NetworkDocument {
  const doc = workspace.documents.find((item) => item.id === id);
  check(doc, `Unknown document: ${id}.`);
  return doc;
}
export function openDocument(
  workspace: DocumentWorkspace,
  doc: NetworkDocument,
  options: CapabilityOptions = {},
): DocumentWorkspace {
  validateNetwork(doc.network);
  requireEditableModelType(doc.network.type, options);
  check(typeof doc.id === 'string' && doc.id.length > 0, 'Document ID must be nonempty.');
  component(doc.network, doc.session.componentId);
  check(!workspace.documents.some((item) => item.id === doc.id), 'Document ID is already open.');
  return freeze({ documents: [...workspace.documents, snapshot(doc)], activeDocumentId: doc.id });
}
export function switchDocument(workspace: DocumentWorkspace, id: string): DocumentWorkspace {
  getDocument(workspace, id);
  return freeze({ ...workspace, activeDocumentId: id });
}
/** Compose a document operation into a workspace without touching other histories. */
export function updateDocument(
  workspace: DocumentWorkspace,
  id: string,
  edit: (doc: NetworkDocument) => NetworkDocument,
): DocumentWorkspace {
  const prior = getDocument(workspace, id);
  const next = edit(prior);
  check(next.id === id, 'Document operations must preserve document identity.');
  validateNetwork(next.network);
  requireEditableModelType(next.network.type, { timed: prior.network.type.timed });
  component(next.network, next.session.componentId);
  return freeze({
    ...workspace,
    documents: workspace.documents.map((item) => (item.id === id ? snapshot(next) : item)),
  });
}
/** Refusal throws; callers retain the original workspace. Explicit discard is the only bypass. */
export function closeDocument(
  workspace: DocumentWorkspace,
  id: string,
  options: { discard?: boolean } = {},
): DocumentWorkspace {
  const doc = getDocument(workspace, id);
  check(
    !isDirty(doc) || options.discard === true,
    'Document has unsaved changes; save it or explicitly discard before closing.',
  );
  const index = workspace.documents.indexOf(doc);
  const documents = workspace.documents.filter((item) => item.id !== id);
  const activeDocumentId =
    workspace.activeDocumentId === id
      ? (documents[Math.min(index, documents.length - 1)]?.id ?? null)
      : workspace.activeDocumentId;
  return freeze({ documents, activeDocumentId });
}
