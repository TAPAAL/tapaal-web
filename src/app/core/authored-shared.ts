/** Authoritative V3 shared-element source. Never hand a validation projection to an engine or codec. */
import { requireEditableModelType } from './model-types';
import type { NetNode } from './net';
import { integer, validateName } from './net';
import { compareAges, validateInvariant } from './timed';
import {
  AuthoredNetwork,
  AuthoredComponent,
  AuthoredInvariant,
  AuthoredSavedQueries,
  Result,
  Use,
  ReadonlyData,
  authoredCheck,
  authoredFailure,
  authoredFingerprint,
  closedAuthored,
  plainAuthoredTree,
  freezeAuthored,
  resolveAuthored,
  constantUses,
} from './authored-model';
import {
  AuthoredEdit,
  transactDocument,
  SnapshotDocument,
  commitAuthoredSnapshot,
  openAuthoredDocument,
} from './authored-documents';

export type SharedOccurrence = ReadonlyData<
  Pick<NetNode, 'id' | 'kind' | 'x' | 'y' | 'nameOffsetX' | 'nameOffsetY' | 'nameVisible'>
> & {
  readonly kind: 'place' | 'transition';
  readonly angle?: number;
  readonly sharedId: string;
};
export type TransitionActor = 'controller' | 'environment';
export type LocalNode = ReadonlyData<NetNode> & { readonly actor?: TransitionActor };
export interface SharedTransition {
  readonly actor?: TransitionActor;
  readonly id: string;
  readonly name: string;
  readonly urgent: boolean;
}
export interface SharedPlace {
  readonly id: string;
  readonly name: string;
  readonly tokens: number;
  readonly timing?: {
    readonly invariant: AuthoredInvariant | null;
    readonly ages: readonly string[];
  };
}
export type SharedComponent = Omit<AuthoredComponent, 'net'> & {
  readonly net: Omit<AuthoredComponent['net'], 'nodes'> & {
    readonly nodes: readonly (LocalNode | SharedOccurrence)[];
  };
};
export interface SharedQueries extends AuthoredSavedQueries {
  readonly protectedSharedTransitions?: readonly { readonly id: string; readonly name: string }[];
  readonly protectedSharedPlaces: readonly { readonly id: string; readonly name: string }[];
  /** Includes local nodes, so conversion cannot silently change a query's meaning. */
  readonly protectedMembership: readonly {
    readonly componentId: string;
    readonly elementId: string;
    readonly sharedId: string | null;
  }[];
}
export type SharedSource = Omit<AuthoredNetwork, 'components' | 'savedQueries'> & {
  readonly shared: {
    readonly places: readonly SharedPlace[];
    readonly transitions: readonly SharedTransition[];
  };
  readonly components: readonly SharedComponent[];
  readonly savedQueries?: SharedQueries;
};
export type SharedDocument = SnapshotDocument<SharedSource>;
const brand: unique symbol = Symbol('ValidatedSharedSource');
export interface SharedRevision {
  readonly [brand]: true;
  readonly source: SharedSource;
}
const occurrenceKeys = [
  'id',
  'kind',
  'sharedId',
  'x',
  'y',
  'nameOffsetX',
  'nameOffsetY',
  'nameVisible',
  'angle',
];
function required(value: object, keys: readonly string[]): void {
  authoredCheck(
    keys.every((key) => Object.hasOwn(value, key)),
    'Missing required source fields.',
  );
}
function id(value: unknown): asserts value is string {
  authoredCheck(typeof value === 'string' && value.length > 0, 'IDs must be nonempty strings.');
}
function isMember(node: SharedComponent['net']['nodes'][number]): node is SharedOccurrence {
  return Object.hasOwn(node, 'sharedId');
}
function memberships(
  source: Pick<SharedSource, 'components'>,
): SharedQueries['protectedMembership'] {
  return source.components.flatMap((c) =>
    c.net.nodes.map((n) => ({
      componentId: c.id,
      elementId: n.id,
      sharedId: isMember(n) ? n.sharedId : null,
    })),
  );
}
/** A constant's pool use is reported once, even with many or no active members. */
export function sharedConstantUses(source: SharedSource, constantId: string): readonly Use[] {
  const local = constantUses(source as unknown as AuthoredNetwork, constantId);
  return freezeAuthored([
    ...local,
    ...source.shared.places.flatMap((pool): Use[] => {
      const upper = pool.timing?.invariant?.upper;
      return upper && typeof upper === 'object' && upper.constantId === constantId
        ? [
            {
              constantId,
              poolId: pool.id,
              field: 'invariant',
              activeMemberCount: source.components.filter(
                (c) => c.active && c.net.nodes.some((n) => isMember(n) && n.sharedId === pool.id),
              ).length,
            },
          ]
        : [];
    }),
  ]);
}
/** Private structural check only: duplicates effective values, so is NEVER a runtime model. */
function validationProjection(source: SharedSource): AuthoredNetwork {
  const pools = new Map(source.shared.places.map((p) => [p.id, p]));
  const transitions = new Map(source.shared.transitions.map((p) => [p.id, p]));
  const components = source.components.map((c): AuthoredComponent => {
    const members = c.net.nodes.filter(isMember).filter((n) => n.kind === 'place');
    const net = {
      ...c.net,
      nodes: c.net.nodes.map((n) => {
        if (!isMember(n)) {
          const { actor: _actor, ...scalar } = n;
          return scalar;
        }
        const { sharedId, ...geometry } = n;
        if (n.kind === 'transition')
          return { ...geometry, name: transitions.get(sharedId)!.name, tokens: 0 };
        const p = pools.get(sharedId)!;
        return { ...geometry, name: p.name, tokens: p.tokens };
      }),
    };
    const timing = c.timing && {
      ...c.timing,
      urgent: [
        ...c.timing.urgent,
        ...c.net.nodes
          .filter(isMember)
          .filter((n) => n.kind === 'transition' && transitions.get(n.sharedId)!.urgent)
          .map((n) => n.id),
      ],
      invariants: Object.fromEntries([
        ...Object.entries(c.timing.invariants),
        ...members.flatMap((n) => {
          const invariant = pools.get(n.sharedId)!.timing?.invariant;
          return invariant ? [[n.id, invariant] as const] : [];
        }),
      ]),
      ages: Object.fromEntries([
        ...Object.entries(c.timing.ages),
        ...members.flatMap((n) => {
          const ages = pools.get(n.sharedId)!.timing?.ages;
          return ages?.length ? [[n.id, ages] as const] : [];
        }),
      ]),
    };
    return { ...c, net, ...(timing ? { timing } : {}) };
  });
  const q = source.savedQueries;
  return {
    name: source.name,
    type: { ...source.type, game: false },
    constants: source.constants,
    // V3 source may be entirely inactive. The old validator requires an active
    // component; changing only this private check input never activates source.
    components: components.some((c) => c.active)
      ? components
      : components.map((c, i) => (i === 0 ? { ...c, active: true } : c)),
    ...(q !== undefined
      ? {
          savedQueries: {
            xml: q.xml,
            protectedComponents: q.protectedComponents,
            protectedConstants: q.protectedConstants,
          },
        }
      : {}),
  };
}
function validateActor(source: SharedSource, actor: unknown): void {
  authoredCheck(
    actor === undefined ||
      (source.type.game && (actor === 'controller' || actor === 'environment')),
    'Actors require a game and must be Controller or Environment.',
  );
}
export function transitionActor(
  source: SharedSource,
  componentId: string,
  elementId: string,
): TransitionActor {
  const n = source.components
    .find((c) => c.id === componentId)
    ?.net.nodes.find((n) => n.id === elementId);
  authoredCheck(n?.kind === 'transition', 'Expected a transition.');
  return (
    (isMember(n) ? source.shared.transitions.find((p) => p.id === n.sharedId)!.actor : n.actor) ??
    'controller'
  );
}
/** Closed source validation, including unused pools and inactive occurrences. No execution result. */
export function validateSharedSource(source: SharedSource): Result<SharedRevision> {
  let uses: readonly Use[] = [];
  try {
    plainAuthoredTree(source);
    requireEditableModelType(source.type, { timed: true, game: true });
    closedAuthored(source, ['name', 'type', 'constants', 'components', 'shared', 'savedQueries']);
    required(source, ['name', 'type', 'constants', 'components', 'shared']);
    closedAuthored(source.shared, ['places', 'transitions']);
    authoredCheck(
      Array.isArray(source.shared.places) && Array.isArray(source.shared.transitions),
      'Pool lists must be arrays.',
    );

    authoredCheck(
      Array.isArray(source.components) && Array.isArray(source.constants),
      'Invalid source lists.',
    );
    const pools = new Map<string, SharedPlace>(),
      names = new Set<string>();
    for (const p of source.shared.places) {
      closedAuthored(p, ['id', 'name', 'tokens', 'timing']);
      required(p, ['id', 'name', 'tokens']);
      id(p.id);
      validateName(p.name);
      integer(p.tokens, 0, 'Pool token count');
      authoredCheck(!pools.has(p.id) && !names.has(p.name), 'Duplicate pool ID or name.', 'name');
      pools.set(p.id, p);
      names.add(p.name);
      authoredCheck(
        source.type.timed ? !!p.timing : p.timing === undefined,
        'Pool timing must match model type.',
      );
      if (p.timing) {
        closedAuthored(p.timing, ['invariant', 'ages']);
        required(p.timing, ['invariant', 'ages']);
        authoredCheck(
          Array.isArray(p.timing.ages) && p.timing.ages.length <= p.tokens,
          'Invalid pool age count.',
        );
        const inv = p.timing.invariant;
        uses =
          inv?.upper && typeof inv.upper === 'object'
            ? sharedConstantUses(source, inv.upper.constantId).filter((use) => use.poolId === p.id)
            : [];
        let upper: string | null = null;
        if (inv !== null) {
          closedAuthored(inv, ['upper', 'upperClosed']);
          required(inv, ['upper', 'upperClosed']);
          if (inv.upper && typeof inv.upper === 'object') {
            closedAuthored(inv.upper, ['constantId']);
            const constantId = inv.upper.constantId;
            const binding = source.constants.find((c) => c.id === constantId);
            authoredCheck(
              binding,
              `Unbound pool constant ${constantId}.`,
              'unbound',
              sharedConstantUses(source, constantId),
            );
            upper = String(binding.value);
          } else upper = inv.upper;
          validateInvariant({ upper, upperClosed: inv.upperClosed });
          authoredCheck(upper !== null, 'Omit the default pool invariant using null.');
        }
        for (const age of p.timing.ages) {
          authoredCheck(
            typeof age === 'string' && compareAges(age, '0') > 0,
            'Pool zero ages are implicit.',
          );
          authoredCheck(
            upper === null ||
              compareAges(age, upper) < 0 ||
              (compareAges(age, upper) === 0 && inv!.upperClosed),
            'Pool initial age violates invariant.',
            'invalid-model',
            inv?.upper && typeof inv.upper === 'object'
              ? sharedConstantUses(source, inv.upper.constantId)
              : [],
          );
        }
      }
      uses = [];
    }
    const transitions = new Map<string, SharedTransition>();
    for (const p of source.shared.transitions) {
      closedAuthored(p, ['id', 'name', 'urgent', 'actor']);
      validateActor(source, p.actor);
      required(p, ['id', 'name', 'urgent']);
      id(p.id);
      validateName(p.name);
      authoredCheck(
        !pools.has(p.id) && !transitions.has(p.id) && !names.has(p.name),
        'Duplicate pool ID or name.',
        'name',
      );
      authoredCheck(
        typeof p.urgent === 'boolean' && (source.type.timed || !p.urgent),
        'Urgency requires a timed model.',
      );
      transitions.set(p.id, p);
      names.add(p.name);
    }
    for (const c of source.components) {
      closedAuthored(c, ['id', 'active', 'net', 'timing']);
      authoredCheck(typeof c.active === 'boolean', 'Component active state must be boolean.');
      closedAuthored(c.net, ['name', 'template', 'nodes', 'arcs', 'annotations']);
      authoredCheck(Array.isArray(c.net.nodes), 'Nodes must be an array.');
      const seen = new Set<string>();
      for (const n of c.net.nodes) {
        if (!isMember(n)) {
          validateActor(source, n.actor);
          authoredCheck(
            n.actor === undefined || n.kind === 'transition',
            'Only transitions have actors.',
          );
          authoredCheck(
            !names.has(n.name),
            `Local name ${n.name} collides with a global pool.`,
            'name',
          );
          continue;
        }
        closedAuthored(n, occurrenceKeys);
        required(n, ['id', 'kind', 'sharedId', 'x', 'y']);
        id(n.sharedId);
        authoredCheck(
          (n.kind === 'place' && pools.has(n.sharedId)) ||
            (n.kind === 'transition' && transitions.has(n.sharedId)),
          'Dangling or wrong-kind shared occurrence.',
        );
        authoredCheck(!seen.has(n.sharedId), 'Only one occurrence of a pool per component.');
        seen.add(n.sharedId);
        authoredCheck(
          !c.timing ||
            (!Object.hasOwn(c.timing.ages, n.id) &&
              !Object.hasOwn(c.timing.invariants, n.id) &&
              !c.timing.urgent.includes(n.id)),
          'Member semantics must live in the pool.',
        );
      }
      for (const arc of c.net.arcs) {
        const from = c.net.nodes.find(
            (n: SharedComponent['net']['nodes'][number]) => n.id === arc.source,
          ),
          to = c.net.nodes.find(
            (n: SharedComponent['net']['nodes'][number]) => n.id === arc.target,
          );
        authoredCheck(
          !(from && to && isMember(from) && isMember(to)),
          'A shared transition cannot connect to any shared place (including inhibitor and transport arcs).',
        );
      }
    }
    if (source.savedQueries !== undefined) {
      const q = source.savedQueries;
      closedAuthored(q, [
        'xml',
        'protectedComponents',
        'protectedConstants',
        'protectedSharedPlaces',
        'protectedSharedTransitions',
        'protectedMembership',
      ]);
      authoredCheck(
        Array.isArray(q.protectedSharedPlaces) && Array.isArray(q.protectedMembership),
        'Missing shared query protections.',
      );
      const seen = new Set<string>();
      for (const p of q.protectedSharedPlaces) {
        closedAuthored(p, ['id', 'name']);
        required(p, ['id', 'name']);
        id(p.id);
        authoredCheck(
          !seen.has(p.id) && pools.get(p.id)?.name === p.name,
          'Saved queries protect shared pool symbols; remove queries first.',
          'query-protected',
        );
        seen.add(p.id);
      }
      if (q.protectedSharedTransitions !== undefined) {
        authoredCheck(
          Array.isArray(q.protectedSharedTransitions),
          'Invalid shared transition query protections.',
        );
        for (const p of q.protectedSharedTransitions) {
          closedAuthored(p, ['id', 'name']);
          required(p, ['id', 'name']);
          id(p.id);
          authoredCheck(
            !seen.has(p.id) && transitions.get(p.id)?.name === p.name,
            'Saved queries protect shared transition symbols; remove queries first.',
            'query-protected',
          );
          seen.add(p.id);
        }
      }
      const current = memberships(source),
        memberKeys = new Set<string>();
      for (const m of q.protectedMembership) {
        closedAuthored(m, ['componentId', 'elementId', 'sharedId']);
        required(m, ['componentId', 'elementId', 'sharedId']);
        id(m.componentId);
        id(m.elementId);
        if (m.sharedId !== null) id(m.sharedId);
        const key = JSON.stringify([m.componentId, m.elementId]);
        authoredCheck(
          !memberKeys.has(key) &&
            current.some(
              (n) =>
                n.componentId === m.componentId &&
                n.elementId === m.elementId &&
                n.sharedId === m.sharedId,
            ),
          'Saved queries protect membership; remove queries first.',
          'query-protected',
        );
        memberKeys.add(key);
      }
    }
    const result = resolveAuthored(validationProjection(source));
    if (!result.ok)
      return {
        ok: false,
        issues: result.issues.map((issue) => ({
          ...issue,
          uses: [
            ...new Map(
              issue.uses.map((use) => {
                const component = source.components.find((c) => c.id === use.componentId);
                const node = component?.net.nodes.find((n) => n.id === use.elementId);
                const translated =
                  use.field === 'invariant' && node && isMember(node)
                    ? (sharedConstantUses(source, use.constantId).find(
                        (u) => u.poolId === node.sharedId,
                      ) ?? use)
                    : use;
                return [authoredFingerprint(translated), translated] as const;
              }),
            ).values(),
          ],
        })),
      };
    return {
      ok: true,
      value: Object.freeze({
        [brand]: true as const,
        source: freezeAuthored(structuredClone(source)),
      }),
    };
  } catch (error) {
    return authoredFailure(error, uses);
  }
}
/** Deliberate V2->V3 opt-in. Does not relax V2 import/execution gates. */
export function sharedFromAuthored(source: AuthoredNetwork): Result<SharedSource> {
  const checked = resolveAuthored(source);
  if (!checked.ok) return checked;
  const { savedQueries, ...rest } = checked.value.source;
  const staged: SharedSource = {
    ...rest,
    shared: { places: [], transitions: [] },
    ...(savedQueries
      ? {
          savedQueries: {
            ...savedQueries,
            protectedSharedPlaces: [],
            protectedMembership: memberships(rest),
          },
        }
      : {}),
  };
  const result = validateSharedSource(staged);
  return result.ok ? { ok: true, value: result.value.source } : result;
}
export function captureSharedQueries(
  source: SharedSource,
  xml: readonly string[],
): Result<SharedQueries> {
  try {
    plainAuthoredTree(xml);
    authoredCheck(Array.isArray(xml), 'Query XML must be an array.');
    const checked = validateSharedSource(source);
    if (!checked.ok) return checked;
    const q: SharedQueries = {
      xml: [...xml],
      protectedComponents: validationProjection(source).components.map((c) => ({
        id: c.id,
        name: c.net.template,
        nodes: c.net.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
      })),
      protectedConstants: source.constants.map(({ id, name }) => ({ id, name })),
      protectedSharedPlaces: source.shared.places.map(({ id, name }) => ({ id, name })),
      ...(source.shared.transitions.length
        ? {
            protectedSharedTransitions: source.shared.transitions.map(({ id, name }) => ({
              id,
              name,
            })),
          }
        : {}),
      protectedMembership: memberships(source),
    };
    const result = validateSharedSource({ ...source, savedQueries: q });
    return result.ok ? { ok: true, value: result.value.source.savedQueries! } : result;
  } catch (error) {
    return authoredFailure(error);
  }
}
export function openSharedDocument(
  source: SharedSource,
  options: { id?: string; saved?: boolean } = {},
): Result<SharedDocument> {
  const checked = validateSharedSource(source);
  if (!checked.ok) return checked;
  // Reuse existing document initialization/session validation, discard its validation-only source.
  const opened = openAuthoredDocument(validationProjection(source), options);
  if (!opened.ok) return opened;
  return {
    ok: true,
    value: freezeAuthored({
      ...opened.value,
      network: checked.value.source,
      past: [],
      future: [],
      saved: options.saved ? checked.value.source : null,
    }),
  };
}

export type SharedEdit =
  | { readonly kind: 'localEdit'; readonly edit: AuthoredEdit }
  | {
      readonly kind: 'localActorEdit';
      readonly edit: AuthoredEdit;
      readonly actor: TransitionActor;
    }
  | {
      readonly kind: 'setActor';
      readonly componentId: string;
      readonly elementId: string;
      readonly actor: TransitionActor;
    }
  | { readonly kind: 'createTransitionPool'; readonly pool: SharedTransition }
  | { readonly kind: 'editTransitionPool'; readonly pool: SharedTransition }
  | { readonly kind: 'deleteTransitionPool'; readonly poolId: string }
  | { readonly kind: 'createPool'; readonly pool: SharedPlace }
  | {
      readonly kind: 'makeShared';
      readonly componentId: string;
      readonly elementId: string;
      readonly poolId: string;
      readonly name: string;
    }
  | {
      readonly kind: 'usePool';
      readonly componentId: string;
      readonly elementId: string;
      readonly poolId: string;
      readonly acceptPoolValues: boolean;
    }
  | {
      readonly kind: 'addOccurrence';
      readonly componentId: string;
      readonly occurrence: SharedOccurrence;
    }
  | {
      readonly kind: 'detach';
      readonly componentId: string;
      readonly elementId: string;
      readonly name: string;
    }
  | { readonly kind: 'removeOccurrence'; readonly componentId: string; readonly elementId: string }
  | { readonly kind: 'editPool'; readonly pool: SharedPlace }
  | { readonly kind: 'deletePool'; readonly poolId: string }
  | {
      readonly kind: 'copyComponent';
      readonly componentId: string;
      readonly id: string;
      readonly template: string;
    }
  | {
      readonly kind: 'updateConstant';
      readonly id: string;
      readonly name: string;
      readonly value: number;
    }
  | { readonly kind: 'deleteConstant'; readonly id: string }
  | {
      readonly kind: 'patchGeometry';
      readonly componentId: string;
      readonly elementId: string;
      readonly geometry: Pick<
        SharedOccurrence,
        'x' | 'y' | 'nameOffsetX' | 'nameOffsetY' | 'nameVisible' | 'angle'
      >;
    }
  | { readonly kind: 'removeQueries' };
const editKeys: Record<SharedEdit['kind'], readonly string[]> = {
  createTransitionPool: ['kind', 'pool'],
  editTransitionPool: ['kind', 'pool'],
  deleteTransitionPool: ['kind', 'poolId'],
  localEdit: ['kind', 'edit'],
  localActorEdit: ['kind', 'edit', 'actor'],
  setActor: ['kind', 'componentId', 'elementId', 'actor'],
  createPool: ['kind', 'pool'],
  makeShared: ['kind', 'componentId', 'elementId', 'poolId', 'name'],
  usePool: ['kind', 'componentId', 'elementId', 'poolId', 'acceptPoolValues'],
  addOccurrence: ['kind', 'componentId', 'occurrence'],
  detach: ['kind', 'componentId', 'elementId', 'name'],
  removeOccurrence: ['kind', 'componentId', 'elementId'],
  editPool: ['kind', 'pool'],
  deletePool: ['kind', 'poolId'],
  copyComponent: ['kind', 'componentId', 'id', 'template'],
  updateConstant: ['kind', 'id', 'name', 'value'],
  deleteConstant: ['kind', 'id'],
  patchGeometry: ['kind', 'componentId', 'elementId', 'geometry'],
  removeQueries: ['kind'],
};
function localSemantics(
  c: SharedComponent,
  n: ReadonlyData<NetNode>,
): Omit<SharedPlace, 'id' | 'name'> {
  return {
    tokens: n.tokens,
    ...(c.timing
      ? {
          timing: {
            invariant: Object.hasOwn(c.timing.invariants, n.id) ? c.timing.invariants[n.id] : null,
            ages: Object.hasOwn(c.timing.ages, n.id) ? c.timing.ages[n.id] : [],
          },
        }
      : {}),
  };
}
function withoutPlaceTiming(c: SharedComponent, nodeId: string): SharedComponent {
  if (!c.timing) return c;
  return {
    ...c,
    timing: {
      ...c.timing,
      ages: Object.fromEntries(Object.entries(c.timing.ages).filter(([key]) => key !== nodeId)),
      invariants: Object.fromEntries(
        Object.entries(c.timing.invariants).filter(([key]) => key !== nodeId),
      ),
    },
  };
}
/** Atomic command: identity check -> inspect untrusted draft -> whole-source validate -> one commit. */
export function transactShared(
  doc: SharedDocument,
  expected: SharedSource,
  edit: SharedEdit,
): Result<SharedDocument> {
  try {
    authoredCheck(
      doc.network === expected,
      'The authored revision changed; reopen the edit.',
      'stale-revision',
    );
    plainAuthoredTree(edit);
    closedAuthored(edit);
    authoredCheck(Object.hasOwn(editKeys, edit.kind), 'Unknown shared edit.');
    closedAuthored(edit, editKeys[edit.kind]);
    required(edit, editKeys[edit.kind]);
    let source = doc.network;
    const c =
      'componentId' in edit ? source.components.find((c) => c.id === edit.componentId) : undefined;
    if ('componentId' in edit) authoredCheck(c, 'Unknown component.');
    const node =
      c && 'elementId' in edit ? c.net.nodes.find((n) => n.id === edit.elementId) : undefined;
    if ('elementId' in edit) authoredCheck(node, 'Unknown element.');
    const change = (next: SharedComponent) => {
      source = {
        ...source,
        components: source.components.map((old) => (old.id === next.id ? next : old)),
      };
    };
    const pools = (places: readonly SharedPlace[]) => {
      source = { ...source, shared: { ...source.shared, places } };
    };
    if (edit.kind === 'updateConstant' || edit.kind === 'deleteConstant') {
      const declaration = source.constants.find((k) => k.id === edit.id);
      const protectedUses = sharedConstantUses(source, edit.id).filter(
        (u) => u.field === 'saved-query-protection',
      );
      authoredCheck(
        !protectedUses.length ||
          (edit.kind === 'updateConstant' && edit.name === declaration?.name),
        `Saved queries protect ${declaration?.name}; remove queries explicitly before rename/removal.`,
        'query-protected',
        protectedUses,
      );
    }
    switch (edit.kind) {
      case 'setActor': {
        authoredCheck(
          source.type.game && node?.kind === 'transition',
          'Actor editing requires a game transition.',
        );
        validateActor(source, edit.actor);
        authoredCheck(
          edit.actor === 'controller' || edit.actor === 'environment',
          'A player choice is required.',
        );
        if (transitionActor(source, c!.id, node.id) === edit.actor) break;
        if (isMember(node))
          source = {
            ...source,
            shared: {
              ...source.shared,
              transitions: source.shared.transitions.map((p) =>
                p.id === node.sharedId ? { ...p, actor: edit.actor } : p,
              ),
            },
          };
        else
          change({
            ...c!,
            net: {
              ...c!.net,
              nodes: c!.net.nodes.map((n) => (n.id === node.id ? { ...n, actor: edit.actor } : n)),
            },
          });
        break;
      }
      case 'localActorEdit':
      case 'localEdit': {
        if (edit.kind === 'localActorEdit') {
          validateActor(source, edit.actor);
          authoredCheck(
            edit.actor === 'controller' || edit.actor === 'environment',
            'A player choice is required.',
          );
          authoredCheck(
            source.type.game &&
              edit.edit.kind === 'editElement' &&
              edit.edit.element.kind === 'transition',
            'Expected a game transition edit.',
          );
        }
        // Reuse scalar command semantics, never a numeric projection commit. Shared members
        // are immutable semantic sentinels; only their explicit geometry may cross back.
        const command = edit.edit;
        authoredCheck(
          command.kind !== 'copyComponent',
          'Use the shared copyComponent command to retain membership.',
        );
        const display = validationProjection(source);
        // Activity is restored from source after scalar command validation. Keeping every
        // surrogate active also permits removing the last active component in V3.
        const projection = {
          ...display,
          components: display.components.map((c) => ({ ...c, active: true })),
        };
        if ('componentId' in command) {
          const component = source.components.find((c) => c.id === command.componentId);
          const memberId =
            command.kind === 'editElement'
              ? command.element.id
              : command.kind === 'setInvariant'
                ? command.placeId
                : undefined;
          const member = component?.net.nodes.find((n) => isMember(n) && n.id === memberId);
          authoredCheck(
            !member,
            `Edit shared ${member?.kind ?? 'element'} values through Shared ${member?.kind === 'transition' ? 'Transitions' : 'Places'}; detach to edit local semantics.`,
          );
        }
        const scalarDoc = { ...doc, network: projection, past: [], future: [], saved: null };
        let scalarCommand =
          command.kind === 'patchComponent' ? { ...command, active: true } : command;
        if (
          (command.kind === 'addElements' || command.kind === 'pasteElements') &&
          command.timing
        ) {
          const component = source.components.find((c) => c.id === command.componentId)!;
          const invariants = { ...command.timing.invariants },
            ages = { ...command.timing.ages };
          for (const member of component.net.nodes.filter(isMember)) {
            if (member.kind === 'transition') continue;
            const pool = source.shared.places.find((p) => p.id === member.sharedId)!;
            authoredCheck(
              !Object.hasOwn(invariants, member.id) ||
                authoredFingerprint(invariants[member.id]) ===
                  authoredFingerprint(pool.timing?.invariant),
              'Shared place timing belongs to the pool.',
            );
            authoredCheck(
              !Object.hasOwn(ages, member.id) ||
                authoredFingerprint(ages[member.id]) === authoredFingerprint(pool.timing?.ages),
              'Shared place timing belongs to the pool.',
            );
            if (pool.timing?.invariant) invariants[member.id] = pool.timing.invariant;
            if (pool.timing?.ages.length) ages[member.id] = pool.timing.ages;
          }
          const urgent = [...command.timing.urgent];
          for (const member of component.net.nodes
            .filter(isMember)
            .filter((n) => n.kind === 'transition')) {
            const pool = source.shared.transitions.find((p) => p.id === member.sharedId)!;
            authoredCheck(
              !urgent.includes(member.id) || pool.urgent,
              'Shared transition urgency belongs to the pool.',
            );
            if (pool.urgent && !urgent.includes(member.id)) urgent.push(member.id);
          }
          scalarCommand = { ...command, timing: { ...command.timing, invariants, ages, urgent } };
        }
        const result = transactDocument(scalarDoc, projection, scalarCommand);
        if (!result.ok) return result;
        const candidate = result.value.network;
        source = {
          ...candidate,
          type: source.type,
          shared: source.shared,
          ...(source.savedQueries && command.kind !== 'removeSavedQueries'
            ? { savedQueries: source.savedQueries }
            : {}),
          components: candidate.components.map((component): SharedComponent => {
            const original = source.components.find((c) => c.id === component.id);
            const nodes = component.net.nodes.map((n) => {
              const member = original?.net.nodes.find((m) => m.id === n.id);
              if (!member || !isMember(member)) {
                if (
                  edit.kind === 'localActorEdit' &&
                  command.kind === 'editElement' &&
                  component.id === command.componentId &&
                  n.id === command.element.id
                )
                  return edit.actor ===
                    ((member && 'actor' in member ? member.actor : undefined) ?? 'controller')
                    ? member && 'actor' in member
                      ? { ...n, actor: member.actor }
                      : n
                    : { ...n, actor: edit.actor };
                return member && 'actor' in member ? { ...n, actor: member.actor } : n;
              }
              if (member.kind === 'transition') {
                const pool = source.shared.transitions.find((p) => p.id === member.sharedId)!;
                authoredCheck(
                  n.kind === 'transition' &&
                    n.name === pool.name &&
                    n.tokens === 0 &&
                    (component.timing?.urgent.includes(n.id) ?? false) === pool.urgent,
                  'Shared transition semantics belong to the pool.',
                );
                const { name: _name, tokens: _tokens, ...geometry } = n;
                return { ...geometry, sharedId: member.sharedId };
              }
              const pool = source.shared.places.find((p) => p.id === member.sharedId)!;
              authoredCheck(
                n.kind === 'place' && n.name === pool.name && n.tokens === pool.tokens,
                'Shared place values belong to the pool. Use Shared Places to edit them.',
              );
              if (component.timing) {
                authoredCheck(
                  authoredFingerprint(component.timing.invariants[n.id] ?? null) ===
                    authoredFingerprint(pool.timing?.invariant ?? null) &&
                    authoredFingerprint(component.timing.ages[n.id] ?? []) ===
                      authoredFingerprint(pool.timing?.ages ?? []),
                  'Shared place timing belongs to the pool.',
                );
              }
              const { name: _name, tokens: _tokens, angle: _angle, ...geometry } = n;
              return { ...geometry, kind: 'place' as const, sharedId: member.sharedId };
            });
            const memberIds = new Set(nodes.filter(isMember).map((n) => n.id));
            const keep = <T>(map: Readonly<Record<string, T>>) =>
              Object.fromEntries(Object.entries(map).filter(([id]) => !memberIds.has(id)));
            return {
              ...component,
              active:
                command.kind === 'patchComponent' && command.componentId === component.id
                  ? command.active
                  : (original?.active ?? component.active),
              net: { ...component.net, nodes },
              ...(component.timing
                ? {
                    timing: {
                      ...component.timing,
                      urgent: component.timing.urgent.filter((id) => !memberIds.has(id)),
                      invariants: keep(component.timing.invariants),
                      ages: keep(component.timing.ages),
                    },
                  }
                : {}),
            };
          }),
        } as SharedSource;
        break;
      }
      case 'createTransitionPool':
        source = {
          ...source,
          shared: { ...source.shared, transitions: [...source.shared.transitions, edit.pool] },
        };
        break;
      case 'editTransitionPool':
        authoredCheck(
          source.shared.transitions.some((p) => p.id === edit.pool.id),
          'Unknown transition pool.',
        );
        source = {
          ...source,
          shared: {
            ...source.shared,
            transitions: source.shared.transitions.map((p) =>
              p.id === edit.pool.id ? edit.pool : p,
            ),
          },
        };
        break;
      case 'deleteTransitionPool':
        authoredCheck(
          source.shared.transitions.some((p) => p.id === edit.poolId),
          'Unknown transition pool.',
        );
        authoredCheck(
          !source.components.some((c) =>
            c.net.nodes.some((n) => isMember(n) && n.sharedId === edit.poolId),
          ),
          'Pool still has occurrences.',
          'in-use',
        );
        source = {
          ...source,
          shared: {
            ...source.shared,
            transitions: source.shared.transitions.filter((p) => p.id !== edit.poolId),
          },
        };
        break;
      case 'createPool':
        pools([...source.shared.places, edit.pool]);
        break;
      case 'editPool':
        authoredCheck(
          source.shared.places.some((p) => p.id === edit.pool.id),
          'Unknown pool.',
        );
        pools(source.shared.places.map((p) => (p.id === edit.pool.id ? edit.pool : p)));
        break;
      case 'deletePool':
        authoredCheck(
          source.shared.places.some((p) => p.id === edit.poolId),
          'Unknown pool.',
        );
        authoredCheck(
          !source.components.some((c) =>
            c.net.nodes.some((n) => isMember(n) && n.sharedId === edit.poolId),
          ),
          'Pool still has occurrences.',
          'in-use',
        );
        pools(source.shared.places.filter((p) => p.id !== edit.poolId));
        break;
      case 'makeShared':
      case 'usePool': {
        authoredCheck(!isMember(node!), 'Only local elements can become shared.');
        if (node!.kind === 'transition') {
          const urgent = c!.timing?.urgent.includes(node!.id) ?? false;
          const actor = transitionActor(source, c!.id, node!.id);
          if (edit.kind === 'makeShared')
            source = {
              ...source,
              shared: {
                ...source.shared,
                transitions: [
                  ...source.shared.transitions,
                  {
                    id: edit.poolId,
                    name: edit.name,
                    urgent,
                    ...(source.type.game ? { actor } : {}),
                  },
                ],
              },
            };
          else {
            const pool = source.shared.transitions.find((p) => p.id === edit.poolId);
            authoredCheck(pool, 'Unknown transition pool.');
            authoredCheck(
              typeof edit.acceptPoolValues === 'boolean' &&
                (edit.acceptPoolValues ||
                  (pool.urgent === urgent && (pool.actor ?? 'controller') === actor)),
              source.type.game
                ? 'Pool urgency or player differs. Select the adoption checkbox to use this pool.'
                : 'Pool urgency differs. Select the adoption checkbox to use this pool.',
            );
          }
          const { name: _name, tokens: _tokens, actor: _actor, ...geometry } = node as LocalNode;
          change({
            ...c!,
            net: {
              ...c!.net,
              nodes: c!.net.nodes.map((n) =>
                n.id === node!.id ? { ...geometry, sharedId: edit.poolId } : n,
              ),
            },
            ...(c!.timing
              ? {
                  timing: {
                    ...c!.timing,
                    urgent: c!.timing.urgent.filter((id) => id !== node!.id),
                  },
                }
              : {}),
          });
          break;
        }
        const values = localSemantics(c!, node as ReadonlyData<NetNode>);
        if (edit.kind === 'makeShared')
          pools([...source.shared.places, { id: edit.poolId, name: edit.name, ...values }]);
        else {
          authoredCheck(
            typeof edit.acceptPoolValues === 'boolean',
            'Explicit acceptPoolValues boolean required.',
          );
          const pool = source.shared.places.find((p) => p.id === edit.poolId);
          authoredCheck(pool, 'Unknown pool.');
          const { id: _id, name: _name, ...effective } = pool;
          authoredCheck(
            edit.acceptPoolValues || authoredFingerprint(values) === authoredFingerprint(effective),
            'Pool values differ; explicitly acceptPoolValues.',
          );
        }
        const { name: _name, tokens: _tokens, actor: _actor, ...geometry } = node as LocalNode;
        change({
          ...withoutPlaceTiming(c!, node!.id),
          net: {
            ...c!.net,
            nodes: c!.net.nodes.map((n) =>
              n.id === node!.id ? { ...geometry, kind: 'place', sharedId: edit.poolId } : n,
            ),
          },
        });
        break;
      }
      case 'addOccurrence':
        authoredCheck(isMember(edit.occurrence), 'An occurrence must explicitly reference a pool.');
        change({ ...c!, net: { ...c!.net, nodes: [...c!.net.nodes, edit.occurrence] } });
        break;
      case 'detach': {
        authoredCheck(isMember(node!), 'Only a shared occurrence can detach.');
        if (node.kind === 'transition') {
          const pool = source.shared.transitions.find((p) => p.id === node.sharedId)!;
          const { sharedId: _shared, ...geometry } = node;
          change({
            ...c!,
            net: {
              ...c!.net,
              nodes: c!.net.nodes.map((n) =>
                n.id === node.id
                  ? {
                      ...geometry,
                      name: edit.name,
                      tokens: 0,
                      ...(source.type.game ? { actor: pool.actor ?? 'controller' } : {}),
                    }
                  : n,
              ),
            },
            ...(c!.timing
              ? {
                  timing: {
                    ...c!.timing,
                    urgent: pool.urgent ? [...c!.timing.urgent, node.id] : c!.timing.urgent,
                  },
                }
              : {}),
          });
          break;
        }
        const pool = source.shared.places.find((p) => p.id === node.sharedId)!;
        const { sharedId: _shared, ...geometry } = node;
        let next: SharedComponent = {
          ...c!,
          net: {
            ...c!.net,
            nodes: c!.net.nodes.map((n) =>
              n.id === node.id ? { ...geometry, name: edit.name, tokens: pool.tokens } : n,
            ),
          },
        };
        if (next.timing && pool.timing)
          next = {
            ...next,
            timing: {
              ...next.timing,
              invariants: {
                ...next.timing.invariants,
                ...(pool.timing.invariant ? { [node.id]: pool.timing.invariant } : {}),
              },
              ages: {
                ...next.timing.ages,
                ...(pool.timing.ages.length ? { [node.id]: pool.timing.ages } : {}),
              },
            },
          };
        change(next);
        break;
      }
      case 'removeOccurrence': {
        authoredCheck(isMember(node!), 'Only shared occurrences can be removed here.');
        const removed = new Set(
          c!.net.arcs
            .filter((a) => a.source === node!.id || a.target === node!.id)
            .map((a) => a.id),
        );
        for (const pair of c!.timing?.transports ?? [])
          if (removed.has(pair.inputArc) || removed.has(pair.outputArc)) {
            removed.add(pair.inputArc);
            removed.add(pair.outputArc);
          }
        const next: SharedComponent = {
          ...c!,
          net: {
            ...c!.net,
            nodes: c!.net.nodes.filter((n) => n.id !== node!.id),
            arcs: c!.net.arcs.filter((a) => !removed.has(a.id)),
          },
        };
        change({
          ...next,
          ...(next.timing
            ? {
                timing: {
                  ...next.timing,
                  intervals: Object.fromEntries(
                    Object.entries(next.timing.intervals).filter(([key]) => !removed.has(key)),
                  ),
                  transports: next.timing.transports.filter((pair) => !removed.has(pair.inputArc)),
                },
              }
            : {}),
        });
        break;
      }
      case 'copyComponent':
        source = {
          ...source,
          components: [
            ...source.components,
            { ...c!, id: edit.id, active: true, net: { ...c!.net, template: edit.template } },
          ],
        };
        break;
      case 'updateConstant':
        authoredCheck(
          source.constants.some((k) => k.id === edit.id),
          'Unknown constant.',
        );
        source = {
          ...source,
          constants: source.constants.map((k) =>
            k.id === edit.id ? { id: k.id, name: edit.name, value: edit.value } : k,
          ),
        };
        break;
      case 'deleteConstant':
        authoredCheck(
          source.constants.some((k) => k.id === edit.id),
          'Unknown constant.',
        );
        authoredCheck(
          sharedConstantUses(source, edit.id).length === 0,
          `Constant ${source.constants.find((k) => k.id === edit.id)!.name} is still in use.`,
          'in-use',
          sharedConstantUses(source, edit.id),
        );
        source = { ...source, constants: source.constants.filter((k) => k.id !== edit.id) };
        break;
      case 'patchGeometry':
        closedAuthored(edit.geometry, [
          'x',
          'y',
          'nameOffsetX',
          'nameOffsetY',
          'nameVisible',
          'angle',
        ]);
        change({
          ...c!,
          net: {
            ...c!.net,
            nodes: c!.net.nodes.map((n) => (n.id === node!.id ? { ...n, ...edit.geometry } : n)),
          },
        });
        break;
      case 'removeQueries': {
        const { savedQueries: _q, ...rest } = source;
        source = rest;
        break;
      }
    }
    const checked = validateSharedSource(source);
    return checked.ok
      ? { ok: true, value: commitAuthoredSnapshot(doc, checked.value.source) }
      : checked;
  } catch (error) {
    return authoredFailure(error);
  }
}
