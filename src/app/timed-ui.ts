import { SharedSource, validateSharedSource } from './core/authored-shared';
import { SharedNetworkSimulation } from './core/shared-network-simulation';
import { AuthoredNetwork, resolveAuthored } from './core/authored-model';
import * as docs from './core/documents';
import { Arc, NetNode } from './core/net';
import { TimedNetworkSimulation } from './core/timed-network-simulation';
import { NetworkSimulation, NetworkSimulationState, ElementRef } from './core/network-simulation';
import {
  TokenSelection,
  TimeInterval,
  TimeInvariant,
  UNRESTRICTED,
  validateInterval,
  validateInvariant,
  compareAges,
} from './core/timed';

export function intervalText(interval: TimeInterval = UNRESTRICTED): string {
  return `${interval.lowerClosed ? '[' : '('}${interval.lower},${interval.upper ?? 'inf'}${interval.upperClosed ? ']' : ')'}`;
}
export function invariantText(invariant?: TimeInvariant): string {
  return invariant ? `${invariant.upperClosed ? '<=' : '<'} ${invariant.upper ?? 'inf'}` : '< inf';
}
function nativeBound(text: string): string {
  if (!/^(0|[1-9]\d*)$/.test(text) || BigInt(text) > 2147483647n)
    throw new Error(
      'Native time bounds must be whole numbers from 0 to 2147483647. Use JSON to preserve existing decimal bounds.',
    );
  return text;
}
export function parseInterval(text: string): TimeInterval {
  const match = /^(\[|\()\s*(\d+)\s*,\s*(\d+|inf)\s*(\]|\))$/.exec(text.trim());
  if (!match)
    throw new Error('Use an interval such as [0,inf), (1,5] or [2,2]. Native bounds are integers.');
  const interval = {
    lower: nativeBound(match[2]),
    upper: match[3] === 'inf' ? null : nativeBound(match[3]),
    lowerClosed: match[1] === '[',
    upperClosed: match[4] === ']',
  };
  validateInterval(interval);
  return interval;
}
export function parseInvariant(text: string): TimeInvariant | null {
  if (text.trim() === '< inf') return null;
  const match = /^(<|<=)\s*(\d+)$/.exec(text.trim());
  if (!match) throw new Error('Use < inf, < N or <= N with a native integer bound.');
  const invariant = { upper: nativeBound(match[2]), upperClosed: match[1] === '<=' };
  validateInvariant(invariant);
  return invariant;
}
export interface TimingDraft {
  invariant: string;
  ages: string;
  urgent: boolean;
  interval: string;
  outputArc: string;
}
export interface TimedElementEdit {
  element: NetNode | Arc;
  timing: TimingDraft;
}
export function timingDraft(doc: docs.NetworkDocument, element: NetNode | Arc): TimingDraft {
  const timing = doc.network.components.find((c) => c.id === doc.session.componentId)!.timing!;
  const ages =
    'name' in element && element.kind === 'place' ? (timing.ages[element.id] ?? []).join(', ') : '';
  return {
    invariant: invariantText(timing.invariants[element.id]),
    ages,
    urgent: timing.urgent.includes(element.id),
    interval: intervalText(timing.intervals[element.id]),
    outputArc: timing.transports.find((p) => p.inputArc === element.id)?.outputArc ?? '',
  };
}
/** Validate and publish graph + timing as one document undo step. Routes are never reconstructed. */
export function editTimedElement(
  doc: docs.NetworkDocument,
  edit: TimedElementEdit,
): docs.NetworkDocument {
  const component = doc.network.components.find((c) => c.id === doc.session.componentId)!;
  const timing = structuredClone(component.timing!);
  const intervals = { ...timing.intervals },
    invariants = { ...timing.invariants },
    ages = { ...timing.ages };
  let urgent = [...timing.urgent],
    transports = [...timing.transports];
  let element = edit.element;
  const original = [...component.net.nodes, ...component.net.arcs].find((e) => e.id === element.id);
  if (!original) throw new Error('The edited element no longer exists.');
  let arcs = component.net.arcs.map((a) => ({ ...a }));
  if ('name' in element) {
    if (element.kind === 'place') {
      const previous = timingDraft(doc, original);
      const invariant =
        edit.timing.invariant === previous.invariant
          ? timing.invariants[element.id]
          : parseInvariant(edit.timing.invariant);
      delete invariants[element.id];
      if (invariant) invariants[element.id] = invariant;
      const values = edit.timing.ages.trim()
        ? edit.timing.ages.split(',').map((s) => s.trim())
        : [];
      for (const age of values) compareAges(age, '0');
      if (values.length > element.tokens)
        throw new Error(
          'More initial ages than tokens. Increase the marking or remove ages explicitly.',
        );
      delete ages[element.id];
      const nonzero = values.filter((age) => compareAges(age, '0') !== 0);
      if (nonzero.length) ages[element.id] = nonzero;
    } else {
      urgent = urgent.filter((id) => id !== element.id);
      if (edit.timing.urgent) urgent.push(element.id);
    }
  } else {
    const pair = transports.find((p) => p.inputArc === element.id || p.outputArc === element.id);
    const input = component.net.nodes.some(
      (n) => n.id === (element as Arc).source && n.kind === 'place',
    );
    if (input) {
      const previous = intervalText(timing.intervals[element.id]);
      const interval =
        edit.timing.interval === previous
          ? timing.intervals[element.id]
          : parseInterval(edit.timing.interval);
      delete intervals[element.id];
      if (interval && intervalText(interval) !== '[0,inf)') intervals[element.id] = interval;
      transports = transports.filter((p) => p.inputArc !== element.id);
      if (edit.timing.outputArc)
        transports.push({ inputArc: element.id, outputArc: edit.timing.outputArc });
    }
    const partner = input ? edit.timing.outputArc : pair?.inputArc;
    if (partner)
      arcs = arcs.map((a) => (a.id === partner ? { ...a, weight: (element as Arc).weight } : a));
    arcs = arcs.map((a) => (a.id === element.id ? (element as Arc) : a));
  }
  const net = {
    ...component.net,
    nodes: component.net.nodes.map((n) => (n.id === element.id ? (element as NetNode) : n)),
    arcs,
  };
  return docs.commitTimedComponent(doc, net, { intervals, invariants, ages, urgent, transports });
}

/** Explicit timing dispatch; an aggregate timed Net never reaches NetworkSimulation. */
export type TokenPolicy = 'oldest' | 'youngest' | 'random' | 'manual';
export class DocumentSimulation {
  private generation = 0;
  get version() {
    return this.generation;
  }
  readonly revision: docs.Network | SharedSource;
  private readonly shared?: SharedNetworkSimulation;
  private readonly source?: SharedSource;
  private readonly untimed?: NetworkSimulation;
  private readonly timed?: TimedNetworkSimulation;
  constructor(
    network: docs.Network | AuthoredNetwork | SharedSource,
    private readonly random: () => number = Math.random,
  ) {
    if ('shared' in network) {
      this.source = network;
      const checked = validateSharedSource(network);
      if (!checked.ok) throw new Error(checked.issues.map((i) => i.message).join(' '));
      if (
        network.type.game ||
        network.shared.places.length ||
        network.shared.transitions.length ||
        !network.components.some((c) => c.active)
      ) {
        this.shared = new SharedNetworkSimulation({ ...checked.value, source: network }, random);
        this.revision = this.shared.revision;
        return;
      }
      const { shared: _shared, savedQueries, ...rest } = network;
      network = {
        ...rest,
        ...(savedQueries
          ? {
              savedQueries: {
                xml: savedQueries.xml,
                protectedComponents: savedQueries.protectedComponents,
                protectedConstants: savedQueries.protectedConstants,
              },
            }
          : {}),
      } as AuthoredNetwork;
    }
    if ('constants' in network) {
      const resolved = resolveAuthored(network);
      if (!resolved.ok) throw new Error(resolved.issues.map((i) => i.message).join(' '));
      network = structuredClone(resolved.value.numeric) as docs.Network;
    }
    this.revision = structuredClone(network);
    if (network.type.timed) {
      this.timed = new TimedNetworkSimulation(network);
    } else this.untimed = new NetworkSimulation(network);
  }
  get cursor() {
    return (this.shared ?? this.timed ?? this.untimed)!.cursor;
  }
  get canBack() {
    return (this.shared ?? this.timed ?? this.untimed)!.canBack;
  }
  get canForward() {
    return (this.shared ?? this.timed ?? this.untimed)!.canForward;
  }
  assertRevision(source: SharedSource) {
    if (this.source && source !== this.source)
      throw new Error('The authored revision changed; restart execution.');
    this.shared?.assertRevision(source);
  }
  get totalTokens(): number {
    if (this.shared) return this.shared.totalTokens;
    return Object.values(this.trace[this.cursor].marking).reduce(
      (sum, marking) => sum + Object.values(marking).reduce((a, b) => a + b, 0),
      0,
    );
  }
  get enabled() {
    if (this.shared) return this.shared.enabled;
    if (!this.timed) return this.untimed!.enabled;
    return this.timed.enabled;
  }
  enabledFor(componentId: string): readonly string[] {
    return (
      this.shared?.enabledFor(componentId) ??
      this.enabled.filter((r) => r.componentId === componentId).map((r) => r.elementId)
    );
  }
  markingFor(componentId: string) {
    if (!this.timed && !this.shared) return this.untimed!.markingFor(componentId);
    return Object.fromEntries(
      Object.entries((this.shared ?? this.timed)!.markingFor(componentId)).map(([id, tokens]) => [
        id,
        tokens.length,
      ]),
    );
  }
  get trace(): readonly NetworkSimulationState[] {
    if (!this.timed && !this.shared) return this.untimed!.trace;
    return (this.shared ?? this.timed)!.trace.map((step) => ({
      transition: step.kind === 'fire' ? step.transition : null,
      marking: Object.fromEntries(
        Object.entries(step.marking).map(([component, places]) => [
          component,
          Object.fromEntries(Object.entries(places).map(([id, tokens]) => [id, tokens.length])),
        ]),
      ),
    }));
  }
  get time(): string {
    return this.shared?.time ?? this.timed?.time ?? '0';
  }
  label(index: number): string | null {
    if (this.shared) return this.shared.label(index);
    const step = this.timed?.trace[index];
    if (!step) return null;
    const action =
      step.kind === 'delay'
        ? `Delay ${step.amount}`
        : step.kind === 'initial'
          ? 'Initial marking'
          : `Fire ${this.nodeName(step.transition.componentId, step.transition.elementId)}`;
    return `${action} · time ${step.time}`;
  }
  private nodeName(componentId: string, elementId: string): string {
    const component = this.revision.components.find((c) => c.id === componentId)!;
    const node = component.net.nodes.find((n) => n.id === elementId)!;
    const name =
      'sharedId' in node
        ? [...this.source!.shared.places, ...this.source!.shared.transitions].find(
            (p) => p.id === node.sharedId,
          )!.name
        : 'name' in node
          ? node.name
          : '';
    return `${component.net.template}.${name}`;
  }
  ages(place: string, componentId = this.revision.components[0].id): string[] {
    return (this.shared ?? this.timed)?.markingFor(componentId)[place]?.map((t) => t.age) ?? [];
  }
  historyAges(index: number): string | null {
    const step = (this.shared ?? this.timed)?.trace[index];
    return step
      ? Object.entries(step.marking)
          .flatMap(([component, places]) =>
            Object.entries(places).flatMap(([place, tokens]) =>
              tokens.map((t) => `${this.nodeName(component, place)}: ${t.age}`),
            ),
          )
          .join(' · ')
      : null;
  }
  get legalDelay() {
    const interval = (this.shared ?? this.timed)?.delayInterval;
    return interval ? intervalText(interval) : '';
  }
  delay(amount: string) {
    if (!this.timed && !this.shared) throw new Error('Delay requires a timed document.');
    (this.shared ?? this.timed)!.delay(amount);
    this.generation++;
  }
  eligibleInputs(ref: ElementRef) {
    if (this.shared) return this.shared.eligibleInputs(ref);
    if (!this.timed) return [];
    const net = (this.revision as docs.Network).components.find(
      (c) => c.id === ref.componentId,
    )!.net;
    return structuredClone(this.timed.eligibleInputs(ref)).map((input) => ({
      ...input,
      placeName: net.nodes.find((node) => node.id === input.place)!.name,
      destinationName:
        input.destination === undefined
          ? undefined
          : net.nodes.find((node) => node.id === input.destination)!.name,
    }));
  }
  fire(
    componentId: string,
    elementId: string,
    policy: Exclude<TokenPolicy, 'manual'> | TokenSelection = 'random',
  ) {
    if (!this.timed && !this.shared) return this.untimed!.fire(componentId, elementId);
    if (!this.enabledFor(componentId).includes(elementId))
      throw new Error('Transition is not enabled.');
    const selection: TokenSelection =
      typeof policy !== 'string'
        ? policy
        : policy === 'random'
          ? { mode: 'random', random: this.random }
          : { mode: policy };
    (this.shared ?? this.timed)!.fire({ componentId, elementId }, selection);
    this.generation++;
  }
  back() {
    (this.shared ?? this.timed ?? this.untimed)!.back();
    this.generation++;
  }
  forward() {
    (this.shared ?? this.timed ?? this.untimed)!.forward();
    this.generation++;
  }
  reset() {
    (this.shared ?? this.timed ?? this.untimed)!.reset();
    this.generation++;
  }
}
