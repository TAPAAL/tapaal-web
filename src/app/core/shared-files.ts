/** V3 shared-element codecs. Scalar inspection projections never escape. */
import {
  AuthoredComponent,
  AuthoredNetwork,
  AuthoredInvariant,
  BoundTerm,
  WeightTerm,
  Result,
  authoredFingerprint,
  closedAuthored,
} from './authored-model';
import {
  SharedComponent,
  SharedOccurrence,
  SharedPlace,
  SharedTransition,
  SharedSource,
  captureSharedQueries,
  sharedFromAuthored,
  validateSharedSource,
} from './authored-shared';
import { parseAuthoredJson, parseAuthoredTapn, serializeAuthoredTapn } from './authored-files';
import { NETWORK_JSON_FORMAT } from './network-files';
import { compareAges } from './timed';
import { validateName } from './net';

export interface SharedImportResult {
  network: SharedSource;
  warnings: string[];
}
function fail(message: string): never {
  throw new Error(message);
}
function value<T>(result: Result<T>): T {
  if (!result.ok) fail(result.issues.map((i) => i.message).join(' '));
  return result.value;
}
const checked = (source: SharedSource) => value(validateSharedSource(source)).source;
const member = (n: SharedComponent['net']['nodes'][number]): n is SharedOccurrence =>
  Object.hasOwn(n, 'sharedId');
const children = (parent: Element, tag: string) =>
  Array.from(parent.children).filter((e) => e.localName === tag);
const xml = (e: Element) => new XMLSerializer().serializeToString(e);
const wireId = (e: Element) => e.getAttribute('id') || e.getAttribute('name') || '';
const nativeName = (e: Element) => e.getAttribute('name') || wireId(e);
function documentFrom(source: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    fail('XML document types and entities are not supported.');
  const d = new DOMParser().parseFromString(source, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) fail('The XML file is malformed.');
  if (
    Array.from(d.childNodes).some(
      (n) => n !== d.documentElement && !(n.nodeType === n.TEXT_NODE && !n.textContent?.trim()),
    )
  )
    fail('XML comments and processing instructions outside PNML are unsupported.');
  return d;
}
export function serializeSharedJson(source: SharedSource): string {
  return JSON.stringify(
    { format: NETWORK_JSON_FORMAT, version: 3, network: checked(source) },
    null,
    2,
  );
}
export function parseSharedJson(source: string): SharedImportResult {
  let file;
  try {
    file = JSON.parse(source);
  } catch {
    fail('The JSON file is malformed.');
  }
  closedAuthored(file, ['format', 'version', 'network', 'net']);
  if (file.format === NETWORK_JSON_FORMAT && file.version === 3) {
    closedAuthored(file, ['format', 'version', 'network']);
    return { network: checked(file.network), warnings: [] };
  }
  // V2 containing shared must pass the OLD exact schema before migration.
  const old = parseAuthoredJson(source);
  return { network: value(sharedFromAuthored(old.network)), warnings: old.warnings };
}
const POOL_ATTRIBUTES = new Set(['name', 'invariant', 'initialMarking']);
/** Inspect declaration location/metadata before adapting any original subtree. */
function declarations(document: Document): Element[] {
  const root = document.documentElement,
    pools: Element[] = [],
    names = new Set<string>();
  for (const e of Array.from(document.getElementsByTagName('*'))) {
    if (!['shared-place', 'shared-transition'].includes(e.localName)) continue;
    if (e.parentElement !== root || e.prefix !== null || e.namespaceURI !== root.namespaceURI)
      fail('Shared declarations must be unprefixed root elements in the PNML namespace.');
    for (const a of Array.from(e.attributes))
      if (
        a.namespaceURI ||
        !(
          e.localName === 'shared-place'
            ? POOL_ATTRIBUTES
            : new Set(['name', 'urgent', 'player', 'weight', 'firingMode', 'distribution', 'value'])
        ).has(a.name)
      )
        fail(`Unsupported ${e.localName} attribute ${a.name}.`);
    const name = e.getAttribute('name') ?? '';
    validateName(name);
    if (names.has(name)) fail(`Duplicate shared declaration name ${name}.`);
    names.add(name);
    if (e.localName === 'shared-place' && !e.hasAttribute('initialMarking'))
      fail(`Missing initialMarking on shared-place ${name}.`);
    pools.push(e);
  }
  return pools;
}
function fresh(used: Set<string>, stem: string): string {
  let name = stem;
  while (used.has(name)) name += '_';
  used.add(name);
  return name;
}
const decimal = (age: string) =>
  age.includes('.') ? age.replace(/0+$/, '').replace(/\.$/, '') : age;
const ages = (input: readonly string[]) => [...input].map(decimal).sort(compareAges);
function semantics(c: AuthoredComponent, id: string) {
  return {
    tokens: c.net.nodes.find((n) => n.id === id)!.tokens,
    invariant: c.timing && Object.hasOwn(c.timing.invariants, id) ? c.timing.invariants[id] : null,
    ages: ages(c.timing && Object.hasOwn(c.timing.ages, id) ? c.timing.ages[id] : []),
  };
}
/** Redundant XML agreement is checked on ORIGINAL elements before any adapter or
 * geometry clone. This compares authored spellings; it does not resolve constants
 * or validate source. The scalar inspector subsequently validates every term/AST.
 */
function wireSemantics(place: Element): string {
  if (place.localName.includes('transition')) {
    const defaults: Record<string, string> = {
      urgent: 'false',
      player: '0',
      weight: '1',
      firingMode: 'Random',
      distribution: 'constant',
      value: '1',
    };
    return authoredFingerprint(
      Object.fromEntries(
        Object.entries(defaults).map(([k, v]) => {
          const raw = place.getAttribute(k) ?? v;
          return [
            k,
            ['player', 'weight', 'value'].includes(k) && /^\d+(\.\d+)?$/.test(raw)
              ? Number(raw)
              : raw,
          ];
        }),
      ),
    );
  }
  const count = place.getAttribute('initialMarking') ?? '';
  if (!/^\d+$/.test(count)) fail('Invalid shared initial marking.');
  const match = /^(<|<=)\s*(\w+)$/.exec(place.getAttribute('invariant') ?? '< inf');
  if (!match) fail('Malformed shared invariant.');
  const bound = match[2];
  const invariant =
    bound === 'inf' && match[1] === '<'
      ? null
      : {
          upperClosed: match[1] === '<=',
          term: /^\d+$/.test(bound) ? { literal: BigInt(bound).toString() } : { constant: bound },
        };
  const markings = children(place, 'initialMarkingAge');
  if (markings.length > 1) fail('Duplicate shared initialMarkingAge.');
  const tokens = markings.flatMap((m) => children(m, 'token'));
  if (BigInt(tokens.length) > BigInt(count)) fail('Shared age count exceeds marking.');
  const nonzero = tokens
    .map((t) => {
      const age = t.getAttribute('age') ?? '';
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(age)) fail('Malformed shared token age.');
      return age;
    })
    .filter((age) => compareAges(age, '0') > 0);
  return authoredFingerprint({ tokens: BigInt(count).toString(), invariant, ages: ages(nonzero) });
}
export function parseSharedTapn(source: string, filename = 'Imported model'): SharedImportResult {
  const original = documentFrom(source),
    root = original.documentElement;
  const features = children(root, 'feature');
  const game = features.some((e) => e.getAttribute('isGame') === 'true');
  const actor = (e: Element) => {
    const player = e.getAttribute('player') ?? '0';
    if (!['0', '1'].includes(player))
      fail('Unsupported game player; expected native player 0 or 1.');
    if (!game && player === '1') fail('Environment transitions require isGame=true.');
    return player === '1' ? ('environment' as const) : ('controller' as const);
  };
  for (const e of Array.from(original.getElementsByTagName('*')))
    if (['transition', 'shared-transition'].includes(e.localName)) actor(e);
  const pools = declarations(original),
    nets = children(root, 'net');
  if (!nets.length) fail('The file contains no components.');
  const byName = new Map(pools.map((p, i) => [p.getAttribute('name')!, i]));
  const poolTemplate = fresh(new Set(nets.map(nativeName)), 'SharedFileDeclarations');
  // Membership is indexed by component + LOCAL wire ID, never by pool ID.
  const memberships = nets.map((net) => {
    const result = new Map<string, number>(),
      ids = new Set<string>(),
      names = new Set<string>();
    for (const e of Array.from(net.children).filter((e) =>
      ['place', 'transition', 'arc'].includes(e.localName),
    )) {
      const id = wireId(e);
      if (!id || ids.has(id)) fail(`Missing or ambiguous node/arc ID ${id}.`);
      ids.add(id);
      if (e.localName === 'arc') continue;
      const name = nativeName(e);
      validateName(name);
      if (names.has(name)) fail(`Duplicate local node name ${name}.`);
      names.add(name);
      const pool = byName.get(name);
      if (pool === undefined) continue;
      if (e.localName !== pools[pool].localName.replace('shared-', ''))
        fail(`Wrong-kind shared member ${name}.`);
      result.set(id, pool);
    }
    return result;
  });
  const poolSemantics = pools.map(wireSemantics);
  nets.forEach((net, index) => {
    for (const place of Array.from(net.children).filter((e) =>
      ['place', 'transition'].includes(e.localName),
    )) {
      const i = memberships[index].get(wireId(place));
      if (i !== undefined && wireSemantics(place) !== poolSemantics[i])
        fail(
          `Shared ${place.localName} member ${wireId(place)} disagrees with declaration ${pools[i].getAttribute('name')} (${place.localName === 'transition' ? 'urgency or transition metadata' : 'count, age multiset or authored invariant'}).`,
        );
    }
  });
  const queryXml = children(root, 'query').map(xml);
  // All semantic subtrees survive into this inspection adapter: pools become
  // isolated places, members retain original attrs/ASTs. Only membership names
  // and declaration metadata are adapted. The old reader validates every field
  // before its own disposable numeric geometry clone is made.
  const copy = original.cloneNode(true) as Document,
    target = copy.documentElement;
  children(target, 'query').forEach((e) => e.remove());
  const poolNet = copy.createElementNS(root.namespaceURI, 'net');
  poolNet.setAttribute('id', poolTemplate);
  poolNet.setAttribute('type', 'P/T net');
  poolNet.setAttribute('active', 'true');
  Array.from(target.children)
    .filter((e) => ['shared-place', 'shared-transition'].includes(e.localName))
    .forEach((pool, i) => {
      const place = copy.createElementNS(root.namespaceURI, pool.localName.replace('shared-', ''));
      for (const a of Array.from(pool.attributes)) place.setAttribute(a.name, a.value);
      place.setAttribute('id', `pool${i}`);
      place.setAttribute('positionX', '0');
      place.setAttribute('positionY', '0');
      for (const child of Array.from(pool.childNodes)) place.appendChild(child.cloneNode(true));
      poolNet.appendChild(place);
      pool.remove();
    });
  children(target, 'net').forEach((net, index) => {
    const names = new Set(Array.from(net.children).map(nativeName));
    for (const place of Array.from(net.children).filter((e) =>
      ['place', 'transition'].includes(e.localName),
    ))
      if (memberships[index].has(wireId(place))) {
        place.setAttribute('id', wireId(place));
        place.setAttribute('name', fresh(names, 'SharedFileOccurrence'));
      }
  });
  target.appendChild(poolNet);
  // Explicit game inspection adapter: roles have been validated on the original,
  // including root/member consensus. Scalar readers remain strict.
  if (game) {
    children(target, 'feature').forEach((e) => e.setAttribute('isGame', 'false'));
    Array.from(target.getElementsByTagName('transition')).forEach((e) =>
      e.setAttribute('player', '0'),
    );
  }
  const parsed = parseAuthoredTapn(xml(target), filename),
    poolComponent = parsed.network.components.at(-1)!;
  const allPools = pools.map((pool, i): SharedPlace | SharedTransition => {
    if (pool.localName === 'shared-transition')
      return {
        id: `tapn:shared-transition:${i}`,
        name: pool.getAttribute('name')!,
        urgent: poolComponent.timing?.urgent.includes(`pool${i}`) ?? false,
        ...(game ? { actor: actor(pool) } : {}),
      };
    const s = semantics(poolComponent, `pool${i}`);
    return {
      id: `tapn:shared-place:${i}`,
      name: pool.getAttribute('name')!,
      tokens: s.tokens,
      ...(parsed.network.type.timed ? { timing: { invariant: s.invariant, ages: s.ages } } : {}),
    };
  });
  const places = allPools.filter((p): p is SharedPlace => 'tokens' in p);
  const transitions = allPools.filter((p): p is SharedTransition => 'urgent' in p);
  const components: SharedComponent[] = parsed.network.components.slice(0, -1).map((c, index) => {
    const mapping = memberships[index];
    for (const [id, i] of mapping)
      if (
        pools[i].localName === 'shared-place' &&
        authoredFingerprint(semantics(c, id)) !==
          authoredFingerprint(semantics(poolComponent, `pool${i}`))
      )
        fail(
          `Shared member ${id} in ${c.net.template} disagrees with declaration ${allPools[i].name} (count, age multiset or authored invariant).`,
        );
    const withoutMembers = <T>(r: Readonly<Record<string, T>>) =>
      Object.fromEntries(Object.entries(r).filter(([id]) => !mapping.has(id)));
    return {
      ...c,
      net: {
        ...c.net,
        nodes: c.net.nodes.map((n) => {
          const i = mapping.get(n.id);
          if (i === undefined)
            return game && n.kind === 'transition'
              ? {
                  ...n,
                  actor: actor(
                    children(nets[index], 'transition').find((e) => wireId(e) === n.id)!,
                  ),
                }
              : n;
          const { name: _name, tokens: _tokens, ...geometry } = n;
          if (n.kind === 'place') delete geometry.angle;
          return { ...geometry, sharedId: allPools[i].id };
        }),
      },
      ...(c.timing
        ? {
            timing: {
              ...c.timing,
              urgent: c.timing.urgent.filter((id) => !mapping.has(id)),
              invariants: withoutMembers(c.timing.invariants),
              ages: withoutMembers(c.timing.ages),
            },
          }
        : {}),
    };
  });
  let network = checked({
    name: parsed.network.name,
    type: { ...parsed.network.type, game },
    constants: parsed.network.constants,
    components,
    shared: { places, transitions },
  });
  if (queryXml.length)
    network = checked({ ...network, savedQueries: value(captureSharedQueries(network, queryXml)) });
  return { network, warnings: parsed.warnings };
}
/** Source comparison with explicit native pool/constant/component name correspondence.
 * Local wire IDs and annotation IDs must survive; there is no numeric equality shortcut.
 */
function meaning(source: SharedSource): string {
  const pools = new Map(
    [...source.shared.places, ...source.shared.transitions].map((p) => [p.id, p.name]),
  );
  const constants = new Map(source.constants.map((p) => [p.id, p.name]));
  const components = new Map(source.components.map((c) => [c.id, c.net.template]));
  const reference = (names: ReadonlyMap<string, string>, id: string): string => {
    if (!names.has(id)) fail(`Missing native reference correspondence for ${id}.`);
    return names.get(id)!;
  };
  const term = (value: BoundTerm | WeightTerm | null) =>
    value !== null && typeof value === 'object'
      ? { constantId: reference(constants, value.constantId) }
      : value;
  const invariant = (value: AuthoredInvariant | null) =>
    value === null ? null : { ...value, upper: term(value.upper) };
  const q = source.savedQueries;
  return authoredFingerprint({
    name: source.name,
    type: source.type,
    constants: source.constants.map(({ name, value }) => ({ name, value })),
    shared: source.shared.places.map(({ id: _id, timing, ...p }) => ({
      ...p,
      ...(timing
        ? { timing: { invariant: invariant(timing.invariant), ages: ages(timing.ages) } }
        : {}),
    })),
    sharedTransitions: source.shared.transitions.map(({ id: _id, ...p }) => ({
      ...p,
      ...(source.type.game ? { actor: p.actor ?? 'controller' } : {}),
    })),
    components: source.components.map((c) => ({
      template: c.net.template,
      active: c.active,
      name: c.net.name,
      nodes: c.net.nodes.map((n) => ({
        ...n,
        ...(!member(n) && n.kind === 'transition' && source.type.game
          ? { actor: n.actor ?? 'controller' }
          : {}),
        ...(member(n) ? { sharedId: reference(pools, n.sharedId) } : {}),
        nameOffsetX: n.nameOffsetX ?? 0,
        nameOffsetY: n.nameOffsetY ?? 35,
        nameVisible: n.nameVisible ?? true,
        ...(!member(n) || n.kind === 'transition' ? { angle: n.angle ?? 0 } : {}),
      })),
      arcs: [...c.net.arcs]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((a) => ({
          ...a,
          weight: term(a.weight),
          nameOffsetX: a.nameOffsetX ?? 0,
          nameOffsetY: a.nameOffsetY ?? 0,
          bends: a.bends ?? [],
          curvedEnd: a.curvedEnd ?? false,
        })),
      annotations: (c.net.annotations ?? []).map((n) => ({
        ...n,
        border: n.border ?? true,
        filled: n.filled ?? true,
      })),
      timing: c.timing && {
        ...c.timing,
        // Timing-map keys are opaque element IDs, even when named constantId/sharedId.
        intervals: Object.fromEntries(
          Object.entries(c.timing.intervals).map(([id, i]) => [
            id,
            { ...i, lower: term(i.lower), upper: term(i.upper) },
          ]),
        ),
        invariants: Object.fromEntries(
          Object.entries(c.timing.invariants).map(([id, i]) => [id, invariant(i)]),
        ),
        ages: Object.fromEntries(Object.entries(c.timing.ages).map(([id, a]) => [id, ages(a)])),
        urgent: [...c.timing.urgent].sort(),
        transports: [...c.timing.transports].sort((a, b) => a.inputArc.localeCompare(b.inputArc)),
      },
    })),
    queries: q && {
      xml: q.xml,
      constants: q.protectedConstants.map(({ id, name }) => ({
        id: reference(constants, id),
        name,
      })),
      transitions: q.protectedSharedTransitions?.map(({ id, name }) => ({
        id: reference(pools, id),
        name,
      })),
      pools: q.protectedSharedPlaces.map(({ id, name }) => ({ id: reference(pools, id), name })),
      components: q.protectedComponents.map(({ id, ...p }) => ({
        ...p,
        id: reference(components, id),
      })),
      membership: q.protectedMembership.map((m) => ({
        ...m,
        componentId: reference(components, m.componentId),
        sharedId: m.sharedId === null ? null : reference(pools, m.sharedId),
      })),
    },
  });
}
export function serializeSharedTapn(input: SharedSource): string {
  const source = checked(input);
  try {
    return writeSharedTapn(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(/JSON/i.test(message) ? message : `${message} Save JSON instead.`);
  }
}
function writeSharedTapn(source: SharedSource): string {
  const template = fresh(
    new Set(source.components.map((c) => c.net.template)),
    'SharedFileDeclarations',
  );
  const poolMap = new Map(source.shared.places.map((p) => [p.id, p]));
  const local: AuthoredNetwork = {
    name: source.name,
    type: { ...source.type, game: false },
    constants: source.constants,
    components: [
      ...source.components.map((c): AuthoredComponent => {
        const names = new Set(c.net.nodes.flatMap((n) => (member(n) ? [] : [n.name])));
        const members = c.net.nodes.filter(member).filter((n) => n.kind === 'place');
        return {
          ...c,
          active: true,
          net: {
            ...c.net,
            nodes: c.net.nodes.map((n) => {
              if (!member(n)) {
                const { actor: _actor, ...scalar } = n;
                return scalar;
              }
              if (n.kind === 'transition') {
                const { sharedId, ...geometry } = n;
                return { ...geometry, name: fresh(names, 'SharedFileOccurrence'), tokens: 0 };
              }
              const { sharedId, ...geometry } = n,
                pool = poolMap.get(sharedId)!;
              return {
                ...geometry,
                name: fresh(names, 'SharedFileOccurrence'),
                tokens: pool.tokens,
              };
            }),
          },
          ...(c.timing
            ? {
                timing: {
                  ...c.timing,
                  urgent: [
                    ...c.timing.urgent,
                    ...c.net.nodes
                      .filter(member)
                      .filter(
                        (n) =>
                          n.kind === 'transition' &&
                          source.shared.transitions.find((p) => p.id === n.sharedId)!.urgent,
                      )
                      .map((n) => n.id),
                  ],
                  invariants: Object.fromEntries([
                    ...Object.entries(c.timing.invariants),
                    ...members.flatMap((n) => {
                      const invariant = poolMap.get(n.sharedId)!.timing!.invariant;
                      return invariant ? [[n.id, invariant] as const] : [];
                    }),
                  ]),
                  ages: Object.fromEntries([
                    ...Object.entries(c.timing.ages),
                    ...members.flatMap((n) => {
                      const ages = poolMap.get(n.sharedId)!.timing!.ages;
                      return ages.length ? [[n.id, ages] as const] : [];
                    }),
                  ]),
                },
              }
            : {}),
        };
      }),
      {
        id: template,
        active: true,
        net: {
          name: source.name,
          template,
          nodes: source.shared.places.map((p, i) => ({
            id: `pool${i}`,
            kind: 'place',
            name: p.name,
            tokens: p.tokens,
            x: 15,
            y: 15,
            nameOffsetY: 0,
          })),
          arcs: [],
        },
        ...(source.type.timed
          ? {
              timing: {
                intervals: {},
                urgent: [],
                transports: [],
                invariants: Object.fromEntries(
                  source.shared.places.flatMap((p, i) =>
                    p.timing!.invariant ? [[`pool${i}`, p.timing!.invariant]] : [],
                  ),
                ),
                ages: Object.fromEntries(
                  source.shared.places.flatMap((p, i) =>
                    p.timing!.ages.length ? [[`pool${i}`, p.timing!.ages]] : [],
                  ),
                ),
              },
            }
          : {}),
      },
    ],
  };
  const document = documentFrom(serializeAuthoredTapn(local)),
    root = document.documentElement,
    nets = children(root, 'net');
  children(root, 'feature').forEach((e) => e.setAttribute('isGame', String(source.type.game)));
  nets.slice(0, -1).forEach((net, i) => {
    net.setAttribute('active', String(source.components[i].active));
    for (const place of Array.from(net.children).filter((e) =>
      ['place', 'transition'].includes(e.localName),
    )) {
      const node = source.components[i].net.nodes.find((n) => n.id === wireId(place))!;
      if (node.kind === 'transition' && source.type.game) {
        const role = member(node)
          ? source.shared.transitions.find((p) => p.id === node.sharedId)!.actor
          : node.actor;
        place.setAttribute('player', role === 'environment' ? '1' : '0');
      }
      if (member(node))
        place.setAttribute(
          'name',
          (node.kind === 'place'
            ? poolMap.get(node.sharedId)!
            : source.shared.transitions.find((p) => p.id === node.sharedId)!
          ).name,
        );
    }
  });
  const poolNet = nets.at(-1)!;
  children(poolNet, 'place').forEach((place) => {
    const pool = document.createElementNS(root.namespaceURI, 'shared-place');
    for (const name of POOL_ATTRIBUTES)
      if (place.hasAttribute(name)) pool.setAttribute(name, place.getAttribute(name)!);
    for (const child of Array.from(place.childNodes)) pool.appendChild(child.cloneNode(true));
    root.appendChild(pool);
  });
  poolNet.remove();
  for (const p of source.shared.transitions) {
    const e = document.createElementNS(root.namespaceURI, 'shared-transition');
    e.setAttribute('name', p.name);
    e.setAttribute('urgent', String(p.urgent));
    if (source.type.game) e.setAttribute('player', p.actor === 'environment' ? '1' : '0');
    root.appendChild(e);
  }
  for (const query of source.savedQueries?.xml ?? [])
    root.appendChild(document.importNode(documentFrom(query).documentElement, true));
  const output = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml(root);
  if (meaning(parseSharedTapn(output).network) !== meaning(source))
    fail(
      'Shared TAPN export verification failed (identity, terms, membership, geometry or query protections); save JSON instead.',
    );
  return output;
}
export function parseSharedModel(source: string, filename = 'Imported model'): SharedImportResult {
  return source.trimStart().startsWith('{')
    ? parseSharedJson(source)
    : parseSharedTapn(source, filename);
}
