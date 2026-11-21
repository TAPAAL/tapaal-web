import { describe, expect, it } from 'vitest';
import {
  addAges,
  eligibleTimedInputs,
  compareAges,
  delayTimed,
  fireTimed,
  initialTimedMarking,
  isTimedEnabled,
  MAX_TIMED_TOKENS,
  timedDelayInterval,
  TimedSimulation,
  UNRESTRICTED,
  validateInterval,
  validateInvariant,
  validateTimedModel,
  type TimedModel,
} from './timed';

function fixture(ages = ['0']): TimedModel {
  return {
    net: {
      name: 'Timed',
      template: 'Main',
      nodes: [
        { id: 'p', name: 'P', kind: 'place', x: 0, y: 0, tokens: ages.length },
        { id: 'q', name: 'Q', kind: 'place', x: 100, y: 0, tokens: 0 },
        { id: 't', name: 'T', kind: 'transition', x: 50, y: 0, tokens: 0 },
      ],
      arcs: [
        { id: 'in', source: 'p', target: 't', kind: 'normal', weight: 1 },
        { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 1 },
      ],
    },
    type: { timed: true, colored: false, game: false, stochastic: false },
    componentCount: 1,
    sharedElementIds: [],
    intervals: {},
    invariants: {},
    urgent: [],
    transports: [],
    initial: ages.map((age, i) => ({ id: `token${i}`, place: 'p', age })),
  };
}

describe('exact native-derived timed semantics', () => {
  it('adds decimal ages exactly at strict boundaries', () => {
    expect(addAges('0.1', '0.2')).toBe('0.3');
    expect(compareAges('0.300', '0.3')).toBe(0);
  });
  it('distinguishes open and closed input endpoints after two delays', () => {
    const m = fixture();
    m.intervals['in'] = { lower: '0.3', upper: '1', lowerClosed: false, upperClosed: false };
    const mark = delayTimed(m, delayTimed(m, initialTimedMarking(m), '0.1'), '0.2');
    expect(mark.tokens[0].age).toBe('0.3');
    expect(isTimedEnabled(m, mark, 't')).toBe(false);
    m.intervals['in'].lowerClosed = true;
    expect(isTimedEnabled(m, mark, 't')).toBe(true);
    const one = delayTimed(m, mark, '0.7');
    expect(isTimedEnabled(m, one, 't')).toBe(false);
    m.intervals['in'].upperClosed = true;
    expect(isTimedEnabled(m, one, 't')).toBe(true);
  });
  it('validates singleton, infinity, empty and reversed intervals and invariants', () => {
    expect(() =>
      validateInterval({ lower: '1', upper: '1', lowerClosed: true, upperClosed: true }),
    ).not.toThrow();
    expect(() => validateInterval(UNRESTRICTED)).not.toThrow();
    for (const interval of [
      { lower: '1', upper: '1', lowerClosed: false, upperClosed: true },
      { lower: '2', upper: '1', lowerClosed: true, upperClosed: true },
      { ...UNRESTRICTED, upperClosed: true },
    ])
      expect(() => validateInterval(interval)).toThrow();
    expect(() => validateInvariant({ upper: '0', upperClosed: false })).toThrow();
    expect(() => validateInvariant({ upper: null, upperClosed: true })).toThrow();
    expect(() => validateInvariant({ upper: '0', upperClosed: true })).not.toThrow();
  });
  it('blocks positive delay only when an urgent transition is enabled', () => {
    const m = fixture();
    m.urgent = ['t'];
    const initial = initialTimedMarking(m);
    expect(() => delayTimed(m, initial, '0.01')).toThrow(/urgent/);
    expect(delayTimed(m, initial, '0')).toEqual(initial);
    expect(timedDelayInterval(m, initial).upper).toBe('0');
    const fired = fireTimed(m, initial, 't').marking;
    expect(delayTimed(m, fired, '20').tokens[0].age).toBe('20');
    m.intervals['in'] = { ...UNRESTRICTED, lower: '1' };
    expect(() => validateTimedModel(m)).toThrow(/Urgent/);
  });
  it('checks invariants for occupied places only, with exact expiry', () => {
    const m = fixture();
    m.invariants['p'] = { upper: '0.3', upperClosed: false };
    m.invariants['q'] = { upper: '0', upperClosed: true };
    const initial = initialTimedMarking(m);
    expect(timedDelayInterval(m, initial)).toEqual({
      lower: '0',
      upper: '0.3',
      lowerClosed: true,
      upperClosed: false,
    });
    const first = delayTimed(m, initial, '0.1');
    expect(() => delayTimed(m, first, '0.2')).toThrow(/invariant/);
    m.invariants['p'].upperClosed = true;
    expect(delayTimed(m, first, '0.2').tokens[0].age).toBe('0.3');
    const empty = { tokens: [], nextId: '0' };
    expect(timedDelayInterval(m, empty).upper).toBeNull();
    expect(delayTimed(m, empty, '100')).toEqual(empty);
  });
  it('selects weighted eligible oldest/youngest tokens and resets ordinary outputs', () => {
    const m = fixture(['1', '5', '3', '0']);
    m.net.arcs[0].weight = 2;
    m.intervals['in'] = { lower: '1', upper: '5', lowerClosed: true, upperClosed: false };
    const mark = initialTimedMarking(m);
    expect(fireTimed(m, mark, 't').bindings['in']).toEqual(['token2', 'token0']);
    expect(fireTimed(m, mark, 't', { mode: 'youngest' }).bindings['in']).toEqual([
      'token0',
      'token2',
    ]);
    const result = fireTimed(m, mark, 't').marking;
    expect(result.tokens.filter((t) => t.place === 'q')).toEqual([
      { id: '@timed:0', place: 'q', age: '0' },
    ]);
    expect(mark.tokens.map((t) => t.age)).toEqual(['1', '5', '3', '0']);
    m.net.arcs[0].weight = 3;
    expect(isTimedEnabled(m, mark, 't')).toBe(false);
  });
  it('requires all independent inputs before consuming anything', () => {
    const m = fixture(['2']);
    m.net.arcs.push({ id: 'second', source: 'q', target: 't', kind: 'normal', weight: 1 });
    const mark = initialTimedMarking(m),
      before = structuredClone(mark);
    expect(isTimedEnabled(m, mark, 't')).toBe(false);
    expect(() => fireTimed(m, mark, 't')).toThrow(/not enabled/);
    expect(mark).toEqual(before);
    const enabled = { ...mark, tokens: [...mark.tokens, { id: 'other', place: 'q', age: '3' }] };
    const result = fireTimed(m, enabled, 't');
    expect(result.bindings).toEqual({ in: ['token0'], second: ['other'] });
    expect(result.marking.tokens).toHaveLength(1);
    expect(result.marking.tokens[0].age).toBe('0');
  });
  it('supports weighted inhibitors without consuming them', () => {
    const m = fixture(['2', '3']);
    m.net.arcs[0].kind = 'inhibitor';
    m.net.arcs[0].weight = 3;
    const mark = initialTimedMarking(m);
    expect(fireTimed(m, mark, 't').marking.tokens.filter((t) => t.place === 'p')).toEqual(
      mark.tokens,
    );
    m.net.arcs[0].weight = 2;
    expect(isTimedEnabled(m, mark, 't')).toBe(false);
    m.intervals['in'] = { ...UNRESTRICTED, lower: '1' };
    expect(() => validateTimedModel(m)).toThrow(/inhibitor/);
  });
  it('preserves transport identities and ages and applies destination invariants', () => {
    const m = fixture(['2', '3', '4']);
    m.transports = [{ inputArc: 'in', outputArc: 'out' }];
    m.net.arcs.forEach((a) => (a.weight = 2));
    m.invariants['q'] = { upper: '4', upperClosed: false };
    const initial = initialTimedMarking(m);
    const result = fireTimed(m, initial, 't');
    expect(result.bindings['in']).toEqual(['token1', 'token0']);
    expect(result.marking.tokens.filter((t) => t.place === 'q').map((t) => [t.id, t.age])).toEqual([
      ['token1', '3'],
      ['token0', '2'],
    ]);
    expect(result.marking.nextId).toBe('0');
    m.invariants['q'].upper = '3';
    expect(isTimedEnabled(m, initial, 't')).toBe(false);
    m.urgent = ['t'];
    expect(() => validateTimedModel(m)).toThrow(/Urgent transport/);
  });
  it('consumes before producing on ordinary selfloops; transport selfloops retain age', () => {
    const m = fixture(['7']);
    m.net.arcs[1].target = 'p';
    const initial = initialTimedMarking(m);
    expect(fireTimed(m, initial, 't').marking.tokens[0]).toEqual({
      id: '@timed:0',
      place: 'p',
      age: '0',
    });
    m.transports = [{ inputArc: 'in', outputArc: 'out' }];
    expect(fireTimed(m, initial, 't').marking).toEqual(initial);
  });
  it('validates manual bindings atomically, including duplicate, excess and missing bindings', () => {
    const m = fixture(['1', '2']);
    m.net.arcs[0].weight = 2;
    const mark = initialTimedMarking(m),
      before = structuredClone(mark);
    const invalidBindings: Record<string, string[]>[] = [
      {},
      { in: ['token0'] },
      { in: ['token0', 'token0'] },
      { in: ['token0', 'absent'] },
      { in: ['token0', 'token1'], out: [] },
    ];
    for (const bindings of invalidBindings) {
      expect(() => fireTimed(m, mark, 't', { mode: 'manual', bindings })).toThrow();
      expect(mark).toEqual(before);
    }
    expect(
      fireTimed(m, mark, 't', { mode: 'manual', bindings: { in: ['token1', 'token0'] } }).bindings[
        'in'
      ],
    ).toEqual(['token1', 'token0']);
  });
  it('uses only injected random choices without replacement', () => {
    const m = fixture(['0', '1', '2']);
    m.net.arcs[0].weight = 2;
    const mark = initialTimedMarking(m);
    expect(fireTimed(m, mark, 't', { mode: 'random', random: () => 0.99 }).bindings['in']).toEqual([
      'token2',
      'token1',
    ]);
    for (const value of [-1, 1, NaN, Infinity])
      expect(() => fireTimed(m, mark, 't', { mode: 'random', random: () => value })).toThrow(
        /Random/,
      );
  });
  it('rejects unsupported dimensions, sharing, competing pairs, malformed identity and stale metadata', () => {
    for (const flag of ['colored', 'game', 'stochastic'] as const) {
      const m = fixture();
      m.type = { ...m.type, [flag]: true };
      expect(() => validateTimedModel(m)).toThrow(/Only timed/);
    }
    const variants = [
      (m: TimedModel) => {
        m.componentCount = 2;
      },
      (m: TimedModel) => {
        m.sharedElementIds = ['p'];
      },
      (m: TimedModel) => {
        m.initial.push({ ...m.initial[0] });
      },
      (m: TimedModel) => {
        m.initial[0].id = '@timed:0';
      },
      (m: TimedModel) => {
        m.invariants['missing'] = { upper: null, upperClosed: false };
      },
      (m: TimedModel) => {
        m.intervals['out'] = { ...UNRESTRICTED };
      },
      (m: TimedModel) => {
        m.transports = [
          { inputArc: 'in', outputArc: 'out' },
          { inputArc: 'in', outputArc: 'out' },
        ];
      },
      (m: TimedModel) => {
        m.net.arcs[1].weight = 2;
        m.transports = [{ inputArc: 'in', outputArc: 'out' }];
      },
      (m: TimedModel) => {
        m.net.arcs.push({ ...m.net.arcs[0], id: 'competing' });
      },
    ];
    for (const mutate of variants) {
      const m = fixture();
      mutate(m);
      expect(() => validateTimedModel(m)).toThrow();
    }
  });
  it('rejects unsafe arithmetic inputs and capacity overflow before returning changes', () => {
    for (const age of ['-1', 'NaN', 'Infinity', '1e3', '.1', '00', '1'.repeat(257)])
      expect(() => addAges(age, '0')).toThrow();
    expect(() => addAges(0.1 as unknown as string, '0.2')).toThrow();
    expect(() => addAges('9'.repeat(256), '1')).toThrow();
    const m = fixture(['1']);
    m.net.arcs[0].kind = 'inhibitor';
    m.net.arcs[0].weight = 2;
    m.net.arcs[1].weight = MAX_TIMED_TOKENS;
    const mark = initialTimedMarking(m);
    expect(() => fireTimed(m, mark, 't')).toThrow(/capacity/);
    expect(mark.tokens).toHaveLength(1);
    expect(() => delayTimed(m, mark, '-1')).toThrow();
    expect(() => fireTimed(m, { ...mark, nextId: '-1' }, 't')).toThrow(/counter/);
  });
  it('reverses/replays exact snapshots, branches, resets and isolates the initial model', () => {
    const m = fixture();
    m.net.arcs[1].target = 'p';
    const original = structuredClone(m),
      simulation = new TimedSimulation(m);
    simulation.delay('0.1');
    simulation.fire('t');
    simulation.delay('0.2');
    const end = simulation.marking;
    simulation.back();
    expect(simulation.marking.tokens[0].age).toBe('0');
    simulation.forward();
    expect(simulation.marking).toEqual(end);
    simulation.back();
    simulation.back();
    simulation.delay('0.3');
    expect(simulation.canForward).toBe(false);
    expect(simulation.marking.tokens[0].age).toBe('0.4');
    const trace = simulation.trace;
    trace[0].marking.tokens[0].age = '99';
    simulation.marking.tokens[0].age = '99';
    expect(simulation.marking.tokens[0].age).toBe('0.4');
    const beforeFailure = simulation.trace;
    expect(() => simulation.fire('t', { mode: 'manual', bindings: {} })).toThrow();
    expect(simulation.trace).toEqual(beforeFailure);
    simulation.reset();
    expect(simulation.marking).toEqual(initialTimedMarking(m));
    expect(simulation.canBack).toBe(false);
    expect(simulation.canForward).toBe(false);
    expect(m).toEqual(original);
  });
});

describe('read-only eligible consuming inputs', () => {
  it('uses strict source endpoints and transport destination invariant, detaches identities, omits inhibitors', () => {
    const model = fixture(['1', '2', '2', '3', '4']);
    model.intervals.in = { lower: '1', upper: '4', lowerClosed: false, upperClosed: false };
    model.transports = [{ inputArc: 'in', outputArc: 'out' }];
    model.invariants.q = { upper: '3', upperClosed: false };
    const marking = initialTimedMarking(model);
    const inputs = eligibleTimedInputs(model, marking, 't');
    expect(inputs).toEqual([
      {
        arcId: 'in',
        place: 'p',
        weight: 1,
        destination: 'q',
        tokens: [marking.tokens[1], marking.tokens[2]],
      },
    ]);
    expect(inputs[0].tokens[0]).not.toBe(marking.tokens[1]);
    expect(inputs[0].tokens.map((t) => t.id)).toEqual(['token1', 'token2']);
    model.transports = [];
    model.net.arcs[0].kind = 'inhibitor';
    model.intervals = {};
    expect(eligibleTimedInputs(model, marking, 't')).toEqual([]);
    expect(() => eligibleTimedInputs(model, marking, 'missing')).toThrow(/Unknown transition/);
  });
});
