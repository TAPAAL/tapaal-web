// @vitest-environment jsdom
// Independent wave-1 review proofs. See design/CONSTANTS-WAVE1-REVIEW.md.
import { describe, it, expect } from 'vitest';
import {
  AuthoredNetwork,
  Result,
  captureAuthoredSavedQueries,
  constantUses,
  resolveAuthored,
} from './authored-model';
import {
  AuthoredDocument,
  AuthoredEdit,
  openAuthoredDocument,
  transactDocument,
  undoAuthored,
  redoAuthored,
} from './authored-documents';
import { validateNetwork, emptyTiming } from './resolved-network';
import type { Network } from './resolved-network';

function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const K = { constantId: 'k' };
function source(): AuthoredNetwork {
  const component = (id: string, template: string, active: boolean) => ({
    id,
    active,
    net: {
      name: 'M',
      template,
      nodes: [
        { id: 'p', name: 'P', kind: 'place' as const, tokens: 2, x: 0, y: 0 },
        { id: 't', name: 'T', kind: 'transition' as const, tokens: 0, x: 50, y: 0, angle: 30 },
        { id: 'q', name: 'Q', kind: 'place' as const, tokens: 0, x: 100, y: 0, nameVisible: false },
      ],
      arcs: [
        { id: 'in', source: 'p', target: 't', kind: 'normal' as const, weight: K },
        {
          id: 'out',
          source: 't',
          target: 'q',
          kind: 'normal' as const,
          weight: K,
          bends: [{ x: 75, y: 9, curved: true }],
        },
      ],
      annotations: [{ id: 'n', text: 'note', x: 0, y: 0, width: 10, height: 10 }],
    },
    timing: {
      ...emptyTiming(),
      intervals: {
        in: { lower: { constantId: 'zero' }, upper: null, lowerClosed: true, upperClosed: false },
      },
      invariants: { p: { upper: { constantId: 'd' }, upperClosed: true } },
      transports: [{ inputArc: 'in', outputArc: 'out' }],
      ages: { p: ['3'] },
    },
  });
  return {
    name: 'M',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [
      { id: 'k', name: 'K', value: 1 },
      { id: 'd', name: 'D', value: 5 },
      { id: 'zero', name: 'Zero', value: 0 },
    ],
    components: [component('a', 'A', true), component('b', 'B', false)],
  };
}
const open = (s = source()) => value(openAuthoredDocument(s));
const edit = (d: AuthoredDocument, e: AuthoredEdit) => transactDocument(d, d.network, e);
function hiddenIndex<T>(items: readonly T[], index: number): T[] {
  const copy = [...items];
  Object.defineProperty(copy, index, { value: copy[index], enumerable: false });
  return copy;
}

describe('wave-1 review: hidden array entries', () => {
  it('F1 rejects a non-enumerable declaration instead of cloning it away', () => {
    const s = { ...source(), constants: hiddenIndex(source().constants, 0) };
    const r = resolveAuthored(s);
    // Contract: hidden fields are rejected before cloning. Actual: ok, but the source revision
    // has a hole where K was declared while weights still reference K.
    if (r.ok) expect(r.value.source.constants[0]).toEqual({ id: 'k', name: 'K', value: 1 });
    expect(r.ok).toBe(false);
  });
  it('a patch with a non-enumerable note is rejected via the numeric projection', () => {
    const d = open();
    const net = d.network.components[0].net;
    const r = edit(d, {
      kind: 'patchNet',
      componentId: 'a',
      net: { ...net, annotations: hiddenIndex(net.annotations!, 0) },
    });
    if (r.ok) expect(resolveAuthored(r.value.network).ok).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe('wave-1 review: hidden protection entry', () => {
  it('F1 opening cannot drop a query protection and wedge the document', () => {
    const s = source();
    const q = value(captureAuthoredSavedQueries(s, ['<query name="Q" query="EF A.P &gt; 0"/>']));
    const r = openAuthoredDocument({
      ...s,
      savedQueries: { ...q, protectedConstants: hiddenIndex(q.protectedConstants, 0) },
    });
    if (r.ok) {
      // Actual: the stored protection list has a hole; every later edit fails to resolve.
      expect(r.value.network.savedQueries!.protectedConstants[0]).toEqual({ id: 'k', name: 'K' });
      expect(edit(r.value, { kind: 'updateConstant', id: 'd', name: 'D', value: 4 }).ok).toBe(true);
    }
    expect(r.ok).toBe(false);
  });
});

describe('wave-1 review: document opening', () => {
  it('rejects session accessors without executing them', () => {
    let reads = 0;
    const session = { componentId: 'a', views: {} };
    Object.defineProperty(session, 'componentId', {
      enumerable: true,
      get() {
        reads++;
        return 'a';
      },
    });
    expect(openAuthoredDocument(source(), { session }).ok).toBe(false);
    expect(reads).toBe(0);
  });
  it('rejects malformed session view data', () => {
    expect(
      openAuthoredDocument(source(), {
        session: {
          componentId: 'a',
          views: {
            a: {
              viewport: { x: NaN, y: 0, zoom: 100 },
              selectedIds: [],
            },
          },
        },
      }).ok,
    ).toBe(false);
  });
  it('F2 refuses a session naming an unknown component', () => {
    const r = openAuthoredDocument(source(), { session: { componentId: 'nope', views: {} } });
    expect(r.ok).toBe(false);
  });
});

describe('wave-1 review: contracts that hold', () => {
  it('validates ages against a symbolic invariant in an inactive component', () => {
    const d = open();
    const r = edit(d, { kind: 'updateConstant', id: 'd', name: 'D', value: 2 });
    expect(r.ok).toBe(false);
    expect(d.network.constants[1].value).toBe(5);
    expect(value(edit(d, { kind: 'updateConstant', id: 'd', name: 'D', value: 3 })).past).toEqual([
      d.network,
    ]);
  });
  it('keeps [Zero,inf) authored, omits it numerically and refuses it on urgent inputs', () => {
    const r = value(resolveAuthored(source()));
    expect(r.numeric.components[1].timing!.intervals).toEqual({});
    expect(r.source.components[1].timing!.intervals['in'].lower).toEqual({ constantId: 'zero' });
    const s = source();
    const urgent = {
      ...s,
      components: s.components.map((c) => ({ ...c, timing: { ...c.timing!, urgent: ['t'] } })),
    };
    expect(resolveAuthored(urgent).ok).toBe(false);
  });
  it('numeric core refuses authored terms (no bypass)', () => {
    const numeric = structuredClone(value(resolveAuthored(source())).numeric) as Network;
    const withRef = (arcWeight: unknown) => ({
      ...numeric,
      components: numeric.components.map((c) => ({
        ...c,
        net: { ...c.net, arcs: c.net.arcs.map((a) => ({ ...a, weight: arcWeight })) },
      })),
    });
    expect(() => validateNetwork(withRef(K) as unknown as Network)).toThrow();
    const bound = {
      ...numeric,
      components: numeric.components.map((c) => ({
        ...c,
        timing: { ...c.timing!, invariants: { p: { upper: K, upperClosed: true } } },
      })),
    };
    expect(() => validateNetwork(bound as unknown as Network)).toThrow();
  });
  it('copies with global IDs, ages, transports, geometry; uses count the copy', () => {
    const d = value(
      edit(open(), { kind: 'copyComponent', componentId: 'b', id: 'c', template: 'C' }),
    );
    const copy = d.network.components[2];
    expect(copy).toEqual({ ...d.network.components[1], id: 'c', net: { ...copy.net } });
    expect(copy.net.template).toBe('C');
    expect(constantUses(d.network, 'k').filter((u) => u.componentId === 'c')).toHaveLength(2);
    expect(edit(d, { kind: 'deleteConstant', id: 'k' }).ok).toBe(false);
  });
  it('removing an arc pair drops its timing and use; query guards survive', () => {
    const s = source();
    const q = {
      ...s,
      savedQueries: value(
        captureAuthoredSavedQueries(s, ['<query name="Q" query="EF A.P &gt; 0"/>']),
      ),
    };
    const d = open(q);
    const net = d.network.components[0].net;
    const next = value(edit(d, { kind: 'patchNet', componentId: 'a', net: { ...net, arcs: [] } }));
    expect(next.network.components[0].timing!.intervals).toEqual({});
    expect(next.network.components[0].timing!.transports).toEqual([]);
    expect(next.network.savedQueries).toEqual(d.network.savedQueries);
    expect(constantUses(next.network, 'k').some((u) => u.componentId === 'a')).toBe(false);
    // Protected node removal stays refused; rename refused; value change allowed.
    expect(
      edit(next, {
        kind: 'patchNet',
        componentId: 'a',
        net: { ...next.network.components[0].net, nodes: [] },
      }).ok,
    ).toBe(false);
    expect(edit(next, { kind: 'updateConstant', id: 'zero', name: 'Z', value: 0 }).ok).toBe(false);
    expect(edit(next, { kind: 'updateConstant', id: 'k', name: 'K', value: 2 }).ok).toBe(true);
    // Explicit removal is the only path, undoable to identical protections.
    const removed = value(edit(next, { kind: 'removeSavedQueries' }));
    const renamed = value(
      edit(removed, { kind: 'updateConstant', id: 'zero', name: 'Z', value: 0 }),
    );
    const back = undoAuthored(undoAuthored(renamed));
    expect(back.network).toBe(next.network);
    expect(redoAuthored(back).network).toBe(removed.network);
  });
  it('does not mutate or freeze caller drafts', () => {
    const d = open();
    const term = { constantId: 'd' };
    const r = value(edit(d, { kind: 'setWeightTerm', componentId: 'a', arcId: 'in', term }));
    expect(Object.isFrozen(term)).toBe(false);
    const arcs = r.network.components[0].net.arcs;
    expect(arcs[0].weight).not.toBe(term);
    expect(arcs[1].weight).toEqual(term);
  });
});
