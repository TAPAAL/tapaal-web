import { type Component, type Network, validateNetwork } from './documents';
import { initialMarking, type Marking, type Net, Simulation, validateNet } from './net';

/** Original document identity, never a name or a composed identifier. */
export interface ElementRef {
  readonly componentId: string;
  readonly elementId: string;
}
export interface CompositionMapping {
  toComposed(componentId: string, elementId: string): string | undefined;
  fromComposed(id: string): ElementRef | undefined;
}
export interface ComposedNetwork {
  readonly net: Net;
  readonly mapping: CompositionMapping;
}
export type NetworkMarking = Readonly<Record<string, Readonly<Marking>>>;
export interface NetworkSimulationState {
  readonly transition: ElementRef | null;
  /** Includes inactive components at their initial marking. */
  readonly marking: NetworkMarking;
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function key(componentId: string, elementId: string): string {
  return JSON.stringify([componentId, elementId]);
}
/** Fixed-width UTF-16 encoding is injective, including arbitrary IDs and lone surrogates. */
function symbol(id: string): string {
  let result = 'e';
  for (let i = 0; i < id.length; i++) result += id.charCodeAt(i).toString(16).padStart(4, '0');
  return result;
}
function requireUntimedNetwork(network: Network): void {
  check(network && typeof network === 'object', 'Invalid network.');
  check(network.type && typeof network.type === 'object', 'Missing network type.');
  // Do not use modelCapabilities: editing/timed support may grow independently of this engine.
  check(
    ['timed', 'colored', 'game', 'stochastic'].every(
      (flag) => Reflect.get(network.type, flag) === false,
    ),
    'Network simulation requires explicitly untimed, uncoloured, nongame, nonstochastic type flags.',
  );
  check(Array.isArray(network.components), 'Network components must be an array.');
  for (const component of network.components) {
    check(component && typeof component === 'object', 'Invalid component.');
  }
  validateNetwork(network);
}

/**
 * Disjoint composition only: the current document schema has no shared entities.
 * Active components retain order and local geometry; IDs and node names are qualified.
 * The returned graph is an isolated clone, not an editable projection of the document.
 */
export function composeNetwork(network: Network): ComposedNetwork {
  requireUntimedNetwork(network);
  const forward = new Map<string, string>();
  const reverse = new Map<string, ElementRef>();
  const net: Net = { name: network.name, template: 'ComposedModel', nodes: [], arcs: [] };
  for (const component of network.components) {
    if (!component.active) continue;
    const local = structuredClone(component.net);
    const idFor = (elementId: string): string => {
      const id = key(component.id, elementId);
      forward.set(id, id);
      reverse.set(id, Object.freeze({ componentId: component.id, elementId }));
      return id;
    };
    for (const node of local.nodes) {
      const id = idFor(node.id);
      net.nodes.push({ ...node, id, name: symbol(id) });
    }
    for (const arc of local.arcs) {
      net.arcs.push({
        ...arc,
        id: idFor(arc.id),
        source: key(component.id, arc.source),
        target: key(component.id, arc.target),
      });
    }
    if (local.annotations) {
      net.annotations ??= [];
      net.annotations.push(...local.annotations.map((note) => ({ ...note, id: idFor(note.id) })));
    }
  }
  validateNet(net);
  return {
    net,
    mapping: Object.freeze({
      toComposed: (componentId: string, elementId: string) =>
        forward.get(key(componentId, elementId)),
      fromComposed: (id: string) => reverse.get(id),
    }),
  };
}

/** A session captures one exact network revision; document edits require a new session. */
export class NetworkSimulation {
  readonly revision: Network;
  readonly mapping: CompositionMapping;
  private readonly composed: Net;
  private simulation: Simulation;

  constructor(network: Network) {
    const composition = composeNetwork(network);
    this.revision = freeze(structuredClone(network));
    this.mapping = composition.mapping;
    this.composed = composition.net;
    this.simulation = new Simulation(this.composed);
  }
  private component(id: string): Component {
    const component = this.revision.components.find((item) => item.id === id);
    check(component, `Unknown component: ${id}.`);
    return component;
  }
  private project(component: Component, marking: Marking): Readonly<Marking> {
    if (!component.active) return freeze(initialMarking(component.net));
    return freeze(
      Object.fromEntries(
        component.net.nodes
          .filter((node) => node.kind === 'place')
          .map((node) => [node.id, marking[this.mapping.toComposed(component.id, node.id)!]]),
      ),
    );
  }
  private projectNetwork(marking: Marking): NetworkMarking {
    return freeze(
      Object.fromEntries(
        this.revision.components.map((component) => [
          component.id,
          this.project(component, marking),
        ]),
      ),
    );
  }
  get marking(): NetworkMarking {
    return this.projectNetwork(this.simulation.marking);
  }
  markingFor(componentId: string): Readonly<Marking> {
    return this.project(this.component(componentId), this.simulation.marking);
  }
  get enabled(): readonly ElementRef[] {
    return freeze(this.simulation.enabled.map((id) => this.mapping.fromComposed(id)!));
  }
  enabledFor(componentId: string): readonly string[] {
    this.component(componentId);
    return freeze(
      this.enabled.filter((ref) => ref.componentId === componentId).map((ref) => ref.elementId),
    );
  }
  get trace(): readonly NetworkSimulationState[] {
    return freeze(
      this.simulation.trace.map((state) => ({
        transition:
          state.transitionId === null ? null : this.mapping.fromComposed(state.transitionId)!,
        marking: this.projectNetwork(state.marking),
      })),
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
  private transitionId(componentId: string, transitionId: string): string {
    const component = this.component(componentId);
    check(component.active, `Component ${componentId} is inactive.`);
    check(
      component.net.nodes.some((node) => node.id === transitionId && node.kind === 'transition'),
      `Unknown transition ${transitionId} in component ${componentId}.`,
    );
    return this.mapping.toComposed(componentId, transitionId)!;
  }
  fire(componentId: string, transitionId: string): void {
    this.simulation.fire(this.transitionId(componentId, transitionId));
  }
  /** Deterministic first-enabled step in component/node order, or an explicit choice. */
  step(ref?: ElementRef): ElementRef | null {
    const chosen = ref ?? this.enabled[0];
    if (!chosen) return null;
    this.fire(chosen.componentId, chosen.elementId);
    return Object.freeze({ ...chosen });
  }
  /** Replace the run from its initial state; a bad trace leaves the entire old run intact. */
  replay(transitions: readonly ElementRef[]): void {
    const next = new Simulation(this.composed);
    for (const ref of transitions) next.fire(this.transitionId(ref.componentId, ref.elementId));
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
