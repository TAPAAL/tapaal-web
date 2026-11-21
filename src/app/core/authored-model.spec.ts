// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  AuthoredNetwork,
  Result,
  authoredFromNumeric,
  resolveAuthored,
  constantUses,
  captureAuthoredSavedQueries,
  freezeAuthored,
} from './authored-model';
import { emptyTiming, Network } from './resolved-network';
import { TimedNetworkSimulation } from './timed-network-simulation';
import { NetworkSimulation } from './network-simulation';
import { MAX_TIMED_TOKENS } from './timed';

export function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
export function fixture(timed = true): AuthoredNetwork {
  return {
    name: 'Model',
    type: { timed, colored: false, game: false, stochastic: false },
    constants: [
      { id: 'batch', name: 'Batch', value: 2 },
      { id: 'deadline', name: 'Deadline', value: 5 },
      { id: '__proto__', name: '_Zero', value: 0 },
    ],
    components: [
      {
        id: '__proto__',
        active: true,
        net: {
          name: 'Model',
          template: 'A',
          nodes: [
            {
              id: 'p',
              kind: 'place',
              name: 'P',
              tokens: 2,
              x: 0,
              y: 0,
              nameVisible: false,
              nameOffsetX: 3,
              nameOffsetY: -4,
            },
            { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 100, y: 0, angle: 45 },
            { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 200, y: 0 },
          ],
          arcs: [
            {
              id: 'in',
              source: 'p',
              target: 't',
              kind: 'normal',
              weight: { constantId: 'batch' },
              bends: [{ x: 50, y: 10, curved: true }],
              curvedEnd: true,
            },
            {
              id: 'out',
              source: 't',
              target: 'q',
              kind: 'normal',
              weight: { constantId: 'batch' },
            },
          ],
          annotations: [
            {
              id: 'note',
              text: 'Keep\nthis',
              x: 1,
              y: 2,
              width: 100,
              height: 20,
              border: false,
              filled: false,
            },
          ],
        },
        ...(timed
          ? {
              timing: {
                ...emptyTiming(),
                intervals: {
                  in: {
                    lower: '0',
                    upper: { constantId: 'deadline' },
                    lowerClosed: true,
                    upperClosed: true,
                  },
                },
                invariants: { p: { upper: { constantId: 'deadline' }, upperClosed: true } },
                ages: { p: ['1', '2'] },
                transports: [{ inputArc: 'in', outputArc: 'out' }],
              },
            }
          : {}),
      },
    ],
  };
}
// Invalid inputs deliberately cross the runtime Interface; do not weaken production types.
const malformed = (s: unknown) => resolveAuthored(s as AuthoredNetwork);
const numeric = (s: AuthoredNetwork): Network =>
  structuredClone(value(resolveAuthored(s)).numeric) as Network;

describe('opt-in authored resolution', () => {
  it('adapts legacy numeric shapes without losing geometry or query shape', () => {
    const n = numeric(fixture());
    const a = value(authoredFromNumeric(n));
    expect(a.constants).toEqual([]);
    expect(a.components).toEqual(n.components);
    expect(value(resolveAuthored(a)).numeric).toEqual(n);
    expect(Object.isFrozen(a.components[0].net.arcs[0].bends)).toBe(true);
  });
  it('refuses authored metadata at the numeric migration seam instead of flattening it', () => {
    const n = numeric(fixture());
    expect(authoredFromNumeric({ ...n, constants: fixture().constants } as Network).ok).toBe(false);
  });
  it('supports inhibitor weights without permitting interval metadata on inhibitors', () => {
    const s = fixture(false),
      c = s.components[0];
    const source: AuthoredNetwork = {
      ...s,
      components: [
        {
          ...c,
          net: {
            ...c.net,
            arcs: c.net.arcs.map((a) => (a.id === 'in' ? { ...a, kind: 'inhibitor' } : a)),
          },
        },
      ],
    };
    expect(numeric(source).components[0].net.arcs[0].weight).toBe(2);
    expect(new NetworkSimulation(numeric(source)).enabled).toEqual([]);
  });
  it('rejects missing query protection names and null timing without erasing malformed data', () => {
    const s = fixture();
    const q = value(captureAuthoredSavedQueries(s, ['<query name="Q"/>']));
    expect(
      malformed({ ...s, savedQueries: { ...q, protectedConstants: [{ id: 'missing' }] } }).ok,
    ).toBe(false);
    expect(malformed({ ...s, components: [{ ...s.components[0], timing: null }] }).ok).toBe(false);
  });
  it('isolates mutable callers and ties frozen revisions to an opaque readonly result', () => {
    const source = fixture();
    const r = value(resolveAuthored(source));
    expect(r.source).toEqual(source);
    expect(r.source).not.toBe(source);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(r.numeric.components[0].net.nodes)).toBe(true);
    expect(Object.isFrozen(r.source.constants)).toBe(true);
    const frozen = freezeAuthored(fixture());
    expect(value(resolveAuthored(frozen)).source).toBe(frozen);
    expect(Object.keys(r.numeric)).toEqual(['name', 'type', 'components']);
  });
  it('resolves every term position and reports structured locations including inactive uses', () => {
    const s = fixture();
    const c = s.components[0];
    const source: AuthoredNetwork = {
      ...s,
      components: [
        {
          ...c,
          active: false,
          timing: {
            ...c.timing!,
            intervals: {
              in: {
                lower: { constantId: '__proto__' },
                upper: { constantId: 'deadline' },
                lowerClosed: true,
                upperClosed: false,
              },
            },
          },
        },
        { ...c, id: 'b', net: { ...c.net, template: 'B' } },
      ],
    };
    expect(numeric(source).components[0].timing!.intervals['in'].lower).toBe('0');
    expect(constantUses(source, 'deadline')).toContainEqual({
      constantId: 'deadline',
      componentId: '__proto__',
      elementId: 'in',
      field: 'upper',
      active: false,
    });
    expect(constantUses(source, 'batch')).toHaveLength(4);
    expect(constantUses(source, '__proto__')[0].field).toBe('lower');
  });
  it('keeps default-equivalent symbolic guards authored and omits only their numeric projection', () => {
    const s = fixture(),
      c = s.components[0];
    const source = {
      ...s,
      components: [
        {
          ...c,
          timing: {
            ...c.timing!,
            intervals: {
              in: {
                lower: { constantId: '__proto__' },
                upper: null,
                lowerClosed: true,
                upperClosed: false,
              },
            },
          },
        },
      ],
    };
    expect(numeric(source).components[0].timing!.intervals).toEqual({});
    expect(
      value(resolveAuthored(source)).source.components[0].timing!.intervals['in'].lower,
    ).toEqual({ constantId: '__proto__' });
    expect(
      resolveAuthored({
        ...source,
        components: [
          { ...source.components[0], timing: { ...source.components[0].timing, urgent: ['t'] } },
        ],
      }).ok,
    ).toBe(false);
  });
  it('rejects literal defaults, unknown guard targets and inhibitor symbolic-zero guards', () => {
    const s = fixture(),
      c = s.components[0];
    for (const id of ['in', 'missing'])
      expect(
        resolveAuthored({
          ...s,
          components: [
            {
              ...c,
              timing: {
                ...c.timing!,
                intervals: {
                  [id]: { lower: '0', upper: null, lowerClosed: true, upperClosed: false },
                },
              },
            },
          ],
        }).ok,
      ).toBe(false);
    const source = {
      ...s,
      components: [
        {
          ...c,
          net: {
            ...c.net,
            arcs: c.net.arcs.map((a) => (a.id === 'in' ? { ...a, kind: 'inhibitor' as const } : a)),
          },
          timing: {
            ...c.timing!,
            transports: [],
            intervals: {
              in: {
                lower: { constantId: '__proto__' },
                upper: null,
                lowerClosed: true,
                upperClosed: false,
              },
            },
          },
        },
      ],
    };
    expect(resolveAuthored(source).ok).toBe(false);
  });
  it('allows Decimal literals while retaining ages and native export as a future gate', () => {
    const s = fixture(),
      c = s.components[0];
    const n = numeric({
      ...s,
      components: [
        {
          ...c,
          timing: {
            ...c.timing!,
            intervals: {
              in: { lower: '0.125', upper: '5.75', lowerClosed: false, upperClosed: true },
            },
          },
        },
      ],
    });
    expect(n.components[0].timing!.intervals['in'].lower).toBe('0.125');
    expect(n.components[0].timing!.ages).toEqual({ p: ['1', '2'] });
  });
  it('requires exact authored transport terms despite equal resolved values', () => {
    const s = fixture(),
      c = s.components[0];
    const source = {
      ...s,
      constants: [...s.constants, { id: 'other', name: 'Other', value: 2 }],
      components: [
        {
          ...c,
          net: {
            ...c.net,
            arcs: c.net.arcs.map((a) =>
              a.id === 'out' ? { ...a, weight: { constantId: 'other' } } : a,
            ),
          },
        },
      ],
    };
    expect(resolveAuthored(source).ok).toBe(false);
  });
  for (const [name, accepted] of [
    ['_Leading', true],
    ['Inf', true],
    ['true', true],
    ['inf', false],
    ['1bad', false],
    ['a b', false],
    ['æ', false],
  ] as const)
    it(`source declaration grammar ${name}`, () => {
      const s = fixture();
      expect(
        resolveAuthored({ ...s, constants: s.constants.map((c, i) => (i ? c : { ...c, name })) })
          .ok,
      ).toBe(accepted);
    });
  for (const v of [-1, 2147483648, 1.5, NaN, Infinity, '2', null])
    it(`rejects declaration value ${v}`, () => {
      const s = fixture();
      expect(
        malformed({
          ...s,
          constants: [{ id: 'batch', name: 'Batch', value: v }, ...s.constants.slice(1)],
        }).ok,
      ).toBe(false);
    });
  it('accepts unused Java max-int and zero declarations', () => {
    const s = fixture();
    expect(
      resolveAuthored({
        ...s,
        constants: [...s.constants, { id: 'max', name: 'Max', value: 2147483647 }],
      }).ok,
    ).toBe(true);
  });
  for (const term of [
    null,
    'Batch',
    {},
    { constantId: 'missing' },
    { constantId: 'batch', value: 2 },
    { constantId: 42 },
    Object.create({ constantId: 'batch' }),
  ])
    it(`refuses malformed term ${JSON.stringify(term)}`, () => {
      const s = fixture(),
        c = s.components[0];
      expect(
        malformed({
          ...s,
          components: [
            { ...c, net: { ...c.net, arcs: c.net.arcs.map((a) => ({ ...a, weight: term })) } },
          ],
        }).ok,
      ).toBe(false);
    });
  it('rejects duplicate IDs/names, inherited state and unknown nested keys', () => {
    const s = fixture();
    for (const constant of [
      { ...s.constants[0], name: 'Other' },
      { ...s.constants[0], id: 'other' },
    ])
      expect(resolveAuthored({ ...s, constants: [...s.constants, constant] }).ok).toBe(false);
    for (const bad of [
      { ...s, sharedPlaces: [] },
      Object.assign(Object.create({ hidden: true }), s),
      { ...s, constants: s.constants.map((c) => ({ ...c, expression: '1+1' })) },
      { ...s, type: { ...s.type, parameterSets: [] } },
    ])
      expect(malformed(bad).ok).toBe(false);
    const inherited = Object.create({
      in: { lower: '0', upper: '5', lowerClosed: true, upperClosed: true },
    });
    expect(
      resolveAuthored({
        ...s,
        components: [
          { ...s.components[0], timing: { ...s.components[0].timing!, intervals: inherited } },
        ],
      }).ok,
    ).toBe(false);
  });
  it('handles arbitrary own map keys without prototype lookup', () => {
    const s = fixture(),
      c = s.components[0];
    const a = {
      ...s,
      components: [
        {
          ...c,
          net: {
            ...c.net,
            arcs: c.net.arcs.map((a) => (a.id === 'in' ? { ...a, id: '__proto__' } : a)),
          },
          timing: {
            ...c.timing!,
            intervals: Object.fromEntries([['__proto__', c.timing!.intervals['in']]]),
            transports: [{ inputArc: '__proto__', outputArc: 'out' }],
          },
        },
      ],
    };
    expect(Object.hasOwn(numeric(a).components[0].timing!.intervals, '__proto__')).toBe(true);
  });
  it('rejects bad intervals, strict zero invariants and initial-age violations', () => {
    const s = fixture();
    for (const v of [0, 1])
      expect(
        resolveAuthored({
          ...s,
          constants: s.constants.map((c) => (c.id === 'deadline' ? { ...c, value: v } : c)),
        }).ok,
      ).toBe(false);
    const c = s.components[0];
    for (const flags of [
      [false, false],
      [true, false],
      [false, true],
    ])
      expect(
        resolveAuthored({
          ...s,
          components: [
            {
              ...c,
              timing: {
                ...c.timing!,
                intervals: {
                  in: {
                    lower: { constantId: 'deadline' },
                    upper: { constantId: 'deadline' },
                    lowerClosed: flags[0],
                    upperClosed: flags[1],
                  },
                },
              },
            },
          ],
        }).ok,
      ).toBe(false);
    expect(
      resolveAuthored({
        ...s,
        components: [
          {
            ...c,
            timing: {
              ...c.timing!,
              invariants: { q: { upper: { constantId: '__proto__' }, upperClosed: false } },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });
  for (const dimension of ['colored', 'game', 'stochastic'] as const)
    it(`retains unsupported ${dimension} gate`, () => {
      const s = fixture();
      expect(resolveAuthored({ ...s, type: { ...s.type, [dimension]: true } }).ok).toBe(false);
    });
  it('validates and removes query metadata before numeric execution, preserving protections on source', () => {
    const s = fixture();
    const savedQueries = value(
      captureAuthoredSavedQueries(s, ['<query name="Q" query="EF A.P &gt; 0"/>']),
    );
    expect(savedQueries.protectedConstants).toEqual(
      s.constants.map(({ id, name }) => ({ id, name })),
    );
    const resolved = value(resolveAuthored({ ...s, savedQueries }));
    expect(resolved.numeric.savedQueries).toBeUndefined();
    expect(resolved.source.savedQueries).toEqual(savedQueries);
    expect(constantUses(resolved.source, '__proto__')).toContainEqual({
      constantId: '__proto__',
      field: 'saved-query-protection',
    });
    expect(
      resolveAuthored({
        ...s,
        savedQueries: { ...savedQueries, protectedConstants: [{ id: 'missing', name: 'X' }] },
      }).ok,
    ).toBe(false);
    expect(
      resolveAuthored({
        ...s,
        savedQueries: { ...savedQueries, xml: ['<query><constant/></query>'] },
      }).ok,
    ).toBe(false);
  });
  it('executes resolved timed multi-component transports identically to their numeric baseline', () => {
    const s = fixture(),
      c = s.components[0];
    const source = {
      ...s,
      components: [
        c,
        { ...c, id: 'b', net: { ...c.net, template: 'B' } },
        { ...c, id: 'inactive', active: false, net: { ...c.net, template: 'C' } },
      ],
    };
    const n = numeric(source),
      a = new TimedNetworkSimulation(n),
      b = new TimedNetworkSimulation(numeric(value(authoredFromNumeric(n))));
    expect(a.enabled).toEqual(b.enabled);
    expect(a.marking).toEqual(b.marking);
    a.delay('1');
    b.delay('1');
    a.fire({ componentId: '__proto__', elementId: 't' });
    b.fire({ componentId: '__proto__', elementId: 't' });
    expect(a.marking).toEqual(b.marking);
    expect(a.enabled).toEqual(b.enabled);
  });
  it('executes untimed symbolic weights and keeps explicit-token capacity separate', () => {
    const s = fixture(false),
      n = numeric(s);
    expect(new NetworkSimulation(n).enabled).toHaveLength(1);
    const big = {
      ...fixture(),
      constants: fixture().constants.map((c) =>
        c.id === 'batch' ? { ...c, value: MAX_TIMED_TOKENS + 1 } : c,
      ),
    };
    expect(resolveAuthored(big).ok).toBe(true);
    expect(() => new TimedNetworkSimulation(numeric(big))).toThrow(/capacity|tokens/i);
  });
});
