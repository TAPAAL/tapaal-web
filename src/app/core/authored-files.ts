import {
  AuthoredNetwork,
  AuthoredInterval,
  AuthoredInvariant,
  BoundTerm,
  WeightTerm,
  ConstantDecl,
  Result,
  authoredFromNumeric,
  authoredFingerprint,
  captureAuthoredSavedQueries,
  closedAuthored,
  resolveAuthored,
} from './authored-model';
import { Network } from './resolved-network';
import {
  NETWORK_JSON_FORMAT,
  parseNetworkJson,
  parseNetworkTapn,
  serializeNetworkTapn,
  inspectNativeTapn,
  canonicalNetworkMeaning,
} from './network-files';
import { readComponentTiming, parseNativeInterval, parseNativeInvariant } from './timed-files';

/** Explicit opt-in codecs. No numeric document factory participates in these paths. */
export interface AuthoredImportResult {
  network: AuthoredNetwork;
  warnings: string[];
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(' '));
  return result.value;
}
function fail(message: string): never {
  throw new Error(message);
}
function checked(network: AuthoredNetwork): AuthoredNetwork {
  return unwrap(resolveAuthored(network)).source;
}
export function serializeAuthoredJson(network: AuthoredNetwork): string {
  return JSON.stringify(
    { format: NETWORK_JSON_FORMAT, version: 2, network: checked(network) },
    null,
    2,
  );
}
export function parseAuthoredJson(source: string): AuthoredImportResult {
  let file;
  try {
    file = JSON.parse(source);
  } catch {
    fail('The JSON file is malformed.');
  }
  closedAuthored(file, ['format', 'version', 'network', 'net']);
  if (file.format === NETWORK_JSON_FORMAT && file.version === 2) {
    closedAuthored(file, ['format', 'version', 'network']);
    return { network: checked(file.network), warnings: [] };
  }
  const numeric = parseNetworkJson(source);
  return { network: unwrap(authoredFromNumeric(numeric.network)), warnings: numeric.warnings };
}
const children = (element: Element, tag: string) =>
  Array.from(element.children).filter((child) => child.localName === tag);
const xml = (element: Element) => new XMLSerializer().serializeToString(element);
const id = (element: Element) => element.getAttribute('id') || element.getAttribute('name') || '';
function documentFrom(source: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    fail('XML document types and entities are not supported.');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) fail('The XML file is malformed.');
  return document;
}
function scalarDeclaration(element: Element, index: number): ConstantDecl {
  if (
    element.prefix !== null ||
    element.attributes.length !== 2 ||
    Array.from(element.attributes).some(
      (a) => a.namespaceURI || !['name', 'value'].includes(a.name),
    ) ||
    element.childNodes.length !== 0
  )
    fail('Scalar <constant> requires only name and value attributes and no content.');
  const name = element.getAttribute('name')!,
    value = element.getAttribute('value')!;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || name === 'inf')
    fail(`Invalid or reserved constant name "${name}".`);
  if (!/^\+?\d+$/.test(value) || BigInt(value) > 2147483647n)
    fail(
      `Constant ${name} requires a nonnegative Java int scalar value (0…2147483647); sets, reals and arithmetic are unsupported.`,
    );
  return { id: `tapn:constant:${index}`, name, value: Number(value) };
}
/** Inspect every original semantic field before a private numeric geometry clone is parsed. */
export function parseAuthoredTapn(
  source: string,
  filename = 'Imported model',
): AuthoredImportResult {
  const document = documentFrom(source),
    root = document.documentElement;
  const declarations = children(root, 'constant');
  const constants = declarations.map(scalarDeclaration);
  const byName = new Map(constants.map((constant) => [constant.name, constant]));
  if (byName.size !== constants.length) fail('Duplicate scalar constant names.');
  const term = (text: string, where: string, weight = false): BoundTerm | number => {
    if (/^\d+$/.test(text)) {
      if (BigInt(text) > 2147483647n) fail(`Scalar ${text} in ${where} exceeds 2147483647.`);
      return weight ? Number(text) : BigInt(text).toString();
    }
    const declaration = byName.get(text);
    if (!declaration) fail(`Undefined constant or unsupported scalar "${text}" in ${where}.`);
    return { constantId: declaration.id };
  };
  const byId = new Map(constants.map((constant) => [constant.id, constant]));
  const numeric = (value: BoundTerm | number): string =>
    typeof value === 'object' ? String(byId.get(value.constantId)!.value) : String(value);
  const interval = (text: string, where: string): AuthoredInterval => {
    const match = /^([[(])\s*(\w+)\s*,\s*(\w+)([\])])$/.exec(text);
    if (!match) fail(`Malformed time interval "${text}" in ${where}.`);
    const value = {
      lower: term(match[2], where) as BoundTerm,
      upper: match[3] === 'inf' ? null : (term(match[3], where) as BoundTerm),
      lowerClosed: match[1] === '[',
      upperClosed: match[4] === ']',
    };
    parseNativeInterval(formatInterval(value, numeric), where);
    return value;
  };
  const invariant = (text: string, where: string): AuthoredInvariant => {
    const match = /^(<|<=)\s*(\w+)$/.exec(text);
    if (!match) fail(`Malformed invariant "${text}" in ${where}.`);
    const value = {
      upper: match[2] === 'inf' ? null : (term(match[2], where) as BoundTerm),
      upperClosed: match[1] === '<=',
    };
    parseNativeInvariant(formatInvariant(value, numeric), where);
    return value;
  };
  const weights = new Map<Element, WeightTerm>();
  const intervals = new Map<Element, AuthoredInterval>();
  const invariants = new Map<Element, AuthoredInvariant>();
  const nets = children(root, 'net');
  for (const net of nets) {
    const seen = new Set<string>();
    for (const element of Array.from(net.children).filter((e) =>
      ['place', 'transition', 'arc'].includes(e.localName),
    )) {
      const key = id(element);
      if (!key || seen.has(key))
        fail(
          `Authored import requires unambiguous, nonempty node/arc IDs in component ${id(net)}: ${key}.`,
        );
      seen.add(key);
    }
    for (const place of children(net, 'place'))
      invariants.set(
        place,
        invariant(
          place.getAttribute('invariant') ?? '< inf',
          `place ${id(place)} in component ${id(net)}`,
        ),
      );
    const places = new Set(children(net, 'place').map(id));
    for (const arc of children(net, 'arc')) {
      const weight = term(
        arc.getAttribute('weight') ?? '1',
        `arc ${id(arc)} in component ${id(net)} weight`,
        true,
      ) as WeightTerm;
      if (Number(numeric(weight)) < 1)
        fail(`Arc ${id(arc)} in component ${id(net)} weight must resolve to at least 1.`);
      weights.set(arc, weight);
      if (places.has(arc.getAttribute('source')!) || arc.getAttribute('type') === 'transport') {
        const text = arc.getAttribute('inscription') ?? '[0,inf)';
        const [guard, group, ...extra] = text.split(':');
        if (
          (arc.getAttribute('type') !== 'transport' && group !== undefined) ||
          extra.length ||
          (group !== undefined && !/^\d+$/.test(group))
        )
          fail(`Malformed inscription on arc ${id(arc)}.`);
        intervals.set(arc, interval(guard, `arc ${id(arc)} in component ${id(net)}`));
      }
    }
  }
  const attribute = (element: Element, name: string, value: string) => {
    if (name === 'weight' && weights.has(element)) return numeric(weights.get(element)!);
    if (name === 'invariant' && invariants.has(element))
      return formatInvariant(invariants.get(element)!, numeric);
    if (name === 'inscription' && intervals.has(element)) {
      const group = value.split(':')[1];
      return (
        formatInterval(intervals.get(element)!, numeric) + (group === undefined ? '' : `:${group}`)
      );
    }
    return value;
  };
  inspectNativeTapn(document, {
    declaration: (element) => {
      scalarDeclaration(element, 0);
    },
    attribute,
    weight: (element) => Number(numeric(weights.get(element)!)),
  });
  // All original attributes/ASTs have now been inspected. Only this clone is resolved.
  const copy = document.cloneNode(true) as Document;
  children(copy.documentElement, 'constant').forEach((e) => e.remove());
  children(copy.documentElement, 'query').forEach((e) => e.remove());
  const copies = children(copy.documentElement, 'net');
  nets.forEach((net, index) => {
    const originals = Array.from(net.querySelectorAll('place, arc'));
    const targets = Array.from(copies[index].querySelectorAll('place, arc'));
    originals.forEach((element, i) => {
      for (const a of Array.from(element.attributes))
        targets[i].setAttribute(a.name, attribute(element, a.name, a.value));
    });
    if (children(root, 'feature')[0].getAttribute('isTimed') === 'true') {
      const timing = readComponentTiming(copies[index], `component ${id(net)}`);
      for (const pair of timing.transports) {
        const a = children(net, 'arc').find((e) => id(e) === pair.inputArc)!;
        const b = children(net, 'arc').find((e) => id(e) === pair.outputArc)!;
        if (
          authoredFingerprint(weights.get(a)) !== authoredFingerprint(weights.get(b)) ||
          authoredFingerprint(intervals.get(a)) !== authoredFingerprint(intervals.get(b))
        )
          fail(
            `Transport halves ${id(a)}/${id(b)} require identical authored weight and interval terms.`,
          );
      }
    }
  });
  const parsed = parseNetworkTapn(xml(copy.documentElement), filename);
  let network: AuthoredNetwork = {
    name: parsed.network.name,
    type: parsed.network.type,
    constants,
    components: parsed.network.components.map((component, index) => {
      const net = nets[index];
      const byId = new Map(children(net, 'arc').map((e) => [id(e), e]));
      const originalNodes = Array.from(net.children).filter((e) =>
        ['place', 'transition'].includes(e.localName),
      );
      if (
        originalNodes.length !== component.net.nodes.length ||
        originalNodes.some(
          (element) => !component.net.nodes.some((node) => node.id === id(element)),
        )
      )
        fail(`Geometry parser changed node IDs in component ${id(net)}.`);
      const timing = component.timing;
      const authoredIntervals = new Map<string, AuthoredInterval>(
        Object.entries(timing?.intervals ?? {}),
      );
      const authoredInvariants = new Map<string, AuthoredInvariant>(
        Object.entries(timing?.invariants ?? {}),
      );
      for (const [element, value] of intervals)
        if (element.parentElement === net) {
          const arc = component.net.arcs.find((a) => a.id === id(element));
          if (!arc) fail(`Geometry parser changed arc ID ${id(element)}.`);
          const input = component.net.nodes.some((n) => n.id === arc.source && n.kind === 'place');
          const symbolic =
            typeof value.lower === 'object' ||
            (value.upper !== null && typeof value.upper === 'object');
          if (input && (symbolic || authoredIntervals.has(arc.id)))
            authoredIntervals.set(arc.id, value);
        }
      for (const [element, value] of invariants)
        if (element.parentElement === net && value.upper !== null)
          authoredInvariants.set(id(element), value);
      return {
        ...component,
        net: {
          ...component.net,
          arcs: component.net.arcs.map((arc) => {
            const element = byId.get(arc.id);
            if (!element) fail(`Geometry parser changed arc ID ${arc.id}.`);
            return { ...arc, weight: weights.get(element)! };
          }),
        },
        ...(timing
          ? {
              timing: {
                ...timing,
                intervals: Object.fromEntries(authoredIntervals),
                invariants: Object.fromEntries(authoredInvariants),
              },
            }
          : {}),
      };
    }),
  };
  const queries = children(root, 'query').map(xml);
  network = checked(network);
  if (queries.length)
    network = checked({
      ...network,
      savedQueries: unwrap(captureAuthoredSavedQueries(network, queries)),
    });
  return { network, warnings: parsed.warnings };
}
function formatInterval(value: AuthoredInterval, spelling: (term: BoundTerm) => string): string {
  return `${value.lowerClosed ? '[' : '('}${spelling(value.lower)},${value.upper === null ? 'inf' : spelling(value.upper)}${value.upperClosed ? ']' : ')'}`;
}
function formatInvariant(value: AuthoredInvariant, spelling: (term: BoundTerm) => string): string {
  return `${value.upperClosed ? '<=' : '<'} ${value.upper === null ? 'inf' : spelling(value.upper)}`;
}
/** Compare bindings by declared name, independently of document-local IDs. */
function meaning(network: AuthoredNetwork): string {
  const resolved = unwrap(resolveAuthored(network));
  const names = new Map(network.constants.map((c) => [c.id, c.name]));
  const terms = network.components.map((c) => ({
    template: c.net.template,
    weights: [...c.net.arcs].sort((a, b) => a.id.localeCompare(b.id)).map((a) => [a.id, a.weight]),
    intervals: c.timing?.intervals,
    invariants: c.timing?.invariants,
  }));
  const bindings = JSON.parse(
    JSON.stringify(terms, (_key, value) =>
      value && typeof value === 'object' && 'constantId' in value
        ? { name: names.get(value.constantId) }
        : value,
    ),
  );
  return authoredFingerprint({
    numeric: canonicalNetworkMeaning(structuredClone(resolved.numeric) as Network),
    constants: [...network.constants]
      .map(({ name, value }) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    bindings,
    queries: network.savedQueries?.xml,
    protections: network.savedQueries && {
      constants: network.savedQueries.protectedConstants.map((p) => p.name).sort(),
      components: network.savedQueries.protectedComponents
        .map(({ id: componentId, ...p }) => ({
          ...p,
          id: network.components.find((c) => c.id === componentId)!.net.template,
          nodes: [...p.nodes].sort((a, b) => a.id.localeCompare(b.id)),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
  });
}
export function serializeAuthoredTapn(source: AuthoredNetwork): string {
  const resolved = unwrap(resolveAuthored(source));
  const numeric: Network = {
    ...(structuredClone(resolved.numeric) as Network),
    ...(source.savedQueries
      ? {
          savedQueries: {
            xml: [...source.savedQueries.xml],
            protectedComponents: structuredClone(source.savedQueries.protectedComponents),
          },
        }
      : {}),
  };
  // Numeric writer checks native bounds/geometry and generates fresh dot ASTs before symbols return.
  const document = documentFrom(serializeNetworkTapn(numeric));
  const root = document.documentElement;
  const names = new Map(source.constants.map((c) => [c.id, c.name]));
  const spelling = (term: BoundTerm | WeightTerm): string =>
    typeof term === 'object' ? names.get(term.constantId)! : String(term);
  for (const declaration of source.constants) {
    const element = document.createElementNS(root.namespaceURI, 'constant');
    element.setAttribute('name', declaration.name);
    element.setAttribute('value', String(declaration.value));
    root.appendChild(element);
  }
  children(root, 'net').forEach((net, index) => {
    const component = source.components[index];
    for (const arc of children(net, 'arc')) {
      arc.setAttribute(
        'weight',
        spelling(component.net.arcs.find((a) => a.id === id(arc))!.weight),
      );
      const pair = component.timing?.transports.find(
        (p) => p.inputArc === id(arc) || p.outputArc === id(arc),
      );
      const intervals = component.timing?.intervals;
      const inputId = pair?.inputArc ?? id(arc);
      const interval =
        intervals && Object.hasOwn(intervals, inputId) ? intervals[inputId] : undefined;
      if (interval) {
        const group = arc.getAttribute('inscription')?.split(':')[1];
        arc.setAttribute(
          'inscription',
          formatInterval(interval, spelling) + (group === undefined ? '' : `:${group}`),
        );
      }
    }
    for (const place of children(net, 'place')) {
      const invariants = component.timing?.invariants;
      const invariant =
        invariants && Object.hasOwn(invariants, id(place)) ? invariants[id(place)] : undefined;
      if (invariant) place.setAttribute('invariant', formatInvariant(invariant, spelling));
    }
  });
  const output = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml(root);
  if (meaning(parseAuthoredTapn(output).network) !== meaning(source))
    fail('Authored TAPN export verification failed; save JSON instead.');
  return output;
}
export function parseAuthoredModel(
  source: string,
  filename = 'Imported model',
): AuthoredImportResult {
  return source.trimStart().startsWith('{')
    ? parseAuthoredJson(source)
    : parseAuthoredTapn(source, filename);
}
