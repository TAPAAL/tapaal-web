// @vitest-environment jsdom
// Independent review probes for synchronized shared transitions (design/SHARED-TRANSITIONS-REVIEW.md).
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
import { undoAuthored } from './authored-documents';

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
const sim = (s: SharedSource = source()) =>
  new SharedNetworkSimulation(value(validateSharedSource(s)));
const tapn = () => serializeSharedTapn(source());
/** Put the same attribute text on the root declaration and on every member transition. */
function everywhere(text: string, attrs: string): string {
  const names = [...attrs.matchAll(/(\w+)="/g)].map((m) => m[1]);
  const strip = (tag: string) =>
    names.reduce((t, n) => t.replace(new RegExp(` ${n}="[^"]*"`), ''), tag);
  return text
    .replace(/<shared-transition [^>]*>/, (tag) =>
      strip(tag).replace('<shared-transition ', `<shared-transition ${attrs} `),
    )
    .replaceAll(/<transition [^>]*name="Sync"[^>]*>/g, (tag) =>
      strip(tag).replace('<transition ', `<transition ${attrs} `),
    );
}

describe('review: native XML shared-transition metadata', () => {
  it('baseline export reopens with membership in all three components', () => {
    const text = tapn();
    expect(text.match(/<shared-transition /g)).toHaveLength(1);
    const read = parseSharedTapn(text).network;
    expect(read.shared.transitions).toHaveLength(1);
    expect(read.components.map((c) => c.net.nodes.filter((n) => 'sharedId' in n).length)).toEqual([
      1, 1, 1,
    ]);
    expect(read.components.map((c) => c.active)).toEqual([true, true, false]);
  });
  it.each([
    ['nondefault firingMode', 'firingMode="Oldest"'],
    ['uncontrollable player', 'player="1"'],
    ['probability weight', 'weight="2"'],
    ['nondefault distribution value', 'distribution="constant" value="2"'],
  ])('refuses (never drops) agreed but unsupported %s', (_label, attrs) => {
    const text = everywhere(tapn(), attrs);
    expect(text.split(attrs.split(' ')[0]).length - 1).toBe(4); // root + 3 members
    expect(() => new DOMParser().parseFromString(text, 'application/xml')).not.toThrow();
    expect(
      new DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
    expect(() => parseSharedTapn(text)).toThrow();
    expect(() => parseSharedTapn(text)).not.toThrow(/malformed/);
  });
  it('accepts agreed native default metadata spelled explicitly', () => {
    const text = everywhere(
      tapn().replace(
        '<shared-transition name="Sync" urgent="false"',
        '<shared-transition name="Sync"',
      ),
      'player="0" weight="1.0" firingMode="Random" distribution="constant" value="1.0"',
    );
    expect(parseSharedTapn(text).network.shared.transitions).toEqual([
      expect.objectContaining({ name: 'Sync', urgent: false }),
    ]);
  });
  it.each([
    [
      'root-only metadata',
      (t: string) =>
        t.replace(
          '<shared-transition name="Sync"',
          '<shared-transition name="Sync" firingMode="Oldest"',
        ),
    ],
    [
      'one member urgent, root nonurgent',
      (t: string) =>
        t.replace(/(<transition [^>]*name="Sync"[^>]*)urgent="false"/, '$1urgent="true"'),
    ],
    [
      'nested declaration',
      (t: string) => t.replace('</net>', '<shared-transition name="Nested" urgent="false"/></net>'),
    ],
    [
      'prefixed declaration',
      (t: string) =>
        t.replace(
          '<shared-transition name="Sync" urgent="false"/>',
          '<shared-transition name="Sync" urgent="false"/><x:shared-transition xmlns:x="http://www.informatik.hu-berlin.de/top/pnml/ptNetb" name="Other" urgent="false"/>',
        ),
    ],
    [
      'place/transition pool name collision',
      (t: string) =>
        t.replace(
          '<shared-transition name="Sync" urgent="false"/>',
          '<shared-transition name="Sync" urgent="false"/><shared-place name="Sync" initialMarking="0" invariant="&lt; inf"/>',
        ),
    ],
    [
      'duplicate declaration',
      (t: string) =>
        t.replace(
          '<shared-transition name="Sync" urgent="false"/>',
          '<shared-transition name="Sync" urgent="false"/><shared-transition name="Sync" urgent="false"/>',
        ),
    ],
    [
      'unknown root attribute',
      (t: string) =>
        t.replace('<shared-transition name="Sync"', '<shared-transition name="Sync" priority="2"'),
    ],
  ])('refuses %s', (_label, mutate) => {
    const original = tapn(),
      text = mutate(original);
    expect(text).not.toBe(original);
    expect(() => parseSharedTapn(text)).toThrow();
    expect(() => parseSharedTapn(text)).not.toThrow(/malformed/);
  });
  it('export saves source urgency once at the root and on every member, including inactive', () => {
    const s = source();
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    const text = serializeSharedTapn(s);
    expect(text).toContain('<shared-transition name="Sync" urgent="true"/>');
    const members = [...text.matchAll(/<transition [^>]*name="Sync"[^>]*>/g)].map((m) => m[0]);
    expect(members).toHaveLength(3);
    for (const m of members) expect(m).toContain('urgent="true"');
    expect(parseSharedTapn(text).network.shared.transitions[0].urgent).toBe(true);
  });
});

describe('review: source validation and protections', () => {
  it('old V3 JSON with an empty transitions array and place-only query protections still opens', () => {
    const s = source();
    s.shared.transitions = [];
    s.components = s.components.map((c) => ({
      ...c,
      net: {
        ...c.net,
        nodes: c.net.nodes.map((n) =>
          n.id === 't' ? { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 1, y: 0 } : n,
        ),
      },
    }));
    const q = value(captureSharedQueries(s, ['<query name="q" query="EF a.P >= 1"/>']));
    expect(q).not.toHaveProperty('protectedSharedTransitions');
    const withQ = { ...s, savedQueries: q };
    expect(parseSharedJson(serializeSharedJson(withQ)).network).toEqual(withQ);
  });
  it('untimed source refuses urgent transition pools', () => {
    const s = source(false);
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    expect(validateSharedSource(s).ok).toBe(false);
  });
  it.each([
    ['output to shared place', 'out'],
    ['transport input from shared place', 'transport-in'],
    ['transport output to shared place', 'transport-out'],
  ])('rejects shared/shared incidence in an inactive component: %s', (_label, which) => {
    const s = source();
    s.shared.places = [{ id: 'g', name: 'G', tokens: 0, timing: { invariant: null, ages: [] } }];
    const c = s.components[2];
    const sharedId = which === 'transport-in' ? 'p' : 'q';
    c.net.nodes = c.net.nodes.map((n) =>
      n.id === sharedId ? { id: n.id, kind: 'place', sharedId: 'g', x: 0, y: 0 } : n,
    );
    c.timing = {
      ...emptyTiming(),
      ...(which.startsWith('transport')
        ? { transports: [{ inputArc: 'in', outputArc: 'out' }] }
        : {}),
      ...(sharedId === 'q' ? { ages: { p: ['1', '2'] } } : {}),
    };
    const result = validateSharedSource(s);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toMatch(/shared transition cannot connect/);
  });
  it('local transition may still use shared places (no over-restriction)', () => {
    const s = source();
    s.shared.places = [{ id: 'g', name: 'G', tokens: 1, timing: { invariant: null, ages: [] } }];
    s.components[0].net.nodes.push({
      id: 'lt',
      kind: 'transition',
      name: 'LT',
      tokens: 0,
      x: 5,
      y: 5,
    } as never);
    s.components[0].net.nodes.push({ id: 'gp', kind: 'place', sharedId: 'g', x: 9, y: 9 } as never);
    s.components[0].net.arcs.push({
      id: 'g-in',
      kind: 'normal',
      source: 'gp',
      target: 'lt',
      weight: 1,
    });
    expect(validateSharedSource(s).ok).toBe(true);
  });
  it('protected unused transition pools cannot be deleted until queries are removed; removal is undoable', () => {
    let s: SharedSource = source();
    s = {
      ...s,
      shared: {
        ...s.shared,
        transitions: [...s.shared.transitions, { id: 'u', name: 'Unused', urgent: false }],
      },
    };
    s = {
      ...s,
      savedQueries: value(captureSharedQueries(s, ['<query name="q" query="EF Unused"/>'])),
    };
    let d = value(openSharedDocument(s));
    const del = transactShared(d, d.network, { kind: 'deleteTransitionPool', poolId: 'u' });
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.issues[0].code).toBe('query-protected');
    // Urgency is semantics, not a protected symbol.
    d = value(
      transactShared(d, d.network, {
        kind: 'editTransitionPool',
        pool: { id: 'u', name: 'Unused', urgent: true },
      }),
    );
    const stale = d.network;
    d = value(transactShared(d, d.network, { kind: 'removeQueries' }));
    expect(transactShared(d, stale, { kind: 'deleteTransitionPool', poolId: 'u' }).ok).toBe(false);
    d = value(transactShared(d, d.network, { kind: 'deleteTransitionPool', poolId: 'u' }));
    expect(d.network.shared.transitions.map((p) => p.id)).toEqual(['s']);
    d = undoAuthored(undoAuthored(d));
    expect(d.network.savedQueries?.protectedSharedTransitions).toContainEqual({
      id: 'u',
      name: 'Unused',
    });
  });
  it('deleting a used pool is refused; removeOccurrence cleans incident transport pairs', () => {
    const s = source();
    s.components = s.components.map((c) => ({
      ...c,
      timing: { ...c.timing!, transports: [{ inputArc: 'in', outputArc: 'out' }] },
    }));
    let d = value(openSharedDocument(s));
    expect(transactShared(d, d.network, { kind: 'deleteTransitionPool', poolId: 's' }).ok).toBe(
      false,
    );
    d = value(
      transactShared(d, d.network, { kind: 'removeOccurrence', componentId: 'a', elementId: 't' }),
    );
    expect(d.network.components[0].net.arcs).toEqual([]);
    expect(d.network.components[0].timing?.transports).toEqual([]);
  });
  it('detach validates the fresh local name against global and local names', () => {
    const d = value(openSharedDocument(source()));
    for (const name of ['Sync', 'P'])
      expect(
        transactShared(d, d.network, { kind: 'detach', componentId: 'a', elementId: 't', name }).ok,
      ).toBe(false);
  });
  it('member transitions cannot carry their own urgency or name through local edits', () => {
    const d = value(openSharedDocument(source()));
    const r = transactShared(d, d.network, {
      kind: 'localEdit',
      edit: {
        kind: 'editElement',
        componentId: 'a',
        element: { id: 't', kind: 'transition', name: 'Renamed', tokens: 0, x: 100, y: 0 },
        timing: null,
      },
    } as never);
    expect(r.ok).toBe(false);
  });
});

describe('review: synchronized execution', () => {
  it('an active member without tokens disables the whole event; an inactive one does not', () => {
    const disabled = source();
    disabled.components[1].net.nodes[0] = {
      id: 'p',
      kind: 'place',
      name: 'P',
      tokens: 0,
      x: 0,
      y: 0,
    };
    disabled.components[1].timing = emptyTiming();
    const r = sim(disabled);
    expect(r.enabled).toEqual([]);
    expect(r.enabledFor('a')).toEqual([]);
    expect(() => r.fire(ref('a'))).toThrow();
    expect(r.trace).toHaveLength(1);

    const inactiveEmpty = source();
    inactiveEmpty.components[2].net.nodes[0] = {
      id: 'p',
      kind: 'place',
      name: 'P',
      tokens: 0,
      x: 0,
      y: 0,
    };
    inactiveEmpty.components[2].timing = emptyTiming();
    expect(sim(inactiveEmpty).enabled).toHaveLength(1);
  });
  it('an inactive canvas member never dispatches and is never highlighted', () => {
    const r = sim();
    expect(r.enabledFor('inactive')).toEqual([]);
    expect(() => r.fire(ref('inactive'))).toThrow(/inactive/);
    expect(r.trace).toHaveLength(1);
  });
  it('an inhibitor on one member blocks the conjunctive event', () => {
    const s = source();
    s.components[1].net.nodes.push({
      id: 'h',
      kind: 'place',
      name: 'H',
      tokens: 1,
      x: 0,
      y: 50,
    } as never);
    s.components[1].net.arcs.push({
      id: 'inh',
      kind: 'inhibitor',
      source: 'h',
      target: 't',
      weight: 1,
    });
    expect(sim(s).enabled).toEqual([]);
  });
  it('a guard on one member constrains the whole event by its own token age', () => {
    const s = source();
    s.components[1].timing = {
      ...s.components[1].timing!,
      intervals: { in: { lower: '3', upper: null, lowerClosed: true, upperClosed: false } },
    };
    const r = sim(s);
    expect(r.enabled).toEqual([]);
    r.delay('1');
    expect(r.enabled).toHaveLength(1);
    r.fire(ref('a'), { mode: 'oldest' });
    // Member a consumed its oldest (age 3); member b its only eligible token (age 3).
    expect(r.markingFor('a').p.map((t) => t.age)).toEqual(['2']);
    expect(r.markingFor('b').p.map((t) => t.age)).toEqual(['2']);
  });
  it('urgency blocks delay only while the whole event is enabled', () => {
    const s = source();
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    s.components[1].timing = {
      ...s.components[1].timing!,
      intervals: { in: { lower: '0', upper: null, lowerClosed: true, upperClosed: false } },
    };
    s.components[1].net.nodes[0] = { id: 'p', kind: 'place', name: 'P', tokens: 0, x: 0, y: 0 };
    s.components[1].timing = emptyTiming();
    const r = sim(s);
    expect(r.enabled).toEqual([]);
    r.delay('5');
    expect(r.time).toBe('5');
  });
  it('manual selection rejects omissions, foreign/local-only keys and duplicates atomically', () => {
    const r = sim(),
      inputs = r.eligibleInputs(ref('a'));
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.placeName)).toEqual([
      expect.stringContaining('a.P'),
      expect.stringContaining('b.P'),
    ]);
    const full = Object.fromEntries(inputs.map((i) => [i.arcId, [i.tokens[0].id]]));
    const bad = [
      { [inputs[0].arcId]: [inputs[0].tokens[0].id] },
      { in: [inputs[0].tokens[0].id], [inputs[1].arcId]: [inputs[1].tokens[0].id] },
      { ...full, [inputs[0].arcId]: [inputs[1].tokens[0].id] },
      { ...full, [inputs[0].arcId]: [inputs[0].tokens[0].id, inputs[0].tokens[0].id] },
    ];
    for (const bindings of bad) {
      expect(() => r.fire(ref('a'), { mode: 'manual', bindings })).toThrow();
      expect(r.trace).toHaveLength(1);
    }
    r.fire(ref('b'), { mode: 'manual', bindings: full });
    expect(r.trace).toHaveLength(2);
  });
  it('back + replay of a recorded synchronized step restores identical history without repicking', () => {
    const r = sim();
    r.fire(ref('b'), { mode: 'youngest' });
    r.delay('1');
    const trace = r.trace,
      actions = trace.slice(1).map((s) => {
        const { time: _t, marking: _m, pools: _p, totalTokens: _n, ...a } = s;
        return a;
      });
    r.back();
    r.back();
    r.replay(actions as never);
    expect(r.trace).toEqual(trace);
  });
  it('pool urgency is checked against guarded inputs of inactive members on join', () => {
    const s = source();
    s.shared.transitions = [{ id: 's', name: 'Sync', urgent: true }];
    s.components[2].timing = {
      ...s.components[2].timing!,
      intervals: { in: { lower: '1', upper: null, lowerClosed: true, upperClosed: false } },
    };
    expect(validateSharedSource(s).ok).toBe(false);
  });
});

describe('review: cross-kind commands', () => {
  it('usePool refuses a pool of the other kind in both directions; makeShared refuses a taken ID', () => {
    const s = source();
    s.shared.places = [
      { id: 'g', name: 'G', tokens: 2, timing: { invariant: null, ages: ['1', '2'] } },
    ];
    s.components[0].net.nodes.push({
      id: 'lt',
      kind: 'transition',
      name: 'LT',
      tokens: 0,
      x: 5,
      y: 5,
    } as never);
    const d = value(openSharedDocument(s));
    const use = (elementId: string, poolId: string) =>
      transactShared(d, d.network, {
        kind: 'usePool',
        componentId: 'a',
        elementId,
        poolId,
        acceptPoolValues: true,
      }).ok;
    expect(use('p', 's')).toBe(false);
    expect(use('lt', 'g')).toBe(false);
    expect(
      transactShared(d, d.network, {
        kind: 'makeShared',
        componentId: 'a',
        elementId: 'lt',
        poolId: 'g',
        name: 'Fresh',
      }).ok,
    ).toBe(false);
    expect(d.past).toHaveLength(0);
  });
});
