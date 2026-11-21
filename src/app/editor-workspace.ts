import { newId } from './core/ids';
/** The UI owns authored documents only. Numeric graphs are disposable canvas/engine inputs. */
import {
  copyAuthoredSelection,
  prepareAuthoredPaste,
  AuthoredClipboard,
} from './core/authored-clipboard';
import type { PasteOptions } from './core/clipboard';
import * as legacy from './core/documents';
import * as authored from './core/authored-documents';
import {
  AuthoredNetwork,
  AuthoredNet,
  AuthoredTiming,
  Result,
  Use,
  authoredFromNumeric,
  freezeAuthored,
  resolveAuthored,
  authoredFingerprint,
} from './core/authored-model';
import { Net, NetNode } from './core/net';
import {
  SharedSource,
  SharedDocument,
  SharedOccurrence,
  SharedEdit,
  LocalNode,
  sharedFromAuthored,
  validateSharedSource,
  openSharedDocument,
  transactShared,
} from './core/authored-shared';
export { sharedConstantUses as constantUses } from './core/authored-shared';
import { CapabilityOptions, requireEditableModelType } from './core/model-types';
export type NetworkDocument = SharedDocument;
export type Network = SharedSource;
export type { ComponentTiming, ComponentView } from './core/documents';
export interface DocumentWorkspace {
  readonly documents: readonly NetworkDocument[];
  readonly activeDocumentId: string | null;
}
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(
      result.issues
        .map(
          (i) =>
            `${i.message}${i.uses.length ? ' Uses: ' + i.uses.map((u) => [u.componentId, u.elementId, u.field].filter(Boolean).join(' / ')).join('; ') : ''}`,
        )
        .join('\n'),
    );
  return result.value;
}
export function isSharedOccurrence(
  node: SharedSource['components'][number]['net']['nodes'][number],
): node is SharedOccurrence {
  return 'sharedId' in node;
}
/** Disposable display/clipboard-placement graph. NEVER a source or execution model. */
export function displaySource(network: Network): AuthoredNetwork {
  const { shared, savedQueries, ...rest } = network;
  return {
    ...rest,
    ...(savedQueries
      ? {
          savedQueries: {
            xml: savedQueries.xml,
            protectedComponents: savedQueries.protectedComponents,
            protectedConstants: savedQueries.protectedConstants,
          },
        }
      : {}),
    components: network.components.map((c) => {
      const invariants = { ...c.timing?.invariants },
        ages = { ...c.timing?.ages };
      const urgent = [...(c.timing?.urgent ?? [])];
      return {
        ...c,
        net: {
          ...c.net,
          nodes: c.net.nodes.map((n) => {
            if (!isSharedOccurrence(n)) {
              const { actor: _actor, ...scalar } = n;
              return scalar;
            }
            if (n.kind === 'transition') {
              const pool = shared.transitions.find((p) => p.id === n.sharedId)!;
              if (pool.urgent) urgent.push(n.id);
              const { sharedId: _shared, ...geometry } = n;
              return { ...geometry, name: pool.name, tokens: 0 };
            }
            const pool = shared.places.find((p) => p.id === n.sharedId)!;
            if (pool.timing?.invariant) invariants[n.id] = pool.timing.invariant;
            if (pool.timing?.ages.length) ages[n.id] = pool.timing.ages;
            const { sharedId: _shared, ...geometry } = n;
            return { ...geometry, name: pool.name, tokens: pool.tokens };
          }),
        },
        ...(c.timing ? { timing: { ...c.timing, invariants, ages, urgent } } : {}),
      };
    }),
  };
}
export function numeric(network: Network): legacy.Network {
  if (network.type.game) throw new Error('Game sources require the manual game adapter.');
  return displayNumeric(network);
}
/** Disposable canvas projection; never used for execution or saving. */
export function displayNumeric(network: Network): legacy.Network {
  unwrap(validateSharedSource(network));
  const display = displaySource(network);
  const resolved = unwrap(
    resolveAuthored({
      ...display,
      type: { ...display.type, game: false },
      components: display.components.map((c, i) => (i === 0 ? { ...c, active: true } : c)),
    }),
  ).numeric;
  return {
    ...structuredClone(resolved),
    type: structuredClone(network.type),
    components: resolved.components.map((c) => ({
      ...structuredClone(c),
      active: network.components.find((original) => original.id === c.id)!.active,
    })),
  } as unknown as legacy.Network;
}
export function networkFromLegacyNet(net: Net): Network {
  return unwrap(sharedFromAuthored(unwrap(authoredFromNumeric(legacy.networkFromLegacyNet(net)))));
}
export function openNetworkDocument(
  network: Network | AuthoredNetwork | legacy.Network,
  options: { id?: string; saved?: boolean } & CapabilityOptions = {},
): NetworkDocument {
  requireEditableModelType(network.type, options);
  const source =
    'shared' in network
      ? network
      : unwrap(
          sharedFromAuthored(
            'constants' in network ? network : unwrap(authoredFromNumeric(network)),
          ),
        );
  return unwrap(
    openSharedDocument(source, {
      ...(options.id ? { id: options.id } : {}),
      saved: options.saved ?? false,
    }),
  );
}
export function createDocument(
  options: Parameters<typeof legacy.createDocument>[0],
): NetworkDocument {
  const doc = legacy.createDocument(options);
  return openNetworkDocument(doc.network, { id: doc.id, saved: false });
}
export function createTimedDocument(
  options: Parameters<typeof legacy.createTimedDocument>[0],
): NetworkDocument {
  const doc = legacy.createTimedDocument(options);
  return openNetworkDocument(doc.network, { id: doc.id, saved: false, timed: true });
}
export function createGameDocument(options: {
  name: string;
  componentName: string;
  timed?: boolean;
}): NetworkDocument {
  const base = options.timed ? createTimedDocument(options) : createDocument(options);
  return unwrap(
    openSharedDocument({ ...base.network, type: { ...base.network.type, game: true } }),
  );
}
export const isDirty = authored.isAuthoredDirty;
export const undoDocument = authored.undoAuthored;
export const redoDocument = authored.redoAuthored;
export function transact(doc: NetworkDocument, edit: authored.AuthoredEdit): NetworkDocument {
  if (edit.kind === 'updateConstant' || edit.kind === 'deleteConstant')
    return sharedTransact(doc, edit);
  return sharedTransact(doc, { kind: 'localEdit', edit });
}
export function sharedTransact(doc: NetworkDocument, edit: SharedEdit): NetworkDocument {
  const result = transactShared(doc, doc.network, edit);
  if (!result.ok)
    throw new Error(
      result.issues
        .map(
          (issue) =>
            issue.message +
            (issue.uses.length
              ? ' Uses: ' + issue.uses.map((use) => useLabel(doc.network, use)).join('; ')
              : ''),
        )
        .join('\n'),
    );
  return result.value;
}
export function sourceComponent(doc: NetworkDocument, id = doc.session.componentId) {
  const component = doc.network.components.find((c) => c.id === id);
  if (!component) throw new Error(`Unknown component ${id}.`);
  return component;
}
export function activeNet(doc: NetworkDocument): Net {
  return displayNumeric(doc.network).components.find((c) => c.id === doc.session.componentId)!.net;
}
/** Retained arcs take semantics from source, never from numeric equality or differences. */
function geometryPatch(doc: NetworkDocument, net: Net, componentId: string): AuthoredNet {
  const current = sourceComponent(doc, componentId);
  return {
    ...net,
    arcs: net.arcs.map((arc) => {
      const old = current.net.arcs.find((a) => a.id === arc.id);
      if (!old) return arc;
      if (old.kind !== arc.kind || old.source !== arc.source || old.target !== arc.target)
        throw new Error('Use arc properties to change arc semantics.');
      return { ...arc, weight: old.weight };
    }),
  };
}
export function commitComponentNet(
  doc: NetworkDocument,
  net: Net,
  componentId = doc.session.componentId,
): NetworkDocument {
  return transact(doc, {
    kind: 'patchNet',
    componentId,
    net: geometryPatch(doc, net, componentId),
  });
}
/** Clipboard supplies new numeric elements only; existing timing always comes from source. */
export function commitTimedComponent(
  doc: NetworkDocument,
  net: Net,
  timing: legacy.ComponentTiming,
  componentId = doc.session.componentId,
): NetworkDocument {
  const source = sourceComponent(doc, componentId);
  const oldIds = new Set([...source.net.nodes, ...source.net.arcs].map((e) => e.id));
  const additions = <T>(map: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(map).filter(([id]) => !oldIds.has(id)));
  const next: AuthoredTiming = {
    ...source.timing!,
    intervals: { ...source.timing!.intervals, ...additions(timing.intervals) },
    invariants: { ...source.timing!.invariants, ...additions(timing.invariants) },
    ages: { ...source.timing!.ages, ...additions(timing.ages) },
    urgent: [...source.timing!.urgent, ...timing.urgent.filter((id) => !oldIds.has(id))],
    transports: [
      ...source.timing!.transports,
      ...timing.transports.filter((p) => !oldIds.has(p.inputArc) && !oldIds.has(p.outputArc)),
    ],
  };
  return transact(doc, {
    kind: 'addElements',
    componentId,
    net: geometryPatch(doc, net, componentId),
    timing: next,
  });
}
export function removeComponentElements(
  doc: NetworkDocument,
  ids: readonly string[],
  componentId = doc.session.componentId,
): NetworkDocument {
  const { net, timing } = sourceComponent(doc, componentId);
  const removed = new Set(ids);
  for (const arc of net.arcs)
    if (removed.has(arc.source) || removed.has(arc.target)) removed.add(arc.id);
  for (const pair of timing?.transports ?? [])
    if (removed.has(pair.inputArc) || removed.has(pair.outputArc)) {
      removed.add(pair.inputArc);
      removed.add(pair.outputArc);
    }
  const { annotations, ...rest } = net;
  const notes = annotations?.filter((n) => !removed.has(n.id));
  return transact(doc, {
    kind: 'patchNet',
    componentId,
    net: {
      ...rest,
      nodes: displaySource(doc.network)
        .components.find((c) => c.id === componentId)!
        .net.nodes.filter((n) => !removed.has(n.id)),
      arcs: net.arcs.filter((a) => !removed.has(a.id)),
      ...(notes?.length ? { annotations: notes } : {}),
    },
  });
}
export function renameDocument(doc: NetworkDocument, name: string) {
  return transact(doc, { kind: 'renameNetwork', name });
}
export function renameComponent(doc: NetworkDocument, id: string, name: string) {
  return transact(doc, {
    kind: 'patchComponent',
    componentId: id,
    active: sourceComponent(doc, id).active,
    template: name,
  });
}
export function setComponentActive(doc: NetworkDocument, id: string, active: boolean) {
  return transact(doc, {
    kind: 'patchComponent',
    componentId: id,
    active,
    template: sourceComponent(doc, id).net.template,
  });
}
export function reorderComponents(doc: NetworkDocument, ids: readonly string[]) {
  return transact(doc, { kind: 'reorderComponents', ids });
}
export function removeComponent(doc: NetworkDocument, id: string) {
  return transact(doc, { kind: 'removeComponent', componentId: id });
}
export function removeSavedQueries(doc: NetworkDocument) {
  return transact(doc, { kind: 'removeSavedQueries' });
}
export function addComponent(doc: NetworkDocument, name: string) {
  const id = newId();
  return switchComponent(
    transact(doc, {
      kind: 'addComponent',
      component: {
        id,
        active: true,
        net: { name: doc.network.name, template: name, nodes: [], arcs: [] },
        ...(doc.network.type.timed ? { timing: legacy.emptyTiming() } : {}),
      },
    }),
    id,
  );
}
export function copyComponent(doc: NetworkDocument, componentId: string, name: string) {
  const id = newId();
  // Native UI copies are active, including copies of inactive components; one history entry.
  sourceComponent(doc, componentId);
  return switchComponent(
    sharedTransact(doc, { kind: 'copyComponent', componentId, id, template: name }),
    id,
  );
}
export function switchComponent(doc: NetworkDocument, id: string): NetworkDocument {
  sourceComponent(doc, id);
  return id === doc.session.componentId
    ? doc
    : freezeAuthored({ ...doc, session: { ...doc.session, componentId: id } });
}
export function setComponentView(
  doc: NetworkDocument,
  view: legacy.ComponentView,
  id = doc.session.componentId,
): NetworkDocument {
  sourceComponent(doc, id);
  if (
    ![view.viewport.x, view.viewport.y, view.viewport.zoom].every(Number.isFinite) ||
    view.viewport.zoom <= 0
  )
    throw new Error('Viewport requires finite coordinates and positive zoom.');
  if (authoredFingerprint(doc.session.views[id]) === authoredFingerprint(view)) return doc;
  return freezeAuthored({
    ...doc,
    session: { ...doc.session, views: { ...doc.session.views, [id]: structuredClone(view) } },
  });
}
export function createWorkspace(): DocumentWorkspace {
  return Object.freeze({ documents: [], activeDocumentId: null });
}
export function getDocument(
  workspace: DocumentWorkspace,
  id = workspace.activeDocumentId,
): NetworkDocument {
  const doc = workspace.documents.find((d) => d.id === id);
  if (!doc) throw new Error(`Unknown document: ${id}.`);
  return doc;
}
export function openDocument(
  workspace: DocumentWorkspace,
  doc: NetworkDocument,
  options: CapabilityOptions = {},
): DocumentWorkspace {
  unwrap(validateSharedSource(doc.network));
  requireEditableModelType(doc.network.type, options);
  if (workspace.documents.some((d) => d.id === doc.id))
    throw new Error('Document ID is already open.');
  return freezeAuthored({ documents: [...workspace.documents, doc], activeDocumentId: doc.id });
}
export function switchDocument(workspace: DocumentWorkspace, id: string): DocumentWorkspace {
  getDocument(workspace, id);
  return freezeAuthored({ ...workspace, activeDocumentId: id });
}
export function updateDocument(
  workspace: DocumentWorkspace,
  id: string,
  edit: (doc: NetworkDocument) => NetworkDocument,
): DocumentWorkspace {
  const prior = getDocument(workspace, id),
    next = edit(prior);
  if (next === prior) return workspace;
  if (next.id !== id) throw new Error('Document identity must be preserved.');
  unwrap(validateSharedSource(next.network));
  return freezeAuthored({
    ...workspace,
    documents: workspace.documents.map((d) => (d.id === id ? next : d)),
  });
}
export function closeDocument(
  workspace: DocumentWorkspace,
  id: string,
  options: { discard?: boolean } = {},
): DocumentWorkspace {
  const doc = getDocument(workspace, id);
  if (isDirty(doc) && !options.discard)
    throw new Error('Document has unsaved changes; save it or explicitly discard before closing.');
  const index = workspace.documents.indexOf(doc),
    documents = workspace.documents.filter((d) => d.id !== id);
  return freezeAuthored({
    documents,
    activeDocumentId:
      workspace.activeDocumentId === id
        ? (documents[Math.min(index, documents.length - 1)]?.id ?? null)
        : workspace.activeDocumentId,
  });
}
export function copySelection(doc: NetworkDocument, selected: readonly string[]) {
  if (doc.network.type.game)
    throw new Error(
      'Game subnet clipboard transfers are unavailable; copy a component to preserve roles.',
    );
  const component = sourceComponent(doc),
    ids = new Set(selected);
  const members = new Set(component.net.nodes.filter(isSharedOccurrence).map((n) => n.id));
  if (
    selected.some((id) => members.has(id)) ||
    component.net.arcs.some(
      (a) => ids.has(a.id) && (members.has(a.source) || members.has(a.target)),
    )
  ) {
    const affected = component.net.nodes.filter(
      (n) =>
        members.has(n.id) &&
        (ids.has(n.id) ||
          component.net.arcs.some(
            (a) => ids.has(a.id) && (a.source === n.id || a.target === n.id),
          )),
    );
    const kinds = new Set(affected.map((n) => n.kind));
    const kind = kinds.size === 1 ? affected[0].kind : 'element';
    throw new Error(
      `Shared ${kind} occurrences cannot be copied, cut or duplicated yet. Copy the component to retain membership, or select only local elements. Nothing was changed.`,
    );
  }
  return copyAuthoredSelection(
    { ...doc, network: displaySource(doc.network), past: [], future: [], saved: null },
    selected,
  );
}
export function pasteAuthoredSelection(
  doc: NetworkDocument,
  content: AuthoredClipboard,
  options: Pick<PasteOptions, 'nodeName' | 'elementId'> = {},
) {
  if (doc.network.type.game)
    throw new Error(
      'Game subnet clipboard transfers are unavailable; copy a component to preserve roles.',
    );
  const prepared = prepareAuthoredPaste(
    { ...doc, network: displaySource(doc.network), past: [], future: [], saved: null },
    content,
    options,
  );
  for (const n of prepared.edit.net.nodes) {
    if (
      !sourceComponent(doc).net.nodes.some((old) => old.id === n.id) &&
      [...doc.network.shared.places, ...doc.network.shared.transitions].some(
        (p) => p.name === n.name,
      )
    )
      throw new Error(
        `Cannot paste: ${n.name} is a global shared ${doc.network.shared.transitions.some((p) => p.name === n.name) ? 'transition' : 'place'} name. Choose a different local name.`,
      );
  }
  return { document: transact(doc, prepared.edit), selectedIds: prepared.selectedIds };
}
export function useLabel(network: Network, use: Use): string {
  if (use.poolId)
    return `Shared place ${network.shared.places.find((p) => p.id === use.poolId)?.name ?? 'removed'} / ${use.field} (${use.activeMemberCount ?? 0} active components)`;
  if (use.field === 'saved-query-protection') return 'Protected by saved queries (not a model use)';
  const c = network.components.find((c) => c.id === use.componentId)!;
  const element = displaySource(network)
    .components.find((component) => component.id === c.id)!
    .net.nodes.find((n) => n.id === use.elementId);
  const arc = c.net.arcs.find((arc) => arc.id === use.elementId);
  const label =
    element?.name ??
    (arc
      ? [arc.source, arc.target]
          .map(
            (id) =>
              displaySource(network)
                .components.find((component) => component.id === c.id)!
                .net.nodes.find((node) => node.id === id)?.name ?? id,
          )
          .join(' → ')
      : use.elementId);
  return `${c.net.template}${c.active ? '' : ' (inactive)'} / ${label} / ${use.field}`;
}
/** Closed numeric-only controls retain every authored bound and weight on the element. */
export function setPlaceTokenAges(doc: NetworkDocument, placeId: string, ages: readonly string[]) {
  const c = sourceComponent(doc),
    place = c.net.nodes.find((n) => n.id === placeId && n.kind === 'place');
  if (!place || !c.timing) throw new Error('Unknown timed place.');
  return transact(doc, {
    kind: 'editElement',
    componentId: c.id,
    element: { ...(place as NetNode), tokens: ages.length },
    timing: {
      invariant: Object.hasOwn(c.timing.invariants, placeId) ? c.timing.invariants[placeId] : null,
      interval: null,
      ages,
      urgent: false,
      outputArc: '',
    },
  });
}
export function setPlaceInvariant(
  doc: NetworkDocument,
  placeId: string,
  invariant: import('./core/authored-model').AuthoredInvariant | null,
) {
  return transact(doc, {
    kind: 'setInvariant',
    componentId: doc.session.componentId,
    placeId,
    invariant,
  });
}
export function setTransitionUrgent(doc: NetworkDocument, transitionId: string, urgent: boolean) {
  const c = sourceComponent(doc),
    element = c.net.nodes.find((n) => n.id === transitionId && n.kind === 'transition');
  if (!element || !c.timing) throw new Error('Unknown timed transition.');
  const { actor: _actor, ...scalar } = element as LocalNode;
  return transact(doc, {
    kind: 'editElement',
    componentId: c.id,
    element: scalar,
    timing: { invariant: null, interval: null, ages: [], urgent, outputArc: '' },
  });
}
