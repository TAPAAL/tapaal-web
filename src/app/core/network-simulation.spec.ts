import { describe, expect, it } from 'vitest';
import { type Network } from './documents';
import { SUPPORTED_MODEL_TYPE } from './model-types';
import { validateNet } from './net';
import { composeNetwork, NetworkSimulation } from './network-simulation';

function fixture(): Network {
  return {
    name: 'Network',
    type: { ...SUPPORTED_MODEL_TYPE },
    components: ['A', 'B', 'Off'].map((id) => ({
      id,
      active: id !== 'Off',
      net: {
        name: 'Network',
        template: id,
        nodes: [
          { id: 'p', name: 'Input', kind: 'place', x: 10, y: 20, tokens: 4 },
          { id: 'q', name: 'Output', kind: 'place', x: 100, y: 20, tokens: 0 },
          { id: 't', name: 'Move', kind: 'transition', x: 50, y: 20, tokens: 0 },
        ],
        arcs: [
          { id: 'in', source: 'p', target: 't', kind: 'normal', weight: 2 },
          { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 3 },
          { id: 'guard', source: 'q', target: 't', kind: 'inhibitor', weight: 4 },
        ],
      },
    })),
  };
}
const a = { componentId: 'A', elementId: 't' };
const b = { componentId: 'B', elementId: 't' };

describe('disjoint network composition', () => {
  it('qualifies repeated local IDs and names, including arcs, and excludes inactive components', () => {
    const network = fixture();
    const before = structuredClone(network);
    const { net, mapping } = composeNetwork(network);
    expect(net.nodes).toHaveLength(6);
    expect(net.arcs).toHaveLength(6);
    expect(new Set(net.nodes.map((node) => node.name)).size).toBe(6);
    expect(() => validateNet(net)).not.toThrow();
    for (const component of network.components.filter((item) => item.active)) {
      for (const element of [...component.net.nodes, ...component.net.arcs]) {
        const id = mapping.toComposed(component.id, element.id)!;
        expect(mapping.fromComposed(id)).toEqual({
          componentId: component.id,
          elementId: element.id,
        });
      }
    }
    expect(mapping.toComposed('Off', 'p')).toBeUndefined();
    expect(mapping.fromComposed('missing')).toBeUndefined();
    expect(network).toEqual(before);
    expect(composeNetwork(network).net).toEqual(net);
    const reordered = composeNetwork({ ...network, components: [...network.components].reverse() });
    expect(reordered.mapping.toComposed('A', 'p')).toBe(mapping.toComposed('A', 'p'));
  });

  it('does not collide for delimiter-like, Unicode, or object-prototype IDs', () => {
    const network = fixture();
    const components = network.components.map((component, i) => ({
      ...component,
      id: ['x","y', '__proto__', 'λ'][i],
      active: true,
      net: {
        ...component.net,
        nodes: [{ ...component.net.nodes[0], id: '__proto__' }],
        arcs: [],
      },
    }));
    const sim = new NetworkSimulation({ ...network, components });
    expect(sim.markingFor('__proto__')).toEqual({ ['__proto__']: 4 });
    expect(Object.keys(sim.marking)).toEqual(['x","y', '__proto__', 'λ']);
    expect(
      new Set(composeNetwork({ ...network, components }).net.nodes.map((n) => n.id)).size,
    ).toBe(3);
  });

  it('deep clones layout, annotation and new optional node/arc metadata', () => {
    const network = fixture();
    const local = network.components[0].net;
    Object.assign(local.nodes[2], { angle: 90, nameVisible: false, nameOffsetX: 12 });
    Object.assign(local.nodes[0], { futureLayout: { values: [1, 2] } });
    local.arcs[0].bends = [{ x: 25, y: 35, curved: true }];
    local.arcs[0].curvedEnd = true;
    local.annotations = [
      { id: 'note', text: 'Local note', x: 1, y: 2, width: 40, height: 20, border: false },
    ];
    const before = structuredClone(network);
    const { net, mapping } = composeNetwork(network);
    expect(net.nodes[2]).toMatchObject({ angle: 90, nameVisible: false, nameOffsetX: 12 });
    expect(net.arcs[0]).toMatchObject({ weight: 2, curvedEnd: true, bends: local.arcs[0].bends });
    expect(mapping.fromComposed(net.annotations![0].id)).toEqual({
      componentId: 'A',
      elementId: 'note',
    });
    net.arcs[0].bends![0].x = 999;
    net.annotations![0].text = 'changed';
    const extension = Reflect.get(net.nodes[0], 'futureLayout') as { values: number[] };
    extension.values.push(3);
    expect(network).toEqual(before);
  });

  it.each(['timed', 'colored', 'game', 'stochastic'] as const)(
    'rejects original %s flags without normalization',
    (flag) => {
      const network = fixture();
      const wrongType = { ...network, type: { ...network.type, [flag]: true } };
      expect(() => composeNetwork(wrongType)).toThrow(/type flags/);
      expect(() => new NetworkSimulation(wrongType)).toThrow(/type flags/);
    },
  );

  it('rejects timed metadata paired with a timed type even if editing capabilities expand', () => {
    const network = fixture();
    Object.assign(network.components[0], { timing: { intervals: {}, invariants: {} } });
    expect(
      () => new NetworkSimulation({ ...network, type: { ...network.type, timed: true } }),
    ).toThrow(/untimed/);
  });

  it('validates names before qualification and rejects malformed networks including inactive data', () => {
    const invalidName = fixture();
    invalidName.components[0].net.nodes[0].name = 'not valid';
    expect(() => composeNetwork(invalidName)).toThrow(/Name/);
    const duplicateName = fixture();
    duplicateName.components[0].net.nodes[0].name = 'Move';
    expect(() => composeNetwork(duplicateName)).toThrow(/already used/);
    const invalidArc = fixture();
    invalidArc.components[2].net.arcs[0].target = 'missing';
    expect(() => composeNetwork(invalidArc)).toThrow(/existing place/);
    const network = fixture();
    for (const malformed of [
      null,
      {},
      { ...network, components: null },
      { ...network, components: [null] },
      { ...network, components: [] },
      { ...network, components: [...network.components, network.components[0]] },
      { ...network, components: network.components.map((c) => ({ ...c, active: false })) },
      { ...network, type: { ...network.type, timed: undefined } },
    ]) {
      expect(() => composeNetwork(malformed as Network)).toThrow();
    }
  });
});

describe('network simulation sessions', () => {
  it('retains input-free local transitions for interactive firing, including empty effects', () => {
    const network = fixture();
    const local = network.components[0].net;
    local.arcs = [];
    const sim = new NetworkSimulation(network);
    const initial = sim.marking;
    expect(sim.enabledFor('A')).toEqual(['t']);
    sim.fire('A', 't');
    expect(sim.marking).toEqual(initial);
    expect(sim.cursor).toBe(1);
    expect(sim.trace[1].transition).toEqual(a);
  });

  it('exposes independently enabled original references and weighted/inhibitor execution', () => {
    const network = fixture();
    const sim = new NetworkSimulation(network);
    expect(sim.enabled).toEqual([a, b]);
    expect(sim.enabledFor('A')).toEqual(['t']);
    sim.fire('A', 't');
    expect(sim.markingFor('A')).toEqual({ p: 2, q: 3 });
    expect(sim.markingFor('B')).toEqual({ p: 4, q: 0 });
    expect(sim.enabled).toEqual([a, b]);
    sim.fire('A', 't');
    expect(sim.markingFor('A')).toEqual({ p: 0, q: 6 });
    expect(sim.enabled).toEqual([b]);
    expect(() => sim.fire('A', 't')).toThrow(/not enabled/);
    expect(network.components[0].net.nodes[0].tokens).toBe(4);
  });

  it('uses strict inhibitor thresholds without consuming inhibitor tokens', () => {
    const network = fixture();
    network.components[0].net.nodes[1].tokens = 4;
    const sim = new NetworkSimulation(network);
    expect(sim.enabledFor('A')).toEqual([]);
    expect(sim.enabledFor('B')).toEqual(['t']);
    expect(() => sim.fire('A', 't')).toThrow(/not enabled/);
  });

  it('shows inactive initial markings and rejects inactive, unknown, and nontransition firing', () => {
    const sim = new NetworkSimulation(fixture());
    expect(sim.enabledFor('Off')).toEqual([]);
    sim.fire('A', 't');
    expect(sim.markingFor('Off')).toEqual({ p: 4, q: 0 });
    expect(() => sim.fire('Off', 't')).toThrow(/inactive/);
    expect(() => sim.markingFor('missing')).toThrow(/Unknown component/);
    expect(() => sim.enabledFor('missing')).toThrow(/Unknown component/);
    expect(() => sim.fire('A', 'p')).toThrow(/Unknown transition/);
    expect(() => sim.fire('A', 'missing')).toThrow(/Unknown transition/);
    expect(sim.cursor).toBe(1);
  });

  it('has no clock dependency and independent component firings commute', () => {
    const first = new NetworkSimulation(fixture());
    const second = new NetworkSimulation(fixture());
    first.replay([a, b]);
    second.replay([b, a]);
    expect(first.marking).toEqual(second.marking);
    expect(first.trace.map((state) => state.transition)).toEqual([null, a, b]);
  });

  it('retains full immutable history, navigates, branches, replays and resets', () => {
    const sim = new NetworkSimulation(fixture());
    const initial = sim.marking;
    expect(sim.step()).toEqual(a);
    expect(sim.step(b)).toEqual(b);
    const oldTrace = sim.trace;
    expect(oldTrace).toHaveLength(3);
    expect(Object.isFrozen(oldTrace)).toBe(true);
    expect(Object.isFrozen(oldTrace[1].transition)).toBe(true);
    expect(Object.isFrozen(oldTrace[1].marking['A'])).toBe(true);
    sim.back();
    expect(sim.cursor).toBe(1);
    expect(sim.canForward).toBe(true);
    expect(sim.markingFor('B')).toEqual(initial['B']);
    sim.forward();
    expect(sim.cursor).toBe(2);
    sim.back();
    sim.fire('A', 't');
    expect(sim.canForward).toBe(false);
    expect(sim.trace.map((state) => state.transition)).toEqual([null, a, a]);
    expect(oldTrace[2].transition).toEqual(b);
    sim.replay([b, a, b, a]);
    expect(sim.cursor).toBe(4);
    expect(sim.enabled).toEqual([]);
    expect(sim.step()).toBeNull();
    sim.reset();
    sim.back();
    sim.forward();
    expect(sim.marking).toEqual(initial);
    expect(sim.trace).toHaveLength(1);
    expect(sim.cursor).toBe(0);
    expect(sim.canBack).toBe(false);
    sim.replay([]);
    expect(sim.trace).toHaveLength(1);
  });

  it('captures the whole revision, including optional metadata, without exposing mutations', () => {
    const network = fixture();
    Object.assign(network, { futureMetadata: { values: [1] } });
    const before = structuredClone(network);
    const sim = new NetworkSimulation(network);
    network.components[0].net.nodes[0].tokens = 100;
    network.components[0].net.nodes[2].name = 'Renamed';
    expect(sim.revision).toEqual(before);
    expect(Object.isFrozen(sim.revision.components[0].net.nodes[0])).toBe(true);
    expect(Object.isFrozen(Reflect.get(sim.revision, 'futureMetadata'))).toBe(true);
    sim.fire('A', 't');
    expect(sim.markingFor('A')['p']).toBe(2);
    expect(sim.revision.components[0].net.nodes[0].tokens).toBe(4);
  });

  it('keeps marking, cursor and future history atomic on overflow or failed replay', () => {
    const network = fixture();
    const local = network.components[0].net;
    local.nodes[1].tokens = Number.MAX_SAFE_INTEGER;
    local.arcs = local.arcs.filter((arc) => arc.kind !== 'inhibitor');
    const sim = new NetworkSimulation(network);
    sim.fire('B', 't');
    sim.back();
    const trace = sim.trace;
    for (const attempt of [
      () => sim.fire('A', 't'),
      () => sim.step(a),
      () => sim.replay([b, a]),
      () => sim.replay([b, { componentId: 'Off', elementId: 't' }]),
      () => sim.replay([b, b, b]),
    ]) {
      expect(attempt).toThrow();
      expect(sim.trace).toEqual(trace);
      expect(sim.cursor).toBe(0);
      expect(sim.canForward).toBe(true);
    }
  });
});
