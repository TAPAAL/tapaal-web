import { SavedQueries, validateSavedQueries } from './saved-queries';
import { Net, validateNet } from './net';
import { ModelType, validateModelType } from './model-types';
import {
  Decimal,
  TimeInterval,
  TimeInvariant,
  TransportPair,
  compareAges,
  validateInterval,
  validateInvariant,
} from './timed';
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Timing of one timed component, keyed by its own Net element IDs. Native defaults are never
 * stored, so equal fingerprints mean equal timing. See design/TIMED-FILES.md.
 */
export interface ComponentTiming {
  /** Ordinary or transport input arc ID -> guard; absent means [0,inf). */
  readonly intervals: Readonly<Record<string, TimeInterval>>;
  /** Place ID -> finite invariant; absent means < inf. */
  readonly invariants: Readonly<Record<string, TimeInvariant>>;
  readonly urgent: readonly string[];
  /** Two ordinary graph arcs forming one native transport arc; each keeps its own route. */
  readonly transports: readonly Readonly<TransportPair>[];
  /** Place ID -> nonzero ages of its first tokens; the remaining tokens are age 0. */
  readonly ages: Readonly<Record<string, readonly Decimal[]>>;
}
export interface Component {
  readonly id: string;
  readonly active: boolean;
  /** template is the component identifier; name mirrors the network display title. */
  readonly net: Net;
  /** Present exactly when the network type is timed. */
  readonly timing?: ComponentTiming;
}
export interface Network {
  readonly savedQueries?: SavedQueries;
  readonly name: string;
  readonly type: ModelType;
  /** Array order is explorer/composition order. IDs, not names, identify components. */
  readonly components: readonly Component[];
}
export function emptyTiming(): ComponentTiming {
  return { intervals: {}, invariants: {}, urgent: [], transports: [], ages: {} };
}
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
function plain(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function unrestricted(interval: TimeInterval): boolean {
  return compareAges(interval.lower, '0') === 0 && interval.lowerClosed && interval.upper === null;
}
/** Structural timing rules only; explicit-token capacity is checked when executing. */
export function validateComponentTiming(net: Net, timing: ComponentTiming): void {
  const where = `component ${net.template}`;
  check(
    plain(timing) &&
      plain(timing.intervals) &&
      plain(timing.invariants) &&
      plain(timing.ages) &&
      Array.isArray(timing.urgent) &&
      Array.isArray(timing.transports),
    `Invalid timing metadata in ${where}.`,
  );
  const node = (id: string) => net.nodes.find((n) => n.id === id);
  const arcById = (id: string) => net.arcs.find((a) => a.id === id);
  for (const [id, interval] of Object.entries(timing.intervals)) {
    const arc = arcById(id);
    check(
      arc && arc.kind === 'normal' && node(arc.source)!.kind === 'place',
      `Interval ${id} in ${where} must belong to an ordinary or transport input arc (inhibitors are always [0,inf)).`,
    );
    validateInterval(interval);
    check(!unrestricted(interval), `Omit the default interval [0,inf) on arc ${id} in ${where}.`);
  }
  for (const [id, invariant] of Object.entries(timing.invariants)) {
    check(node(id)?.kind === 'place', `Invariant ${id} in ${where} must belong to a place.`);
    validateInvariant(invariant);
    check(invariant.upper !== null, `Omit the default invariant < inf on place ${id} in ${where}.`);
  }
  const urgent = new Set(timing.urgent);
  check(
    urgent.size === timing.urgent.length &&
      timing.urgent.every((id) => node(id)?.kind === 'transition'),
    `Urgent IDs in ${where} must identify unique transitions.`,
  );
  for (const id of urgent)
    check(
      !net.arcs.some((a) => a.target === id && own(timing.intervals, a.id)),
      `Urgent transition ${node(id)!.name} in ${where} requires [0,inf) on every input arc.`,
    );
  const paired = new Set<string>();
  for (const pair of timing.transports) {
    check(plain(pair), `Invalid transport in ${where}.`);
    const input = arcById(pair.inputArc),
      output = arcById(pair.outputArc);
    check(
      input &&
        output &&
        input.kind === 'normal' &&
        output.kind === 'normal' &&
        node(input.source)!.kind === 'place' &&
        node(output.target)!.kind === 'place' &&
        input.target === output.source,
      `Transport ${pair.inputArc}/${pair.outputArc} in ${where} must pair an input and an output arc of one transition.`,
    );
    check(
      input.weight === output.weight,
      `Transport halves ${input.id}/${output.id} in ${where} must have equal weights.`,
    );
    check(
      !paired.has(input.id) && !paired.has(output.id),
      `An arc in ${where} belongs to more than one transport.`,
    );
    paired.add(input.id);
    paired.add(output.id);
    if (urgent.has(input.target))
      check(
        !own(timing.invariants, output.target),
        `Urgent transport destinations must have no finite invariant (${output.target} in ${where}).`,
      );
  }
  for (const [id, ages] of Object.entries(timing.ages)) {
    const place = node(id);
    check(
      place?.kind === 'place' &&
        Array.isArray(ages) &&
        ages.length > 0 &&
        ages.length <= place.tokens,
      `Token ages for ${id} in ${where} must list between 1 and the place's token count of ages.`,
    );
    const invariant = own(timing.invariants, id);
    for (const age of ages) {
      check(
        compareAges(age, '0') > 0,
        `Zero token ages are implicit; list only nonzero ages (place ${place.name} in ${where}).`,
      );
      const order = invariant?.upper == null ? -1 : compareAges(age, invariant.upper);
      check(
        order < 0 || (order === 0 && invariant!.upperClosed),
        `Initial token age ${age} violates the invariant of place ${place.name} in ${where}.`,
      );
    }
  }
}
export function validateNetwork(network: Network): void {
  validateModelType(network.type);
  check(
    typeof network.name === 'string' &&
      network.name.trim().length > 0 &&
      network.name.length <= 200,
    'Model name is required (maximum 200 characters).',
  );
  check(network.components.length > 0, 'A network must contain at least one component.');
  check(
    network.components.some((item) => item.active),
    'At least one component must be active.',
  );
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const item of network.components) {
    check(
      typeof item.id === 'string' && item.id.length > 0 && !ids.has(item.id),
      'Component IDs must be nonempty and unique.',
    );
    check(typeof item.active === 'boolean', 'Component active state must be boolean.');
    validateNet(item.net);
    if (network.type.timed) {
      check(
        item.timing,
        `Timed networks require timing metadata on component ${item.net.template}.`,
      );
      validateComponentTiming(item.net, item.timing);
    } else check(item.timing === undefined, 'Untimed networks cannot carry timing metadata.');
    check(
      item.net.name === network.name,
      'Component Net.name must match the network display name.',
    );
    check(!names.has(item.net.template), 'Component identifiers must be unique within a network.');
    ids.add(item.id);
    names.add(item.net.template);
  }
  validateSavedQueries(network);
}
