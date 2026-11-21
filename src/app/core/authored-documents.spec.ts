// @vitest-environment jsdom
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
  markAuthoredSaved,
  isAuthoredDirty,
  authoredDocumentFromNumeric,
} from './authored-documents';
import { createDocument, renameDocument, markSaved } from './documents';
import { emptyTiming } from './resolved-network';
function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
function document(queries = false): AuthoredDocument {
  let source: AuthoredNetwork = {
    name: 'Model',
    type: { timed: true, colored: false, game: false, stochastic: false },
    constants: [
      { id: 'batch', name: 'Batch', value: 2 },
      { id: 'deadline', name: 'Deadline', value: 5 },
    ],
    components: [
      {
        id: 'a',
        active: true,
        net: {
          name: 'Model',
          template: 'A',
          nodes: [
            {
              id: 'p',
              name: 'P',
              kind: 'place',
              tokens: 2,
              x: 1,
              y: 2,
              nameVisible: false,
              nameOffsetX: -2,
              nameOffsetY: 3,
            },
            { id: 't', name: 'T', kind: 'transition', tokens: 0, x: 100, y: 2, angle: 45 },
            { id: 'q', name: 'Q', kind: 'place', tokens: 0, x: 200, y: 2 },
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
              text: 'Text\nline',
              x: 1,
              y: 2,
              width: 80,
              height: 30,
              border: false,
              filled: false,
            },
          ],
        },
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
          transports: [{ inputArc: 'in', outputArc: 'out' }],
          ages: { p: ['1', '2'] },
        },
      },
    ],
  };
  if (queries)
    source = {
      ...source,
      savedQueries: value(
        captureAuthoredSavedQueries(source, [
          '<query name="Q" query="EF A.P &gt; 0"><!-- Batch stays verbatim --></query>',
        ]),
      ),
    };
  return value(openAuthoredDocument(source, { saved: true }));
}
const edit = (d: AuthoredDocument, e: AuthoredEdit) => value(transactDocument(d, d.network, e));
const update = (id: string, name: string, value: number): AuthoredEdit => ({
  kind: 'updateConstant',
  id,
  name,
  value,
});

describe('atomic authored documents', () => {
  it('adapts legacy current/saved/history snapshots without retaining numeric dual state', () => {
    const original = markSaved(createDocument({ name: 'Original' }));
    const legacy = renameDocument(original, 'Renamed');
    const d = value(authoredDocumentFromNumeric(legacy));
    expect(d.network.constants).toEqual([]);
    expect(d.past[0].constants).toEqual([]);
    expect(d.saved).toBe(d.past[0]);
    expect(d.session).toEqual(legacy.session);
    expect(Object.keys(d).sort()).toEqual(
      ['id', 'network', 'past', 'future', 'saved', 'session'].sort(),
    );
    expect(undoAuthored(d).network.name).toBe('Original');
    expect(legacy.network.name).toBe('Renamed');
  });
  it('one edit updates shared transport weight once, freezes snapshots and undoes atomically', () => {
    const d = document();
    const next = edit(d, update('batch', 'Batch', 3));
    expect(next.past).toEqual([d.network]);
    expect(next.saved).toBe(d.saved);
    expect(next.session).toBe(d.session);
    expect(next.network.components[0].net.arcs.map((a) => a.weight)).toEqual([
      { constantId: 'batch' },
      { constantId: 'batch' },
    ]);
    expect(
      value(resolveAuthored(next.network)).numeric.components[0].net.arcs.map((a) => a.weight),
    ).toEqual([3, 3]);
    expect(undoAuthored(next).network).toBe(d.network);
    expect(redoAuthored(undoAuthored(next)).network).toBe(next.network);
    expect(Object.isFrozen(next.network.components[0].net.arcs[0].bends)).toBe(true);
    expect(isAuthoredDirty(next)).toBe(true);
    expect(isAuthoredDirty(markAuthoredSaved(next))).toBe(false);
  });
  it('rejects Batch 2→0 without changing document/history/session/saved/query identities', () => {
    const d = document(true);
    const refs = [d.network, d.past, d.future, d.session, d.saved, d.network.savedQueries];
    const r = transactDocument(d, d.network, update('batch', 'Batch', 0));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues[0].uses).toContainEqual({
        constantId: 'batch',
        componentId: 'a',
        elementId: 'in',
        field: 'weight',
        active: true,
      });
    [d.network, d.past, d.future, d.session, d.saved, d.network.savedQueries].forEach((v, i) =>
      expect(v).toBe(refs[i]),
    );
  });
  it('rejects Deadline 5→7 because an inactive component uses [Deadline,6]', () => {
    let d = document();
    d = edit(d, { kind: 'copyComponent', componentId: 'a', id: 'b', template: 'B' });
    d = edit(d, { kind: 'patchComponent', componentId: 'b', active: false, template: 'B' });
    d = edit(d, {
      kind: 'setInterval',
      componentId: 'b',
      arcId: 'in',
      interval: {
        lower: { constantId: 'deadline' },
        upper: '6',
        lowerClosed: true,
        upperClosed: true,
      },
    });
    const r = transactDocument(d, d.network, update('deadline', 'Deadline', 7));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.issues[0].uses.some((u) => u.componentId === 'b' && u.active === false)).toBe(true);
    expect(d.network.constants[1].value).toBe(5);
  });
  it('checks stale revision before interpreting an edit, preserves no-op aliases and clears future on success', () => {
    const d = document(),
      next = edit(d, update('batch', 'Batch', 3));
    const stale = transactDocument(next, d.network, null as unknown as AuthoredEdit);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.issues[0].code).toBe('stale-revision');
    const undone = undoAuthored(next);
    expect(edit(undone, update('batch', 'Batch', 2))).toBe(undone);
    expect(edit(undone, update('batch', 'Batch', 4)).future).toEqual([]);
  });
  it('keeps IDs stable through rename/undo and refuses in-use deletion', () => {
    const d = document(),
      renamed = edit(d, update('batch', 'Renamed', 2));
    expect(renamed.network.constants[0].id).toBe('batch');
    expect(constantUses(renamed.network, 'batch')).toHaveLength(2);
    expect(undoAuthored(renamed).network).toBe(d.network);
    const r = transactDocument(d, d.network, { kind: 'deleteConstant', id: 'batch' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe('in-use');
  });
  it('protects all declarations captured with queries, allows value changes/additions without recapture', () => {
    const d = document(true),
      q = d.network.savedQueries;
    for (const e of [
      update('batch', 'Changed', 2),
      { kind: 'deleteConstant', id: 'deadline' } as const,
    ]) {
      const r = transactDocument(d, d.network, e);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].code).toBe('query-protected');
    }
    const changed = edit(d, update('batch', 'Batch', 3));
    expect(changed.network.savedQueries).toEqual(q);
    const added = edit(changed, {
      kind: 'addConstant',
      constant: { id: 'new', name: 'New', value: 1 },
    });
    expect(added.network.savedQueries!.protectedConstants).toEqual(q!.protectedConstants);
    expect(edit(added, update('new', 'Renamed', 1)).network.constants[2].name).toBe('Renamed');
    const removed = edit(d, { kind: 'removeSavedQueries' });
    expect(removed.network.savedQueries).toBeUndefined();
    expect(edit(removed, update('batch', 'Renamed', 2)).network.constants[0].name).toBe('Renamed');
    expect(undoAuthored(removed).network).toBe(d.network);
    expect(redoAuthored(undoAuthored(removed)).network).toBe(removed.network);
  });
  it('retains existing query node/component guards across topology and name edits', () => {
    const d = document(true),
      c = d.network.components[0];
    for (const e of [
      { kind: 'patchComponent', componentId: 'a', active: true, template: 'Other' },
      {
        kind: 'patchNet',
        componentId: 'a',
        net: {
          ...c.net,
          nodes: c.net.nodes.map((n) => (n.id === 'p' ? { ...n, name: 'Other' } : n)),
        },
      },
      { kind: 'patchNet', componentId: 'a', net: { ...c.net, nodes: [], arcs: [] } },
    ] satisfies AuthoredEdit[])
      expect(transactDocument(d, d.network, e).ok).toBe(false);
  });
  it('patches full geometry while preserving authored terms, notes, names, rotations and timing; clones global bindings', () => {
    const d = document(),
      c = d.network.components[0];
    const net = {
      ...c.net,
      nodes: c.net.nodes.map((n) => ({ ...n, x: n.x + 20 })),
      arcs: c.net.arcs.map((a) => ({
        ...a,
        ...(a.bends ? { bends: a.bends.map((b) => ({ ...b, y: b.y + 5 })) } : {}),
      })),
    };
    const patched = edit(d, { kind: 'patchNet', componentId: 'a', net });
    expect(patched.network.components[0].net).toEqual(net);
    expect(patched.network.components[0].timing).toEqual(c.timing);
    const copy = edit(patched, {
      kind: 'copyComponent',
      componentId: 'a',
      id: '__proto__',
      template: 'Copy',
    });
    expect(copy.network.components[1].net).toEqual({ ...net, template: 'Copy' });
    expect(copy.network.components[1].timing).toEqual(c.timing);
    expect(copy.network.constants).toEqual(d.network.constants);
    expect(constantUses(copy.network, 'batch')).toHaveLength(4);
    const removed = edit(copy, { kind: 'removeComponent', componentId: '__proto__' });
    expect(constantUses(removed.network, 'batch')).toHaveLength(2);
  });
  it('refuses numeric projection semantic replacement and one-sided transport removal', () => {
    const d = document(),
      c = d.network.components[0];
    const numeric = value(resolveAuthored(d.network)).numeric.components[0].net;
    expect(
      transactDocument(d, d.network, { kind: 'patchNet', componentId: 'a', net: numeric }).ok,
    ).toBe(false);
    expect(
      transactDocument(d, d.network, {
        kind: 'patchNet',
        componentId: 'a',
        net: { ...c.net, arcs: c.net.arcs.slice(1) },
      }).ok,
    ).toBe(false);
    const removed = edit(d, { kind: 'patchNet', componentId: 'a', net: { ...c.net, arcs: [] } });
    expect(removed.network.components[0].timing!.transports).toEqual([]);
    expect(edit(removed, { kind: 'deleteConstant', id: 'batch' }).network.constants).toHaveLength(
      1,
    );
  });
  it('sets both transport halves and keeps default-equivalent references through history', () => {
    let d = document();
    d = edit(d, { kind: 'setWeightTerm', componentId: 'a', arcId: 'out', term: 1 });
    expect(d.network.components[0].net.arcs.map((a) => a.weight)).toEqual([1, 1]);
    d = edit(d, { kind: 'addConstant', constant: { id: 'zero', name: 'Zero', value: 0 } });
    const previous = d;
    d = edit(d, {
      kind: 'setInterval',
      componentId: 'a',
      arcId: 'in',
      interval: {
        lower: { constantId: 'zero' },
        upper: null,
        lowerClosed: true,
        upperClosed: false,
      },
    });
    expect(value(resolveAuthored(d.network)).numeric.components[0].timing!.intervals).toEqual({});
    expect(constantUses(d.network, 'zero')).toHaveLength(1);
    expect(undoAuthored(d).network).toBe(previous.network);
  });
  it('validates invariant edits, refuses unknown and extra edit keys', () => {
    const d = document();
    expect(
      transactDocument(d, d.network, {
        kind: 'setInvariant',
        componentId: 'a',
        placeId: 'p',
        invariant: { upper: '1', upperClosed: true },
      }).ok,
    ).toBe(false);
    const e = {
      kind: 'updateConstant',
      id: 'batch',
      name: 'Batch',
      value: 3,
      savedQueries: undefined,
    };
    expect(transactDocument(d, d.network, e as AuthoredEdit).ok).toBe(false);
    expect(
      transactDocument(d, d.network, { kind: '__proto__' } as unknown as AuthoredEdit).ok,
    ).toBe(false);
  });
});

describe('atomic authored dependency and element paste command', () => {
  it('commits declarations plus elements once, preserves originals and restores bindings on redo', () => {
    const d = document(),
      c = d.network.components[0];
    const edit: AuthoredEdit = {
      kind: 'pasteElements',
      componentId: c.id,
      constants: [{ id: 'imported', name: 'Imported', value: 3 }],
      net: {
        ...c.net,
        nodes: [
          ...c.net.nodes,
          { id: 'new', name: 'New', kind: 'place', tokens: 0, x: 100, y: 100 },
        ],
        arcs: [
          ...c.net.arcs,
          {
            id: 'newArc',
            source: 't',
            target: 'new',
            kind: 'normal',
            weight: { constantId: 'imported' },
          },
        ],
      },
      timing: c.timing!,
    };
    const next = value(transactDocument(d, d.network, edit));
    expect(next.past).toHaveLength(1);
    expect(next.network.components[0].net.arcs.slice(0, 2)).toEqual(c.net.arcs);
    expect(next.network.constants.at(-1)).toEqual(edit.constants[0]);
    expect(undoAuthored(next).network).toBe(d.network);
    expect(redoAuthored(undoAuthored(next)).network).toBe(next.network);
    for (const bad of [
      { ...edit, constants: [{ id: 'imported', name: 'Batch', value: 2 }] },
      { ...edit, constants: [{ id: 'batch', name: 'Imported', value: 3 }] },
      {
        ...edit,
        net: {
          ...edit.net,
          arcs: edit.net.arcs.map((a) => (a.id === 'in' ? { ...a, weight: 2 } : a)),
        },
      },
      { ...edit, constants: [], extra: true },
    ]) {
      expect(transactDocument(d, d.network, bad as AuthoredEdit).ok).toBe(false);
      expect(d.past).toHaveLength(0);
    }
    let accessed = false;
    const unsafe = { ...edit.net };
    Object.defineProperty(unsafe, 'arcs', {
      enumerable: true,
      get() {
        accessed = true;
        return edit.net.arcs;
      },
    });
    expect(transactDocument(d, d.network, { ...edit, net: unsafe }).ok).toBe(false);
    expect(accessed).toBe(false);
    const list = [{ id: 'imported', name: 'Imported', value: 3 }];
    Object.defineProperty(list, 'hidden', { value: true });
    expect(transactDocument(d, d.network, { ...edit, constants: list }).ok).toBe(false);
  });
});
