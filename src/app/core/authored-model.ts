import type { Arc, Net } from './net';
import { integer } from './net';
import { requireEditableModelType } from './model-types';
import { ComponentTiming, Network, validateNetwork } from './resolved-network';
import { SavedQueries, captureSavedQueries, validateSavedQueries } from './saved-queries';
import { Decimal, compareAges, validateInterval, validateInvariant } from './timed';

export type ReadonlyData<T> = T extends object
  ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
  : T;
export type ConstantId = string;
export interface ConstantDecl {
  readonly id: ConstantId;
  readonly name: string;
  readonly value: number;
}
export interface ConstantRef {
  readonly constantId: ConstantId;
}
export type WeightTerm = number | ConstantRef;
export type BoundTerm = Decimal | ConstantRef;
export interface AuthoredInterval {
  readonly lower: BoundTerm;
  readonly upper: BoundTerm | null;
  readonly lowerClosed: boolean;
  readonly upperClosed: boolean;
}
export interface AuthoredInvariant {
  readonly upper: BoundTerm | null;
  readonly upperClosed: boolean;
}
export type AuthoredArc = ReadonlyData<Omit<Arc, 'weight'>> & { readonly weight: WeightTerm };
export type AuthoredNet = ReadonlyData<Omit<Net, 'arcs'>> & {
  readonly arcs: readonly AuthoredArc[];
};
export type AuthoredTiming = ReadonlyData<Omit<ComponentTiming, 'intervals' | 'invariants'>> & {
  readonly intervals: Readonly<Record<string, AuthoredInterval>>;
  readonly invariants: Readonly<Record<string, AuthoredInvariant>>;
};
export interface AuthoredComponent {
  readonly id: string;
  readonly active: boolean;
  readonly net: AuthoredNet;
  readonly timing?: AuthoredTiming;
}
export interface AuthoredSavedQueries extends SavedQueries {
  readonly protectedConstants: readonly { readonly id: string; readonly name: string }[];
}
export type AuthoredNetwork = ReadonlyData<Omit<Network, 'components' | 'savedQueries'>> & {
  readonly constants: readonly ConstantDecl[];
  readonly components: readonly AuthoredComponent[];
  readonly savedQueries?: AuthoredSavedQueries;
};
export interface Use {
  readonly constantId: ConstantId;
  /** V3 global use: poolId + activeMemberCount, with no component/element IDs. */
  readonly poolId?: string;
  readonly activeMemberCount?: number;
  readonly componentId?: string;
  readonly elementId?: string;
  readonly active?: boolean;
  readonly field: 'weight' | 'lower' | 'upper' | 'invariant' | 'saved-query-protection';
}
export interface Issue {
  readonly code:
    | 'shape'
    | 'name'
    | 'range'
    | 'unbound'
    | 'in-use'
    | 'query-protected'
    | 'invalid-model'
    | 'unsupported'
    | 'stale-revision';
  readonly message: string;
  readonly uses: readonly Use[];
}
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] };
const resolvedBrand: unique symbol = Symbol('ResolvedRevision');
export interface ResolvedRevision {
  readonly [resolvedBrand]: true;
  readonly source: AuthoredNetwork;
  readonly numeric: ReadonlyData<Network>;
}

/** Internal shared value helpers; no mutable aliases survive an Interface call. */
export function freezeAuthored<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeAuthored(child);
    Object.freeze(value);
  }
  return value;
}
export function authoredFingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export class AuthoredFailure extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message);
  }
}
export function authoredCheck(
  ok: unknown,
  message: string,
  code: Issue['code'] = 'shape',
  uses: readonly Use[] = [],
): asserts ok {
  if (!ok) throw new AuthoredFailure({ code, message, uses });
}
export function authoredFailure(error: unknown, uses: readonly Use[] = []): Result<never> {
  return {
    ok: false,
    issues: [
      error instanceof AuthoredFailure
        ? error.issue
        : {
            code: 'invalid-model',
            message: error instanceof Error ? error.message : String(error),
            uses,
          },
    ],
  };
}
/** Reject inherited state, accessors and hidden keys before cloning could erase evidence. */
export function closedAuthored(value: unknown, keys?: readonly string[]): void {
  authoredCheck(
    !!value && typeof value === 'object' && !Array.isArray(value),
    'Expected a plain record.',
  );
  const prototype = Object.getPrototypeOf(value);
  authoredCheck(
    prototype === Object.prototype || prototype === null,
    'Inherited model fields are unsupported.',
  );
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    authoredCheck(
      typeof key === 'string' &&
        descriptor.enumerable &&
        'value' in descriptor &&
        (!keys || keys.includes(key)),
      `Unknown or non-data field ${String(key)}.`,
    );
  }
}
export function plainAuthoredTree(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    authoredCheck(
      Object.getPrototypeOf(value) === Array.prototype,
      'Inherited arrays are unsupported.',
    );
    authoredCheck(
      Reflect.ownKeys(value).length === value.length + 1,
      'Arrays must be dense with no extra fields.',
    );
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      authoredCheck(
        !!descriptor && descriptor.enumerable && 'value' in descriptor,
        'Invalid array entry.',
      );
      plainAuthoredTree(value[i]);
    }
  } else {
    closedAuthored(value);
    for (const item of Object.values(value)) plainAuthoredTree(item);
  }
}
const ref = (v: unknown): v is ConstantRef => !!v && typeof v === 'object';
function allConstantUses(source: AuthoredNetwork): Use[] {
  const uses: Use[] = [];
  for (const c of source.components) {
    const add = (term: unknown, elementId: string, field: Use['field']) => {
      if (ref(term) && typeof term.constantId === 'string')
        uses.push({
          constantId: term.constantId,
          componentId: c.id,
          elementId,
          field,
          active: c.active,
        });
    };
    for (const a of c.net.arcs) add(a.weight, a.id, 'weight');
    for (const [aid, i] of Object.entries(c.timing?.intervals ?? {})) {
      add(i.lower, aid, 'lower');
      add(i.upper, aid, 'upper');
    }
    for (const [pid, i] of Object.entries(c.timing?.invariants ?? {}))
      add(i.upper, pid, 'invariant');
  }
  for (const c of source.savedQueries?.protectedConstants ?? [])
    uses.push({ constantId: c.id, field: 'saved-query-protection' });
  return uses;
}
export function constantUses(source: AuthoredNetwork, id: ConstantId): readonly Use[] {
  return freezeAuthored(allConstantUses(source).filter((u) => u.constantId === id));
}
function validateShape(source: AuthoredNetwork): void {
  plainAuthoredTree(source);
  closedAuthored(source, ['name', 'type', 'components', 'constants', 'savedQueries']);
  closedAuthored(source.type, ['timed', 'colored', 'game', 'stochastic']);
  authoredCheck(
    Array.isArray(source.constants) && Array.isArray(source.components),
    'Declarations and components must be arrays.',
  );
  for (const c of source.components) {
    closedAuthored(c, ['id', 'active', 'net', 'timing']);
    closedAuthored(c.net, ['name', 'template', 'nodes', 'arcs', 'annotations']);
    authoredCheck(
      Array.isArray(c.net.nodes) && Array.isArray(c.net.arcs),
      'Nodes and arcs must be arrays.',
    );
    for (const n of c.net.nodes)
      closedAuthored(n, [
        'id',
        'kind',
        'name',
        'x',
        'y',
        'tokens',
        'nameOffsetX',
        'nameOffsetY',
        'nameVisible',
        'angle',
      ]);
    for (const a of c.net.arcs) {
      closedAuthored(a, [
        'id',
        'source',
        'target',
        'kind',
        'weight',
        'bends',
        'curvedEnd',
        'nameOffsetX',
        'nameOffsetY',
      ]);
      if (a.bends !== undefined) {
        authoredCheck(Array.isArray(a.bends), 'Bends must be an array.');
        for (const b of a.bends) closedAuthored(b, ['x', 'y', 'curved']);
      }
    }
    if (c.net.annotations !== undefined) {
      authoredCheck(Array.isArray(c.net.annotations), 'Annotations must be an array.');
      for (const n of c.net.annotations)
        closedAuthored(n, ['id', 'text', 'x', 'y', 'width', 'height', 'border', 'filled']);
    }
    if (c.timing !== undefined) {
      closedAuthored(c.timing, ['intervals', 'invariants', 'urgent', 'transports', 'ages']);
      for (const map of [c.timing.intervals, c.timing.invariants, c.timing.ages])
        closedAuthored(map);
      authoredCheck(
        Array.isArray(c.timing.urgent) && Array.isArray(c.timing.transports),
        'Invalid timing arrays.',
      );
      for (const i of Object.values(c.timing.intervals))
        closedAuthored(i, ['lower', 'upper', 'lowerClosed', 'upperClosed']);
      for (const i of Object.values(c.timing.invariants))
        closedAuthored(i, ['upper', 'upperClosed']);
      for (const p of c.timing.transports) closedAuthored(p, ['inputArc', 'outputArc']);
    }
  }
}
/** Whole-network structural resolution, including inactive components; execution capacity stays in engines. */
export function resolveAuthored(source: AuthoredNetwork): Result<ResolvedRevision> {
  let uses: readonly Use[] = [];
  try {
    validateShape(source);
    const allUses = allConstantUses(source);
    const componentUses = new Map<string, Use[]>();
    for (const use of allUses) {
      const list = componentUses.get(use.componentId ?? '') ?? [];
      list.push(use);
      componentUses.set(use.componentId ?? '', list);
    }
    const bindings = new Map<string, ConstantDecl>(),
      names = new Set<string>();
    for (const c of source.constants) {
      uses = allUses.filter((u) => u.constantId === c.id);
      closedAuthored(c, ['id', 'name', 'value']);
      authoredCheck(
        typeof c.id === 'string' && c.id.length > 0 && !bindings.has(c.id),
        'Constant IDs must be nonempty and unique.',
      );
      authoredCheck(
        typeof c.name === 'string' &&
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name) &&
          c.name !== 'inf' &&
          !names.has(c.name),
        `Invalid, reserved or duplicate constant name: ${c.name}.`,
        'name',
      );
      authoredCheck(
        Number.isInteger(c.value) && c.value >= 0 && c.value <= 2147483647,
        `Constant ${c.name} must be an integer in 0…2147483647.`,
        'range',
        uses,
      );
      bindings.set(c.id, c);
      names.add(c.name);
    }
    const term = (v: WeightTerm | BoundTerm, numeric: boolean): number | string => {
      if (ref(v)) {
        closedAuthored(v, ['constantId']);
        authoredCheck(
          typeof v.constantId === 'string' && bindings.has(v.constantId),
          `Unbound constant ${v.constantId}.`,
          'unbound',
          uses,
        );
        return numeric
          ? bindings.get(v.constantId)!.value
          : String(bindings.get(v.constantId)!.value);
      }
      authoredCheck(
        typeof v === (numeric ? 'number' : 'string'),
        'Expected a literal or {constantId} term.',
      );
      return v;
    };
    const components = source.components.map((c) => {
      uses = componentUses.get(c.id) ?? [];
      const net = {
        ...structuredClone(c.net),
        arcs: c.net.arcs.map((a) => {
          uses = (componentUses.get(c.id) ?? []).filter(
            (use) => use.elementId === a.id && use.field === 'weight',
          );
          const weight = term(a.weight, true) as number;
          integer(weight, 1, 'Arc weight');
          return { ...structuredClone(a), weight };
        }),
      } as Net;
      uses = componentUses.get(c.id) ?? [];
      if (c.timing === undefined) return { id: c.id, active: c.active, net };
      const timing = c.timing;
      const intervals = Object.fromEntries(
        Object.entries(timing.intervals).flatMap(([id, i]) => {
          const value = {
            ...i,
            lower: term(i.lower, false) as string,
            upper: i.upper === null ? null : (term(i.upper, false) as string),
          };
          validateInterval(value);
          const isDefault =
            compareAges(value.lower, '0') === 0 && value.lowerClosed && value.upper === null;
          authoredCheck(!isDefault || ref(i.lower), `Omit literal default interval on ${id}.`);
          const arc = c.net.arcs.find((a) => a.id === id);
          authoredCheck(
            arc?.kind === 'normal' &&
              c.net.nodes.some((n) => n.id === arc.source && n.kind === 'place'),
            `Interval ${id} must belong to an ordinary or transport input arc.`,
            'invalid-model',
            uses,
          );
          authoredCheck(
            !timing.urgent.includes(arc.target) || (!ref(i.lower) && !ref(i.upper)),
            `Symbolic urgent input ${id} is unsupported pending native oracle evidence.`,
            'unsupported',
            uses,
          );
          return isDefault ? [] : [[id, value]];
        }),
      );
      const invariants = Object.fromEntries(
        Object.entries(timing.invariants).map(([id, i]) => {
          const value = { ...i, upper: i.upper === null ? null : (term(i.upper, false) as string) };
          validateInvariant(value);
          authoredCheck(value.upper !== null, `Omit literal default invariant on ${id}.`);
          return [id, value];
        }),
      );
      for (const pair of timing.transports) {
        const input = c.net.arcs.find((a) => a.id === pair.inputArc),
          output = c.net.arcs.find((a) => a.id === pair.outputArc);
        authoredCheck(
          input &&
            output &&
            authoredFingerprint(input.weight) === authoredFingerprint(output.weight),
          `Transport ${pair.inputArc}/${pair.outputArc} requires identical authored weight terms.`,
          'invalid-model',
          uses,
        );
      }
      return { ...c, net, timing: { ...structuredClone(timing), intervals, invariants } };
    });
    const numeric: Network = { name: source.name, type: { ...source.type }, components };
    if (source.savedQueries !== undefined) {
      const q = source.savedQueries;
      closedAuthored(q, ['xml', 'protectedComponents', 'protectedConstants']);
      authoredCheck(Array.isArray(q.protectedConstants), 'Missing protected constants.');
      const seen = new Set<string>();
      for (const p of q.protectedConstants) {
        closedAuthored(p, ['id', 'name']);
        authoredCheck(
          typeof p.id === 'string' &&
            typeof p.name === 'string' &&
            bindings.has(p.id) &&
            !seen.has(p.id) &&
            bindings.get(p.id)!.name === p.name,
          `Saved queries protect constant ${p.name}; remove queries explicitly before rename/removal.`,
          'query-protected',
          [{ constantId: p.id, field: 'saved-query-protection' }],
        );
        seen.add(p.id);
      }
      validateSavedQueries({
        ...numeric,
        savedQueries: { xml: q.xml, protectedComponents: q.protectedComponents },
      });
    }
    uses = allUses;
    validateNetwork(numeric);
    try {
      requireEditableModelType(numeric.type, { timed: true });
    } catch (e) {
      authoredCheck(false, (e as Error).message, 'unsupported');
    }
    // Immutable document revisions retain identity; mutable imports get an isolated source.
    const immutable = (v: unknown): boolean =>
      !v || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(immutable));
    const revision = immutable(source) ? source : freezeAuthored(structuredClone(source));
    return {
      ok: true,
      value: Object.freeze({
        [resolvedBrand]: true as const,
        source: revision,
        numeric: freezeAuthored(structuredClone(numeric)),
      }),
    };
  } catch (e) {
    return authoredFailure(e, uses);
  }
}
/** Validated opt-in adapter; existing documents and their history remain numeric. */
export function authoredFromNumeric(network: Network): Result<AuthoredNetwork> {
  try {
    plainAuthoredTree(network);
    closedAuthored(network, ['name', 'type', 'components', 'savedQueries']);
    validateNetwork(network);
  } catch (e) {
    return authoredFailure(e);
  }
  const { savedQueries, ...rest } = network;
  const source: AuthoredNetwork = {
    ...rest,
    constants: [],
    ...(network.savedQueries
      ? { savedQueries: { ...network.savedQueries, protectedConstants: [] } }
      : {}),
  };
  const result = resolveAuthored(source);
  return result.ok ? { ok: true, value: freezeAuthored(structuredClone(source)) } : result;
}
/** Capture once at import/open; transactions never call this or recapture protections. */
export function captureAuthoredSavedQueries(
  source: AuthoredNetwork,
  xml: readonly string[],
): Result<AuthoredSavedQueries> {
  const resolved = resolveAuthored(source);
  if (!resolved.ok) return resolved;
  const q: AuthoredSavedQueries = {
    ...captureSavedQueries(structuredClone(resolved.value.numeric) as Network, xml),
    protectedConstants: source.constants.map(({ id, name }) => ({ id, name })),
  };
  const checked = resolveAuthored({ ...source, savedQueries: q });
  return checked.ok ? { ok: true, value: freezeAuthored(structuredClone(q)) } : checked;
}
