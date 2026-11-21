import { validateNet, type Net } from './net';
import type { ModelType } from './model-types';

/** Decimal strings only: no binary floating-point enters age arithmetic. */
export type Decimal = string;
export interface TimeInterval {
  lower: Decimal;
  upper: Decimal | null;
  lowerClosed: boolean;
  upperClosed: boolean;
}
export interface TimeInvariant {
  upper: Decimal | null;
  upperClosed: boolean;
}
export interface TimedToken {
  id: string;
  place: string;
  age: Decimal;
}
export interface TimedMarking {
  tokens: TimedToken[];
  /** Monotonic allocator for engine-owned `@timed:N` identities. */
  nextId: string;
}
export interface TransportPair {
  inputArc: string;
  outputArc: string;
}
/** Deliberately NOT a Net: callers must explicitly dispatch timed execution. */
export interface TimedModel {
  net: Net;
  type: ModelType;
  componentCount: number;
  sharedElementIds: string[];
  intervals: Record<string, TimeInterval>;
  invariants: Record<string, TimeInvariant>;
  urgent: string[];
  transports: TransportPair[];
  initial: TimedToken[];
}
export type TokenSelection =
  | { mode: 'oldest' | 'youngest' }
  | { mode: 'manual'; bindings: Record<string, string[]> }
  | { mode: 'random'; random: () => number };
export const UNRESTRICTED: Readonly<TimeInterval> = Object.freeze({
  lower: '0',
  upper: null,
  lowerClosed: true,
  upperClosed: false,
});
/** Explicit resource limits, not silent rounding or aggregate token approximation. */
export const MAX_TIMED_TOKENS = 100_000;
export const MAX_DECIMAL_DIGITS = 256;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function parts(value: Decimal): [bigint, number] {
  check(
    typeof value === 'string' &&
      value.length <= MAX_DECIMAL_DIGITS + 1 &&
      /^(0|[1-9]\d*)(\.\d+)?$/.test(value),
    'Expected a nonnegative plain decimal string (maximum 256 digits).',
  );
  const [whole, fraction = ''] = value.split('.');
  check(whole.length + fraction.length <= MAX_DECIMAL_DIGITS, 'Decimal precision limit exceeded.');
  return [BigInt(whole + fraction), fraction.length];
}
function aligned(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const [x, xs] = parts(a),
    [y, ys] = parts(b),
    scale = Math.max(xs, ys);
  return [x * 10n ** BigInt(scale - xs), y * 10n ** BigInt(scale - ys), scale];
}
function decimal(value: bigint, scale: number): Decimal {
  check(value >= 0n, 'Negative decimal result.');
  let s = value.toString().padStart(scale + 1, '0');
  if (scale) s = `${s.slice(0, -scale)}.${s.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
  parts(s);
  return s;
}
export function compareAges(a: Decimal, b: Decimal): number {
  const [x, y] = aligned(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function addAges(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = aligned(a, b);
  return decimal(x + y, scale);
}
function subtract(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = aligned(a, b);
  return decimal(x - y, scale);
}
export function validateInterval(interval: TimeInterval): void {
  check(
    !!interval &&
      typeof interval.lowerClosed === 'boolean' &&
      typeof interval.upperClosed === 'boolean',
    'Invalid interval flags.',
  );
  parts(interval.lower);
  if (interval.upper === null) check(!interval.upperClosed, 'Infinity must be open.');
  else {
    const order = compareAges(interval.lower, interval.upper);
    check(
      order < 0 || (order === 0 && interval.lowerClosed && interval.upperClosed),
      'Empty or reversed interval.',
    );
  }
}
export function validateInvariant(invariant: TimeInvariant): void {
  check(!!invariant && typeof invariant.upperClosed === 'boolean', 'Invalid invariant.');
  if (invariant.upper === null) check(!invariant.upperClosed, 'Infinity must be open.');
  else
    check(
      compareAges(invariant.upper, '0') > 0 || invariant.upperClosed,
      'The invariant < 0 is invalid.',
    );
}
function inside(age: Decimal, i: TimeInterval): boolean {
  const lo = compareAges(age, i.lower);
  const hi = i.upper === null ? -1 : compareAges(age, i.upper);
  return (lo > 0 || (lo === 0 && i.lowerClosed)) && (hi < 0 || (hi === 0 && i.upperClosed));
}
function satisfies(age: Decimal, invariant?: TimeInvariant): boolean {
  if (!invariant || invariant.upper === null) return true;
  const order = compareAges(age, invariant.upper);
  return order < 0 || (order === 0 && invariant.upperClosed);
}
function intervalFor(model: TimedModel, arc: string): TimeInterval {
  return Object.hasOwn(model.intervals, arc) ? model.intervals[arc] : UNRESTRICTED;
}
function invariantFor(model: TimedModel, place: string): TimeInvariant | undefined {
  return Object.hasOwn(model.invariants, place) ? model.invariants[place] : undefined;
}
function unrestricted(i: TimeInterval): boolean {
  return compareAges(i.lower, '0') === 0 && i.lowerClosed && i.upper === null;
}
export function validateTimedModel(model: TimedModel): void {
  check(!!model && !!model.type, 'Expected a TimedModel wrapper.');
  check(
    model.type.timed === true &&
      model.type.colored === false &&
      model.type.game === false &&
      model.type.stochastic === false,
    'Only timed, uncoloured, nongame, nonstochastic models are supported.',
  );
  check(
    model.componentCount === 1 &&
      Array.isArray(model.sharedElementIds) &&
      model.sharedElementIds.length === 0,
    'Only one component without shared elements is supported.',
  );
  validateNet(model.net);
  check(
    !!model.intervals &&
      !!model.invariants &&
      Array.isArray(model.urgent) &&
      Array.isArray(model.transports),
    'Missing timing metadata.',
  );
  const places = new Set(model.net.nodes.filter((n) => n.kind === 'place').map((n) => n.id));
  const transitions = new Set(
    model.net.nodes.filter((n) => n.kind === 'transition').map((n) => n.id),
  );
  check(
    new Set(model.urgent).size === model.urgent.length &&
      model.urgent.every((id) => transitions.has(id)),
    'Urgent IDs must identify unique transitions.',
  );
  for (const [id, i] of Object.entries(model.invariants)) {
    check(places.has(id), 'Invariant references an unknown place.');
    validateInvariant(i);
  }
  for (const [id, i] of Object.entries(model.intervals)) {
    check(
      model.net.arcs.some((a) => a.id === id && places.has(a.source)),
      'Interval must reference an input arc.',
    );
    validateInterval(i);
  }
  const paired = new Set<string>();
  for (const pair of model.transports) {
    const input = model.net.arcs.find((a) => a.id === pair.inputArc);
    const output = model.net.arcs.find((a) => a.id === pair.outputArc);
    check(
      input &&
        output &&
        input.kind === 'normal' &&
        output.kind === 'normal' &&
        places.has(input.source) &&
        places.has(output.target) &&
        input.target === output.source &&
        input.weight === output.weight,
      'Transport requires matching normal input/output arcs of equal weight through one transition.',
    );
    check(
      !paired.has(input.id) && !paired.has(output.id),
      'Competing transport bindings are unsupported.',
    );
    paired.add(input.id);
    paired.add(output.id);
    if (model.urgent.includes(input.target))
      check(
        invariantFor(model, output.target)?.upper == null,
        'Urgent transport destinations must have no finite invariant.',
      );
  }
  // validateNet rejects parallel endpoints, hence each source place has at most one
  // consuming input to a transition. No token can satisfy two competing inputs.
  for (const arc of model.net.arcs) {
    check(arc.weight <= MAX_TIMED_TOKENS, 'Arc weight exceeds explicit-token capacity.');
    if (places.has(arc.source) && (model.urgent.includes(arc.target) || arc.kind === 'inhibitor'))
      check(
        unrestricted(intervalFor(model, arc.id)),
        'Urgent and inhibitor inputs require [0,infinity).',
      );
  }
  validateTokens(model, model.initial, '0', true);
  for (const place of model.net.nodes.filter((n) => n.kind === 'place'))
    check(
      model.initial.filter((t) => t.place === place.id).length === place.tokens,
      'Initial token identities must match Net aggregate counts.',
    );
}
function validateTokens(
  model: TimedModel,
  tokens: TimedToken[],
  nextId: string,
  initial = false,
): void {
  check(
    typeof nextId === 'string' &&
      /^(0|[1-9]\d*)$/.test(nextId) &&
      nextId.length <= MAX_DECIMAL_DIGITS,
    'Invalid token identity counter.',
  );
  check(
    Array.isArray(tokens) && tokens.length <= MAX_TIMED_TOKENS,
    'Explicit-token capacity exceeded.',
  );
  const ids = new Set<string>();
  for (const token of tokens) {
    check(
      !!token && typeof token.id === 'string' && token.id.length > 0 && !ids.has(token.id),
      'Token identities must be nonempty and unique.',
    );
    ids.add(token.id);
    if (token.id.startsWith('@timed:')) {
      const suffix = token.id.slice(7);
      check(
        !initial &&
          /^(0|[1-9]\d*)$/.test(suffix) &&
          suffix.length <= MAX_DECIMAL_DIGITS &&
          BigInt(suffix) < BigInt(nextId),
        'Reserved or invalid generated token identity.',
      );
    }
    check(
      model.net.nodes.some((n) => n.id === token.place && n.kind === 'place'),
      'Token references an unknown place.',
    );
    parts(token.age);
    check(
      satisfies(token.age, invariantFor(model, token.place)),
      'Token violates its place invariant.',
    );
  }
}
export function validateTimedMarking(model: TimedModel, marking: TimedMarking): void {
  validateTimedModel(model);
  check(!!marking, 'Missing timed marking.');
  validateTokens(model, marking.tokens, marking.nextId);
}
export function initialTimedMarking(model: TimedModel): TimedMarking {
  validateTimedModel(model);
  return { tokens: structuredClone(model.initial), nextId: '0' };
}
function inputs(model: TimedModel, marking: TimedMarking, transition: string) {
  check(
    model.net.nodes.some((n) => n.id === transition && n.kind === 'transition'),
    'Unknown transition.',
  );
  return model.net.arcs
    .filter((a) => a.target === transition)
    .map((arc) => {
      const pair = model.transports.find((p) => p.inputArc === arc.id);
      const destination = pair
        ? model.net.arcs.find((a) => a.id === pair.outputArc)!.target
        : undefined;
      const eligible = marking.tokens.filter(
        (t) =>
          t.place === arc.source &&
          inside(t.age, intervalFor(model, arc.id)) &&
          (destination === undefined || satisfies(t.age, invariantFor(model, destination))),
      );
      return { arc, destination, eligible };
    });
}
/** Detached, read-only view of the same consuming inputs used by firing. */
export interface EligibleTimedInput {
  readonly arcId: string;
  readonly place: string;
  readonly weight: number;
  readonly destination?: string;
  readonly tokens: readonly Readonly<TimedToken>[];
}
export function eligibleTimedInputs(
  model: TimedModel,
  marking: TimedMarking,
  transition: string,
): readonly EligibleTimedInput[] {
  validateTimedMarking(model, marking);
  return inputs(model, marking, transition)
    .filter(({ arc }) => arc.kind !== 'inhibitor')
    .map(({ arc, destination, eligible }) => ({
      arcId: arc.id,
      place: arc.source,
      weight: arc.weight,
      destination,
      tokens: eligible.map((token) => ({ ...token })),
    }));
}
function enabled(model: TimedModel, marking: TimedMarking, transition: string): boolean {
  return inputs(model, marking, transition).every(({ arc, eligible }) =>
    arc.kind === 'inhibitor' ? eligible.length < arc.weight : eligible.length >= arc.weight,
  );
}
export function isTimedEnabled(
  model: TimedModel,
  marking: TimedMarking,
  transition: string,
): boolean {
  validateTimedMarking(model, marking);
  return enabled(model, marking, transition);
}
/** Complete legal delay interval for this marking; NOT future transition enabling intervals. */
export function timedDelayInterval(model: TimedModel, marking: TimedMarking): TimeInterval {
  validateTimedMarking(model, marking);
  if (model.urgent.some((id) => enabled(model, marking, id)))
    return { lower: '0', upper: '0', lowerClosed: true, upperClosed: true };
  let upper: string | null = null,
    upperClosed = false;
  for (const token of marking.tokens) {
    const invariant = invariantFor(model, token.place);
    if (!invariant || invariant.upper === null) continue;
    const remaining = subtract(invariant.upper, token.age);
    const order = upper === null ? -1 : compareAges(remaining, upper);
    if (order < 0) {
      upper = remaining;
      upperClosed = invariant.upperClosed;
    } else if (order === 0) upperClosed = upperClosed && invariant.upperClosed;
  }
  return { lower: '0', upper, lowerClosed: true, upperClosed };
}
export function delayTimed(
  model: TimedModel,
  marking: TimedMarking,
  amount: Decimal,
): TimedMarking {
  parts(amount);
  check(
    inside(amount, timedDelayInterval(model, marking)),
    'Delay blocked by an invariant or an enabled urgent transition.',
  );
  return {
    nextId: marking.nextId,
    tokens: marking.tokens.map((t) => ({ ...t, age: addAges(t.age, amount) })),
  };
}
export interface TimedFiring {
  marking: TimedMarking;
  /** Input arc ID -> exact identities, including transport input arcs. */
  bindings: Record<string, string[]>;
}
export function fireTimed(
  model: TimedModel,
  marking: TimedMarking,
  transition: string,
  selection: TokenSelection = { mode: 'oldest' },
): TimedFiring {
  validateTimedMarking(model, marking);
  check(enabled(model, marking, transition), 'Transition is not enabled.');
  check(
    ['oldest', 'youngest', 'manual', 'random'].includes(selection.mode),
    'Unknown token selection mode.',
  );
  const consuming = inputs(model, marking, transition).filter((i) => i.arc.kind !== 'inhibitor');
  if (selection.mode === 'manual')
    check(
      !!selection.bindings &&
        Object.keys(selection.bindings).length === consuming.length &&
        Object.keys(selection.bindings).every((id) => consuming.some((i) => i.arc.id === id)),
      'Manual bindings must cover exactly the consuming input arcs.',
    );
  const bindings: Record<string, string[]> = Object.create(null);
  const consumed = new Set<string>();
  const transported: TimedToken[] = [];
  for (const { arc, destination, eligible } of consuming) {
    let chosen: TimedToken[];
    if (selection.mode === 'manual') {
      const ids = selection.bindings[arc.id];
      check(
        Array.isArray(ids) && ids.length === arc.weight && new Set(ids).size === ids.length,
        'Invalid manual token count or duplicate identity.',
      );
      chosen = ids.map((id) => {
        const token = eligible.find((t) => t.id === id);
        check(token, 'Manual token is absent or ineligible.');
        return token;
      });
    } else if (selection.mode === 'random') {
      check(
        typeof selection.random === 'function',
        'Random selection requires an injected source.',
      );
      const pool = [...eligible];
      chosen = [];
      for (let i = 0; i < arc.weight; i++) {
        const random = selection.random();
        check(
          Number.isFinite(random) && random >= 0 && random < 1,
          'Random source must return a finite number in [0,1).',
        );
        chosen.push(pool.splice(Math.floor(random * pool.length), 1)[0]);
      }
    } else
      chosen = [...eligible]
        .sort((a, b) => compareAges(a.age, b.age) * (selection.mode === 'oldest' ? -1 : 1))
        .slice(0, arc.weight);
    bindings[arc.id] = chosen.map((t) => t.id);
    for (const token of chosen) {
      check(!consumed.has(token.id), 'Competing token bindings are unsupported.');
      consumed.add(token.id);
      if (destination !== undefined) transported.push({ ...token, place: destination });
    }
  }
  const outputs = model.net.arcs.filter(
    (a) => a.source === transition && !model.transports.some((p) => p.outputArc === a.id),
  );
  let size = marking.tokens.length - consumed.size + transported.length;
  for (const arc of outputs) {
    size += arc.weight;
    check(
      Number.isSafeInteger(size) && size <= MAX_TIMED_TOKENS,
      'Result exceeds explicit-token capacity.',
    );
  }
  const tokens = marking.tokens.filter((t) => !consumed.has(t.id)).map((t) => ({ ...t }));
  tokens.push(...transported);
  let nextId = BigInt(marking.nextId);
  for (const arc of outputs)
    for (let i = 0; i < arc.weight; i++)
      tokens.push({ id: `@timed:${nextId++}`, place: arc.target, age: '0' });
  const next = { tokens, nextId: nextId.toString() };
  validateTokens(model, next.tokens, next.nextId);
  return { marking: next, bindings };
}
export type TimedStep =
  | { kind: 'initial'; marking: TimedMarking }
  | { kind: 'delay'; amount: Decimal; marking: TimedMarking }
  | { kind: 'fire'; transition: string; bindings: Record<string, string[]>; marking: TimedMarking };
/** Simulation snapshots are isolated from document history and from callers. */
export class TimedSimulation {
  private readonly model: TimedModel;
  private states: TimedStep[];
  private position = 0;
  constructor(model: TimedModel) {
    this.model = structuredClone(model);
    this.states = [{ kind: 'initial', marking: initialTimedMarking(this.model) }];
  }
  get marking(): TimedMarking {
    return structuredClone(this.states[this.position].marking);
  }
  get trace(): TimedStep[] {
    return structuredClone(this.states);
  }
  get cursor(): number {
    return this.position;
  }
  get canBack(): boolean {
    return this.position > 0;
  }
  get canForward(): boolean {
    return this.position + 1 < this.states.length;
  }
  private append(step: TimedStep): void {
    this.states = [...this.states.slice(0, this.position + 1), step];
    this.position++;
  }
  delay(amount: Decimal): void {
    this.append({ kind: 'delay', amount, marking: delayTimed(this.model, this.marking, amount) });
  }
  fire(transition: string, selection?: TokenSelection): void {
    const result = fireTimed(this.model, this.marking, transition, selection);
    this.append({ kind: 'fire', transition, ...result });
  }
  back(): void {
    if (this.canBack) this.position--;
  }
  forward(): void {
    if (this.canForward) this.position++;
  }
  reset(): void {
    this.states = this.states.slice(0, 1);
    this.position = 0;
  }
}
