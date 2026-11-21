import {
  inspectDotDeclaration,
  inspectDotDependency,
  writeDotDependencies,
} from './dot-expressions';
import { captureSavedQueries, parseSavedQuery } from './saved-queries';
import { Network, validateNetwork } from './documents';
import { parseJson, parseTapn, serializeTapn } from './files';
import { SUPPORTED_MODEL_TYPE, requireEditableModelType } from './model-types';
import { Net, validateName } from './net';
import { readComponentTiming, stripTiming, writeComponentTiming } from './timed-files';

/** Whole-network open result. Warnings report malformed input that was repaired, never omissions. */
export interface NetworkImportResult {
  network: Network;
  warnings: string[];
}
export const NETWORK_JSON_FORMAT = 'tapaal-web-network';
const LEGACY_JSON_FORMAT = 'tapaal-web-untimed';
const NS = 'http://www.informatik.hu-berlin.de/top/pnml/ptNetb';
const MAX_INT = 2147483647;

function fail(message: string): never {
  throw new Error(message);
}
/** Deterministic: reopening the same file yields the same IDs; UUIDs from documents.ts never collide. */
export function tapnComponentId(templateName: string): string {
  return `tapn:${templateName}`;
}

// ---- Closed JSON shape: unknown keys are rejected, never carried or dropped silently.

const KEYS = {
  file: ['format', 'version', 'network'],
  network: ['name', 'type', 'components', 'savedQueries'],
  type: ['timed', 'colored', 'game', 'stochastic'],
  component: ['id', 'active', 'net', 'timing'],
  timing: ['intervals', 'invariants', 'urgent', 'transports', 'ages'],
  interval: ['lower', 'upper', 'lowerClosed', 'upperClosed'],
  invariant: ['upper', 'upperClosed'],
  transport: ['inputArc', 'outputArc'],
  net: ['name', 'template', 'nodes', 'arcs', 'annotations'],
  node: [
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
  ],
  arc: [
    'id',
    'source',
    'target',
    'kind',
    'weight',
    'bends',
    'curvedEnd',
    'nameOffsetX',
    'nameOffsetY',
  ],
  bend: ['x', 'y', 'curved'],
  annotation: ['id', 'text', 'x', 'y', 'width', 'height', 'border', 'filled'],
};
function closed(value: unknown, kind: keyof typeof KEYS, where: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Invalid ${where}.`);
  const unknown = Object.keys(value).filter((key) => !KEYS[kind].includes(key));
  if (unknown.length) fail(`Unsupported field ${unknown.join(', ')} in ${where}.`);
}
function closedNet(net: unknown, where: string): void {
  closed(net, 'net', where);
  const { nodes, arcs, annotations } = net as Net;
  for (const node of Array.isArray(nodes) ? nodes : []) closed(node, 'node', `${where} node`);
  for (const note of Array.isArray(annotations) ? annotations : [])
    closed(note, 'annotation', `${where} annotation`);
  for (const arc of Array.isArray(arcs) ? arcs : []) {
    closed(arc, 'arc', `${where} arc`);
    for (const bend of Array.isArray(arc.bends) ? arc.bends : [])
      closed(bend, 'bend', `${where} arc ${arc.id} bend`);
  }
}
function closedNetwork(network: unknown): asserts network is Network {
  closed(network, 'network', 'network');
  const { type, components } = network as Network;
  closed(type, 'type', 'network type');
  if (!Array.isArray(components)) fail('Network components must be a list.');
  components.forEach((item, i) => {
    closed(item, 'component', `component ${i + 1}`);
    const where = `component ${item.net?.template ?? i + 1}`;
    closedNet(item.net, where);
    if (item.timing === undefined) return;
    const { timing } = item;
    closed(timing, 'timing', `${where} timing`);
    for (const value of Object.values(timing.intervals ?? {}))
      closed(value, 'interval', `${where} interval`);
    for (const value of Object.values(timing.invariants ?? {}))
      closed(value, 'invariant', `${where} invariant`);
    for (const value of Array.isArray(timing.transports) ? timing.transports : [])
      closed(value, 'transport', `${where} transport`);
  });
}
/** File formats carry timed-only networks; opening one for editing remains a separate opt-in. */
function supported(network: Network): void {
  closedNetwork(network);
  validateNetwork(network);
  requireEditableModelType(network.type, { timed: true });
}

// ---- JSON

export function serializeNetworkJson(network: Network): string {
  supported(network);
  return JSON.stringify({ format: NETWORK_JSON_FORMAT, version: 1, network }, null, 2);
}
/** Network JSON, or legacy single-Net JSON migrated to a one-component network. */
export function parseNetworkJson(source: string): NetworkImportResult {
  let document: { format?: unknown; version?: unknown; network?: unknown; net?: Net };
  try {
    document = JSON.parse(source);
  } catch {
    fail('The JSON file is malformed.');
  }
  if (!document || typeof document !== 'object') fail('Expected a TAPAAL Web JSON model.');
  if (document.format === LEGACY_JSON_FORMAT) {
    const net = parseJson(source).net;
    closedNet(net, `component ${net.template}`);
    const network: Network = {
      name: net.name,
      type: { ...SUPPORTED_MODEL_TYPE },
      components: [{ id: tapnComponentId(net.template), active: true, net }],
    };
    supported(network);
    return { network, warnings: [] };
  }
  if (document.format !== NETWORK_JSON_FORMAT)
    fail('Unsupported JSON format. Open a TAPAAL Web model.');
  if (document.version !== 1)
    fail(`Unsupported ${NETWORK_JSON_FORMAT} version: ${String(document.version)}.`);
  closed(document, 'file', 'network file');
  closedNetwork(document.network);
  supported(document.network);
  return { network: structuredClone(document.network), warnings: [] };
}

// ---- TAPN: an allowlist of native content this model represents exactly; anything else is refused.

type Rule = [ok: (value: string) => boolean, message: string];
const any: Rule = [() => true, ''];
const is =
  (...values: string[]) =>
  (value: string) =>
    values.includes(value);
const integral = (value: string) => /^[-+]?\d+(\.0+)?$/.test(value);
const count = (min: number) => (value: string) =>
  /^\d+$/.test(value) && Number(value) >= min && Number(value) <= MAX_INT;
const numeric = (expected: number) => (value: string) =>
  /^[-+]?\d+(\.\d+)?$/.test(value) && Number(value) === expected;
const COORDINATE: Rule = [
  integral,
  'Desktop TAPAAL stores whole-number positions and label offsets; fractional or non-numeric values are not supported',
];
const DISPLAY_NAME: Rule = [is('true', 'false'), 'displayName must be "true" or "false"'];
// TapnXmlLoader uses Integer.parseInt here: no fractions, no exponents.
const javaInt = (value: string) => /^[-+]?\d+$/.test(value) && Math.abs(Number(value)) <= MAX_INT;
const ANNOTATION_NUMBER: Rule = [
  (value) => value === '' || count(0)(value),
  'Annotation positions and sizes must be whole numbers from 0 to 2,147,483,647',
];
const NODE = {
  id: any,
  name: any,
  positionX: COORDINATE,
  positionY: COORDINATE,
  nameOffsetX: COORDINATE,
  nameOffsetY: COORDINATE,
  displayName: DISPLAY_NAME,
};
const RULES: Record<string, Record<string, Rule>> = {
  pnml: { name: any },
  feature: {
    isTimed: [is('false'), 'Only explicitly untimed TAPAAL files are supported'],
    isColored: [is('false'), 'Coloured nets are not supported'],
    isGame: [is('false'), 'Game nets are not supported'],
    isStochastic: [is('false'), 'Stochastic nets are not supported'],
  },
  'k-bound': { bound: [count(0), 'Invalid k-bound'] },
  net: {
    id: any,
    name: any,
    active: [is('true', 'false'), 'Component active must be "true" or "false"'],
    type: [is('P/T net'), 'Only P/T net components are supported'],
  },
  place: {
    ...NODE,
    initialMarking: [count(0), 'Initial markings must be whole numbers from 0 to 2,147,483,647'],
    invariant: [(v) => /^<\s*(inf|∞)$/i.test(v), 'Timed place invariants are not supported'],
  },
  transition: {
    ...NODE,
    angle: [javaInt, 'Transition angles must be whole numbers of degrees'],
    infiniteServer: [is('false'), 'Infinite-server transitions are not supported'],
    priority: [numeric(0), 'Transition priorities are not supported'],
    urgent: [is('false'), 'Urgent transitions are not supported'],
    player: [numeric(0), 'Game (environment) transitions are not supported'],
    weight: [numeric(1), 'Stochastic transition weights are not supported'],
    firingMode: [is('Random'), 'Token firing modes other than Random are not supported'],
    distribution: [is('constant'), 'Stochastic delay distributions are not supported'],
    value: [numeric(1), 'Stochastic delay distributions are not supported'],
  },
  arc: {
    id: any,
    source: any,
    target: any,
    type: [
      is('normal', 'timed', 'tapnInhibitor', 'inhibitor'),
      'Only normal and inhibitor arcs are supported (no transport arcs)',
    ],
    inscription: any,
    weight: [
      count(1),
      'Arc weights must be whole numbers from 1 to 2,147,483,647 (constants are not supported)',
    ],
    nameOffsetX: COORDINATE,
    nameOffsetY: COORDINATE,
  },
  labels: {
    positionX: ANNOTATION_NUMBER,
    positionY: ANNOTATION_NUMBER,
    width: ANNOTATION_NUMBER,
    height: ANNOTATION_NUMBER,
    border: [(v) => /^(true|false)$/i.test(v), 'Annotation border must be true or false'],
  },
  arcpath: {
    id: any,
    xCoord: [integral, 'Arc path points must be whole numbers'],
    yCoord: [integral, 'Arc path points must be whole numbers'],
    arcPointType: [(v) => /^(true|false)$/i.test(v), 'Arc point types must be true or false'],
  },
};
/** Native timed attributes; their values are parsed by timed-files.ts. */
const TIMED_RULES: Record<string, Record<string, Rule>> = {
  ...RULES,
  feature: { ...RULES['feature'], isTimed: [is('true'), ''] },
  place: { ...RULES['place'], invariant: any },
  transition: {
    ...RULES['transition'],
    urgent: [is('true', 'false'), 'urgent must be "true" or "false"'],
  },
  arc: {
    ...RULES['arc'],
    type: [
      is('normal', 'timed', 'tapnInhibitor', 'inhibitor', 'transport'),
      'Unsupported arc type',
    ],
    transportID: [javaInt, 'transportID must be a whole number'],
  },
  initialMarkingAge: {},
  token: { age: any },
};
const REQUIRED: Record<string, string[]> = {
  feature: ['isTimed'],
  place: ['positionX', 'positionY', 'initialMarking'],
  transition: ['positionX', 'positionY'],
  arc: ['source', 'target'],
  arcpath: ['xCoord', 'yCoord'],
  token: ['age'],
};
const UNSUPPORTED: Record<string, string> = {
  constant: 'Constants are not supported; opening would discard them',
  'shared-place': 'Shared places are not supported',
  'shared-transition': 'Shared transitions are not supported',
  custom_distribution: 'Stochastic distributions are not supported',
  declaration: 'Colour declarations are not supported',
  transportArc: 'Transport arcs are not supported',
  inputArc: 'Legacy inputArc/outputArc/inhibitorArc elements are not supported here',
  outputArc: 'Legacy inputArc/outputArc/inhibitorArc elements are not supported here',
  inhibitorArc: 'Legacy inputArc/outputArc/inhibitorArc elements are not supported here',
  initialMarkingAge: 'Token ages are not supported',
  type: 'Coloured place types are not supported',
  colorinvariant: 'Coloured expressions are not supported',
  hlinitialMarking: 'Coloured expressions are not supported',
  condition: 'Coloured guards are not supported',
  hlinscription: 'Coloured expressions are not supported',
  colorinterval: 'Coloured expressions are not supported',
};
const CHILDREN: Record<string, string[]> = {
  pnml: ['net', 'feature', 'k-bound', 'declaration'],
  net: ['labels', 'place', 'transition', 'arc'],
  arc: ['arcpath'],
};
const TIMED_CHILDREN: Record<string, string[]> = {
  ...CHILDREN,
  place: ['initialMarkingAge'],
  initialMarkingAge: ['token'],
};

function describe(element: Element): string {
  const net = element.closest('net') ?? (element.localName === 'net' ? element : null);
  const self =
    element.localName === 'net' || element.localName === 'pnml'
      ? `<${element.localName}>`
      : `${element.localName} "${element.getAttribute('id') ?? element.getAttribute('name') ?? '?'}"`;
  const owner = net && net !== element ? ` in component "${templateName(net)}"` : '';
  return self + owner;
}
function templateName(net: Element): string {
  return net.getAttribute('name') || net.getAttribute('id') || '';
}
/** Opt-in scalar inspection; the legacy numeric path never supplies this hook. */
export interface NativeScalarInspection {
  declaration(element: Element): void;
  attribute(element: Element, name: string, value: string): string;
  weight(element: Element): number;
}
function inspect(
  node: Node,
  namespace: string | null,
  timed: boolean,
  scalar?: NativeScalarInspection,
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === child.TEXT_NODE) {
      // Annotation text is content; elsewhere only whitespace is allowed.
      if (child.textContent!.trim() && (node as Element).localName !== 'labels')
        fail(`Unsupported text content in ${describe(node as Element)}.`);
    } else if (child.nodeType === child.ELEMENT_NODE) {
      if (node.nodeType === node.DOCUMENT_NODE) inspect(child, namespace, timed, scalar);
      else inspectElement(child as Element, node as Element, namespace, timed, scalar);
    } else if (child.nodeType !== child.DOCUMENT_TYPE_NODE) {
      fail(
        'XML comments, CDATA and processing instructions are not supported; they would be lost.',
      );
    }
  }
}
function inspectElement(
  element: Element,
  parent: Element,
  namespace: string | null,
  timed: boolean,
  scalar?: NativeScalarInspection,
): void {
  const tag = element.localName;
  if (tag === 'query' && parent.localName === 'pnml') {
    parseSavedQuery(new XMLSerializer().serializeToString(element));
    return;
  }
  if (element.namespaceURI !== namespace) fail(`Unsupported XML namespace on <${tag}>.`);
  if (scalar && tag === 'constant' && parent.localName === 'pnml') {
    scalar.declaration(element);
    return;
  }
  if (tag === 'declaration' && parent.localName === 'pnml') {
    try {
      inspectDotDeclaration(element);
    } catch {
      fail('Colour declarations are not supported.');
    }
    return;
  }
  if (
    (parent.localName === 'place' && ['type', 'hlinitialMarking'].includes(tag)) ||
    (parent.localName === 'arc' && tag === 'hlinscription')
  ) {
    try {
      if (scalar && parent.localName === 'arc') {
        const copy = parent.cloneNode(true) as Element;
        copy.setAttribute('weight', String(scalar.weight(parent)));
        inspectDotDependency(
          Array.from(copy.children).find((e) => e.localName === tag)!,
          copy,
        );
      } else inspectDotDependency(element, parent);
    } catch {
      fail(
        `${UNSUPPORTED[tag]}: unsupported or conflicting dot-only scaffolding (in ${describe(parent)}).`,
      );
    }
    return;
  }
  if (!((timed ? TIMED_CHILDREN : CHILDREN)[parent.localName] ?? []).includes(tag))
    fail(`${UNSUPPORTED[tag] ?? `Unsupported element <${tag}>`} (in ${describe(parent)}).`);
  inspectAttributes(element, timed, scalar);
  inspect(element, namespace, timed, scalar);
}
function inspectAttributes(
  element: Element,
  timed: boolean,
  scalar?: NativeScalarInspection,
): void {
  const tag = element.localName;
  const rules = (timed ? TIMED_RULES : RULES)[tag];
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    const rule = attribute.namespaceURI ? undefined : rules[attribute.name];
    if (!rule) fail(`Unsupported attribute ${attribute.name} on ${describe(element)}.`);
    if (
      !rule[0](
        scalar ? scalar.attribute(element, attribute.name, attribute.value) : attribute.value,
      )
    )
      fail(`${rule[1]} (${attribute.name}="${attribute.value}" on ${describe(element)}).`);
  }
  for (const key of REQUIRED[tag] ?? [])
    if (!element.hasAttribute(key)) fail(`Missing ${key} on ${describe(element)}.`);
}
/** Direction-dependent native rules that the per-attribute allowlist cannot express. */
function inspectArcs(net: Element): void {
  const kinds = new Map<string, string>();
  for (const node of Array.from(net.children).filter((e) => e.localName !== 'arc'))
    kinds.set(node.getAttribute('id') || node.getAttribute('name') || '', node.localName);
  for (const arc of Array.from(net.children).filter((e) => e.localName === 'arc')) {
    const type = arc.getAttribute('type') ?? 'normal';
    const input = type !== 'normal';
    const source = kinds.get(arc.getAttribute('source')!),
      target = kinds.get(arc.getAttribute('target')!);
    if (!source || !target) fail(`Arc endpoints do not exist (${describe(arc)}).`);
    if ((source === 'place') !== input || source === target)
      fail(`Arc type ${type} does not match its endpoints (${describe(arc)}).`);
    const inscription = arc.getAttribute('inscription');
    if (inscription !== null && input && !/^\[0,\s*(inf|∞)\)$/i.test(inscription))
      fail(`Timed arc intervals are not supported (${describe(arc)}).`);
    if (inscription !== null && !input && inscription !== '1')
      fail(`Unsupported output arc inscription "${inscription}" (${describe(arc)}).`);
  }
}
/** Native TapnXmlLoader.isNameAllowed: desktop renames other template names on load. */
function requireNativeTemplateName(name: string): void {
  validateName(name, 'Component identifier');
  if (!/^[a-zA-Z]/.test(name))
    fail(`Desktop TAPAAL requires component identifiers to start with a letter: ${name}.`);
}
function title(root: Element, filename: string): string {
  const name = root.getAttribute('name');
  if (name !== null) return name;
  const stem = filename.replace(/^.*[\\/]/, '').replace(/\.(tapn|pnml|xml)$/i, '');
  return stem.trim() ? stem.slice(0, 200) : 'Imported model';
}

/** Validate original XML without discarding unsupported content. */
export function inspectNativeTapn(document: Document, scalar?: NativeScalarInspection): void {
  const root = document.documentElement;
  const namespace = root.namespaceURI;
  if (root.localName !== 'pnml' || (namespace !== null && namespace !== NS))
    fail('Expected a TAPAAL PNML document.');
  const top = (tag: string) => Array.from(root.children).filter((e) => e.localName === tag);
  const features = top('feature');
  if (features.length !== 1) fail('Expected exactly one <feature> declaration.');
  const timed = features[0].getAttribute('isTimed') === 'true';
  inspectAttributes(features[0], timed);
  if (top('k-bound').length > 1 || top('declaration').length > 1)
    fail('Duplicate k-bound or declaration elements.');
  inspectAttributes(root, timed);
  inspect(document, namespace, timed, scalar);
}

/**
 * Multi-component native TAPN. Each `<net>` is checked against the allowlist above, then re-parsed by
 * the legacy single-net `parseTapn` from a standalone copy so the per-component dialect stays shared.
 */
export function parseNetworkTapn(source: string, filename = 'Imported model'): NetworkImportResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    fail('XML document types and entities are not supported.');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) fail('The XML file is malformed.');
  inspectNativeTapn(document);
  const root = document.documentElement;
  const top = (tag: string) => Array.from(root.children).filter((e) => e.localName === tag);
  const timed = top('feature')[0].getAttribute('isTimed') === 'true';
  const nets = top('net');
  if (!nets.length) fail('The file contains no components.');
  const name = title(root, filename);
  const warnings: string[] = [];
  const seen = new Set<string>();
  const components = nets.map((element) => {
    const template = templateName(element);
    const id = element.getAttribute('id');
    if (element.hasAttribute('name') && id !== null && id !== template)
      fail(`Component has conflicting id "${id}" and name "${template}".`);
    requireNativeTemplateName(template);
    if (seen.has(template)) fail(`Component identifiers must be unique: ${template}.`);
    seen.add(template);
    const timing = timed ? readComponentTiming(element, `component "${template}"`) : undefined;
    if (!timed) inspectArcs(element);
    const local = new DOMParser().parseFromString(`<pnml xmlns="${NS}"/>`, 'application/xml');
    const copy = local.importNode(element, true) as Element;
    if (timed) stripTiming(copy);
    // Already validated as redundant; the legacy parser intentionally refuses colour children.
    for (const child of Array.from(copy.querySelectorAll('type, hlinitialMarking, hlinscription')))
      child.remove();
    copy.removeAttribute('name');
    copy.setAttribute('id', template);
    copy.setAttribute('active', 'true');
    // Native defaults absent label offsets to 0; parseTapn would default nameOffsetY to 35.
    for (const node of Array.from(copy.children))
      for (const key of ['nameOffsetX', 'nameOffsetY'])
        if (['place', 'transition'].includes(node.localName) && !node.hasAttribute(key))
          node.setAttribute(key, '0');
    local.documentElement.setAttribute('name', name);
    local.documentElement.appendChild(copy);
    const feature = local.createElementNS(NS, 'feature');
    feature.setAttribute('isTimed', 'false');
    local.documentElement.appendChild(feature);
    const result = parseTapn(new XMLSerializer().serializeToString(local), filename);
    warnings.push(...result.warnings.map((warning) => `Component ${template}: ${warning}`));
    return {
      id: tapnComponentId(template),
      active: element.getAttribute('active') !== 'false',
      net: result.net,
      ...(timing ? { timing } : {}),
    };
  });
  let network: Network = { name, type: { ...SUPPORTED_MODEL_TYPE, timed }, components };
  const queries = top('query').map((e) => new XMLSerializer().serializeToString(e));
  if (queries.length) network = { ...network, savedQueries: captureSavedQueries(network, queries) };
  supported(network);
  return { network, warnings };
}

// Optional fields with native defaults compare equal to their absence; key order is immaterial.
export function canonicalNetworkMeaning(network: Network) {
  const sorted = (_key: string, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item;
  return JSON.stringify(
    {
      name: network.name,
      type: network.type,
      queries: network.savedQueries?.xml,
      components: network.components.map(({ active, net, timing }) => ({
        active,
        template: net.template,
        timing: timing && {
          ...timing,
          urgent: [...timing.urgent].sort(),
          transports: [...timing.transports].sort((a, b) => (a.inputArc < b.inputArc ? -1 : 1)),
        },
        nodes: net.nodes.map(({ nameOffsetX, nameOffsetY, nameVisible, angle, ...node }) => ({
          ...node,
          nameOffsetX: nameOffsetX ?? 0,
          nameOffsetY: nameOffsetY ?? 35,
          nameVisible: nameVisible ?? true,
          angle: angle ?? 0,
        })),
        // TAPN has no annotation IDs: order, geometry, text and border must survive.
        annotations: (net.annotations ?? []).map(({ id: _id, border, filled, ...note }) => ({
          ...note,
          border: border ?? true,
          filled: filled ?? true,
        })),
        // Timed export may move transport halves together; arc order is only drawing order.
        arcs: (timing ? [...net.arcs].sort((a, b) => (a.id < b.id ? -1 : 1)) : net.arcs).map(
          ({ bends, curvedEnd, ...arc }) => ({
            ...arc,
            nameOffsetX: arc.nameOffsetX ?? 0,
            nameOffsetY: arc.nameOffsetY ?? 0,
            bends: bends ?? [],
            curvedEnd: curvedEnd ?? false,
          }),
        ),
      })),
    },
    sorted,
  );
}
/** All components in order with active flags, one feature declaration, and the root title. */
export function serializeNetworkTapn(network: Network): string {
  supported(network);
  for (const { net } of network.components) {
    requireNativeTemplateName(net.template);
    const notes = net.annotations ?? [];
    const fractional = [
      ...net.nodes.flatMap((n) => [n.x, n.y, n.nameOffsetX ?? 0, n.nameOffsetY ?? 0]),
      ...net.arcs.flatMap((a) => [
        a.nameOffsetX ?? 0,
        a.nameOffsetY ?? 0,
        ...(a.bends ?? []).flatMap((b) => [b.x, b.y]),
      ]),
      ...notes.flatMap((n) => [n.x, n.y, n.width, n.height]),
    ].some((value) => !Number.isInteger(value));
    if (fractional)
      fail(
        `Component ${net.template} has fractional coordinates, label offsets or annotation sizes; desktop TAPAAL truncates or rejects them. Snap the elements or save JSON instead.`,
      );
    // TimedArcPetriNetNetworkWriter writes "" for a negative annotation position.
    if (notes.some((n) => n.x < 0 || n.y < 0))
      fail(
        `Component ${net.template} has an annotation left of or above the canvas origin; desktop TAPAAL cannot save its position. Move it or save JSON instead.`,
      );
    if (notes.some((n) => n.filled === false))
      fail(
        `Component ${net.template} has a transparent annotation; desktop TAPAAL does not save annotation backgrounds. Make it solid or save JSON instead.`,
      );
  }
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const [first, ...rest] = network.components;
  const document = parse(serializeTapn(first.net));
  const root = document.documentElement;
  for (const item of rest)
    root.appendChild(
      document.importNode(parse(serializeTapn(item.net)).querySelector('net')!, true),
    );
  // Explorer order: all nets first, then the single k-bound and feature.
  const nets = Array.from(root.children).filter((e) => e.localName === 'net');
  for (const element of Array.from(root.children).filter((e) => e.localName !== 'net'))
    root.appendChild(element);
  nets.forEach((element, i) =>
    element.setAttribute('active', String(network.components[i].active)),
  );
  const counter = { transportId: 0 };
  nets.forEach((element, i) => {
    const { net, timing } = network.components[i];
    if (timing) writeComponentTiming(element, net, timing, counter);
  });
  // Untimed exports retain the legacy-reader dialect; only transports need expressions to
  // preserve weight. Timed exports use native scaffolding consistently on every arc.
  if (network.type.timed) writeDotDependencies(root);
  if (network.type.timed) root.querySelector(':scope > feature')!.setAttribute('isTimed', 'true');
  for (const xml of network.savedQueries?.xml ?? [])
    root.appendChild(document.importNode(parseSavedQuery(xml), true));
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(document.documentElement);
  if (canonicalNetworkMeaning(parseNetworkTapn(xml).network) !== canonicalNetworkMeaning(network))
    fail(
      'TAPN export verification failed; the file would not reopen identically. Save JSON instead.',
    );
  return xml;
}

/** Auto-detects network JSON, legacy web JSON, and native/legacy TAPN XML. */
export function parseNetworkModel(
  source: string,
  filename = 'Imported model',
): NetworkImportResult {
  return source.trimStart().startsWith('{')
    ? parseNetworkJson(source)
    : parseNetworkTapn(source, filename);
}
