// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  emptyTiming,
  timedModelForNetwork,
  type Component,
  type ComponentTiming,
  type Network,
} from './documents';
import { TimedNetworkSimulation, type TimedNetworkAction } from './timed-network-simulation';
import { MAX_TIMED_TOKENS, UNRESTRICTED } from './timed';
import { captureSavedQueries } from './saved-queries';

function component(
  id: string,
  ages = ['1'],
  timing: Partial<ComponentTiming> = {},
  active = true,
): Component {
  return {
    id,
    active,
    net: {
      name: 'Network',
      template: `C${id}`,
      nodes: [
        { id: 'p', name: 'P', kind: 'place', x: 10, y: 20, tokens: ages.length },
        { id: 'q', name: 'Q', kind: 'place', x: 100, y: 20, tokens: 0 },
        { id: 't', name: 'T', kind: 'transition', x: 50, y: 20, tokens: 0 },
      ],
      arcs: [
        { id: 'in', source: 'p', target: 't', kind: 'normal', weight: 1 },
        { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 1 },
      ],
    },
    timing: {
      ...emptyTiming(),
      ages: ages.some((a) => a !== '0') ? { p: ages.filter((a) => a !== '0') } : {},
      ...timing,
    },
  };
}
function network(...components: Component[]): Network {
  return {
    name: 'Network',
    type: { timed: true, colored: false, game: false, stochastic: false },
    components,
  };
}
const ref = (componentId = 'a', elementId = 't') => ({ componentId, elementId });
const ages = (s: TimedNetworkSimulation, c: string, p = 'p') =>
  s.marking[c][p].map((t) => t.age).sort();
function actions(s: TimedNetworkSimulation): TimedNetworkAction[] {
  return s.trace.filter(
    (state): state is Exclude<typeof state, { kind: 'initial' }> => state.kind !== 'initial',
  );
}
function frozen(value: unknown): void {
  if (value && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}

describe('disjoint timed network simulation', () => {
  it('qualifies repeated IDs/names, advances one exact clock, and keeps local firing local', () => {
    const s = new TimedNetworkSimulation(
      network(component('a'), component('b', ['2']), component('c', ['3'])),
    );
    expect(s.enabled).toEqual([ref('a'), ref('b'), ref('c')]);
    const a = s.mapping.toComposed('a', 'p')!,
      b = s.mapping.toComposed('b', 'p')!;
    expect(a).not.toBe(b);
    expect(s.mapping.fromComposed(a)).toEqual(ref('a', 'p'));
    expect(s.mapping.fromComposed('missing')).toBeUndefined();
    s.delay('0.1');
    s.delay('0.2');
    expect(s.time).toBe('0.3');
    expect(ages(s, 'a')).toEqual(['1.3']);
    expect(ages(s, 'b')).toEqual(['2.3']);
    const other = s.marking.b;
    s.fire(ref());
    expect(s.marking.b).toEqual(other);
    expect(ages(s, 'a', 'q')).toEqual(['0']);
    expect(s.time).toBe('0.3');
  });
  it('keeps inactive initial ages but excludes its invariants, urgent transitions and choices', () => {
    const s = new TimedNetworkSimulation(
      network(
        component('a'),
        component(
          'b',
          ['2'],
          {
            urgent: ['t'],
            invariants: { p: { upper: '2', upperClosed: true } },
          },
          false,
        ),
      ),
    );
    s.delay('100');
    s.fire(ref());
    expect(ages(s, 'b')).toEqual(['2']);
    expect(s.enabledFor('b')).toEqual([]);
    expect(s.mapping.toComposed('b', 'p')).toBeUndefined();
    expect(() => s.fire(ref('b'))).toThrow(/inactive/);
    expect(() => s.eligibleInputs(ref('b'))).toThrow(/inactive/);
  });
  it('intersects occupied invariants globally, respecting strict ties and ignoring empty places', () => {
    const a = component('a', ['1'], {
      invariants: { p: { upper: '2', upperClosed: true }, q: { upper: '0', upperClosed: true } },
    });
    const b = component('b', ['2'], { invariants: { p: { upper: '3', upperClosed: false } } });
    const s = new TimedNetworkSimulation(network(a, b));
    expect(s.delayInterval).toEqual({
      lower: '0',
      upper: '1',
      lowerClosed: true,
      upperClosed: false,
    });
    expect(() => s.delay('1')).toThrow(/invariant/);
    expect(s.cursor).toBe(0);
    s.delay('0.9');
    expect(s.delayInterval.upper).toBe('0.1');
    const closed = new TimedNetworkSimulation(network(a, component('b', ['2'])));
    closed.delay('1');
    expect(closed.delayInterval.upper).toBe('0');
  });
  it('blocks global delay for an enabled urgent transition elsewhere, then releases after firing', () => {
    const s = new TimedNetworkSimulation(
      network(component('a'), component('b', ['1'], { urgent: ['t'] })),
    );
    expect(s.delayInterval.upper).toBe('0');
    expect(() => s.delay('0.1')).toThrow(/urgent/);
    s.delay('0');
    s.fire(ref('b'));
    s.delay('0.1');
    expect(ages(s, 'a')).toEqual(['1.1']);
  });
  it('uses strict input endpoints without offering future-enabling unions', () => {
    const s = new TimedNetworkSimulation(
      network(
        component('a', ['0'], {
          intervals: { in: { lower: '0.3', upper: '1', lowerClosed: false, upperClosed: false } },
        }),
        component('b'),
      ),
    );
    s.delay('0.1');
    s.delay('0.2');
    expect(s.enabledFor('a')).toEqual([]);
    expect(s.delayInterval.upper).toBeNull();
    s.delay('0.1');
    expect(s.enabledFor('a')).toEqual(['t']);
    s.delay('0.6');
    expect(s.enabledFor('a')).toEqual([]);
  });
  it('selects weighted ordinary inputs and preserves weighted inhibitor tokens', () => {
    const a = component('a', ['1', '3', '2']);
    a.net.arcs[0].weight = 2;
    a.net.arcs[1].weight = 2;
    const b = component('b', ['2', '3']);
    b.net.arcs[0].kind = 'inhibitor';
    b.net.arcs[0].weight = 3;
    const s = new TimedNetworkSimulation(network(a, b));
    expect(s.eligibleInputs(ref())[0].weight).toBe(2);
    s.fire(ref(), { mode: 'youngest' });
    expect(ages(s, 'a')).toEqual(['3']);
    expect(ages(s, 'a', 'q')).toEqual(['0', '0']);
    expect(s.eligibleInputs(ref('b'))).toEqual([]);
    s.fire(ref('b'), { mode: 'manual', bindings: {} });
    expect(ages(s, 'b')).toEqual(['2', '3']);
    b.net.arcs[0].weight = 2;
    expect(new TimedNetworkSimulation(network(a, b)).enabledFor('b')).toEqual([]);
  });
  it('maps weighted transport eligibility/destination and retains exact identities and ages', () => {
    const a = component('a', ['1', '2', '4'], {
      transports: [{ inputArc: 'in', outputArc: 'out' }],
      invariants: { q: { upper: '4', upperClosed: false } },
    });
    a.net.arcs.forEach((arc) => (arc.weight = 2));
    const s = new TimedNetworkSimulation(network(a, component('b')));
    const input = s.eligibleInputs(ref())[0];
    expect({ arc: input.arcId, place: input.place, destination: input.destination }).toEqual({
      arc: 'in',
      place: 'p',
      destination: 'q',
    });
    expect(input.tokens.map((t) => t.age)).toEqual(['1', '2']);
    s.fire(ref(), { mode: 'manual', bindings: { in: input.tokens.map((t) => t.id) } });
    expect(s.marking.a.q.map((t) => t.id)).toEqual(input.tokens.map((t) => t.id));
    s.delay('1');
    expect(ages(s, 'a', 'q')).toEqual(['2', '3']);
    expect(s.delayInterval).toMatchObject({ upper: '1', upperClosed: false });
    expect(() => s.delay('1')).toThrow();
  });
  it('transport selfloops retain identity and local fires commute across components', () => {
    const a = component('a', ['1', '2'], { transports: [{ inputArc: 'in', outputArc: 'out' }] });
    a.net.arcs[1].target = 'p';
    const n = network(
      a,
      component('b', ['3'], { transports: [{ inputArc: 'in', outputArc: 'out' }] }),
    );
    const x = new TimedNetworkSimulation(n),
      y = new TimedNetworkSimulation(n);
    const initial = x.marking.a.p;
    x.fire(ref());
    expect(x.marking.a.p.map((t) => t.id).sort()).toEqual(initial.map((t) => t.id).sort());
    x.fire(ref('b'));
    y.fire(ref('b'));
    y.fire(ref());
    expect(x.marking).toEqual(y.marking);
  });
  it('rejects foreign tokens, composed/local arc confusion, wrong kinds and bad manual bindings atomically', () => {
    const s = new TimedNetworkSimulation(network(component('a'), component('b')));
    s.delay('1');
    s.back();
    const before = s.trace;
    const own = s.marking.a.p[0].id,
      foreign = s.marking.b.p[0].id;
    for (const bindings of [
      { in: [foreign] },
      { in: [] },
      { in: [own, own] },
      {},
      { out: [own] },
      { [s.mapping.toComposed('a', 'in')!]: [own] },
    ]) {
      expect(() => s.fire(ref(), { mode: 'manual', bindings })).toThrow();
      expect(s.trace).toEqual(before);
      expect(s.canForward).toBe(true);
    }
    for (const r of [ref('missing'), ref('a', 'p'), ref('a', 'missing')])
      expect(() => s.fire(r)).toThrow();
    expect(() => s.markingFor('missing')).toThrow();
    expect(() => s.enabledFor('missing')).toThrow();
    s.fire(ref(), { mode: 'manual', bindings: { in: [own] } });
    expect(s.canForward).toBe(false);
  });
  it('captures random bindings, navigates snapshots and replays without repicking', () => {
    const n = network(component('a', ['1', '2', '3']), component('b'));
    const s = new TimedNetworkSimulation(n);
    let calls = 0;
    s.delay('0.1');
    s.fire(ref(), {
      mode: 'random',
      random: () => {
        calls++;
        return 0.5;
      },
    });
    const full = s.trace,
      saved = actions(s);
    expect(calls).toBe(1);
    s.back();
    expect(s.time).toBe('0.1');
    s.back();
    expect(s.time).toBe('0');
    s.forward();
    s.forward();
    expect(s.trace).toEqual(full);
    s.reset();
    expect(s.cursor).toBe(0);
    expect(s.time).toBe('0');
    expect(s.canForward).toBe(false);
    s.replay(saved);
    expect(s.trace).toEqual(full);
    expect(calls).toBe(1);
    s.back();
    const before = s.trace;
    expect(() =>
      s.replay([...saved, { kind: 'fire', transition: ref('no'), bindings: {} }]),
    ).toThrow();
    expect(s.trace).toEqual(before);
    expect(s.cursor).toBe(1);
    expect(s.canForward).toBe(true);
    expect(() => s.fire(ref(), { mode: 'random', random: () => NaN })).toThrow();
    expect(s.trace).toEqual(before);
    expect(() => s.delay('-1')).toThrow();
    expect(s.trace).toEqual(before);
    s.delay('0.2');
    expect(s.time).toBe('0.3');
    expect(s.canForward).toBe(false);
  });
  it('freezes isolated revisions, mappings, views and trace while preserving source geometry', () => {
    const n = network(component('a'), component('b'));
    Object.assign(n.components[0].net.arcs[0], { extension: { value: [1, 2] } });
    const before = structuredClone(n);
    const s = new TimedNetworkSimulation(n);
    frozen(s.revision);
    frozen(s.mapping);
    frozen(s.mapping.fromComposed(s.mapping.toComposed('a', 'p')!));
    frozen(s.marking);
    frozen(s.trace);
    frozen(s.eligibleInputs(ref()));
    frozen(s.delayInterval);
    frozen(s.enabled);
    n.components[0].net.nodes[0].tokens = 8;
    expect(s.revision).toEqual(before);
    const source = structuredClone(s.revision);
    s.delay('1');
    s.fire(ref());
    expect(s.revision).toEqual(source);
    expect(() => new TimedNetworkSimulation(s.revision)).not.toThrow();
    expect(() => timedModelForNetwork(s.revision)).toThrow(/exactly one/);
  });
  it('preserves protected queries without executing them or renaming their source symbols', () => {
    const base = network(component('a'), component('b'));
    const n = {
      ...base,
      savedQueries: captureSavedQueries(base, ['<query name="saved" query="EF Ca.P = 0"/>']),
    };
    const before = structuredClone(n);
    const s = new TimedNetworkSimulation(n);
    s.fire(ref());
    s.delay('1');
    expect(s.revision).toEqual(before);
    expect(n).toEqual(before);
    n.components[0].net.nodes[0].name = 'Changed';
    expect(() => new TimedNetworkSimulation(n)).toThrow();
  });
  it('uses injective mappings for punctuation, Unicode and prototype-like element IDs', () => {
    const a = component('a'),
      b = component('b');
    const remap = (c: Component, id: string) => {
      c.net.nodes[0].id = id;
      c.net.arcs[0].source = id;
      return {
        ...c,
        id: c.id + '\u0000[]"😀',
        timing: { ...emptyTiming(), ages: { [id]: ['1'] } },
      };
    };
    const n = network(remap(a, '__proto__'), remap(b, 'constructor'));
    const s = new TimedNetworkSimulation(n);
    for (const c of n.components)
      for (const e of [...c.net.nodes, ...c.net.arcs]) {
        const id = s.mapping.toComposed(c.id, e.id)!;
        expect(s.mapping.fromComposed(id)).toEqual({ componentId: c.id, elementId: e.id });
      }
    s.delay('0.1');
    expect(s.marking[n.components[0].id]['__proto__'][0].age).toBe('1.1');
    s.fire(ref(n.components[0].id));
    expect(s.marking[n.components[1].id]['constructor'][0].age).toBe('1.1');
  });
  it('checks global clock overflow even in empty networks, atomically after Back', () => {
    const s = new TimedNetworkSimulation(network(component('a', []), component('b', [])));
    s.delay('9'.repeat(256));
    s.delay('0');
    s.back();
    const before = s.trace;
    expect(() => s.delay('1')).toThrow(/precision|decimal/i);
    expect(s.trace).toEqual(before);
    expect(s.canForward).toBe(true);
  });
  it.each(['timed', 'colored', 'game', 'stochastic'] as const)(
    'requires explicit supported %s type flag',
    (flag) => {
      for (const value of [undefined, null, 'false', 0, flag === 'timed' ? false : true]) {
        const n = network(component('a'));
        Object.assign(n.type, { [flag]: value });
        expect(() => new TimedNetworkSimulation(n)).toThrow(/explicitly/);
      }
    },
  );
  it('refuses unrepresented shared/constants semantics and revalidates inactive timing', () => {
    for (const field of ['constants', 'sharedPlaces', 'sharedTransitions', 'sharedElementIds']) {
      const n = network(component('a'));
      Object.assign(n, { [field]: ['x'] });
      expect(() => new TimedNetworkSimulation(n)).toThrow(/Unsupported/);
    }
    for (const timing of [
      { intervals: { in: UNRESTRICTED } },
      { ages: { p: ['0'] } },
      { urgent: ['missing'] },
      { invariants: { p: { upper: '0', upperClosed: true } } },
    ]) {
      expect(
        () =>
          new TimedNetworkSimulation(network(component('a'), component('b', ['1'], timing, false))),
      ).toThrow();
    }
  });
  it('refuses unsafe counts/weights, aggregate capacity and output overflow without losing future', () => {
    for (const count of [Number.MAX_SAFE_INTEGER + 1, MAX_TIMED_TOKENS + 1]) {
      const c = component('a');
      c.net.nodes[0].tokens = count;
      expect(() => new TimedNetworkSimulation(network(c))).toThrow();
    }
    const c = component('a');
    c.net.arcs[0].weight = Number.MAX_SAFE_INTEGER + 1;
    expect(() => new TimedNetworkSimulation(network(c))).toThrow();
    const a = component('a'),
      b = component('b');
    a.net.nodes[0].tokens = 60000;
    b.net.nodes[0].tokens = 60000;
    expect(() => new TimedNetworkSimulation(network(a, b))).toThrow(/capacity/);
    const grow = component('a');
    grow.net.arcs[1].weight = MAX_TIMED_TOKENS;
    const s = new TimedNetworkSimulation(network(grow, component('b')));
    s.delay('1');
    s.back();
    const before = s.trace;
    expect(() => s.fire(ref())).toThrow(/capacity/);
    expect(s.trace).toEqual(before);
    expect(s.canForward).toBe(true);
  });
});
