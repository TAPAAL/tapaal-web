import { newId } from './ids';
import type { NetNode } from './net';
import { compareAges } from './timed';
import type { NetworkDocument, DocumentSession } from './documents';
import type { Network } from './resolved-network';
import {
  AuthoredNetwork,
  AuthoredComponent,
  AuthoredNet,
  AuthoredArc,
  AuthoredTiming,
  AuthoredInterval,
  AuthoredInvariant,
  ConstantDecl,
  WeightTerm,
  Result,
  ReadonlyData,
  authoredCheck,
  authoredFailure,
  authoredFingerprint,
  authoredFromNumeric,
  closedAuthored,
  constantUses,
  freezeAuthored,
  resolveAuthored,
} from './authored-model';

export interface SnapshotDocument<N> {
  readonly id: string;
  readonly network: N;
  readonly past: readonly N[];
  readonly future: readonly N[];
  readonly saved: N | null;
  readonly session: ReadonlyData<DocumentSession>;
}
export type AuthoredDocument = SnapshotDocument<AuthoredNetwork>;
export type AuthoredEdit =
  | {
      readonly kind: 'pasteElements';
      readonly componentId: string;
      readonly net: AuthoredNet;
      readonly timing: AuthoredTiming | null;
      readonly constants: readonly ConstantDecl[];
    }
  | { readonly kind: 'reorderComponents'; readonly ids: readonly string[] }
  | {
      readonly kind: 'addElements';
      readonly componentId: string;
      readonly net: AuthoredNet;
      readonly timing: AuthoredTiming | null;
    }
  | {
      readonly kind: 'editElement';
      readonly componentId: string;
      readonly element: NetNode | AuthoredArc;
      readonly timing: {
        readonly invariant: AuthoredInvariant | null;
        readonly interval: AuthoredInterval | null;
        readonly ages: readonly string[];
        readonly urgent: boolean;
        readonly outputArc: string;
      } | null;
    }
  | { readonly kind: 'addConstant'; readonly constant: ConstantDecl }
  | {
      readonly kind: 'updateConstant';
      readonly id: string;
      readonly name: string;
      readonly value: number;
    }
  | { readonly kind: 'deleteConstant'; readonly id: string }
  | {
      readonly kind: 'setWeightTerm';
      readonly componentId: string;
      readonly arcId: string;
      readonly term: WeightTerm;
    }
  | {
      readonly kind: 'setInterval';
      readonly componentId: string;
      readonly arcId: string;
      readonly interval: AuthoredInterval | null;
    }
  | {
      readonly kind: 'setInvariant';
      readonly componentId: string;
      readonly placeId: string;
      readonly invariant: AuthoredInvariant | null;
    }
  /** Existing arc semantics must match exactly. Dedicated setters express semantic intent. */
  | { readonly kind: 'patchNet'; readonly componentId: string; readonly net: AuthoredNet }
  | { readonly kind: 'addComponent'; readonly component: AuthoredComponent }
  | {
      readonly kind: 'copyComponent';
      readonly componentId: string;
      readonly id: string;
      readonly template: string;
    }
  | { readonly kind: 'removeComponent'; readonly componentId: string }
  | {
      readonly kind: 'patchComponent';
      readonly componentId: string;
      readonly active: boolean;
      readonly template: string;
    }
  | { readonly kind: 'renameNetwork'; readonly name: string }
  | { readonly kind: 'removeSavedQueries' };
const editKeys: Record<AuthoredEdit['kind'], readonly string[]> = {
  reorderComponents: ['kind', 'ids'],
  addElements: ['kind', 'componentId', 'net', 'timing'],
  pasteElements: ['kind', 'componentId', 'net', 'timing', 'constants'],
  editElement: ['kind', 'componentId', 'element', 'timing'],
  addConstant: ['kind', 'constant'],
  updateConstant: ['kind', 'id', 'name', 'value'],
  deleteConstant: ['kind', 'id'],
  setWeightTerm: ['kind', 'componentId', 'arcId', 'term'],
  setInterval: ['kind', 'componentId', 'arcId', 'interval'],
  setInvariant: ['kind', 'componentId', 'placeId', 'invariant'],
  patchNet: ['kind', 'componentId', 'net'],
  addComponent: ['kind', 'component'],
  copyComponent: ['kind', 'componentId', 'id', 'template'],
  removeComponent: ['kind', 'componentId'],
  patchComponent: ['kind', 'componentId', 'active', 'template'],
  renameNetwork: ['kind', 'name'],
  removeSavedQueries: ['kind'],
};
function validateSession(session: ReadonlyData<DocumentSession>, source: AuthoredNetwork): void {
  closedAuthored(session, ['componentId', 'views']);
  authoredCheck(
    typeof session.componentId === 'string' &&
      source.components.some((component) => component.id === session.componentId),
    'Session must name an existing component.',
  );
  closedAuthored(session.views);
  for (const view of Object.values(session.views)) {
    closedAuthored(view, ['viewport', 'selectedIds']);
    closedAuthored(view.viewport, ['x', 'y', 'zoom']);
    authoredCheck(
      ['x', 'y', 'zoom'].every((key) =>
        Number.isFinite(view.viewport[key as keyof typeof view.viewport]),
      ) && view.viewport.zoom > 0,
      'Session viewport must contain finite coordinates and a positive zoom.',
    );
    const ids = view.selectedIds;
    authoredCheck(
      Array.isArray(ids) &&
        Object.getPrototypeOf(ids) === Array.prototype &&
        Reflect.ownKeys(ids).length === ids.length + 1,
      'Session selection must be a plain dense array.',
    );
    for (let index = 0; index < ids.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(ids, index);
      authoredCheck(
        !!descriptor &&
          descriptor.enumerable &&
          'value' in descriptor &&
          typeof descriptor.value === 'string' &&
          descriptor.value.length > 0,
        'Session selection must contain plain element IDs.',
      );
    }
  }
}
export function openAuthoredDocument(
  network: AuthoredNetwork,
  options: { id?: string; saved?: boolean; session?: ReadonlyData<DocumentSession> } = {},
): Result<AuthoredDocument> {
  try {
    closedAuthored(options, ['id', 'saved', 'session']);
    authoredCheck(
      options.saved === undefined || typeof options.saved === 'boolean',
      'Saved must be boolean.',
    );
    const checked = resolveAuthored(network);
    if (!checked.ok) return checked;
    const source = freezeAuthored(structuredClone(network));
    const id = options.id === undefined ? newId() : options.id;
    if (typeof id !== 'string' || !id.length)
      return authoredFailure(new Error('Document ID must be nonempty.'));
    const session =
      options.session === undefined
        ? { componentId: source.components[0].id, views: {} }
        : options.session;
    validateSession(session, source);
    return {
      ok: true,
      value: freezeAuthored({
        id,
        network: source,
        past: [],
        future: [],
        saved: options.saved ? source : null,
        session: structuredClone(session),
      }),
    };
  } catch (error) {
    return authoredFailure(error);
  }
}
/** Explicit migration of every numeric history snapshot; no second numeric history is retained. */
export function authoredDocumentFromNumeric(doc: NetworkDocument): Result<AuthoredDocument> {
  try {
    const revisions = new Map<Network, AuthoredNetwork>();
    const convert = (n: Network): AuthoredNetwork => {
      if (!revisions.has(n)) {
        const result = authoredFromNumeric(n);
        if (!result.ok) throw new Error(result.issues.map((i) => i.message).join(' '));
        revisions.set(n, result.value);
      }
      return revisions.get(n)!;
    };
    return {
      ok: true,
      value: freezeAuthored({
        id: doc.id,
        network: convert(doc.network),
        past: doc.past.map(convert),
        // Numeric redo pops the last entry; authored redo shifts the first.
        future: [...doc.future].reverse().map(convert),
        saved: doc.saved ? convert(doc.saved) : null,
        session: structuredClone(doc.session),
      }),
    };
  } catch (e) {
    return authoredFailure(e);
  }
}
function sessionFor<N extends { readonly components: readonly { readonly id: string }[] }>(
  doc: SnapshotDocument<N>,
  n: N,
): ReadonlyData<DocumentSession> {
  return n.components.some((c) => c.id === doc.session.componentId)
    ? doc.session
    : freezeAuthored({ ...doc.session, componentId: n.components[0].id });
}
export function undoAuthored<N extends { readonly components: readonly { readonly id: string }[] }>(
  doc: SnapshotDocument<N>,
): SnapshotDocument<N> {
  if (!doc.past.length) return doc;
  const network = doc.past[doc.past.length - 1];
  return Object.freeze({
    ...doc,
    network,
    past: Object.freeze(doc.past.slice(0, -1)),
    future: Object.freeze([doc.network, ...doc.future]),
    session: sessionFor(doc, network),
  });
}
export function redoAuthored<N extends { readonly components: readonly { readonly id: string }[] }>(
  doc: SnapshotDocument<N>,
): SnapshotDocument<N> {
  if (!doc.future.length) return doc;
  const network = doc.future[0];
  return Object.freeze({
    ...doc,
    network,
    past: Object.freeze([...doc.past, doc.network]),
    future: Object.freeze(doc.future.slice(1)),
    session: sessionFor(doc, network),
  });
}
export function markAuthoredSaved<N>(doc: SnapshotDocument<N>): SnapshotDocument<N> {
  return Object.freeze({ ...doc, saved: doc.network });
}
export function isAuthoredDirty<N>(doc: SnapshotDocument<N>): boolean {
  return !doc.saved || authoredFingerprint(doc.saved) !== authoredFingerprint(doc.network);
}

/** Compare captured snapshot identity before reading drafts; failure never changes any input alias. */
export function transactDocument(
  doc: AuthoredDocument,
  expected: AuthoredNetwork,
  edit: AuthoredEdit,
): Result<AuthoredDocument> {
  if (doc.network !== expected)
    return {
      ok: false,
      issues: [
        {
          code: 'stale-revision',
          message: 'The authored revision changed; reopen the edit.',
          uses: [],
        },
      ],
    };
  try {
    closedAuthored(edit);
    authoredCheck(Object.hasOwn(editKeys, edit.kind), 'Unknown authored edit.');
    closedAuthored(edit, editKeys[edit.kind]);
    authoredCheck(
      editKeys[edit.kind].every((k) => Object.hasOwn(edit, k)),
      'Missing edit fields.',
    );
    // Do not clone drafts before validation: that would hide inherited/extra fields.
    let candidate: AuthoredNetwork = structuredClone(doc.network);
    const componentId = 'componentId' in edit ? edit.componentId : undefined;
    const current =
      componentId === undefined
        ? undefined
        : candidate.components.find((c) => c.id === componentId);
    if (componentId !== undefined) authoredCheck(current, `Unknown component ${componentId}.`);
    const changeComponent = (c: AuthoredComponent) => {
      candidate = {
        ...candidate,
        components: candidate.components.map((old) => (old.id === c.id ? c : old)),
      };
    };
    switch (edit.kind) {
      case 'reorderComponents': {
        authoredCheck(
          edit.ids.length === candidate.components.length &&
            new Set(edit.ids).size === edit.ids.length &&
            edit.ids.every((id) => candidate.components.some((c) => c.id === id)),
          'Component order must contain every component exactly once.',
        );
        candidate = {
          ...candidate,
          components: edit.ids.map((id) => candidate.components.find((c) => c.id === id)!),
        };
        break;
      }
      case 'pasteElements':
      case 'addElements': {
        if (edit.kind === 'pasteElements') {
          authoredCheck(
            Array.isArray(edit.constants) &&
              Object.getPrototypeOf(edit.constants) === Array.prototype &&
              Reflect.ownKeys(edit.constants).length === edit.constants.length + 1,
            'Paste declarations must be a plain dense list.',
          );
          for (let i = 0; i < edit.constants.length; i++) {
            const descriptor = Object.getOwnPropertyDescriptor(edit.constants, i);
            authoredCheck(
              descriptor && descriptor.enumerable && 'value' in descriptor,
              'Paste declarations must be own data.',
            );
            closedAuthored(descriptor.value, ['id', 'name', 'value']);
          }
          candidate = { ...candidate, constants: [...candidate.constants, ...edit.constants] };
          // Validate draft descriptors before preservation comparisons can read nested values.
          // This projection is discarded; only authored data can enter history.
          const inspected = resolveAuthored({
            ...candidate,
            components: candidate.components.map((c) =>
              c.id === current!.id
                ? { ...c, net: edit.net, ...(edit.timing === null ? {} : { timing: edit.timing }) }
                : c,
            ),
          });
          if (!inspected.ok) return inspected;
        }
        for (const field of ['nodes', 'arcs'] as const)
          for (const old of current!.net[field])
            authoredCheck(
              authoredFingerprint(edit.net[field].find((e) => e.id === old.id)) ===
                authoredFingerprint(old),
              'Adding elements must preserve all existing elements.',
            );
        authoredCheck(
          edit.net.name === current!.net.name && edit.net.template === current!.net.template,
          'Adding elements must preserve names.',
        );
        for (const note of current!.net.annotations ?? [])
          authoredCheck(
            authoredFingerprint(edit.net.annotations?.find((n) => n.id === note.id)) ===
              authoredFingerprint(note),
            'Adding elements must preserve annotations.',
          );
        if (current!.timing) {
          authoredCheck(edit.timing, 'Timed additions require timing.');
          for (const field of ['intervals', 'invariants', 'ages'] as const) {
            for (const element of [...current!.net.nodes, ...current!.net.arcs]) {
              const own = (t: AuthoredTiming) =>
                Object.hasOwn(t[field], element.id) ? t[field][element.id] : undefined;
              authoredCheck(
                authoredFingerprint(own(edit.timing)) === authoredFingerprint(own(current!.timing)),
                'Adding elements must preserve existing timing.',
              );
            }
          }
          const oldIds = new Set([...current!.net.nodes, ...current!.net.arcs].map((e) => e.id));
          authoredCheck(
            authoredFingerprint(edit.timing.urgent.filter((id) => oldIds.has(id))) ===
              authoredFingerprint(current!.timing.urgent),
            'Adding elements must preserve urgency.',
          );
          authoredCheck(
            authoredFingerprint(
              edit.timing.transports.filter(
                (p) => oldIds.has(p.inputArc) || oldIds.has(p.outputArc),
              ),
            ) === authoredFingerprint(current!.timing.transports),
            'Adding elements must preserve transport pairs.',
          );
        } else authoredCheck(edit.timing === null, 'Untimed additions cannot introduce timing.');
        changeComponent({
          ...current!,
          net: edit.net,
          ...(edit.timing ? { timing: edit.timing } : {}),
        });
        break;
      }
      case 'editElement': {
        closedAuthored(edit.element);
        const element = edit.element;
        const old = [...current!.net.nodes, ...current!.net.arcs].find((e) => e.id === element.id);
        authoredCheck(
          old && 'name' in old === 'name' in element,
          'The edited element no longer exists.',
        );
        let timing = current!.timing;
        let arcs = current!.net.arcs;
        if ('name' in element) authoredCheck(element.kind === old.kind, 'Cannot change node kind.');
        else {
          authoredCheck(
            'source' in old && old.source === element.source && old.target === element.target,
            'Element edits must preserve endpoints.',
          );
          arcs = arcs.map((a) => (a.id === element.id ? element : a));
        }
        if (timing) {
          const draft = edit.timing;
          authoredCheck(draft, 'Timed element edits require explicit timing.');
          closedAuthored(draft, ['invariant', 'interval', 'ages', 'urgent', 'outputArc']);
          const set = <T>(map: Readonly<Record<string, T>>, value: T | null) =>
            Object.fromEntries([
              ...Object.entries(map).filter(([id]) => id !== element.id),
              ...(value === null ? [] : [[element.id, value] as [string, T]]),
            ]);
          if ('name' in element) {
            if (element.kind === 'place') {
              for (const age of draft.ages) compareAges(age, '0');
              authoredCheck(
                draft.ages.length <= element.tokens,
                'More initial ages than tokens. Increase the marking or remove ages explicitly.',
              );
              const nonzero = draft.ages.filter((age) => compareAges(age, '0') !== 0);
              timing = {
                ...timing,
                invariants: set(timing.invariants, draft.invariant),
                ages: set<readonly string[]>(timing.ages, nonzero.length ? nonzero : null),
              };
            } else
              timing = {
                ...timing,
                urgent:
                  draft.urgent === timing.urgent.includes(element.id)
                    ? timing.urgent
                    : [
                        ...timing.urgent.filter((id) => id !== element.id),
                        ...(draft.urgent ? [element.id] : []),
                      ],
              };
          } else {
            const input = current!.net.nodes.some(
              (n) => n.id === element.source && n.kind === 'place',
            );
            const pair = timing.transports.find(
              (p) => p.inputArc === element.id || p.outputArc === element.id,
            );
            if (input)
              timing = {
                ...timing,
                intervals: set(timing.intervals, draft.interval),
                transports:
                  (pair?.outputArc ?? '') === draft.outputArc
                    ? timing.transports
                    : [
                        ...timing.transports.filter((p) => p.inputArc !== element.id),
                        ...(draft.outputArc
                          ? [{ inputArc: element.id, outputArc: draft.outputArc }]
                          : []),
                      ],
              };
            const partner = input ? draft.outputArc : pair?.inputArc;
            if (partner)
              arcs = arcs.map((a) => (a.id === partner ? { ...a, weight: element.weight } : a));
          }
        } else
          authoredCheck(edit.timing === null, 'Untimed element edits cannot introduce timing.');
        changeComponent({
          ...current!,
          net: {
            ...current!.net,
            nodes: current!.net.nodes.map((n) => (n.id === element.id ? (element as NetNode) : n)),
            arcs,
          },
          ...(timing ? { timing } : {}),
        });
        break;
      }
      case 'addConstant':
        candidate = { ...candidate, constants: [...candidate.constants, edit.constant] };
        break;
      case 'updateConstant':
      case 'deleteConstant': {
        const old = candidate.constants.find((c) => c.id === edit.id);
        authoredCheck(old, `Unknown constant ${edit.id}.`, 'unbound');
        const uses = constantUses(candidate, edit.id);
        const protectedUses = uses.filter((u) => u.field === 'saved-query-protection');
        authoredCheck(
          !protectedUses.length || (edit.kind === 'updateConstant' && edit.name === old.name),
          `Saved queries protect ${old.name}; remove queries explicitly before rename/removal.`,
          'query-protected',
          protectedUses,
        );
        if (edit.kind === 'deleteConstant') {
          authoredCheck(!uses.length, `Constant ${old.name} is still in use.`, 'in-use', uses);
          candidate = {
            ...candidate,
            constants: candidate.constants.filter((c) => c.id !== edit.id),
          };
        } else
          candidate = {
            ...candidate,
            constants: candidate.constants.map((c) =>
              c.id === edit.id ? { id: c.id, name: edit.name, value: edit.value } : c,
            ),
          };
        break;
      }
      case 'setWeightTerm': {
        authoredCheck(
          current!.net.arcs.some((a) => a.id === edit.arcId),
          `Unknown arc ${edit.arcId}.`,
        );
        const pair = current!.timing?.transports.find(
          (p) => p.inputArc === edit.arcId || p.outputArc === edit.arcId,
        );
        const ids = new Set(pair ? [pair.inputArc, pair.outputArc] : [edit.arcId]);
        changeComponent({
          ...current!,
          net: {
            ...current!.net,
            arcs: current!.net.arcs.map((a) => (ids.has(a.id) ? { ...a, weight: edit.term } : a)),
          },
        });
        break;
      }
      case 'setInterval':
      case 'setInvariant': {
        authoredCheck(current!.timing, 'Timing setters require a timed component.');
        const interval = edit.kind === 'setInterval';
        const key = interval ? 'intervals' : 'invariants';
        const id = interval ? edit.arcId : edit.placeId;
        const value = interval ? edit.interval : edit.invariant;
        const entries = Object.entries(current!.timing[key]).filter(([k]) => k !== id);
        if (value !== null) entries.push([id, value]);
        changeComponent({
          ...current!,
          timing: { ...current!.timing, [key]: Object.fromEntries(entries) },
        });
        break;
      }
      case 'patchNet': {
        authoredCheck(
          edit.net.name === candidate.name && edit.net.template === current!.net.template,
          'Use renameNetwork/patchComponent for names.',
        );
        for (const arc of edit.net.arcs) {
          const old = current!.net.arcs.find((a) => a.id === arc.id);
          authoredCheck(
            !old ||
              (authoredFingerprint(old.weight) === authoredFingerprint(arc.weight) &&
                old.kind === arc.kind &&
                old.source === arc.source &&
                old.target === arc.target),
            `Unexpected semantic replacement on arc ${arc.id}; use dedicated semantic setters or explicit topology removal/addition.`,
            'invalid-model',
          );
        }
        let timing = current!.timing;
        if (timing) {
          const ids = new Set([...edit.net.nodes, ...edit.net.arcs].map((n) => n.id));
          for (const pair of timing.transports)
            authoredCheck(
              ids.has(pair.inputArc) === ids.has(pair.outputArc),
              'Removing only one transport half is forbidden.',
            );
          const keep = <T>(map: Readonly<Record<string, T>>) =>
            Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
          timing = {
            ...timing,
            intervals: keep(timing.intervals),
            invariants: keep(timing.invariants),
            ages: keep(timing.ages),
            urgent: timing.urgent.filter((id) => ids.has(id)),
            transports: timing.transports.filter((p) => ids.has(p.inputArc)),
          };
        }
        changeComponent({ ...current!, net: edit.net, ...(timing ? { timing } : {}) });
        break;
      }
      case 'addComponent':
        candidate = { ...candidate, components: [...candidate.components, edit.component] };
        break;
      case 'copyComponent':
        candidate = {
          ...candidate,
          components: [
            ...candidate.components,
            { ...current!, id: edit.id, net: { ...current!.net, template: edit.template } },
          ],
        };
        break;
      case 'removeComponent':
        candidate = {
          ...candidate,
          components: candidate.components.filter((c) => c.id !== edit.componentId),
        };
        break;
      case 'patchComponent':
        changeComponent({
          ...current!,
          active: edit.active,
          net: { ...current!.net, template: edit.template },
        });
        break;
      case 'renameNetwork':
        candidate = {
          ...candidate,
          name: edit.name,
          components: candidate.components.map((c) => ({
            ...c,
            net: { ...c.net, name: edit.name },
          })),
        };
        break;
      case 'removeSavedQueries': {
        const { savedQueries: _removed, ...rest } = candidate;
        candidate = rest;
        break;
      }
    }
    authoredCheck(
      edit.kind === 'removeSavedQueries' ||
        authoredFingerprint(candidate.savedQueries) ===
          authoredFingerprint(doc.network.savedQueries),
      'Saved query metadata must be retained.',
    );
    const resolved = resolveAuthored(candidate);
    if (!resolved.ok) return resolved;
    return { ok: true, value: commitAuthoredSnapshot(doc, candidate) };
  } catch (e) {
    return authoredFailure(e);
  }
}

/** One whole-source history discipline shared by the V2 and opt-in V3 adapters.
 * Call only after validating the entire candidate and checking revision identity. */
export function commitAuthoredSnapshot<
  N extends { readonly components: readonly { readonly id: string }[] },
>(doc: SnapshotDocument<N>, candidate: N): SnapshotDocument<N> {
  if (authoredFingerprint(candidate) === authoredFingerprint(doc.network)) return doc;
  const network = freezeAuthored(structuredClone(candidate));
  return Object.freeze({
    ...doc,
    network,
    past: Object.freeze([...doc.past, doc.network]),
    future: Object.freeze([]),
    session: sessionFor(doc, network),
  });
}
