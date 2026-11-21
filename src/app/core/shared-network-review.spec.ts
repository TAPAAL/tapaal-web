// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SharedNetworkSimulation } from './shared-network-simulation';
import { validateSharedSource, type SharedSource, type SharedRevision } from './authored-shared';
import { serializeSharedJson, parseSharedJson } from './shared-files';
import { MAX_TIMED_TOKENS } from './timed';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
function source(): Mutable<SharedSource> {
  return {
    name: 'Review',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [],
    shared: {
      places: [
        { id: 'pool', name: 'Pool', tokens: 3, timing: { invariant: null, ages: ['1', '2', '3'] } },
      ],
      transitions: [],
    },
    components: ['a', 'b', 'inactive'].map((id) => ({
      id,
      active: id !== 'inactive',
      net: {
        name: 'Review',
        template: id,
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
      timing: { ages: {}, invariants: {}, intervals: {}, transports: [], urgent: [] },
    })),
  };
}
const ref = { componentId: 'a', elementId: 't' };
function revision(input: SharedSource) {
  const r = validateSharedSource(input);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function sim(input = source(), random = () => 0) {
  return new SharedNetworkSimulation(revision(input), random);
}
function snapshot(s: SharedNetworkSimulation) {
  return {
    trace: s.trace,
    cursor: s.cursor,
    marking: s.marking,
    pools: s.pools,
    enabled: s.enabled,
    time: s.time,
  };
}
function atomicFailure(s: SharedNetworkSimulation, operation: () => void) {
  const before = snapshot(s);
  expect(operation).toThrow();
  expect(snapshot(s)).toEqual(before);
}

describe('independent shared execution review', () => {
  it.each([NaN, Infinity, -Infinity, -0.01, 1, 2])(
    'rejects RNG %s after a partial weighted choice without losing future',
    (bad) => {
      const input = source();
      input.components[0].net.arcs[0].weight = 2;
      let calls = 0;
      const s = sim(input, () => (++calls === 1 ? 0 : bad));
      s.delay('0.1');
      s.back();
      atomicFailure(s, () => s.fire(ref));
      expect(calls).toBe(2);
      expect(s.canForward).toBe(true);
    },
  );

  it('does not publish partial choices when RNG throws', () => {
    const s = sim(source(), () => {
      throw new Error('external RNG failure');
    });
    atomicFailure(s, () => s.fire(ref));
  });

  it.each(['-1', 'NaN', 'Infinity', '1e2', '', '01', '.1'])(
    'rejects malformed delay %s atomically',
    (amount) => {
      const s = sim();
      s.delay('0.2');
      s.back();
      atomicFailure(s, () => s.delay(amount));
    },
  );

  it.each([true, false])('rejects decimal overflow atomically with active=%s', (active) => {
    const input = source();
    input.shared.places[0].timing!.ages = ['9'.repeat(256)];
    input.components.forEach((c) => {
      c.active = active;
    });
    const s = sim(input);
    atomicFailure(s, () => s.delay('1'));
  });

  it('counts frozen locals and dormant tokens before consulting RNG for output capacity', () => {
    const input = source();
    const local = input.components[2].net.nodes[1];
    if (!('tokens' in local)) throw new Error('local expected');
    local.tokens = MAX_TIMED_TOKENS - 4;
    input.shared.places.push({
      id: 'unused',
      name: 'Unused',
      tokens: 1,
      timing: { invariant: null, ages: [] },
    });
    input.components[0].net.arcs[1].weight = 2;
    let calls = 0;
    const s = sim(input, () => {
      calls++;
      return 0;
    });
    expect(s.totalTokens).toBe(MAX_TIMED_TOKENS);
    expect(() => s.fire(ref)).toThrow(/capacity/);
    expect(calls).toBe(0);
    expect(s.cursor).toBe(0);
  });

  it('accepts billion-token source for saving but rejects execution before materialization', () => {
    const input = source();
    input.shared.places[0].tokens = 1_000_000_000;
    const r = revision(input);
    expect(parseSharedJson(serializeSharedJson(r.source)).network.shared.places[0].tokens).toBe(
      1_000_000_000,
    );
    expect(() => new SharedNetworkSimulation(r)).toThrow(/Reduce the initial marking/);
  });

  it('separates source arc limits from explicit-token engine limits', () => {
    const input = source();
    input.components[0].net.arcs[1].weight = MAX_TIMED_TOKENS + 1;
    const r = revision(input);
    expect(() => new SharedNetworkSimulation(r)).toThrow(/Arc weight exceeds/);
  });

  it('retains physical identities across projections, produces unique outputs over repeated firings, and replays without RNG', () => {
    const input = source();
    input.components[0].net.arcs[1].target = 'p';
    let calls = 0;
    const s = sim(input, () => {
      calls++;
      return 0.9;
    });
    const seen = new Set(s.pools[0].tokens.map((t) => t.id));
    for (let i = 0; i < 12; i++) {
      const old = new Set(s.pools[0].tokens.map((t) => t.id));
      s.fire(ref);
      const fresh = s.pools[0].tokens.filter((t) => !old.has(t.id));
      expect(fresh).toHaveLength(1);
      expect(seen.has(fresh[0].id)).toBe(false);
      expect(fresh[0].age).toBe('0');
      seen.add(fresh[0].id);
      expect(s.totalTokens).toBe(3);
      expect(s.marking.inactive.p.map((t) => t.id)).toEqual(s.marking.a.p.map((t) => t.id));
    }
    const trace = s.trace;
    const actions = trace.filter((a) => a.kind !== 'initial');
    s.jump(2);
    s.forward();
    s.back();
    s.replay(actions);
    expect(s.trace).toEqual(trace);
    expect(calls).toBe(12);
    atomicFailure(s, () => s.replay([...actions, { kind: 'delay', amount: '-1' }]));
    for (const index of [-1, 0.5, NaN, Infinity, 999]) atomicFailure(s, () => s.jump(index));
  });

  it('preserves authored save data and rejects new activation/constant revisions', () => {
    const input = source();
    input.constants = [{ id: 'k', name: 'K', value: 4 }];
    input.shared.places[0].timing!.invariant = { upper: { constantId: 'k' }, upperClosed: true };
    const r = revision(input),
      s = new SharedNetworkSimulation(r);
    const saved = serializeSharedJson(r.source);
    s.fire(ref, { mode: 'oldest' });
    s.delay('0.1');
    expect(serializeSharedJson(s.revision)).toBe(saved);
    const edited = structuredClone(input);
    edited.constants[0].value = 5;
    edited.components[2].active = true;
    expect(() => s.assertRevision(revision(edited).source)).toThrow(/restart/);
    s.assertRevision(r.source);
    expect(sim(input).pools[0].tokens.map((t) => t.age)).toEqual(['1', '2', '3']);
    expect(Object.isFrozen(s.mapping.occurrences(s.mapping.toPhysical('a', 'p')!)[0])).toBe(true);
    expect(Object.isFrozen(s.pools[0].tokens[0])).toBe(true);
    expect(Object.isFrozen(s.revision.constants[0])).toBe(true);
  });

  it('revalidates forged revision source and refuses malformed shared transitions', () => {
    const input = source();
    input.shared.transitions.push({ id: 'unsupported' } as never);
    expect(
      () => new SharedNetworkSimulation({ source: input } as unknown as SharedRevision),
    ).toThrow(/Missing required source fields/);
  });

  it.each(['local-local', 'local-shared', 'shared-local', 'shared-shared', 'shared-self'])(
    'weighted transport %s preserves identity and rechecks destination eligibility after delay',
    (route) => {
      const input = source();
      input.shared.places.push({
        id: 'dest',
        name: 'Destination',
        tokens: 0,
        timing: { invariant: { upper: '3', upperClosed: false }, ages: [] },
      });
      const c = input.components[0];
      c.net.nodes.push({ id: 'r', kind: 'place', sharedId: 'dest', x: 150, y: 0 });
      c.net.nodes.push({ id: 'z', kind: 'place', name: 'Z', tokens: 0, x: 200, y: 0 });
      const from = route.startsWith('local') ? 'q' : 'p';
      const to = route.endsWith('local') ? 'z' : route.endsWith('self') ? 'p' : 'r';
      if (from === 'q') {
        const q = c.net.nodes[1];
        if (!('tokens' in q)) throw new Error('local expected');
        q.tokens = 3;
        c.timing!.ages.q = ['1', '2', '3'];
      }
      // Self-loop destination invariant also bounds its initial marking.
      if (to === 'p') input.shared.places[0].timing!.ages = ['1', '2', '2.5'];
      if (to === 'p') input.shared.places[0].timing!.invariant = { upper: '3', upperClosed: false };
      c.timing!.invariants.z = { upper: '3', upperClosed: false };
      c.net.arcs[0].source = from;
      c.net.arcs[1].target = to;
      c.net.arcs.forEach((a) => {
        a.weight = 2;
      });
      c.timing!.transports = [{ inputArc: 'in', outputArc: 'out' }];
      c.timing!.intervals.in = { lower: '1', upper: '2', lowerClosed: true, upperClosed: true };
      const s = sim(input);
      const ids = s.eligibleInputs(ref)[0].tokens.map((t) => t.id);
      expect(ids).toHaveLength(2);
      expect(s.eligibleInputs(ref)[0].destination).toBe(to);
      s.delay('0.1');
      atomicFailure(s, () => s.fire(ref, { mode: 'manual', bindings: { in: ids } }));
      s.back();
      s.fire(ref, { mode: 'manual', bindings: { in: ids } });
      const moved = s.markingFor('a')[to].filter((t) => ids.includes(t.id));
      expect(moved.map((t) => t.id)).toEqual(ids);
      expect(moved.map((t) => t.age)).toEqual(['1', '2']);
      expect(s.canForward).toBe(false);
    },
  );

  // Deliberately unskipped expected-contract proofs. These expose review findings.
  it.each(['fire', 'step', 'delay', 'replay', 'back', 'forward', 'jump', 'reset'] as const)(
    'rejects reentrant %s, preserves future, and releases the guard after failure',
    (operation) => {
      let s: SharedNetworkSimulation;
      let nested = true;
      s = sim(source(), () => {
        if (!nested) return 0;
        switch (operation) {
          case 'fire':
            s.fire(ref);
            break;
          case 'step':
            s.step();
            break;
          case 'delay':
            s.delay('0.25');
            break;
          case 'replay':
            s.replay([]);
            break;
          case 'back':
            s.back();
            break;
          case 'forward':
            s.forward();
            break;
          case 'jump':
            s.jump(0);
            break;
          case 'reset':
            s.reset();
            break;
        }
        return 0;
      });
      s.delay('0.1');
      s.back();
      atomicFailure(s, () => s.fire(ref));
      expect(s.canForward).toBe(true);
      nested = false;
      s.fire(ref);
      expect(s.marking.a.q).toHaveLength(1);
    },
  );

  it('step returns the captured transition when RNG mutates its caller reference', () => {
    const mutableRef = { ...ref };
    const s = sim(source(), () => {
      mutableRef.componentId = 'b';
      mutableRef.elementId = 'q';
      return 0;
    });
    expect(s.step(mutableRef)).toEqual(ref);
    expect(s.trace[1]).toMatchObject({ kind: 'fire', transition: ref });
    expect(s.marking.a.q).toHaveLength(1);
    expect(s.marking.b.q).toHaveLength(0);
  });

  it('R1: a reentrant RNG cannot publish a delay before returning an invalid value', () => {
    let s: SharedNetworkSimulation;
    s = sim(source(), () => {
      s.delay('0.25');
      return NaN;
    });
    s.delay('0.1');
    s.back();
    atomicFailure(s, () => s.fire(ref));
  });

  it('R1: a reentrant RNG cannot append a fire from an older clock snapshot', () => {
    let s: SharedNetworkSimulation;
    s = sim(source(), () => {
      s.delay('0.25');
      return 0;
    });
    // Rejecting reentrancy is acceptable; permitting it must preserve a valid trace.
    try {
      s.fire(ref);
    } catch {
      /* A guarded session may reject the callback. */
    }
    const times = s.trace.map((state) => Number(state.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('R2: captures the firing reference before external RNG can mutate the caller object', () => {
    const mutableRef = { ...ref };
    const s = sim(source(), () => {
      mutableRef.elementId = 'q';
      return 0;
    });
    s.fire(mutableRef);
    expect(s.marking.a.q).toHaveLength(1);
    const action = s.trace[1];
    if (action.kind !== 'fire') throw new Error('fire expected');
    expect(action.transition).toEqual(ref);
    const committed = s.marking;
    s.replay([action]);
    expect(s.marking).toEqual(committed);
  });
});
