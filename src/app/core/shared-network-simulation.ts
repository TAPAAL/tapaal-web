/** Execution of validated V3 shared-element source. No executable projection escapes. */
import {
  type SharedRevision,
  type SharedSource,
  validateSharedSource,
  transitionActor,
} from './authored-shared';
import { type BoundTerm, type AuthoredInvariant, freezeAuthored } from './authored-model';
import type { ElementRef } from './network-simulation';
import type { TimedNetworkMarking } from './timed-network-simulation';
import {
  type Decimal,
  type TimedModel,
  type TimedMarking,
  type TimedToken,
  type TimeInvariant,
  type TimeInterval,
  type TokenSelection,
  type EligibleTimedInput,
  MAX_TIMED_TOKENS,
  addAges,
  validateTimedModel,
  initialTimedMarking,
  eligibleTimedInputs,
  isTimedEnabled,
  timedDelayInterval,
  fireTimed,
  delayTimed,
} from './timed';

export interface SharedInput extends EligibleTimedInput {
  readonly member: ElementRef;
  readonly placeName: string;
  readonly destinationName?: string;
  readonly poolId?: string;
}
export type SharedAction =
  | { readonly kind: 'delay'; readonly amount: Decimal }
  | {
      readonly kind: 'fire';
      readonly transition: ElementRef;
      readonly bindings: Readonly<Record<string, readonly string[]>>;
    };
export type SharedState = ({ readonly kind: 'initial' } | SharedAction) & {
  readonly time: Decimal;
  readonly marking: TimedNetworkMarking;
  readonly pools: readonly SharedPoolState[];
  /** Physical tokens, including frozen inactive locals and dormant pools, counted once. */
  readonly totalTokens: number;
};
export interface SharedPoolState {
  readonly id: string;
  readonly name: string;
  readonly status: 'live' | 'dormant';
  readonly occurrences: readonly ElementRef[];
  readonly tokens: readonly Readonly<TimedToken>[];
}
export interface SharedMapping {
  toPhysical(componentId: string, elementId: string): string | undefined;
  /** A physical shared place maps to every original occurrence, including inactive ones. */
  occurrences(physicalId: string): readonly ElementRef[];
}
interface StoredState {
  action: { kind: 'initial' } | SharedAction;
  time: Decimal;
  marking: TimedMarking;
}
interface PassivePlace {
  id: string;
  count: number;
  ages: readonly Decimal[];
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const key = (...parts: string[]) => JSON.stringify(parts);
function symbol(id: string): string {
  let result = 'e';
  for (let i = 0; i < id.length; i++) result += id.charCodeAt(i).toString(16).padStart(4, '0');
  return result;
}
const member = (
  n: SharedSource['components'][number]['net']['nodes'][number],
): n is Extract<SharedSource['components'][number]['net']['nodes'][number], { sharedId: string }> =>
  'sharedId' in n;

/**
 * Captures/revalidates revision.source; never consumes validationProjection or wire projections.
 * Untimed source uses the token engine with empty timing internally: public delay is disabled,
 * every age is zero, and authored lens/source remains unchanged. Explicit-token capacity applies
 * to timed AND untimed sessions (source saves are capacity independent).
 */
export class SharedNetworkSimulation {
  readonly revision: SharedSource;
  readonly mapping: SharedMapping;
  private readonly original: SharedSource;
  private readonly model: TimedModel;
  private readonly passive = new Map<string, PassivePlace>();
  private readonly livePools = new Set<string>();
  private readonly physical = new Map<string, string>();
  private readonly provenance = new Map<string, readonly ElementRef[]>();
  private readonly transitions = new Map<string, ElementRef>();
  private readonly passiveCount: number;
  private states: StoredState[];
  private position = 0;
  private firing = false;

  constructor(
    revision: SharedRevision,
    private readonly random: () => number = Math.random,
  ) {
    check(revision && typeof revision === 'object' && revision.source, 'Expected SharedRevision.');
    // Revalidate even a structurally forged revision. The brand is intentionally not inspected.
    const checked = validateSharedSource(revision.source);
    check(checked.ok, checked.ok ? '' : checked.issues.map((i) => i.message).join(' '));
    this.original = revision.source;
    this.revision = checked.value.source;
    const source = this.revision;

    // Count BEFORE materializing even one token, including inactive/dormant metadata.
    let count = 0;
    const reserve = (n: number) => {
      count += n;
      check(
        Number.isSafeInteger(count) && count <= MAX_TIMED_TOKENS,
        `Shared execution requires at most ${MAX_TIMED_TOKENS} physical tokens including dormant pools and inactive locals. Reduce the initial marking; source can still be saved.`,
      );
    };
    for (const p of source.shared.places) reserve(p.tokens);
    for (const c of source.components)
      for (const n of c.net.nodes) if (!member(n) && n.kind === 'place') reserve(n.tokens);

    const constants = new Map(source.constants.map((c) => [c.id, c.value]));
    const bound = (term: BoundTerm): string =>
      typeof term === 'object' ? String(constants.get(term.constantId)!) : term;
    const invariant = (i: AuthoredInvariant): TimeInvariant => ({
      upper: i.upper === null ? null : bound(i.upper),
      upperClosed: i.upperClosed,
    });
    const model: TimedModel = {
      net: { name: source.name, template: 'SharedExecution', nodes: [], arcs: [] },
      type: { ...source.type, timed: true, game: false },
      componentCount: 1,
      sharedElementIds: [],
      intervals: Object.create(null),
      invariants: Object.create(null),
      urgent: [],
      transports: [],
      initial: [],
    };
    const register = (ref: ElementRef, id: string) => {
      this.physical.set(key(ref.componentId, ref.elementId), id);
      this.provenance.set(id, freezeAuthored([...(this.provenance.get(id) ?? []), ref]));
    };
    for (const c of source.components)
      for (const n of c.net.nodes) {
        const id = member(n) ? key('pool', n.sharedId) : key('local', c.id, n.id);
        register({ componentId: c.id, elementId: n.id }, id);
        if (member(n) && n.kind === 'place' && c.active) this.livePools.add(n.sharedId);
      }
    const tokens = (p: PassivePlace, time = '0'): TimedToken[] =>
      Array.from({ length: p.count }, (_, i) => ({
        id: key('initial', p.id, String(i)),
        place: p.id,
        age: addAges(p.ages[i] ?? '0', time),
      }));
    let passiveCount = 0;
    for (const p of source.shared.places) {
      const id = key('pool', p.id),
        initial = { id, count: p.tokens, ages: p.timing?.ages ?? [] };
      if (!this.livePools.has(p.id)) {
        this.passive.set(id, initial);
        passiveCount += p.tokens;
        continue;
      }
      model.net.nodes.push({ id, kind: 'place', name: symbol(id), tokens: p.tokens, x: 0, y: 0 });
      if (p.timing?.invariant) model.invariants[id] = invariant(p.timing.invariant);
      for (const t of tokens(initial)) model.initial.push(t);
    }
    for (const c of source.components) {
      const idFor = (id: string) => this.physical.get(key(c.id, id)) ?? key('arc', c.id, id);
      for (const n of c.net.nodes) {
        if (member(n)) {
          if (n.kind === 'transition' && c.active && !this.transitions.has(idFor(n.id))) {
            const id = idFor(n.id),
              pool = source.shared.transitions.find((p) => p.id === n.sharedId)!;
            model.net.nodes.push({
              id,
              kind: 'transition',
              name: symbol(id),
              tokens: 0,
              x: 0,
              y: 0,
            });
            this.transitions.set(id, freezeAuthored({ componentId: c.id, elementId: n.id }));
            if (pool.urgent) model.urgent.push(id);
          }
          continue;
        }
        const id = idFor(n.id);
        if (!c.active) {
          if (n.kind === 'place') {
            this.passive.set(id, { id, count: n.tokens, ages: c.timing?.ages[n.id] ?? [] });
            passiveCount += n.tokens;
          }
          continue;
        }
        model.net.nodes.push({ ...n, id, name: symbol(id) });
        if (n.kind === 'transition')
          this.transitions.set(id, freezeAuthored({ componentId: c.id, elementId: n.id }));
        else
          for (const t of tokens({ id, count: n.tokens, ages: c.timing?.ages[n.id] ?? [] }))
            model.initial.push(t);
      }
      if (!c.active) continue;
      for (const a of c.net.arcs) {
        const id = key('arc', c.id, a.id);
        register({ componentId: c.id, elementId: a.id }, id);
        model.net.arcs.push({
          ...a,
          bends: a.bends?.map((b) => ({ ...b })),
          id,
          source: idFor(a.source),
          target: idFor(a.target),
          weight: typeof a.weight === 'number' ? a.weight : constants.get(a.weight.constantId)!,
        });
      }
      if (c.timing) {
        for (const [id, i] of Object.entries(c.timing.intervals))
          model.intervals[key('arc', c.id, id)] = {
            ...i,
            lower: bound(i.lower),
            upper: i.upper === null ? null : bound(i.upper),
          };
        for (const [id, i] of Object.entries(c.timing.invariants))
          model.invariants[idFor(id)] = invariant(i);
        model.urgent.push(...c.timing.urgent.map(idFor));
        model.transports.push(
          ...c.timing.transports.map((p) => ({
            inputArc: key('arc', c.id, p.inputArc),
            outputArc: key('arc', c.id, p.outputArc),
          })),
        );
      }
    }
    // Retains endpoint duplication, one consuming input per physical place/transition,
    // transport pairing, unrestricted inhibitor/urgent guards and destination invariant rules.
    validateTimedModel(model);
    this.model = freezeAuthored(model);
    this.passiveCount = passiveCount;
    this.mapping = Object.freeze({
      toPhysical: (componentId: string, elementId: string) =>
        this.physical.get(key(componentId, elementId)),
      occurrences: (id: string) => this.provenance.get(id) ?? Object.freeze([]),
    });
    this.states = [{ action: { kind: 'initial' }, time: '0', marking: initialTimedMarking(model) }];
  }
  /** Document edits, including activation or constant changes, require a fresh session. */
  assertRevision(source: SharedSource): void {
    check(source === this.original, 'The authored revision changed; restart shared execution.');
  }
  private component(id: string) {
    const c = this.revision.components.find((c) => c.id === id);
    check(c, `Unknown component: ${id}.`);
    return c;
  }
  private transitionId(ref: ElementRef): string {
    check(
      ref && typeof ref.componentId === 'string' && typeof ref.elementId === 'string',
      'Invalid transition reference.',
    );
    const c = this.component(ref.componentId);
    check(c.active, `Component ${c.id} is inactive.`);
    const id = this.physical.get(key(c.id, ref.elementId));
    check(id && this.transitions.has(id), 'Unknown local transition.');
    return id;
  }
  private passiveTokens(p: PassivePlace, time: string): TimedToken[] {
    return Array.from({ length: p.count }, (_, i) => ({
      id: key('initial', p.id, String(i)),
      place: p.id,
      age: addAges(p.ages[i] ?? '0', time),
    }));
  }
  private poolViews(state: StoredState): readonly SharedPoolState[] {
    return this.revision.shared.places.map((p) => {
      const id = key('pool', p.id),
        live = this.livePools.has(p.id);
      return {
        id: p.id,
        name: p.name,
        status: live ? 'live' : 'dormant',
        occurrences: this.mapping.occurrences(id),
        tokens: (live
          ? state.marking.tokens.filter((t) => t.place === id)
          : this.passiveTokens(this.passive.get(id)!, state.time)
        ).map((t) => ({ ...t, place: p.id })),
      };
    });
  }
  private project(state: StoredState): TimedNetworkMarking {
    const pools = new Map(this.poolViews(state).map((p) => [p.id, p.tokens]));
    return Object.fromEntries(
      this.revision.components.map((c) => [
        c.id,
        Object.fromEntries(
          c.net.nodes
            .filter((n) => n.kind === 'place')
            .map((n) => {
              const id = this.physical.get(key(c.id, n.id))!;
              const tokens = member(n)
                ? pools.get(n.sharedId)!
                : c.active
                  ? state.marking.tokens.filter((t) => t.place === id)
                  : this.passiveTokens(this.passive.get(id)!, '0');
              return [n.id, tokens.map((t) => ({ ...t, place: n.id }))];
            }),
        ),
      ]),
    );
  }
  get marking(): TimedNetworkMarking {
    return freezeAuthored(this.project(this.states[this.position]));
  }
  markingFor(componentId: string): TimedNetworkMarking[string] {
    this.component(componentId);
    return this.marking[componentId];
  }
  get pools(): readonly SharedPoolState[] {
    return freezeAuthored(this.poolViews(this.states[this.position]));
  }
  get totalTokens(): number {
    return this.states[this.position].marking.tokens.length + this.passiveCount;
  }
  get enabled(): readonly ElementRef[] {
    return freezeAuthored(
      [...this.transitions]
        .filter(([id]) => isTimedEnabled(this.model, this.states[this.position].marking, id))
        .map(([, ref]) => ref),
    );
  }
  enabledFor(componentId: string): readonly string[] {
    this.component(componentId);
    return freezeAuthored(
      this.enabled
        .flatMap((r) => this.mapping.occurrences(this.transitionId(r)))
        .filter((r) => r.componentId === componentId && this.component(r.componentId).active)
        .map((r) => r.elementId),
    );
  }
  private localId(physical: string, componentId: string): string {
    const ref = this.provenance.get(physical)?.find((r) => r.componentId === componentId);
    check(ref, 'Missing compiled provenance.');
    return ref.elementId;
  }
  eligibleInputs(ref: ElementRef): readonly SharedInput[] {
    const id = this.transitionId(ref);
    const shared =
      this.mapping.occurrences(id).length > 1 ||
      this.component(ref.componentId).net.nodes.some((n) => n.id === ref.elementId && member(n));
    return freezeAuthored(
      eligibleTimedInputs(this.model, this.states[this.position].marking, id).map((i) => {
        const owner = this.mapping.occurrences(i.arcId)[0];
        const c = this.component(owner.componentId);
        const eventMember = this.mapping.occurrences(id).find((r) => r.componentId === c.id)!;
        const local = (id: string) => this.localId(id, c.id);
        const name = (id: string) => {
          const n = c.net.nodes.find((n) => n.id === id)!;
          return member(n)
            ? this.revision.shared.places.find((p) => p.id === n.sharedId)!.name
            : n.name;
        };
        const place = local(i.place),
          n = c.net.nodes.find((n) => n.id === place)!;
        const destination = i.destination === undefined ? undefined : local(i.destination);
        return {
          ...i,
          member: { ...eventMember },
          arcId: shared ? i.arcId : local(i.arcId),
          place,
          placeName: shared ? `${c.net.template}.${name(place)} (${local(i.arcId)})` : name(place),
          ...(member(n) ? { poolId: n.sharedId } : {}),
          destination,
          destinationName: destination === undefined ? undefined : name(destination),
          tokens: i.tokens.map((t) => ({ ...t, place })),
        };
      }),
    );
  }
  get time(): Decimal {
    return this.states[this.position].time;
  }
  get delayInterval(): Readonly<TimeInterval> | null {
    return this.revision.type.timed
      ? freezeAuthored(timedDelayInterval(this.model, this.states[this.position].marking))
      : null;
  }
  get trace(): readonly SharedState[] {
    return freezeAuthored(
      this.states.map((s) => ({
        ...s.action,
        time: s.time,
        marking: this.project(s),
        pools: this.poolViews(s),
        totalTokens: s.marking.tokens.length + this.passiveCount,
      })),
    );
  }
  label(index: number): string {
    const state = this.states[index];
    check(state, 'Invalid history index.');
    const a = state.action;
    if (a.kind === 'initial') return `Initial marking · time ${state.time}`;
    if (a.kind === 'delay') return `Delay ${a.amount} · time ${state.time}`;
    const c = this.component(a.transition.componentId);
    const n = c.net.nodes.find((n) => n.id === a.transition.elementId)!;
    if (member(n)) {
      const pool = this.revision.shared.transitions.find((p) => p.id === n.sharedId)!;
      const members = this.mapping
        .occurrences(this.transitionId(a.transition))
        .filter((r) => this.component(r.componentId).active)
        .map((r) => this.component(r.componentId).net.template);
      return `Fire ${this.revision.type.game ? this.actor(a.transition) + ' ' : ''}${pool.name} [${members.join(', ')}] · time ${state.time}`;
    }
    return `Fire ${this.revision.type.game ? this.actor(a.transition) + ' ' : ''}${c.net.template}.${n.name} · time ${state.time}`;
  }
  actor(ref: ElementRef) {
    return transitionActor(this.revision, ref.componentId, ref.elementId);
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
  private append(state: StoredState): void {
    this.states = [...this.states.slice(0, this.position + 1), freezeAuthored(state)];
    this.position++;
  }
  private assertIdle(): void {
    check(!this.firing, 'Cannot mutate shared simulation during token selection.');
  }
  private selection(ref: ElementRef, selection: TokenSelection): TokenSelection {
    check(selection && typeof selection === 'object', 'Invalid token selection.');
    if (selection.mode !== 'manual') return selection;
    check(
      selection.bindings &&
        typeof selection.bindings === 'object' &&
        !Array.isArray(selection.bindings),
      'Invalid manual bindings.',
    );
    return {
      mode: 'manual',
      bindings: Object.fromEntries(
        Object.entries(selection.bindings).map(([arc, ids]) => [
          this.component(ref.componentId).net.nodes.some((n) => n.id === ref.elementId && member(n))
            ? arc
            : key('arc', ref.componentId, arc),
          ids,
        ]),
      ),
    };
  }
  fire(ref: ElementRef, selection: TokenSelection = { mode: 'random', random: this.random }): void {
    this.assertIdle();
    this.firing = true;
    try {
      // Capture provenance before any external selection callback can change its argument.
      ref = Object.freeze({ componentId: ref.componentId, elementId: ref.elementId });
      const id = this.transitionId(ref),
        previous = this.states[this.position];
      // Capacity of retained passive metadata also checked BEFORE output allocation or RNG use.
      const inputs = this.model.net.arcs.filter((a) => a.target === id && a.kind === 'normal');
      const outputs = this.model.net.arcs.filter((a) => a.source === id);
      const size =
        previous.marking.tokens.length +
        this.passiveCount -
        inputs.reduce((n, a) => n + a.weight, 0) +
        outputs.reduce((n, a) => n + a.weight, 0);
      check(
        size <= MAX_TIMED_TOKENS,
        'Result exceeds shared execution capacity including dormant pools and inactive locals.',
      );
      const result = fireTimed(this.model, previous.marking, id, this.selection(ref, selection));
      const bindings = Object.fromEntries(
        Object.entries(result.bindings).map(([arc, ids]) => [
          this.component(ref.componentId).net.nodes.some((n) => n.id === ref.elementId && member(n))
            ? arc
            : this.localId(arc, ref.componentId),
          ids,
        ]),
      );
      this.append({
        action: { kind: 'fire', transition: { ...ref }, bindings },
        time: previous.time,
        marking: result.marking,
      });
    } finally {
      this.firing = false;
    }
  }
  step(ref?: ElementRef, selection?: TokenSelection): ElementRef | null {
    this.assertIdle();
    const chosen = ref ?? this.enabled[0];
    if (!chosen) return null;
    const captured = freezeAuthored({
      componentId: chosen.componentId,
      elementId: chosen.elementId,
    });
    this.fire(captured, selection);
    return captured;
  }
  delay(amount: Decimal): void {
    this.assertIdle();
    check(this.revision.type.timed, 'Delay requires an authored timed model.');
    const previous = this.states[this.position],
      time = addAges(previous.time, amount);
    // Detect decimal overflow in dormant ages before publishing any state.
    for (const p of this.revision.shared.places)
      if (!this.livePools.has(p.id)) for (const age of p.timing!.ages) addAges(age, time);
    const marking = delayTimed(this.model, previous.marking, amount);
    this.append({ action: { kind: 'delay', amount }, time, marking });
  }
  replay(actions: readonly SharedAction[]): void {
    this.assertIdle();
    check(Array.isArray(actions), 'Replay requires an action list.');
    const saved = this.states,
      cursor = this.position;
    this.states = saved.slice(0, 1);
    this.position = 0;
    try {
      for (const a of actions) {
        check(a && typeof a === 'object', 'Invalid replay action.');
        if (a.kind === 'delay') this.delay(a.amount);
        else {
          check(a.kind === 'fire', 'Invalid replay action kind.');
          this.fire(a.transition, {
            mode: 'manual',
            bindings: structuredClone(a.bindings) as Record<string, string[]>,
          });
        }
      }
    } catch (error) {
      this.states = saved;
      this.position = cursor;
      throw error;
    }
  }
  back(): void {
    this.assertIdle();
    if (this.canBack) this.position--;
  }
  forward(): void {
    this.assertIdle();
    if (this.canForward) this.position++;
  }
  jump(index: number): void {
    this.assertIdle();
    check(
      Number.isInteger(index) && index >= 0 && index < this.states.length,
      'Invalid history index.',
    );
    this.position = index;
  }
  reset(): void {
    this.assertIdle();
    this.states = this.states.slice(0, 1);
    this.position = 0;
  }
}
