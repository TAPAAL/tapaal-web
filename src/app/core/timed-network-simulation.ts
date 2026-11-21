import { type Component, type Network, timedModelForNetwork, validateNetwork } from './documents';
import type { CompositionMapping, ElementRef } from './network-simulation';
import {
  addAges,
  eligibleTimedInputs,
  isTimedEnabled,
  MAX_TIMED_TOKENS,
  timedDelayInterval,
  TimedSimulation,
  validateTimedModel,
  type Decimal,
  type EligibleTimedInput,
  type TimeInterval,
  type TimedMarking,
  type TimedModel,
  type TimedToken,
  type TokenSelection,
} from './timed';

export type TimedNetworkMarking = Readonly<
  Record<string, Readonly<Record<string, readonly Readonly<TimedToken>[]>>>
>;
export type TimedNetworkAction =
  | { readonly kind: 'delay'; readonly amount: Decimal }
  | {
      readonly kind: 'fire';
      readonly transition: ElementRef;
      readonly bindings: Readonly<Record<string, readonly string[]>>;
    };
export type TimedNetworkState = ({ readonly kind: 'initial' } | TimedNetworkAction) & {
  readonly time: Decimal;
  readonly marking: TimedNetworkMarking;
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const key = (component: string, element: string): string => JSON.stringify([component, element]);
function symbol(id: string): string {
  let value = 'e';
  for (let i = 0; i < id.length; i++) value += id.charCodeAt(i).toString(16).padStart(4, '0');
  return value;
}
function rejectUnsupported(value: object): void {
  for (const field of ['constants', 'sharedPlaces', 'sharedTransitions', 'sharedElementIds'])
    check(!Object.hasOwn(value, field), `Unsupported network execution field: ${field}.`);
}

/** Opt-in disjoint timed execution. The original network is never relabelled as one component. */
export class TimedNetworkSimulation {
  readonly revision: Network;
  readonly mapping: CompositionMapping;
  private readonly model: TimedModel;
  private readonly inactive = new Map<string, readonly TimedToken[]>();
  private simulation: TimedSimulation;

  constructor(network: Network) {
    check(network && typeof network === 'object', 'Invalid network.');
    check(
      network.type &&
        network.type.timed === true &&
        ['colored', 'game', 'stochastic'].every((k) => Reflect.get(network.type, k) === false),
      'Timed network execution requires explicitly timed, uncoloured, nongame, nonstochastic flags.',
    );
    check(Array.isArray(network.components), 'Network components must be an array.');
    rejectUnsupported(network);
    for (const component of network.components) {
      check(component && typeof component === 'object', 'Invalid component.');
      rejectUnsupported(component);
      check(component.net && typeof component.net === 'object', 'Invalid component net.');
      rejectUnsupported(component.net);
    }
    validateNetwork(network); // Includes inactive timing and saved-query protections.
    this.revision = freeze(structuredClone(network));
    const forward = new Map<string, string>(),
      reverse = new Map<string, ElementRef>();
    const model: TimedModel = {
      net: { name: network.name, template: 'TimedComposition', nodes: [], arcs: [] },
      type: { ...network.type },
      componentCount: 1,
      sharedElementIds: [],
      intervals: {},
      invariants: {},
      urgent: [],
      transports: [],
      initial: [],
    };
    let total = 0;
    for (const component of this.revision.components) {
      // This adapter validates an actual individual component, not a disguised whole network.
      const local = timedModelForNetwork({
        name: network.name,
        type: network.type,
        components: [{ ...component, active: true }],
      });
      const idFor = (id: string) => key(component.id, id);
      const tokens = local.initial.map((t) => ({
        ...t,
        id: key(component.id, t.id),
        place: idFor(t.place),
      }));
      if (!component.active) {
        this.inactive.set(component.id, freeze(tokens));
        continue;
      }
      total += tokens.length;
      check(total <= MAX_TIMED_TOKENS, 'Active network exceeds explicit-token capacity.');
      for (const element of [
        ...local.net.nodes,
        ...local.net.arcs,
        ...(local.net.annotations ?? []),
      ]) {
        const id = idFor(element.id);
        forward.set(id, id);
        reverse.set(id, Object.freeze({ componentId: component.id, elementId: element.id }));
      }
      model.net.nodes.push(
        ...local.net.nodes.map((n) => ({ ...n, id: idFor(n.id), name: symbol(idFor(n.id)) })),
      );
      model.net.arcs.push(
        ...local.net.arcs.map((a) => ({
          ...a,
          id: idFor(a.id),
          source: idFor(a.source),
          target: idFor(a.target),
        })),
      );
      if (local.net.annotations) {
        model.net.annotations ??= [];
        model.net.annotations.push(
          ...local.net.annotations.map((n) => ({ ...n, id: idFor(n.id) })),
        );
      }
      for (const [id, interval] of Object.entries(local.intervals))
        model.intervals[idFor(id)] = interval;
      for (const [id, invariant] of Object.entries(local.invariants))
        model.invariants[idFor(id)] = invariant;
      model.urgent.push(...local.urgent.map(idFor));
      model.transports.push(
        ...local.transports.map((p) => ({
          inputArc: idFor(p.inputArc),
          outputArc: idFor(p.outputArc),
        })),
      );
      model.initial.push(...tokens);
    }
    validateTimedModel(model);
    this.model = freeze(model);
    this.mapping = Object.freeze({
      toComposed: (componentId: string, elementId: string) =>
        forward.get(key(componentId, elementId)),
      fromComposed: (id: string) => reverse.get(id),
    });
    this.simulation = new TimedSimulation(this.model);
  }
  private component(id: string): Component {
    const component = this.revision.components.find((c) => c.id === id);
    check(component, `Unknown component: ${id}.`);
    return component;
  }
  private transitionId(ref: ElementRef): string {
    check(
      ref && typeof ref.componentId === 'string' && typeof ref.elementId === 'string',
      'Invalid transition reference.',
    );
    const component = this.component(ref.componentId);
    check(component.active, `Component ${component.id} is inactive.`);
    check(
      component.net.nodes.some((n) => n.id === ref.elementId && n.kind === 'transition'),
      'Unknown transition.',
    );
    return this.mapping.toComposed(ref.componentId, ref.elementId)!;
  }
  private project(marking: TimedMarking): TimedNetworkMarking {
    return freeze(
      Object.fromEntries(
        this.revision.components.map((c) => {
          const tokens = c.active ? marking.tokens : this.inactive.get(c.id)!;
          return [
            c.id,
            Object.fromEntries(
              c.net.nodes
                .filter((n) => n.kind === 'place')
                .map((n) => [
                  n.id,
                  tokens
                    .filter((t) => t.place === key(c.id, n.id))
                    .map((t) => ({ ...t, place: n.id })),
                ]),
            ),
          ];
        }),
      ),
    );
  }
  get marking(): TimedNetworkMarking {
    return this.project(this.simulation.marking);
  }
  markingFor(componentId: string): TimedNetworkMarking[string] {
    this.component(componentId);
    return this.marking[componentId];
  }
  get enabled(): readonly ElementRef[] {
    const marking = this.simulation.marking;
    return freeze(
      this.model.net.nodes
        .filter((n) => n.kind === 'transition' && isTimedEnabled(this.model, marking, n.id))
        .map((n) => this.mapping.fromComposed(n.id)!),
    );
  }
  enabledFor(componentId: string): readonly string[] {
    this.component(componentId);
    return freeze(
      this.enabled.filter((r) => r.componentId === componentId).map((r) => r.elementId),
    );
  }
  /** Arc/place/destination and token.place use local IDs of ref.componentId; token IDs are opaque. */
  eligibleInputs(ref: ElementRef): readonly EligibleTimedInput[] {
    const id = this.transitionId(ref);
    const local = (id: string) => this.mapping.fromComposed(id)!.elementId;
    return freeze(
      eligibleTimedInputs(this.model, this.simulation.marking, id).map((input) => ({
        ...input,
        arcId: local(input.arcId),
        place: local(input.place),
        destination: input.destination === undefined ? undefined : local(input.destination),
        tokens: input.tokens.map((t) => ({ ...t, place: local(t.place) })),
      })),
    );
  }
  get delayInterval(): Readonly<TimeInterval> {
    return freeze(timedDelayInterval(this.model, this.simulation.marking));
  }
  get time(): Decimal {
    return this.simulation.trace
      .slice(0, this.cursor + 1)
      .reduce((time, state) => (state.kind === 'delay' ? addAges(time, state.amount) : time), '0');
  }
  get trace(): readonly TimedNetworkState[] {
    let time = '0';
    return freeze(
      this.simulation.trace.map((state) => {
        if (state.kind === 'delay') time = addAges(time, state.amount);
        const common = { time, marking: this.project(state.marking) };
        if (state.kind !== 'fire')
          return state.kind === 'initial'
            ? { kind: state.kind, ...common }
            : { kind: state.kind, amount: state.amount, ...common };
        return {
          kind: state.kind,
          transition: this.mapping.fromComposed(state.transition)!,
          bindings: Object.fromEntries(
            Object.entries(state.bindings).map(([id, tokens]) => [
              this.mapping.fromComposed(id)!.elementId,
              tokens,
            ]),
          ),
          ...common,
        };
      }),
    );
  }
  get cursor(): number {
    return this.simulation.cursor;
  }
  get canBack(): boolean {
    return this.simulation.canBack;
  }
  get canForward(): boolean {
    return this.simulation.canForward;
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
        Object.entries(selection.bindings).map(([arc, ids]) => {
          const id = this.mapping.toComposed(ref.componentId, arc);
          check(id, `Unknown local input arc: ${arc}.`);
          return [id, ids];
        }),
      ),
    };
  }
  fire(ref: ElementRef, selection: TokenSelection = { mode: 'oldest' }): void {
    const id = this.transitionId(ref);
    this.simulation.fire(id, this.selection(ref, selection));
  }
  delay(amount: Decimal): void {
    addAges(this.time, amount); // Validate the clock too, even when all places are empty.
    this.simulation.delay(amount);
  }
  /** Recorded bindings only: replay never asks a random source to choose again. Atomic replacement. */
  replay(actions: readonly TimedNetworkAction[]): void {
    check(Array.isArray(actions), 'Replay requires an action list.');
    const next = new TimedSimulation(this.model);
    let time = '0';
    for (const action of actions) {
      check(action && typeof action === 'object', 'Invalid replay action.');
      if (action.kind === 'delay') {
        time = addAges(time, action.amount);
        next.delay(action.amount);
      } else {
        check(action.kind === 'fire', 'Invalid replay action kind.');
        const id = this.transitionId(action.transition);
        next.fire(
          id,
          this.selection(action.transition, {
            mode: 'manual',
            bindings: structuredClone(action.bindings) as Record<string, string[]>,
          }),
        );
      }
    }
    this.simulation = next;
  }
  back(): void {
    this.simulation.back();
  }
  forward(): void {
    this.simulation.forward();
  }
  reset(): void {
    this.simulation.reset();
  }
}
