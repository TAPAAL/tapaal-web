// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Result, AuthoredNetwork, freezeAuthored, resolveAuthored } from './authored-model';
import { emptyTiming } from './resolved-network';
import {
  undoAuthored,
  redoAuthored,
  markAuthoredSaved,
  isAuthoredDirty,
} from './authored-documents';
import {
  SharedSource,
  SharedPlace,
  SharedEdit,
  SharedDocument,
  SharedOccurrence,
  sharedFromAuthored,
  validateSharedSource,
  openSharedDocument,
  transactShared,
  captureSharedQueries,
  sharedConstantUses,
} from './authored-shared';
function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function local(): AuthoredNetwork {
  return {
    name: 'Model',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [{ id: 'k', name: 'K', value: 5 }],
    components: ['a', 'b'].map((id) => ({
      id,
      active: id === 'a',
      net: {
        name: 'Model',
        template: id.toUpperCase(),
        nodes: [
          {
            id: 'p',
            kind: 'place',
            name: 'P',
            tokens: 2,
            x: 1,
            y: 2,
            nameVisible: false,
            nameOffsetX: 3,
          },
          { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 100, y: 2 },
          { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 200, y: 2 },
        ],
        arcs: [
          {
            id: 'in',
            kind: 'normal',
            source: 'p',
            target: 't',
            weight: { constantId: 'k' },
            bends: [{ x: 50, y: 10, curved: true }],
          },
          {
            id: 'out',
            kind: 'normal',
            source: 't',
            target: 'q',
            weight: { constantId: 'k' },
            curvedEnd: true,
          },
        ],
      },
      timing: {
        ...emptyTiming(),
        ages: { p: ['2'] },
        invariants: { p: { upper: { constantId: 'k' }, upperClosed: true } },
        intervals: { in: { lower: '1', upper: null, lowerClosed: true, upperClosed: false } },
        transports: [{ inputArc: 'in', outputArc: 'out' }],
      },
    })),
  };
}
function doc(): SharedDocument {
  return value(openSharedDocument(value(sharedFromAuthored(local())), { id: 'doc', saved: true }));
}
function edit(d: SharedDocument, e: SharedEdit) {
  return value(transactShared(d, d.network, e));
}
function shared(d = doc()) {
  return edit(d, {
    kind: 'makeShared',
    componentId: 'a',
    elementId: 'p',
    poolId: 'pool',
    name: 'Pool',
  });
}
function occurrence(id = 'member', sharedId = 'pool'): SharedOccurrence {
  return { id, kind: 'place', sharedId, x: 4, y: 5 };
}
function pool(id = 'unused'): SharedPlace {
  return {
    id,
    name: 'Unused',
    tokens: 1,
    timing: { ages: ['3'], invariant: { upper: { constantId: 'k' }, upperClosed: true } },
  };
}
function changed(d: SharedDocument, transform: (s: any) => void): SharedSource {
  const s = structuredClone(d.network);
  transform(s);
  return s;
}

describe('internal shared-place source and single-snapshot document adapter', () => {
  it('opts in without inferring equal local names or opening the old resolver gate', () => {
    const d = doc();
    expect(d.network.shared.places).toEqual([]);
    expect(d.network.components.map((c) => c.net.nodes[0])).toEqual([
      local().components[0].net.nodes[0],
      local().components[1].net.nodes[0],
    ]);
    expect(resolveAuthored(shared().network as unknown as AuthoredNetwork).ok).toBe(false);
    expect(sharedFromAuthored(shared().network as unknown as AuthoredNetwork).ok).toBe(false);
  });
  it('transfers SOURCE terms and sparse ages exactly; geometry/routes stay local', () => {
    const before = doc(),
      after = shared(before),
      p = after.network.shared.places[0];
    expect(p).toEqual({
      id: 'pool',
      name: 'Pool',
      tokens: 2,
      timing: { ages: ['2'], invariant: { upper: { constantId: 'k' }, upperClosed: true } },
    });
    expect(after.network.components[0].net.nodes[0]).toEqual({
      id: 'p',
      kind: 'place',
      sharedId: 'pool',
      x: 1,
      y: 2,
      nameVisible: false,
      nameOffsetX: 3,
    });
    expect(after.network.components[0].timing!.ages).toEqual({});
    expect(after.network.components[0].timing!.invariants).toEqual({});
    expect(after.network.components[0].net.arcs).toEqual(before.network.components[0].net.arcs);
    expect(after.past).toEqual([before.network]);
    expect(Object.isFrozen(p.timing!.ages)).toBe(true);
    expect(undoAuthored(after).network).toBe(before.network);
    expect(redoAuthored(undoAuthored(after)).network).toBe(after.network);
  });
  it('requires explicit adoption of differing source values, including symbolic equality', () => {
    const d = shared();
    const altered = changed(d, (s) => {
      s.components[1].timing.invariants.p.upper = '5';
    });
    const base = value(openSharedDocument(altered));
    const command: SharedEdit = {
      kind: 'usePool',
      componentId: 'b',
      elementId: 'p',
      poolId: 'pool',
      acceptPoolValues: false,
    };
    expect(transactShared(base, base.network, command).ok).toBe(false);
    const next = edit(base, { ...command, acceptPoolValues: true });
    expect(next.network.shared.places[0].tokens).toBe(2);
    expect(next.network.components[1].timing!.ages).toEqual({});
    expect(edit(d, command).network.shared.places[0].tokens).toBe(2);
  });
  it('detaches a copy of pool SOURCE semantics and leaves pool unchanged', () => {
    const d = shared(),
      next = edit(d, { kind: 'detach', componentId: 'a', elementId: 'p', name: 'Detached' });
    expect(next.network.shared).toEqual(d.network.shared);
    expect(next.network.components[0].net.nodes[0]).toEqual({
      ...local().components[0].net.nodes[0],
      name: 'Detached',
    });
    expect(next.network.components[0].timing).toEqual(local().components[0].timing);
    expect(undoAuthored(next).network).toBe(d.network);
    expect(
      transactShared(d, d.network, {
        kind: 'detach',
        componentId: 'a',
        elementId: 'p',
        name: 'Pool',
      }).ok,
    ).toBe(false);
  });
  it('copies membership without adding tokens; moving the copy cannot move original', () => {
    const d = shared(),
      copied = edit(d, {
        kind: 'copyComponent',
        componentId: 'a',
        id: '__proto__',
        template: 'Copy',
      });
    expect(copied.network.shared).toEqual(d.network.shared);
    expect(copied.past.length).toBe(d.past.length + 1);
    const moved = edit(copied, {
      kind: 'patchGeometry',
      componentId: '__proto__',
      elementId: 'p',
      geometry: { x: 99, y: 30 },
    });
    expect(moved.network.components[0].net.nodes[0].x).toBe(1);
    expect(moved.network.components[2].net.nodes[0].x).toBe(99);
    expect(
      transactShared(d, d.network, {
        kind: 'patchGeometry',
        componentId: 'a',
        elementId: 'p',
        geometry: { x: 4, y: 5, tokens: 88 },
      } as any).ok,
    ).toBe(false);
  });
  it('removes both transport halves and their timing, while retaining other source metadata', () => {
    const d = shared(),
      next = edit(d, { kind: 'removeOccurrence', componentId: 'a', elementId: 'p' });
    expect(next.network.components[0].net.arcs).toEqual([]);
    expect(next.network.components[0].timing).toEqual(emptyTiming());
    expect(next.network.shared).toEqual(d.network.shared);
    expect(next.network.components[1]).toEqual(d.network.components[1]);
    expect(edit(next, { kind: 'deletePool', poolId: 'pool' }).network.shared.places).toEqual([]);
    expect(transactShared(d, d.network, { kind: 'deletePool', poolId: 'pool' }).ok).toBe(false);
  });
  it('counts global constants once, even unused/inactive; invalid edits fail atomically', () => {
    let d = shared();
    d = edit(d, {
      kind: 'usePool',
      componentId: 'b',
      elementId: 'p',
      poolId: 'pool',
      acceptPoolValues: false,
    });
    expect(sharedConstantUses(d.network, 'k').filter((u) => u.poolId)).toEqual([
      { constantId: 'k', poolId: 'pool', field: 'invariant', activeMemberCount: 1 },
    ]);
    d = edit(d, { kind: 'createPool', pool: pool() });
    expect(
      sharedConstantUses(d.network, 'k').find((u) => u.poolId === 'unused')!.activeMemberCount,
    ).toBe(0);
    expect(
      transactShared(d, d.network, { kind: 'updateConstant', id: 'k', name: 'K', value: 1 }).ok,
    ).toBe(false);
    const deleted = transactShared(d, d.network, { kind: 'deleteConstant', id: 'k' });
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) expect(deleted.issues[0].uses.filter((u) => u.poolId).length).toBe(2);
    expect(
      edit(d, { kind: 'updateConstant', id: 'k', name: 'Limit', value: 5 }).network.shared,
    ).toEqual(d.network.shared);
  });
  it('protects unused symbols, local conversions and membership, until explicit query removal', () => {
    const initial = edit(shared(), { kind: 'createPool', pool: pool() });
    const q = value(
      captureSharedQueries(initial.network, [
        '<query name="opaque"><formula>Pool</formula></query>',
      ]),
    );
    const d = value(openSharedDocument({ ...initial.network, savedQueries: q }));
    const commands: SharedEdit[] = [
      { kind: 'editPool', pool: { ...d.network.shared.places[0], name: 'Renamed' } },
      { kind: 'deletePool', poolId: 'unused' },
      { kind: 'detach', componentId: 'a', elementId: 'p', name: 'Detached' },
      { kind: 'removeOccurrence', componentId: 'a', elementId: 'p' },
      { kind: 'makeShared', componentId: 'b', elementId: 'p', poolId: 'new', name: 'New' },
      { kind: 'usePool', componentId: 'b', elementId: 'p', poolId: 'pool', acceptPoolValues: true },
      { kind: 'updateConstant', id: 'k', name: 'Renamed', value: 5 },
    ];
    for (const command of commands)
      expect(transactShared(d, d.network, command).ok, command.kind).toBe(false);
    const geometry = edit(d, {
      kind: 'patchGeometry',
      componentId: 'a',
      elementId: 'p',
      geometry: { x: 30, y: 40 },
    });
    expect(geometry.network.savedQueries).toEqual(q);
    const unprotected = edit(d, { kind: 'removeQueries' });
    for (const command of commands)
      expect(transactShared(unprotected, unprotected.network, command).ok, command.kind).toBe(true);
    expect(undoAuthored(unprotected).network).toBe(d.network);
    const added = edit(d, {
      kind: 'addOccurrence',
      componentId: 'a',
      occurrence: occurrence('new', 'unused'),
    });
    expect(
      edit(added, { kind: 'removeOccurrence', componentId: 'a', elementId: 'new' }).network
        .savedQueries,
    ).toEqual(q);
  });
  it('uses exact whole-source history; stale/no-op/failure preserve redo and saved state', () => {
    const before = doc(),
      after = shared(before),
      undone = undoAuthored(after);
    expect(isAuthoredDirty(before)).toBe(false);
    expect(isAuthoredDirty(after)).toBe(true);
    expect(isAuthoredDirty(markAuthoredSaved(after))).toBe(false);
    expect(edit(undone, { kind: 'removeQueries' })).toBe(undone);
    expect(transactShared(after, before.network, { kind: 'removeQueries' }).ok).toBe(false);
    expect(
      transactShared(undone, undone.network, { kind: 'deletePool', poolId: 'missing' }).ok,
    ).toBe(false);
    expect(redoAuthored(undone).network).toBe(after.network);
    expect(edit(undone, { kind: 'createPool', pool: pool() }).future).toEqual([]);
  });
  it('accepts zero tokens/default ages, inclusive zero bounds and source above runtime capacity', () => {
    const d = doc();
    for (const tokens of [0, 1, 1000000000]) {
      const next = edit(d, {
        kind: 'createPool',
        pool: {
          id: 'z',
          name: 'Zero',
          tokens,
          timing: { ages: [], invariant: { upper: '0', upperClosed: true } },
        },
      });
      expect(validateSharedSource(next.network).ok).toBe(true);
    }
    const inactive = changed(shared(), (s) => {
      for (const c of s.components) c.active = false;
    });
    expect(validateSharedSource(inactive).ok).toBe(true);
    expect(sharedConstantUses(inactive, 'k').find((u) => u.poolId)!.activeMemberCount).toBe(0);
  });
  it('uses prototype-safe IDs for pools, nodes and timing maps', () => {
    let d = edit(doc(), {
      kind: 'makeShared',
      componentId: 'a',
      elementId: 'p',
      poolId: '__proto__',
      name: 'Global',
    });
    d = edit(d, {
      kind: 'addOccurrence',
      componentId: 'b',
      occurrence: occurrence('constructor', '__proto__'),
    });
    expect(validateSharedSource(d.network).ok).toBe(true);
    d = edit(d, { kind: 'detach', componentId: 'b', elementId: 'constructor', name: 'Other' });
    expect(Object.hasOwn(d.network.components[1].timing!.invariants, 'constructor')).toBe(true);
  });
  it.each([
    [
      'member semantic fields',
      (s: any) => {
        s.components[0].net.nodes[0].tokens = 2;
      },
    ],
    [
      'member name',
      (s: any) => {
        s.components[0].net.nodes[0].name = 'Pool';
      },
    ],
    [
      'member timing',
      (s: any) => {
        s.components[0].timing.ages.p = ['2'];
      },
    ],
    [
      'dangling ref',
      (s: any) => {
        s.components[0].net.nodes[0].sharedId = 'missing';
      },
    ],
    [
      'wrong kind',
      (s: any) => {
        s.components[0].net.nodes[0].kind = 'transition';
      },
    ],
    [
      'duplicate membership',
      (s: any) => {
        s.components[0].net.nodes.push(occurrence());
      },
    ],
    [
      'inactive collision',
      (s: any) => {
        s.components[1].net.nodes[1].name = 'Pool';
      },
    ],
    [
      'duplicate pool ID',
      (s: any) => {
        s.shared.places.push({ ...s.shared.places[0], name: 'Other' });
      },
    ],
    [
      'transition missing urgency',
      (s: any) => {
        s.shared.transitions.push({ id: 'sync', name: 'Sync' });
      },
    ],
    [
      'import-style member',
      (s: any) => {
        s.components[1].net.nodes[0].shared = true;
      },
    ],
    [
      'unused invalid age',
      (s: any) => {
        s.shared.places.push({
          ...pool(),
          timing: { ages: ['6'], invariant: { upper: '5', upperClosed: true } },
        });
      },
    ],
    [
      'zero explicit age',
      (s: any) => {
        s.shared.places[0].timing.ages = ['0'];
      },
    ],
    [
      'missing ages',
      (s: any) => {
        delete s.shared.places[0].timing.ages;
      },
    ],
    [
      'unknown pool field',
      (s: any) => {
        s.shared.places[0].urgent = false;
      },
    ],
    [
      'unbound unused constant',
      (s: any) => {
        s.shared.places.push({
          ...pool(),
          timing: { ages: [], invariant: { upper: { constantId: 'no' }, upperClosed: true } },
        });
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    expect(validateSharedSource(changed(shared(), mutate)).ok).toBe(false);
  });
  it('edits and renames pools by stable ID, with one history entry and full revalidation', () => {
    const d = shared();
    const renamed = edit(d, {
      kind: 'editPool',
      pool: { ...d.network.shared.places[0], name: 'Renamed' },
    });
    expect(renamed.network.shared.places[0].id).toBe('pool');
    expect(renamed.network.components).toEqual(d.network.components);
    expect(renamed.past.length).toBe(d.past.length + 1);
    const revised = edit(renamed, {
      kind: 'editPool',
      pool: { id: 'pool', name: 'Renamed', tokens: 0, timing: { ages: [], invariant: null } },
    });
    expect(revised.network.components).toEqual(d.network.components);
    expect(undoAuthored(revised).network).toBe(renamed.network);
    expect(edit(revised, { kind: 'editPool', pool: revised.network.shared.places[0] })).toBe(
      revised,
    );
    expect(
      transactShared(d, d.network, { kind: 'editPool', pool: { ...pool('pool'), tokens: 0 } }).ok,
    ).toBe(false);
  });
  it('supports untimed pools and refuses timed semantics in an untimed source', () => {
    const original = local();
    const untimed: AuthoredNetwork = {
      ...original,
      type: { ...original.type, timed: false },
      components: original.components.map(({ timing: _timing, ...c }) => c),
    };
    const d = shared(value(openSharedDocument(value(sharedFromAuthored(untimed)))));
    expect(d.network.shared.places[0]).toEqual({ id: 'pool', name: 'Pool', tokens: 2 });
    expect(transactShared(d, d.network, { kind: 'createPool', pool: pool() }).ok).toBe(false);
    expect(
      edit(d, { kind: 'detach', componentId: 'a', elementId: 'p', name: 'Detached' }).network
        .components[0].timing,
    ).toBeUndefined();
  });
  it('transfers zero marking without inventing ages or a finite invariant', () => {
    const d = value(
      openSharedDocument(
        changed(doc(), (s) => {
          s.components[0].net.nodes[0].tokens = 0;
          s.components[0].timing.ages = {};
          s.components[0].timing.invariants = {};
        }),
      ),
    );
    const next = shared(d);
    expect(next.network.shared.places[0].timing).toEqual({ ages: [], invariant: null });
    expect(next.network.shared.places[0].tokens).toBe(0);
    expect(undoAuthored(next).network).toBe(d.network);
  });
  it('does not lose validation evidence through the projection or occurrence command', () => {
    expect(
      validateSharedSource(
        changed(shared(), (s) => {
          for (const c of s.components) c.active = false;
          delete s.components[0].active;
        }),
      ).ok,
    ).toBe(false);
    const d = shared();
    expect(
      transactShared(d, d.network, {
        kind: 'addOccurrence',
        componentId: 'a',
        occurrence: { id: 'local', kind: 'place', name: 'Extra', tokens: 0, x: 0, y: 0 },
      } as any).ok,
    ).toBe(false);
    expect(
      validateSharedSource(
        changed(d, (s) => {
          s.components[1].active = false;
          s.shared.places[0].timing.invariant.upper = '1';
        }),
      ).ok,
    ).toBe(false);
  });
  it('resolves prototype-named constant IDs without looking them up on Object.prototype', () => {
    const d = value(
      openSharedDocument(
        changed(doc(), (s) => {
          s.constants[0].id = '__proto__';
          for (const c of s.components) {
            c.timing.invariants.p.upper.constantId = '__proto__';
            for (const arc of c.net.arcs) arc.weight.constantId = '__proto__';
          }
        }),
      ),
    );
    expect(validateSharedSource(shared(d).network).ok).toBe(true);
    expect(sharedConstantUses(shared(d).network, '__proto__').filter((u) => u.poolId).length).toBe(
      1,
    );
  });
  it('rejects accessors, nonenumerable/inherited/unknown fields and hostile arrays before cloning', () => {
    let calls = 0;
    const mutations = [
      (s: any) =>
        Object.defineProperty(s.shared.places[0], 'name', {
          enumerable: true,
          get: () => {
            calls++;
            return 'Pool';
          },
        }),
      (s: any) => Object.defineProperty(s.shared.places[0], 'hidden', { value: 1 }),
      (s: any) => Object.setPrototypeOf(s.shared.places[0], { inherited: true }),
      (s: any) => {
        s.shared.places.extra = true;
      },
      (s: any) => {
        delete s.shared.places[0];
      },
      (s: any) => {
        s.shared.places[0][Symbol('hidden')] = 1;
      },
    ];
    for (const mutate of mutations)
      expect(validateSharedSource(changed(shared(), mutate)).ok).toBe(false);
    const draft = { kind: 'editPool', pool: { ...pool() } } as any;
    Object.defineProperty(draft.pool, 'tokens', {
      enumerable: true,
      get: () => {
        calls++;
        return 1;
      },
    });
    const d = shared();
    expect(transactShared(d, d.network, draft).ok).toBe(false);
    expect(calls).toBe(0);
    const frozen = freezeAuthored(structuredClone(d.network));
    expect(validateSharedSource(frozen).ok).toBe(true);
  });
});

describe('shared local source-command adapter', () => {
  it('checks captured source before inspecting a nested draft, retaining redo and saved aliases', () => {
    const initial = shared(),
      changed = edit(initial, {
        kind: 'patchGeometry',
        componentId: 'a',
        elementId: 'p',
        geometry: { x: 50, y: 20 },
      });
    const undone = undoAuthored(changed);
    let reads = 0;
    const draft = Object.defineProperty({}, 'edit', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('must not read');
      },
    });
    const result = transactShared(undone, changed.network, draft as SharedEdit);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe('stale-revision');
    expect(reads).toBe(0);
    expect(undone.future[0]).toBe(changed.network);
    expect(undone.saved).toBe(initial.saved);
  });
  it('preserves shared sentinels on symbolic local commands and rejects member semantic edits atomically', () => {
    const before = shared();
    const changed = edit(before, {
      kind: 'localEdit',
      edit: { kind: 'setWeightTerm', componentId: 'a', arcId: 'in', term: 2 },
    });
    expect(changed.network.components[0].net.arcs.map((a) => a.weight)).toEqual([2, 2]);
    expect(changed.network.components[0].net.nodes[0]).toEqual(
      before.network.components[0].net.nodes[0],
    );
    expect(changed.network.components[0].timing!.invariants).not.toHaveProperty('p');
    expect(changed.network.shared).toEqual(before.network.shared);
    expect(undoAuthored(changed).network).toBe(before.network);
    expect(
      transactShared(before, before.network, {
        kind: 'localEdit',
        edit: { kind: 'setInvariant', componentId: 'a', placeId: 'p', invariant: null },
      }).ok,
    ).toBe(false);
    expect(
      transactShared(before, before.network, {
        kind: 'localEdit',
        edit: { kind: 'copyComponent', componentId: 'a', id: 'bad', template: 'BadCopy' },
      }).ok,
    ).toBe(false);
    expect(before.future).toEqual([]);
  });
  it('can remove the only active component while keeping inactive source and a dormant pool', () => {
    const before = shared();
    const changed = edit(before, {
      kind: 'localEdit',
      edit: { kind: 'removeComponent', componentId: 'a' },
    });
    expect(changed.network.components.map((c) => [c.id, c.active])).toEqual([['b', false]]);
    expect(changed.network.shared).toEqual(before.network.shared);
    expect(undoAuthored(changed).network).toBe(before.network);
  });
});
