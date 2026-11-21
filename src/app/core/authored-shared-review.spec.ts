// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AuthoredNetwork, Result, resolveAuthored } from './authored-model';
import { emptyTiming } from './resolved-network';
import { serializeAuthoredJson, serializeAuthoredTapn } from './authored-files';
import {
  openAuthoredDocument,
  transactDocument,
  undoAuthored,
  redoAuthored,
  markAuthoredSaved,
  isAuthoredDirty,
} from './authored-documents';
import {
  SharedSource,
  SharedDocument,
  SharedEdit,
  captureSharedQueries,
  openSharedDocument,
  sharedConstantUses,
  transactShared,
  validateSharedSource,
} from './authored-shared';

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

// Independent source fixture: no conversion command is used to establish membership.
function source(): SharedSource {
  return {
    name: 'Review',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [
      { id: 'limit', name: 'Limit', value: 5 },
      { id: 'batch', name: 'Batch', value: 1 },
    ],
    shared: {
      places: [
        {
          id: '__proto__',
          name: 'Buffer',
          tokens: 2,
          timing: {
            invariant: { upper: { constantId: 'limit' }, upperClosed: false },
            ages: ['2'],
          },
        },
      ],
      transitions: [],
    },
    components: ['constructor', 'toString'].map((id, i) => ({
      id,
      active: i === 0,
      net: {
        name: 'Review',
        template: i === 0 ? 'First' : 'Second',
        nodes: [
          { id: '__proto__', kind: 'place', sharedId: '__proto__', x: i, y: 0 },
          { id: 't', kind: 'transition', name: 'Move', tokens: 0, x: 20, y: 0 },
          { id: 'q', kind: 'place', name: 'Local', tokens: 0, x: 40, y: 0 },
        ],
        arcs: [
          {
            id: 'in',
            kind: 'normal',
            source: '__proto__',
            target: 't',
            weight: { constantId: 'batch' },
          },
          { id: 'out', kind: 'normal', source: 't', target: 'q', weight: { constantId: 'batch' } },
        ],
      },
      timing: {
        ...emptyTiming(),
        transports: [{ inputArc: 'in', outputArc: 'out' }],
        intervals: { in: { lower: '1', upper: null, lowerClosed: true, upperClosed: false } },
      },
    })),
  };
}
function document(s = source()): SharedDocument {
  return ok(openSharedDocument(s, { id: 'review', saved: true }));
}
function edit(d: SharedDocument, e: SharedEdit): SharedDocument {
  return ok(transactShared(d, d.network, e));
}

describe('independent shared foundation review', () => {
  it('has one pool authority, no public numeric projection, and closed old save/resolver gates', () => {
    const s = source();
    const revision = ok(validateSharedSource(s));
    expect(Object.keys(revision)).toEqual(['source']);
    expect(revision.source).toEqual(s);
    expect(revision.source).not.toBe(s);
    expect(Object.isFrozen(revision.source.shared.places[0].timing!.ages)).toBe(true);
    for (const c of revision.source.components) {
      expect(c.net.nodes[0]).not.toHaveProperty('tokens');
      expect(c.net.nodes[0]).not.toHaveProperty('name');
      expect(c.timing!.ages).toEqual({});
      expect(c.timing!.invariants).toEqual({});
    }
    const oldSource = revision.source as unknown as AuthoredNetwork;
    expect(resolveAuthored(oldSource).ok).toBe(false);
    expect(() => serializeAuthoredJson(oldSource)).toThrow();
    expect(() => serializeAuthoredTapn(oldSource)).toThrow();
  });

  it('keeps all-inactive source activity and validates unused pools with no token allocation', () => {
    const s = source();
    const inactive = { ...s, components: s.components.map((c) => ({ ...c, active: false })) };
    expect(ok(validateSharedSource(inactive)).source.components.every((c) => !c.active)).toBe(true);
    expect(sharedConstantUses(inactive, 'limit')).toEqual([
      { constantId: 'limit', poolId: '__proto__', field: 'invariant', activeMemberCount: 0 },
    ]);
    const unused = {
      ...inactive,
      components: inactive.components.map((c) => ({
        ...c,
        net: { ...c.net, nodes: c.net.nodes.slice(1), arcs: [] },
        timing: emptyTiming(),
      })),
    };
    expect(validateSharedSource(unused).ok).toBe(true);
    const excessiveAge = {
      ...unused,
      shared: {
        ...unused.shared,
        places: [
          {
            ...unused.shared.places[0],
            timing: { invariant: { upper: '1', upperClosed: true }, ages: ['2'] },
          },
        ],
      },
    };
    expect(validateSharedSource(excessiveAge).ok).toBe(false);
    const large = {
      ...unused,
      shared: {
        ...unused.shared,
        places: [
          {
            ...unused.shared.places[0],
            tokens: 1_000_000_000,
          },
        ],
      },
    };
    expect(validateSharedSource(large).ok).toBe(true);
  });

  it.each([null, false, 0, ''])(
    'rejects malformed savedQueries=%j instead of erasing it in projection',
    (savedQueries) => {
      expect(
        validateSharedSource({ ...source(), savedQueries } as unknown as SharedSource).ok,
      ).toBe(false);
    },
  );

  it('reports the pool use when a constant makes an unused strict invariant impossible', () => {
    const s = source();
    const unused = {
      ...s,
      components: s.components.map((c) => ({
        ...c,
        net: { ...c.net, nodes: c.net.nodes.slice(1), arcs: [] },
        timing: emptyTiming(),
      })),
      shared: {
        ...s.shared,
        places: [
          {
            ...s.shared.places[0],
            tokens: 0,
            timing: { invariant: { upper: { constantId: 'limit' }, upperClosed: false }, ages: [] },
          },
        ],
      },
    };
    const d = document(unused);
    const r = transactShared(d, d.network, {
      kind: 'updateConstant',
      id: 'limit',
      name: 'Limit',
      value: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues.flatMap((i) => i.uses)).toContainEqual({
        constantId: 'limit',
        poolId: '__proto__',
        field: 'invariant',
        activeMemberCount: 0,
      });
    expect(d.network).toEqual(unused);
    expect(d.past).toEqual([]);
  });

  it('keeps unrelated constant locations out of a failed constant edit', () => {
    const d = document();
    const r = transactShared(d, d.network, {
      kind: 'updateConstant',
      id: 'batch',
      name: 'Batch',
      value: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const uses = r.issues.flatMap((i) => i.uses);
      expect(uses.length).toBeGreaterThan(0);
      expect(uses.every((u) => u.constantId === 'batch')).toBe(true);
    }
  });

  it('rejects malformed descriptors before invoking getters, including hidden array entries', () => {
    let calls = 0;
    const mutations: ((s: any) => void)[] = [
      (s) => Object.defineProperty(s.shared.places, '0', { enumerable: false }),
      (s) => Object.defineProperty(s.shared.places[0].timing.ages, '0', { enumerable: false }),
      (s) =>
        Object.defineProperty(s.type, 'timed', {
          enumerable: true,
          get: () => {
            calls++;
            return true;
          },
        }),
      (s) =>
        Object.defineProperty(s.components[0].net.nodes[0], 'x', {
          enumerable: true,
          get: () => {
            calls++;
            return 0;
          },
        }),
      (s) => {
        s.type.timed = 'true';
      },
      (s) => {
        delete s.type.game;
      },
      (s) => {
        s.type.stochastic = true;
      },
      (s) => {
        s.components[1].net.nodes[2].name = 'Buffer';
      },
      (s) => {
        s.components[1].net.nodes.push({
          id: 'again',
          kind: 'place',
          sharedId: '__proto__',
          x: 0,
          y: 0,
        });
      },
      (s) => {
        s.components[1].net.nodes[0].tokens = 2;
      },
      (s) => {
        s.components[1].timing.ages = Object.fromEntries([['__proto__', ['2']]]);
      },
    ];
    for (const mutate of mutations) {
      const s = structuredClone(source());
      mutate(s);
      expect(validateSharedSource(s).ok).toBe(false);
    }
    expect(calls).toBe(0);
    for (const options of [
      null,
      { saved: 'yes' },
      { extra: true },
      Object.defineProperty({}, 'saved', {
        enumerable: true,
        get: () => {
          calls++;
          return true;
        },
      }),
    ])
      expect(openSharedDocument(source(), options as any).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('preserves query captures through permitted edits, and restores protections with undo', () => {
    const s = source();
    const savedQueries = ok(captureSharedQueries(s, ['<query>opaque</query>']));
    const d = document({ ...s, savedQueries });
    const copied = edit(d, {
      kind: 'copyComponent',
      componentId: 'constructor',
      id: 'copy',
      template: 'Copy',
    });
    const removed = edit(copied, {
      kind: 'removeOccurrence',
      componentId: 'copy',
      elementId: '__proto__',
    });
    expect(removed.network.savedQueries).toEqual(savedQueries);
    expect(
      transactShared(removed, removed.network, {
        kind: 'detach',
        componentId: 'constructor',
        elementId: '__proto__',
        name: 'Detached',
      }).ok,
    ).toBe(false);
    const unprotected = edit(removed, { kind: 'removeQueries' });
    expect(
      edit(unprotected, {
        kind: 'detach',
        componentId: 'constructor',
        elementId: '__proto__',
        name: 'Detached',
      }).network.shared,
    ).toEqual(s.shared);
    const restored = undoAuthored(unprotected);
    expect(restored.network).toBe(removed.network);
    expect(restored.network.savedQueries).toEqual(savedQueries);
  });

  it('copies geometry independently and removes a transport partner without losing pool state', () => {
    const d = document();
    const copied = edit(d, {
      kind: 'copyComponent',
      componentId: 'constructor',
      id: 'copy',
      template: 'Copy',
    });
    expect(copied.network.shared).toEqual(d.network.shared);
    expect(Object.isFrozen(copied.network.components[2].net.nodes[0])).toBe(true);
    const moved = edit(copied, {
      kind: 'patchGeometry',
      componentId: 'copy',
      elementId: '__proto__',
      geometry: { x: 99, y: 98 },
    });
    expect(moved.network.components[0].net.nodes[0].x).toBe(0);
    const removed = edit(moved, {
      kind: 'removeOccurrence',
      componentId: 'copy',
      elementId: '__proto__',
    });
    expect(removed.network.components[2].net.arcs).toEqual([]);
    expect(removed.network.components[2].timing).toEqual(emptyTiming());
    expect(removed.network.shared).toEqual(d.network.shared);
    expect(redoAuthored(undoAuthored(removed)).network).toBe(removed.network);
  });

  const invalidCommands: SharedEdit[] = [
    { kind: 'createPool', pool: { id: '__proto__', name: 'Duplicate', tokens: 0 } },
    {
      kind: 'editPool',
      pool: {
        id: '__proto__',
        name: 'Buffer',
        tokens: 0,
        timing: { invariant: null, ages: ['2'] },
      },
    },
    { kind: 'deletePool', poolId: '__proto__' },
    { kind: 'makeShared', componentId: 'constructor', elementId: 'q', poolId: 'new', name: 'Move' },
    {
      kind: 'usePool',
      componentId: 'constructor',
      elementId: 'q',
      poolId: '__proto__',
      acceptPoolValues: true,
    },
    {
      kind: 'addOccurrence',
      componentId: 'constructor',
      occurrence: { id: 'extra', kind: 'place', sharedId: '__proto__', x: 0, y: 0 },
    },
    { kind: 'detach', componentId: 'constructor', elementId: '__proto__', name: 'Move' },
    { kind: 'removeOccurrence', componentId: 'constructor', elementId: 'q' },
    { kind: 'copyComponent', componentId: 'constructor', id: 'toString', template: 'Copy' },
    { kind: 'updateConstant', id: 'limit', name: 'Limit', value: 1 },
    { kind: 'deleteConstant', id: 'limit' },
    {
      kind: 'patchGeometry',
      componentId: 'constructor',
      elementId: '__proto__',
      geometry: { x: Infinity, y: 0 },
    },
  ];
  it.each(invalidCommands)(
    'fails $kind atomically and checks stale identity before the draft',
    (command) => {
      const initial = document();
      const changed = edit(initial, {
        kind: 'patchGeometry',
        componentId: 'constructor',
        elementId: '__proto__',
        geometry: { x: 2, y: 3 },
      });
      const d = undoAuthored(changed);
      const before = JSON.stringify(d);
      expect(transactShared(d, d.network, command).ok).toBe(false);
      expect(JSON.stringify(d)).toBe(before);
      expect(redoAuthored(d).network).toBe(changed.network);
      let calls = 0;
      const draft = Object.defineProperty({}, 'kind', {
        enumerable: true,
        get: () => {
          calls++;
          return command.kind;
        },
      });
      const stale = transactShared(changed, initial.network, draft as SharedEdit);
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.issues[0].code).toBe('stale-revision');
      expect(calls).toBe(0);
      expect(edit(d, { kind: 'removeQueries' })).toBe(d);
      expect(isAuthoredDirty(d)).toBe(false);
      expect(isAuthoredDirty(markAuthoredSaved(changed))).toBe(false);
    },
  );

  it('retains generic document helpers behavior for old authored snapshots', () => {
    const s = source();
    const old: AuthoredNetwork = {
      name: s.name,
      type: s.type,
      constants: [],
      components: s.components.map((c) => ({
        ...c,
        timing: emptyTiming(),
        net: {
          ...c.net,
          nodes: c.net.nodes.slice(1) as AuthoredNetwork['components'][number]['net']['nodes'],
          arcs: [],
        },
      })),
    };
    const d = ok(openAuthoredDocument(old, { id: 'v2', saved: true }));
    const next = ok(transactDocument(d, d.network, { kind: 'removeSavedQueries' }));
    expect(next).toBe(d);
    expect(undoAuthored(d)).toBe(d);
    expect(redoAuthored(d)).toBe(d);
    expect(isAuthoredDirty(markAuthoredSaved(d))).toBe(false);
  });
});
