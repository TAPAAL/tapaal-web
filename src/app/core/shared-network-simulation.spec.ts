// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SharedNetworkSimulation, type SharedAction } from './shared-network-simulation';
import {
  type SharedSource,
  type SharedRevision,
  validateSharedSource,
  captureSharedQueries,
} from './authored-shared';
import { type Result } from './authored-model';
import { emptyTiming } from './resolved-network';
import { MAX_TIMED_TOKENS } from './timed';
function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function source(): SharedSource {
  return {
    name: 'Shared',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [{ id: 'k', name: 'K', value: 5 }],
    shared: {
      places: [
        {
          id: 'pool',
          name: 'Pool',
          tokens: 2,
          timing: {
            invariant: { upper: { constantId: 'k' }, upperClosed: true },
            ages: ['1', '2'],
          },
        },
      ],
      transitions: [],
    },
    components: ['a', 'b', 'i'].map((id) => ({
      id,
      active: id !== 'i',
      net: {
        name: 'Shared',
        template: id.toUpperCase(),
        nodes: [
          { id: 'p', kind: 'place', sharedId: 'pool', x: 0, y: 0 },
          { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 100, y: 0 },
          { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 50, y: 0 },
        ],
        arcs: [
          { id: 'in', kind: 'normal', source: 'p', target: 't', weight: 1 },
          { id: 'out', kind: 'normal', source: 't', target: 'q', weight: 1 },
        ],
      },
      timing: emptyTiming(),
    })),
  };
}
function sim(s = source(), rng = () => 0): SharedNetworkSimulation {
  return new SharedNetworkSimulation(value(validateSharedSource(s)), rng);
}
const a = { componentId: 'a', elementId: 't' },
  b = { componentId: 'b', elementId: 't' };
function ages(s: SharedNetworkSimulation, component = 'a', place = 'p') {
  return s.markingFor(component)[place].map((t) => t.age);
}
function snapshot(s: SharedNetworkSimulation) {
  return JSON.stringify({
    trace: s.trace,
    cursor: s.cursor,
    time: s.time,
    marking: s.marking,
    enabled: s.enabled,
  });
}
function failed(s: SharedNetworkSimulation, action: () => void) {
  const before = snapshot(s);
  expect(action).toThrow();
  expect(snapshot(s)).toBe(before);
}
function mutate(s: SharedSource, fn: (draft: any) => void): SharedSource {
  const draft = structuredClone(s);
  fn(draft);
  return draft;
}

describe('opt-in shared place execution', () => {
  it('competes for one pool and projects consumption into inactive occurrences atomically', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.shared.places[0].tokens = 1;
        d.shared.places[0].timing.ages = ['2'];
      }),
    );
    expect(s.enabled).toEqual([a, b]);
    expect(s.totalTokens).toBe(1);
    s.fire(a);
    expect(s.enabled).toEqual([]);
    for (const c of ['a', 'b', 'i']) expect(ages(s, c)).toEqual([]);
    expect(ages(s, 'a', 'q')).toEqual(['0']);
    expect(s.totalTokens).toBe(1);
    expect(s.label(1)).toBe('Fire A.T · time 0');
  });
  it('delays each physical token once with an exact decimal clock and finite legal interval', () => {
    const s = sim();
    s.delay('0.1');
    s.delay('0.2');
    expect(s.time).toBe('0.3');
    expect(ages(s)).toEqual(['1.3', '2.3']);
    expect(s.delayInterval).toEqual({
      lower: '0',
      upper: '2.7',
      lowerClosed: true,
      upperClosed: true,
    });
    expect(ages(s, 'i')).toEqual(ages(s));
    expect(s.totalTokens).toBe(2);
    failed(s, () => s.delay('2.8'));
  });
  it('keeps dormant pools outside invariants and inactive LOCAL ages frozen', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.components[2].net.nodes[1].tokens = 1;
        d.components[2].timing.ages.q = ['2'];
        d.components[2].timing.invariants.q = { upper: '2', upperClosed: true };
        d.shared.places.push({
          id: 'dormant',
          name: 'Dormant',
          tokens: 1,
          timing: { invariant: { upper: '1', upperClosed: true }, ages: ['1'] },
        });
        d.components[2].net.nodes.push({
          id: 'd',
          kind: 'place',
          sharedId: 'dormant',
          x: 0,
          y: 10,
        });
      }),
    );
    s.delay('3');
    expect(s.pools[1].status).toBe('dormant');
    expect(s.pools[1].tokens[0].age).toBe('4');
    expect(ages(s, 'i', 'd')).toEqual(['4']);
    expect(ages(s, 'i', 'q')).toEqual(['2']);
    expect(s.totalTokens).toBe(4);
    s.back();
    expect(s.pools[1].tokens[0].age).toBe('1');
  });
  it('permits all-inactive timed delay, has no vacuous firing, resets on activation', () => {
    const initial = mutate(source(), (d) => {
      d.components.forEach((c: any) => (c.active = false));
    });
    const s = sim(initial);
    expect(s.step()).toBeNull();
    expect(s.enabled).toEqual([]);
    expect(s.delayInterval?.upper).toBeNull();
    s.delay('100');
    expect(ages(s)).toEqual(['101', '102']);
    failed(s, () => s.fire(a));
    const restarted = sim(
      mutate(initial, (d) => {
        d.components[0].active = true;
      }),
    );
    expect(ages(restarted)).toEqual(['1', '2']);
  });
  it('an empty invariant does not block delay; occupancy starts constraining delay', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.shared.places[0].tokens = 0;
        d.shared.places[0].timing.ages = [];
        d.shared.places[0].timing.invariant = { upper: '0', upperClosed: true };
        d.components[0].net.arcs = [
          { id: 'out', source: 't', target: 'p', kind: 'normal', weight: 1 },
        ];
      }),
    );
    s.delay('50');
    expect(s.time).toBe('50');
    s.fire(a);
    expect(s.delayInterval?.upper).toBe('0');
    failed(s, () => s.delay('1'));
  });
  it.each([true, false])(
    'only active enabled urgent transitions constrain time (active=%s)',
    (active) => {
      const s = sim(
        mutate(source(), (d) => {
          d.components[0].active = active;
          d.components[0].timing.urgent = ['t'];
        }),
      );
      if (active) {
        expect(s.delayInterval?.upper).toBe('0');
        failed(s, () => s.delay('1'));
        s.delay('0');
      } else {
        s.delay('1');
        expect(s.time).toBe('1');
      }
    },
  );
  it('captures symbolic resolution and saves/queries unchanged, with revision identity guard', () => {
    const original = source();
    const q = value(captureSharedQueries(original, ['<query/>']));
    const rev = value(validateSharedSource({ ...original, savedQueries: q }));
    const before = JSON.stringify(rev.source);
    const s = new SharedNetworkSimulation(rev, () => 0);
    s.assertRevision(rev.source);
    s.fire(a);
    s.delay('1');
    expect(JSON.stringify(rev.source)).toBe(before);
    expect(s.revision.savedQueries).toEqual(q);
    expect(s.revision.shared.places[0].timing?.invariant?.upper).toEqual({ constantId: 'k' });
    const changed = mutate(rev.source, (d) => {
      d.constants[0].value = 9;
    });
    expect(() => s.assertRevision(changed)).toThrow(/restart/);
    expect(sim(changed).delayInterval?.upper).toBe('7');
    expect(s.delayInterval?.upper).toBe('2');
    expect(Object.isFrozen(s.revision.shared.places)).toBe(true);
  });
  it('qualifies opaque prototype-like IDs injectively and keeps many-to-one provenance immutable', () => {
    const input = mutate(source(), (d) => {
      d.components[0].id = '__proto__';
      d.components[1].id = 'constructor';
      d.components[2].id = '["constructor","p"]';
      d.shared.places[0].id = '__proto__';
      d.components.forEach((c: any) => (c.net.nodes[0].sharedId = '__proto__'));
    });
    const s = sim(input),
      p = s.mapping.toPhysical('__proto__', 'p')!;
    expect(s.mapping.toPhysical('constructor', 'p')).toBe(p);
    expect(s.mapping.occurrences(p)).toHaveLength(3);
    expect(Object.isFrozen(s.mapping.occurrences(p))).toBe(true);
    expect(s.mapping.toPhysical('__proto__', 't')).not.toBe(
      s.mapping.toPhysical('constructor', 't'),
    );
    s.fire({ componentId: '__proto__', elementId: 't' });
    expect(ages(s, 'constructor')).toEqual(['2']);
  });
  it.each(['oldest', 'youngest', 'random', 'manual'] as const)(
    'records %s bindings and distinct equal-age token IDs',
    (mode) => {
      const s = sim(
        mutate(source(), (d) => {
          d.shared.places[0].timing.ages = ['2', '2'];
        }),
      );
      const input = s.eligibleInputs(a)[0];
      expect(input.placeName).toBe('Pool');
      expect(input.poolId).toBe('pool');
      expect(input.member).toEqual(a);
      expect(new Set(input.tokens.map((t) => t.id)).size).toBe(2);
      const selected = input.tokens[mode === 'manual' ? 1 : 0].id;
      s.fire(
        a,
        mode === 'manual'
          ? { mode, bindings: { in: [selected] } }
          : mode === 'random'
            ? { mode, random: () => 0 }
            : { mode },
      );
      const step = s.trace[1];
      expect(step.kind).toBe('fire');
      if (step.kind === 'fire') expect(step.bindings.in).toEqual([selected]);
      expect(ages(s)).toEqual(['2']);
    },
  );
  it.each([
    ['oldest', '2'],
    ['youngest', '1'],
    ['random', '1'],
  ] as const)('selects %s from existing engine eligibility', (mode, age) => {
    const s = sim(
      mutate(source(), (d) => {
        d.components[0].timing.transports = [{ inputArc: 'in', outputArc: 'out' }];
      }),
    );
    s.fire(a, mode === 'random' ? { mode, random: () => 0 } : { mode });
    expect(ages(s, 'a', 'q')).toEqual([age]);
  });
  it('rejects foreign/repeated/omitted/extra/ineligible manual bindings without losing future', () => {
    const s = sim();
    s.delay('0.5');
    s.back();
    const invalid: Record<string, string[]>[] = [
      {},
      { in: [] },
      { in: ['foreign'] },
      { in: ['foreign', 'foreign'] },
      { in: [s.eligibleInputs(a)[0].tokens[0].id], extra: [] },
    ];
    for (const bindings of invalid) failed(s, () => s.fire(a, { mode: 'manual', bindings }));
    failed(s, () => s.fire(a, { mode: 'random', random: () => 1 }));
    failed(s, () => s.fire({ componentId: 'i', elementId: 't' }));
    expect(s.canForward).toBe(true);
  });
  it('restores exact bindings and identities in navigation/replay, branches only after success', () => {
    const s = sim();
    s.delay('0.1');
    s.fire(a);
    s.delay('0.2');
    const trace = s.trace,
      actions = trace
        .slice(1)
        .map(
          ({ marking: _m, time: _t, pools: _p, totalTokens: _n, ...action }) =>
            action as SharedAction,
        );
    s.jump(1);
    failed(s, () => s.delay('99'));
    expect(s.canForward).toBe(true);
    s.replay(actions);
    expect(s.trace).toEqual(trace);
    s.back();
    s.forward();
    expect(s.trace).toEqual(trace);
    failed(s, () => s.replay([...actions, { kind: 'fire', transition: a, bindings: {} }]));
    s.jump(1);
    s.fire(b, { mode: 'youngest' });
    expect(s.trace).toHaveLength(3);
    expect(s.canForward).toBe(false);
    failed(s, () => s.jump(-1));
    s.reset();
    expect(s.cursor).toBe(0);
    expect(ages(s)).toEqual(['1', '2']);
  });
  it.each(['local-local', 'local-share', 'share-local', 'share-share'] as const)(
    'preserves weighted guarded transport ages/identity: %s',
    (route) => {
      const [from, to] = route.split('-');
      const s = sim(
        mutate(source(), (d) => {
          d.shared.places.push({
            id: 'other',
            name: 'Other',
            tokens: 0,
            timing: { invariant: { upper: '3', upperClosed: true }, ages: [] },
          });
          const c = d.components[0];
          c.net.nodes.push({ id: 'r', kind: 'place', sharedId: 'other', x: 150, y: 0 });
          if (from === 'local') {
            c.net.nodes[1].tokens = 2;
            c.timing.ages.q = ['1', '2'];
          }
          c.net.arcs[0].source = from === 'local' ? 'q' : 'p';
          c.net.arcs[1].target = to === 'local' ? 'q' : 'r';
          c.net.arcs.forEach((a: any) => (a.weight = 2));
          c.timing.transports = [{ inputArc: 'in', outputArc: 'out' }];
          c.timing.intervals.in = { lower: '1', upper: '3', lowerClosed: true, upperClosed: true };
        }),
      );
      const input = s.eligibleInputs(a)[0];
      const ids = input.tokens.map((t) => t.id);
      s.fire(a, { mode: 'manual', bindings: { in: ids } });
      const target = s.markingFor('a')[to === 'local' ? 'q' : 'r'];
      expect(target.map((t) => t.id)).toEqual(ids);
      expect(target.map((t) => t.age)).toEqual(['1', '2']);
    },
  );
  it('supports share-to-same-share transport, and normal self-loop resets age with fresh identity', () => {
    for (const transport of [false, true]) {
      const s = sim(
        mutate(source(), (d) => {
          const c = d.components[0];
          c.net.arcs[1].target = 'p';
          if (transport) c.timing.transports = [{ inputArc: 'in', outputArc: 'out' }];
        }),
      );
      const id = s.eligibleInputs(a)[0].tokens[0].id;
      s.fire(a, { mode: 'youngest' });
      const token = s.markingFor('a').p.find((t) => t.id === id);
      if (transport) expect(token?.age).toBe('1');
      else {
        expect(token).toBeUndefined();
        expect(ages(s)).toEqual(['2', '0']);
      }
    }
  });
  it('checks transport destination strict invariant against prestate eligible ages', () => {
    const s = sim(
      mutate(source(), (d) => {
        const c = d.components[0];
        c.timing.transports = [{ inputArc: 'in', outputArc: 'out' }];
        c.timing.invariants.q = { upper: '2', upperClosed: false };
      }),
    );
    expect(s.eligibleInputs(a)[0].tokens.map((t) => t.age)).toEqual(['1']);
    s.fire(a, { mode: 'oldest' });
    expect(ages(s, 'a', 'q')).toEqual(['1']);
  });
  it('inhibitor observes global prestate count and rejects restricted inhibitor intervals', () => {
    const input = mutate(source(), (d) => {
      d.components[1].net.arcs[0].kind = 'inhibitor';
      d.components[1].net.arcs[0].weight = 2;
    });
    const s = sim(input);
    expect(s.enabled).toEqual([a]);
    s.fire(a);
    expect(s.enabled).toEqual([a, b]);
    s.fire(b);
    expect(ages(s)).toEqual(['2']);
    expect(() =>
      sim(
        mutate(input, (d) => {
          d.components[1].timing.intervals.in = {
            lower: '1',
            upper: null,
            lowerClosed: true,
            upperClosed: false,
          };
        }),
      ),
    ).toThrow();
  });
  it('refuses malformed shared transitions and source duplicate endpoints even on forged revisions', () => {
    const bad = mutate(source(), (d) => {
      d.shared.transitions = [{ id: 'sync' }];
    });
    expect(() => new SharedNetworkSimulation({ source: bad } as SharedRevision)).toThrow(
      /Missing required source fields/,
    );
    expect(() =>
      sim(
        mutate(source(), (d) => {
          d.components[0].net.arcs.push({ ...d.components[0].net.arcs[0], id: 'duplicate' });
        }),
      ),
    ).toThrow();
  });
  it('validates initial dormant invariants and separates source capacity before token allocation', () => {
    expect(() =>
      sim(
        mutate(source(), (d) => {
          d.components.forEach((c: any) => (c.active = false));
          d.shared.places[0].timing.invariant = { upper: '1', upperClosed: true };
        }),
      ),
    ).toThrow(/invariant/);
    const huge = mutate(source(), (d) => {
      d.shared.places.push({
        id: 'huge',
        name: 'Huge',
        tokens: 1_000_000_000,
        timing: { invariant: null, ages: [] },
      });
    });
    const valid = value(validateSharedSource(huge));
    expect(() => new SharedNetworkSimulation(valid)).toThrow(/Reduce the initial marking/);
  });
  it('bounds dormant metadata plus outputs before allocation and preserves future on overflow', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.shared.places.push({
          id: 'd',
          name: 'Dormant',
          tokens: MAX_TIMED_TOKENS - 2,
          timing: { invariant: null, ages: [] },
        });
        d.components[0].net.arcs = [];
        d.components[0].net.arcs.push({
          id: 'out',
          source: 't',
          target: 'q',
          kind: 'normal',
          weight: 1,
        });
      }),
    );
    // Avoid materializing the 100k-token projected trace in this capacity-only assertion.
    expect(() => s.fire(a)).toThrow(/capacity/);
    expect(s.cursor).toBe(0);
    expect(s.totalTokens).toBe(MAX_TIMED_TOKENS);
  });
  it('untimed path preserves authored lens and disjoint local identities, has no delay', () => {
    const input = mutate(source(), (d) => {
      d.type.timed = false;
      d.shared.places.forEach((p: any) => delete p.timing);
      d.components.forEach((c: any) => delete c.timing);
    });
    const s = sim(input);
    expect(s.revision.type.timed).toBe(false);
    expect(s.delayInterval).toBeNull();
    failed(s, () => s.delay('0'));
    s.fire(a);
    expect(ages(s, 'a', 'q')).toEqual(['0']);
    expect(s.time).toBe('0');
    const local = mutate(input, (d) => {
      d.shared.places = [];
      d.components.forEach((c: any) => {
        c.net.nodes[0] = { id: 'p', kind: 'place', name: 'P', tokens: 2, x: 0, y: 0 };
      });
    });
    const disjoint = sim(local);
    disjoint.fire(a);
    expect(ages(disjoint, 'b')).toHaveLength(2);
    expect(disjoint.totalTokens).toBe(6);
  });
  it('projections and trace are deeply frozen, input objects remain untouched', () => {
    const input = source(),
      before = JSON.stringify(input);
    const s = sim(input);
    s.fire(a);
    s.delay('1');
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(s.marking.a.p)).toBe(true);
    expect(Object.isFrozen(s.trace[1].marking)).toBe(true);
    expect(Object.isFrozen(s.eligibleInputs(b))).toBe(true);
  });
  it('manual weighted inputs reject duplicate real identities and tokens from another input place', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.components[0].net.nodes[1].tokens = 1;
        d.components[0].net.arcs[0].weight = 2;
        d.components[0].net.arcs.push({
          id: 'second',
          source: 'q',
          target: 't',
          kind: 'normal',
          weight: 1,
        });
      }),
    );
    const inputs = s.eligibleInputs(a),
      pool = inputs.find((i) => i.arcId === 'in')!.tokens;
    const local = inputs.find((i) => i.arcId === 'second')!.tokens[0].id;
    failed(s, () =>
      s.fire(a, { mode: 'manual', bindings: { in: [pool[0].id, pool[0].id], second: [local] } }),
    );
    failed(s, () =>
      s.fire(a, { mode: 'manual', bindings: { in: [pool[0].id, local], second: [pool[1].id] } }),
    );
    s.fire(a, { mode: 'manual', bindings: { in: pool.map((t) => t.id), second: [local] } });
    expect(ages(s)).toEqual([]);
    expect(ages(s, 'a', 'q')).toEqual(['0']);
  });
  it('rejects a stale consumed ID after another component uses the pool', () => {
    const s = sim(),
      consumed = s.eligibleInputs(a)[0].tokens[0].id;
    s.fire(a, { mode: 'manual', bindings: { in: [consumed] } });
    failed(s, () => s.fire(b, { mode: 'manual', bindings: { in: [consumed] } }));
  });
  it('rejects a guard-ineligible token even when present in the same shared place', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.components[0].timing.intervals.in = {
          lower: '2',
          upper: null,
          lowerClosed: true,
          upperClosed: false,
        };
      }),
    );
    const young = s.markingFor('a').p[0].id;
    failed(s, () => s.fire(a, { mode: 'manual', bindings: { in: [young] } }));
    s.fire(a);
    expect(ages(s)).toEqual(['1']);
  });
  it('normal output into another shared pool is visible in every occurrence and starts at zero', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.shared.places.push({
          id: 'other',
          name: 'Other',
          tokens: 0,
          timing: { invariant: null, ages: [] },
        });
        for (const c of d.components)
          c.net.nodes.push({ id: 'r', kind: 'place', sharedId: 'other', x: 0, y: 0 });
        d.components[0].net.arcs[1].target = 'r';
        d.components[0].net.arcs[1].weight = 2;
      }),
    );
    s.fire(a);
    expect(s.totalTokens).toBe(3);
    for (const c of ['a', 'b', 'i']) expect(ages(s, c, 'r')).toEqual(['0', '0']);
  });
  it('nonshared timed locals remain disjoint with inactive initial ages unchanged', () => {
    const s = sim(
      mutate(source(), (d) => {
        d.shared.places = [];
        for (const c of d.components) {
          c.net.nodes[0] = { id: 'p', name: 'P', kind: 'place', tokens: 1, x: 0, y: 0 };
          c.timing.ages.p = ['2'];
        }
      }),
    );
    s.delay('1');
    s.fire(a);
    expect(ages(s, 'b')).toEqual(['3']);
    expect(ages(s, 'i')).toEqual(['2']);
  });
  it('default policy is Random and replay never invokes that source again', () => {
    let calls = 0;
    const s = sim(source(), () => {
      calls++;
      return 0.99;
    });
    s.fire(a);
    expect(calls).toBe(1);
    expect(ages(s)).toEqual(['1']);
    const action = s.trace[1];
    if (action.kind !== 'fire') throw new Error('expected fire');
    s.replay([action]);
    expect(calls).toBe(1);
    expect(ages(s)).toEqual(['1']);
  });
  it('dormant decimal overflow fails without moving history or clock', () => {
    const huge = '9'.repeat(256);
    const s = sim(
      mutate(source(), (d) => {
        d.components.forEach((c: any) => (c.active = false));
        d.shared.places[0].timing.invariant = null;
        d.shared.places[0].timing.ages = [huge];
      }),
    );
    failed(s, () => s.delay('1'));
    expect(s.time).toBe('0');
  });
  it('resolves symbolic weights and guard bounds from the captured source before compiling', () => {
    const input = mutate(source(), (d) => {
      d.constants[0].value = 2;
      d.components[0].net.arcs.forEach((arc: any) => (arc.weight = { constantId: 'k' }));
      d.components[0].timing.intervals.in = {
        lower: '1',
        upper: { constantId: 'k' },
        lowerClosed: true,
        upperClosed: true,
      };
      d.components[0].timing.transports = [{ inputArc: 'in', outputArc: 'out' }];
    });
    const s = sim(input);
    expect(s.eligibleInputs(a)[0].weight).toBe(2);
    expect(s.eligibleInputs(a)[0].tokens.map((t) => t.age)).toEqual(['1', '2']);
    s.fire(a, { mode: 'oldest' });
    expect(ages(s, 'a', 'q')).toEqual(['2', '1']);
    expect(ages(s)).toEqual([]);
    expect(s.revision.components[0].net.arcs[0].weight).toEqual({ constantId: 'k' });
    expect(ages(sim(input))).toEqual(['1', '2']);
  });
  it('records zero-effect active source firings while inactive source transitions never become events', () => {
    const input = mutate(source(), (d) => {
      for (const c of d.components) c.net.arcs = [];
    });
    const s = sim(input),
      marking = s.marking;
    s.fire(a);
    expect(s.cursor).toBe(1);
    expect(s.marking).toEqual(marking);
    const inactive = sim(
      mutate(input, (d) => {
        for (const c of d.components) c.active = false;
      }),
    );
    expect(inactive.enabled).toEqual([]);
    expect(inactive.step()).toBeNull();
    expect(inactive.cursor).toBe(0);
  });
});
