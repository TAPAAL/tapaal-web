import type { ComponentTiming } from './documents';
import type { Net } from './net';
import {
  TimeInterval,
  TimeInvariant,
  compareAges,
  validateInterval,
  validateInvariant,
} from './timed';

/** Native timed TAPN attributes for one `<net>`; see design/TIMED-FILES.md for the source audit. */
const MAX_INT = 2147483647n;

function fail(message: string): never {
  throw new Error(message);
}
const elementsOf = (net: Element, ...tags: string[]) =>
  Array.from(net.children).filter((e) => tags.includes(e.localName));
const idOf = (element: Element) => element.getAttribute('id') || element.getAttribute('name') || '';

/** TimeInterval.parse / TimeInvariant.parse bounds: Integer.parseInt, else a constant name. */
function bound(value: string, where: string): string {
  if (!/^\d+$/.test(value))
    fail(`Constant or non-integer bound "${value}" in ${where} is not supported.`);
  if (BigInt(value) > MAX_INT) fail(`Bound ${value} in ${where} exceeds 2,147,483,647.`);
  return BigInt(value).toString();
}
export function parseNativeInterval(text: string, where: string): TimeInterval {
  const match = /^([[(])\s*(\w+)\s*,\s*(\w+)([\])])$/.exec(text);
  if (!match) fail(`Malformed time interval "${text}" in ${where}.`);
  const interval: TimeInterval = {
    lower: bound(match[2], where),
    upper: match[3] === 'inf' ? null : bound(match[3], where),
    lowerClosed: match[1] === '[',
    upperClosed: match[4] === ']',
  };
  try {
    validateInterval(interval);
  } catch (e) {
    fail(`Invalid time interval "${text}" in ${where}: ${(e as Error).message}`);
  }
  return interval;
}
export function parseNativeInvariant(text: string, where: string): TimeInvariant {
  const match = /^(<|<=)\s*(\w+)$/.exec(text);
  if (!match) fail(`Malformed invariant "${text}" in ${where}.`);
  const invariant: TimeInvariant = {
    upper: match[2] === 'inf' ? null : bound(match[2], where),
    upperClosed: match[1] === '<=',
  };
  try {
    validateInvariant(invariant);
  } catch (e) {
    fail(`Invalid invariant "${text}" in ${where}: ${(e as Error).message}`);
  }
  return invariant;
}
function nativeBound(value: string, where: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) > MAX_INT)
    fail(
      `${where} has bound ${value}; desktop TAPAAL stores whole-number bounds up to 2,147,483,647. Save JSON instead.`,
    );
  return value;
}
export function formatNativeInterval(interval: TimeInterval, where: string): string {
  const lower = nativeBound(interval.lower, where);
  const upper = interval.upper === null ? 'inf' : nativeBound(interval.upper, where);
  return `${interval.lowerClosed ? '[' : '('}${lower},${upper}${interval.upperClosed ? ']' : ')'}`;
}
export function formatNativeInvariant(invariant: TimeInvariant, where: string): string {
  const upper = invariant.upper === null ? 'inf' : nativeBound(invariant.upper, where);
  return `${invariant.upperClosed ? '<=' : '<'} ${upper}`;
}
const DEFAULT_INTERVAL = '[0,inf)';
const unrestricted = (i: TimeInterval) =>
  i.lower === '0' && i.lowerClosed && i.upper === null && !i.upperClosed;

interface Half {
  id: string;
  transition: string;
  input: boolean;
}
/**
 * TapnXmlLoader.parseAndAddTransportArc: halves pair per transition in document order, ignoring
 * transportID. A second pending half in the same direction would overwrite the first; refuse it.
 */
function pairHalves(
  halves: readonly Half[],
  where: string,
): { inputArc: string; outputArc: string }[] {
  const pending = { in: new Map<string, string>(), out: new Map<string, string>() };
  const pairs: { inputArc: string; outputArc: string }[] = [];
  for (const half of halves) {
    const [own, other] = half.input ? [pending.in, pending.out] : [pending.out, pending.in];
    const partner = other.get(half.transition);
    if (partner !== undefined) {
      other.delete(half.transition);
      pairs.push(
        half.input
          ? { inputArc: half.id, outputArc: partner }
          : { inputArc: partner, outputArc: half.id },
      );
    } else if (own.has(half.transition))
      fail(
        `Ambiguous transport arcs ${own.get(half.transition)} and ${half.id} in ${where}: desktop TAPAAL would drop one.`,
      );
    else own.set(half.transition, half.id);
  }
  const unpaired = [...pending.in.values(), ...pending.out.values()];
  if (unpaired.length) fail(`Unpaired transport arc ${unpaired[0]} in ${where}.`);
  return pairs;
}

/** Reads timing from an allowlist-checked timed `<net>`; refuses anything it cannot represent. */
export function readComponentTiming(net: Element, where: string): ComponentTiming {
  const kinds = new Map<string, string>();
  for (const node of elementsOf(net, 'place', 'transition')) kinds.set(idOf(node), node.localName);
  const intervals = new Map<string, TimeInterval>();
  const invariants = new Map<string, TimeInvariant>();
  const agesByPlace = new Map<string, string[]>();
  const timing = {
    urgent: [] as string[],
    transports: [] as { inputArc: string; outputArc: string }[],
  };
  for (const place of elementsOf(net, 'place')) {
    const id = idOf(place),
      at = `place "${id}" in ${where}`;
    const invariant = parseNativeInvariant(place.getAttribute('invariant') ?? '< inf', at);
    if (invariant.upper !== null) invariants.set(id, invariant);
    const markings = elementsOf(place, 'initialMarkingAge');
    if (markings.length > 1) fail(`Duplicate initialMarkingAge in ${at}.`);
    const tokens = markings.length ? elementsOf(markings[0], 'token') : [];
    if (tokens.length > Number(place.getAttribute('initialMarking') ?? '0'))
      fail(`The number of initial token ages exceeds the initial marking of ${at}.`);
    // TapnXmlLoader: BigDecimal ages; the writer omits zero ages and the rest are implicitly 0.
    const ages = tokens.map((token) => {
      const age = token.getAttribute('age')!;
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(age))
        fail(`Token age "${age}" in ${at} must be a plain nonnegative decimal such as 1.25.`);
      return age;
    });
    const nonzero = ages.filter((age) => compareAges(age, '0') > 0);
    if (nonzero.length) agesByPlace.set(id, nonzero);
  }
  for (const transition of elementsOf(net, 'transition'))
    if (transition.getAttribute('urgent') === 'true') timing.urgent.push(idOf(transition));
  const seen = new Set(kinds.keys());
  const halves: Half[] = [];
  const transport = new Map<string, { interval: string; weight: string }>();
  for (const arc of elementsOf(net, 'arc')) {
    const id = arc.getAttribute('id') ?? '';
    const at = `arc "${id}" in ${where}`;
    if (!id || seen.has(id)) fail(`Timed components require unique arc IDs (${at}).`);
    seen.add(id);
    const type = arc.getAttribute('type') ?? 'normal';
    const source = arc.getAttribute('source')!,
      target = arc.getAttribute('target')!;
    const from = kinds.get(source),
      to = kinds.get(target);
    if (!from || !to || from === to)
      fail(`Arc endpoints must be a place and a transition (${at}).`);
    const input = from === 'place';
    const inscription = arc.getAttribute('inscription');
    if (type === 'transport') {
      const [text, group, ...extra] = (inscription ?? DEFAULT_INTERVAL).split(':');
      if (extra.length || (group !== undefined && !/^\d+$/.test(group)))
        fail(`Malformed transport inscription "${inscription}" (${at}).`);
      const interval = parseNativeInterval(text, at);
      transport.set(id, {
        interval: JSON.stringify(interval),
        weight: arc.getAttribute('weight') ?? '1',
      });
      if (input && !unrestricted(interval)) intervals.set(id, interval);
      halves.push({ id, transition: input ? target : source, input });
      continue;
    }
    if ((type === 'normal') === input)
      fail(`Arc type ${type} does not match its endpoints (${at}).`);
    if (!input) {
      if (inscription !== null && inscription !== '1')
        fail(`Unsupported output arc inscription "${inscription}" (${at}).`);
      continue;
    }
    const interval = parseNativeInterval(inscription ?? DEFAULT_INTERVAL, at);
    if (unrestricted(interval)) continue;
    // TapnXmlLoader replaces nontrivial inhibitor intervals; refuse instead of altering the file.
    if (type !== 'timed') fail(`Inhibitor arcs only support the interval [0,inf) (${at}).`);
    intervals.set(id, interval);
  }
  timing.transports = pairHalves(halves, where);
  for (const { inputArc, outputArc } of timing.transports) {
    const a = transport.get(inputArc)!,
      b = transport.get(outputArc)!;
    // The loader keeps only the input half's interval and the later half's weight.
    if (a.interval !== b.interval || a.weight !== b.weight)
      fail(
        `Transport halves ${inputArc} and ${outputArc} in ${where} have different intervals or weights; desktop TAPAAL would keep only one.`,
      );
  }
  return {
    intervals: Object.fromEntries(intervals),
    invariants: Object.fromEntries(invariants),
    urgent: timing.urgent,
    transports: timing.transports,
    ages: Object.fromEntries(agesByPlace),
  };
}

/** Resets a standalone copy to untimed defaults so the shared untimed parser reads its geometry. */
export function stripTiming(net: Element): void {
  const kinds = new Map(elementsOf(net, 'place', 'transition').map((n) => [idOf(n), n.localName]));
  for (const place of elementsOf(net, 'place')) {
    place.setAttribute('invariant', '< inf');
    for (const marking of elementsOf(place, 'initialMarkingAge')) marking.remove();
  }
  for (const transition of elementsOf(net, 'transition'))
    transition.setAttribute('urgent', 'false');
  for (const arc of elementsOf(net, 'arc')) {
    arc.removeAttribute('transportID');
    const input = kinds.get(arc.getAttribute('source')!) === 'place';
    if (arc.getAttribute('type') === 'transport')
      arc.setAttribute('type', input ? 'timed' : 'normal');
    arc.setAttribute('inscription', input ? DEFAULT_INTERVAL : '1');
  }
}

/**
 * Writes TimedArcPetriNetNetworkWriter timing into a `<net>` produced by the untimed writer.
 * Transport halves are moved adjacent only when document order would make the loader pair them
 * differently.
 */
export function writeComponentTiming(
  element: Element,
  net: Net,
  timing: ComponentTiming,
  counter: { transportId: number },
): void {
  const where = `Component ${net.template}`;
  const document = element.ownerDocument;
  const byId = (tag: string) =>
    new Map(elementsOf(element, tag).map((e) => [e.getAttribute('id')!, e]));
  const places = byId('place'),
    transitions = byId('transition'),
    arcs = byId('arc');
  for (const [id, invariant] of Object.entries(timing.invariants))
    places
      .get(id)!
      .setAttribute('invariant', formatNativeInvariant(invariant, `${where} place ${id}`));
  for (const [id, ages] of Object.entries(timing.ages)) {
    const marking = document.createElementNS(element.namespaceURI, 'initialMarkingAge');
    for (const age of ages) {
      const token = document.createElementNS(element.namespaceURI, 'token');
      token.setAttribute('age', age);
      marking.appendChild(token);
    }
    places.get(id)!.appendChild(marking);
  }
  for (const id of timing.urgent) transitions.get(id)!.setAttribute('urgent', 'true');
  for (const [id, interval] of Object.entries(timing.intervals))
    arcs.get(id)!.setAttribute('inscription', formatNativeInterval(interval, `${where} arc ${id}`));
  const groups = new Map<string, number>();
  for (const { inputArc, outputArc } of timing.transports) {
    const transition = net.arcs.find((a) => a.id === inputArc)!.target;
    const group = (groups.get(transition) ?? 0) + 1;
    groups.set(transition, group);
    const interval = Object.hasOwn(timing.intervals, inputArc)
      ? timing.intervals[inputArc]
      : undefined;
    const text = interval
      ? formatNativeInterval(interval, `${where} arc ${inputArc}`)
      : DEFAULT_INTERVAL;
    const transportId = String(++counter.transportId);
    for (const id of [inputArc, outputArc]) {
      const arc = arcs.get(id)!;
      arc.setAttribute('type', 'transport');
      arc.setAttribute('inscription', `${text}:${group}`);
      arc.setAttribute('transportID', transportId);
    }
  }
  const halves = () =>
    elementsOf(element, 'arc')
      .filter((arc) => arc.getAttribute('type') === 'transport')
      .map((arc) => {
        const id = arc.getAttribute('id')!;
        const graph = net.arcs.find((a) => a.id === id)!;
        const input = transitions.has(graph.target);
        return { id, input, transition: input ? graph.target : graph.source };
      });
  const key = (pairs: { inputArc: string; outputArc: string }[]) =>
    pairs
      .map((p) => `${p.inputArc}\u0000${p.outputArc}`)
      .sort()
      .join('\u0001');
  let replayed: string | null;
  try {
    replayed = key(pairHalves(halves(), where));
  } catch {
    replayed = null;
  }
  if (replayed !== key([...timing.transports]))
    for (const { inputArc, outputArc } of timing.transports)
      arcs.get(inputArc)!.after(arcs.get(outputArc)!);
}
