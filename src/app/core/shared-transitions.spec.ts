// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  SharedSource,
  validateSharedSource,
  openSharedDocument,
  transactShared,
  captureSharedQueries,
} from './authored-shared';
import { SharedNetworkSimulation } from './shared-network-simulation';
import {
  parseSharedJson,
  serializeSharedJson,
  parseSharedTapn,
  serializeSharedTapn,
} from './shared-files';
import { Result } from './authored-model';
import { emptyTiming } from './resolved-network';
function value<T>(r: Result<T>): T {
  if (!r.ok) throw Error(r.issues.map((i) => i.message).join(' '));
  return r.value;
}
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
function source(timed = true): Mutable<SharedSource> {
  return {
    name: 'Sync',
    type: { timed, colored: false, game: false, stochastic: false },
    constants: [],
    shared: { places: [], transitions: [{ id: 's', name: 'Sync', urgent: false }] },
    components: ['a', 'b', 'inactive'].map((id) => ({
      id,
      active: id !== 'inactive',
      net: {
        name: 'Sync',
        template: id,
        nodes: [
          { id: 'p', kind: 'place', name: 'P', tokens: 2, x: 0, y: 0 },
          { id: 't', kind: 'transition', sharedId: 's', x: 100, y: 0, angle: 90 },
          { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 200, y: 0 },
        ],
        arcs: [
          { id: 'in', kind: 'normal', source: 'p', target: 't', weight: 1 },
          { id: 'out', kind: 'normal', source: 't', target: 'q', weight: 1 },
        ],
      },
      ...(timed ? { timing: { ...emptyTiming(), ages: { p: ['1', '2'] } } } : {}),
    })),
  };
}
const ref = (componentId = 'a') => ({ componentId, elementId: 't' });
const sim = (s = source()) => new SharedNetworkSimulation(value(validateSharedSource(s)));
describe('synchronized shared transitions', () => {
  it('transfers source urgency and requires explicit adoption when urgency differs', () => {
    const s = source();
    s.shared.transitions = [];
    s.components = s.components.map((c, i) => ({
      ...c,
      net: {
        ...c.net,
        nodes: c.net.nodes.map((n) =>
          n.id === 't'
            ? { id: 't', kind: 'transition', name: 'LocalT', tokens: 0, x: 100, y: 0, angle: 90 }
            : n,
        ),
      },
      timing: { ...c.timing!, urgent: i === 0 ? ['t'] : [] },
    }));
    let d = value(openSharedDocument(s));
    d = value(
      transactShared(d, d.network, {
        kind: 'makeShared',
        componentId: 'a',
        elementId: 't',
        poolId: 'new',
        name: 'Together',
      }),
    );
    expect(d.network.shared.transitions).toEqual([{ id: 'new', name: 'Together', urgent: true }]);
    expect(d.network.components[0].timing?.urgent).toEqual([]);
    const join = {
      kind: 'usePool' as const,
      componentId: 'b',
      elementId: 't',
      poolId: 'new',
      acceptPoolValues: false,
    };
    expect(transactShared(d, d.network, join).ok).toBe(false);
    d = value(transactShared(d, d.network, { ...join, acceptPoolValues: true }));
    expect(d.network.components[1].net.nodes[1]).toMatchObject({ sharedId: 'new', angle: 90 });
    expect(d.past).toHaveLength(2);
  });
  it('fuses active members, accepts either click, highlights all, records once and freezes inactive locals', () => {
    const s = sim();
    expect(s.enabled).toEqual([ref()]);
    expect(s.enabledFor('b')).toEqual(['t']);
    s.fire(ref('b'), { mode: 'oldest' });
    expect(s.trace).toHaveLength(2);
    for (const c of ['a', 'b']) {
      expect(s.markingFor(c).p.map((t) => t.age)).toEqual(['1']);
      expect(s.markingFor(c).q).toHaveLength(1);
    }
    expect(s.markingFor('inactive').p).toHaveLength(2);
    expect(s.label(1)).toContain('Sync [a, b]');
    expect(s.mapping.occurrences(s.mapping.toPhysical('b', 't')!)).toHaveLength(3);
    s.back();
    s.forward();
    expect(s.markingFor('b').q).toHaveLength(1);
  });
  it('requires every active input and checks whole-event urgency', () => {
    const s = source();
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    s.components[1].net.nodes = [
      ...s.components[1].net.nodes.filter((n) => n.id !== 'p'),
      { id: 'p', kind: 'place', name: 'P', tokens: 0, x: 0, y: 0 },
    ];
    s.components[1].timing = { ...emptyTiming() };
    const run = sim(s);
    expect(run.enabled).toEqual([]);
    run.delay('1');
    expect(() => run.fire(ref())).toThrow();
    const enabled = source();
    enabled.shared.transitions = s.shared.transitions;
    expect(() => sim(enabled).delay('1')).toThrow(/urgent/i);
  });
  it('all inactive creates no event or urgency blocker', () => {
    const s = source();
    s.components = s.components.map((c) => ({ ...c, active: false }));
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    const r = sim(s);
    expect(r.step()).toBeNull();
    r.delay('2');
  });
  it.each(['oldest', 'youngest', 'random'] as const)(
    'records qualified bindings and replay never repicks: %s',
    (mode) => {
      const r = sim();
      r.fire(ref(), mode === 'random' ? { mode, random: () => 0 } : { mode });
      const trace = r.trace;
      const a = trace[1];
      expect(a.kind).toBe('fire');
      if (a.kind !== 'fire') throw Error();
      expect(Object.keys(a.bindings)).toHaveLength(2);
      r.replay([a]);
      expect(r.trace).toEqual(trace);
    },
  );
  it('manual inputs are qualified by component despite repeated local arc IDs', () => {
    const r = sim(),
      inputs = r.eligibleInputs(ref('b'));
    expect(inputs.map((i) => i.member.componentId)).toEqual(['a', 'b']);
    expect(new Set(inputs.map((i) => i.arcId)).size).toBe(2);
    r.fire(ref('b'), {
      mode: 'manual',
      bindings: Object.fromEntries(inputs.map((i) => [i.arcId, [i.tokens[0].id]])),
    });
    expect(r.markingFor('a').p).toHaveLength(1);
  });
  it('RNG reentrancy cannot change history, and failure is atomic', () => {
    const r = sim(),
      before = r.trace;
    r.back();
    expect(() =>
      r.fire(ref(), {
        mode: 'random',
        random: () => {
          r.reset();
          return 0;
        },
      }),
    ).toThrow();
    expect(r.trace).toEqual(before);
  });
  it('supports untimed atomic synchronization without delay', () => {
    const r = sim(source(false));
    r.fire(ref('b'));
    expect(r.markingFor('a').q).toHaveLength(1);
    expect(() => r.delay('1')).toThrow();
  });
  it('rejects wrong kind, duplicate membership, dangling refs and global local-name collisions', () => {
    for (const bad of ['kind', 'duplicate', 'dangling', 'name']) {
      const s = source();
      if (bad === 'kind')
        s.shared.places = [
          { id: 's', name: 'Other', tokens: 0, timing: { invariant: null, ages: [] } },
        ];
      if (bad === 'duplicate')
        s.components[0].net.nodes = [
          ...s.components[0].net.nodes,
          { id: 'other', kind: 'transition', sharedId: 's', x: 0, y: 1 },
        ];
      if (bad === 'dangling') s.shared.transitions = [];
      if (bad === 'name') s.shared.transitions = [{ id: 's', name: 'P', urgent: false }];
      expect(validateSharedSource(s).ok).toBe(false);
    }
  });
  it.each(['normal', 'inhibitor'] as const)(
    'rejects shared-place incidence even in inactive members: %s',
    (kind) => {
      const s = source();
      s.shared.places = [
        { id: 'p', name: 'GlobalP', tokens: 2, timing: { invariant: null, ages: [] } },
      ];
      s.components[2].net.nodes = s.components[2].net.nodes.map((n) =>
        n.id === 'p' ? { id: 'p', kind: 'place', sharedId: 'p', x: 0, y: 0 } : n,
      );
      s.components[2].net.arcs = s.components[2].net.arcs.map((a) =>
        a.id === 'in' ? { ...a, kind } : a,
      );
      expect(validateSharedSource(s).ok).toBe(false);
    },
  );
  it('roundtrips exact JSON IDs and native membership, urgency, geometry and query protection', () => {
    let s: SharedSource = source();
    s = {
      ...s,
      savedQueries: value(captureSharedQueries(s, ['<query name="q" query="EF Sync"/>'])),
    };
    expect(parseSharedJson(serializeSharedJson(s)).network).toEqual(s);
    const text = serializeSharedTapn(s),
      read = parseSharedTapn(text).network;
    expect(read.shared.transitions[0].name).toBe('Sync');
    expect(read.components[0].net.nodes[1]).toMatchObject({
      kind: 'transition',
      angle: 90,
      sharedId: read.shared.transitions[0].id,
    });
    expect(read.savedQueries?.protectedSharedTransitions).toContainEqual({
      id: read.shared.transitions[0].id,
      name: 'Sync',
    });
    expect(() =>
      parseSharedTapn(
        text.replace(
          '<shared-transition name="Sync" urgent="false"',
          '<shared-transition name="Sync" urgent="true"',
        ),
      ),
    ).toThrow(/disagrees/);
  });
  it('queries protect unused global names and membership; removal is explicit', () => {
    let s: SharedSource = source();
    s = {
      ...s,
      savedQueries: value(captureSharedQueries(s, ['<query name="q" query="EF Sync"/>'])),
    };
    let d = value(openSharedDocument(s));
    expect(
      transactShared(d, d.network, {
        kind: 'editTransitionPool',
        pool: { id: 's', name: 'Renamed', urgent: false },
      }).ok,
    ).toBe(false);
    d = value(transactShared(d, d.network, { kind: 'removeQueries' }));
    d = value(
      transactShared(d, d.network, {
        kind: 'detach',
        componentId: 'a',
        elementId: 't',
        name: 'Local',
      }),
    );
    expect(d.network.components[0].net.nodes[1]).toMatchObject({
      name: 'Local',
      kind: 'transition',
      angle: 90,
    });
  });
});

describe('synchronized edge cases', () => {
  it('transport preserves age and identity across both members', () => {
    const s = source();
    s.components = s.components.map((c) => ({
      ...c,
      timing: { ...c.timing!, transports: [{ inputArc: 'in', outputArc: 'out' }] },
    }));
    const r = sim(s),
      inputs = r.eligibleInputs(ref());
    r.fire(ref(), { mode: 'oldest' });
    for (const c of ['a', 'b']) {
      const t = r.markingFor(c).q[0];
      expect(t.age).toBe('2');
      expect(
        inputs.find((i) => i.member.componentId === c)!.tokens.some((x) => x.id === t.id),
      ).toBe(true);
    }
  });
  it('records a zero-effect source event once', () => {
    const s = source();
    s.components = s.components.map((c) => ({ ...c, net: { ...c.net, arcs: [] } }));
    const r = sim(s);
    r.fire(ref('b'));
    expect(r.trace).toHaveLength(2);
    expect(r.marking).toEqual(r.trace[0].marking);
  });
  it('pool edits validate symbolic urgent inputs of inactive members', () => {
    const s = source();
    s.constants = [{ id: 'k', name: 'K', value: 0 }];
    s.components[2].timing = {
      ...s.components[2].timing!,
      intervals: {
        in: { lower: { constantId: 'k' }, upper: null, lowerClosed: true, upperClosed: false },
      },
    };
    const d = value(openSharedDocument(s));
    const changed = transactShared(d, d.network, {
      kind: 'editTransitionPool',
      pool: { id: 's', name: 'Sync', urgent: true },
    });
    expect(changed.ok).toBe(false);
  });
  it('supports local geometry, copy rejoins, detach urgency and one source history', () => {
    let d = value(openSharedDocument(source()));
    d = value(
      transactShared(d, d.network, {
        kind: 'copyComponent',
        componentId: 'a',
        id: 'copy',
        template: 'Copy',
      }),
    );
    expect(d.network.components[3].net.nodes[1]).toMatchObject({ sharedId: 's' });
    d = value(
      transactShared(d, d.network, {
        kind: 'editTransitionPool',
        pool: { id: 's', name: 'Renamed', urgent: true },
      }),
    );
    d = value(
      transactShared(d, d.network, {
        kind: 'detach',
        componentId: 'a',
        elementId: 't',
        name: 'Private',
      }),
    );
    expect(d.network.components[0].timing?.urgent).toEqual(['t']);
    expect(d.past).toHaveLength(3);
  });
});

it('never mistakes an opaque local arc ID for another member physical binding key', () => {
  const s = source(),
    id = JSON.stringify(['arc', 'b', 'in']);
  s.components[0].net.nodes = s.components[0].net.nodes.map((n) =>
    n.id === 't' ? { id: 't', kind: 'transition', name: 'LocalT', tokens: 0, x: 100, y: 0 } : n,
  );
  s.components[0].net.arcs = s.components[0].net.arcs.map((a) =>
    a.id === 'in' ? { ...a, id } : a,
  );
  const r = sim(s),
    input = r.eligibleInputs(ref())[0];
  expect(input.arcId).toBe(id);
  r.fire(ref(), { mode: 'manual', bindings: { [id]: [input.tokens[0].id] } });
  expect(r.markingFor('a').q).toHaveLength(1);
  expect(r.markingFor('b').q).toHaveLength(0);
});
