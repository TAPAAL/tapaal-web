// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseAuthoredTapn } from './authored-files';
import { serializeSharedJson as serializeAuthoredJson, parseSharedJson } from './shared-files';
import * as w from '../editor-workspace';
import {
  AuthoredClipboard,
  authoredClipboardPayload,
  copyAuthoredSelection,
  isAuthoredClipboard,
  parseAuthoredClipboard,
  prepareAuthoredPaste,
  readSelectionClipboard,
  validateAuthoredClipboard,
} from './authored-clipboard';
import { MAX_CLIPBOARD_TEXT } from './clipboard';
import { captureSharedQueries as captureAuthoredSavedQueries } from './authored-shared';
const xml = readFileSync(
  'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn',
  'utf8',
).replaceAll('<arc ', '<arc nameOffsetX="-23" nameOffsetY="17" ');
function doc() {
  return w.openNetworkDocument(parseAuthoredTapn(xml).network, { timed: true, saved: true });
}
function all(d = doc()) {
  const c = w.sourceComponent(d);
  return [...c.net.nodes, ...c.net.arcs, ...(c.net.annotations ?? [])].map((e) => e.id);
}
function content(d = doc()): AuthoredClipboard {
  const c = copyAuthoredSelection(d, all(d)).content;
  if (!isAuthoredClipboard(c)) throw new Error('expected authored');
  return c;
}
function target() {
  return w.createTimedDocument({ name: 'Target' });
}
function paste(d: w.NetworkDocument, c: AuthoredClipboard) {
  return w.pasteAuthoredSelection(d, c).document;
}
function mutable(c = content()) {
  return JSON.parse(JSON.stringify(c));
}

describe('authored clipboard v3 public Interface', () => {
  it('copies exactly used declarations and all authored scalar positions including Zero', () => {
    let d = doc();
    d = w.transact(d, {
      kind: 'addConstant',
      constant: { id: 'unused', name: 'Unused', value: 7 },
    });
    const c = content(d);
    expect(c.constants.map((c) => c.name)).toEqual(['K', 'D', 'Zero']);
    expect(c.fragment.arcs).toEqual(w.sourceComponent(d).net.arcs);
    expect(c.fragment.arcs[0]).toMatchObject({ nameOffsetX: -23, nameOffsetY: 17 });
    expect(c.fragment.timing).toEqual(w.sourceComponent(d).timing);
    const p = authoredClipboardPayload(c);
    expect(p.nativeText).toBe(p.webText);
    expect(JSON.parse(p.webText)).not.toHaveProperty('native');
    expect(parseAuthoredClipboard(p.webText)).toEqual(c);
    expect(Object.isFrozen(p.content.fragment.arcs[0].weight)).toBe(true);
  });
  it('imports fresh dependency and element IDs, preserves every term, and undoes/redoes once', () => {
    const c = content(),
      before = target();
    // Source IDs have no authority even when a different target declaration already uses one.
    const d = w.transact(before, {
      kind: 'addConstant',
      constant: { ...c.constants[0], name: 'Unrelated' },
    });
    const prepared = prepareAuthoredPaste(d, c);
    const pasted = w.transact(d, prepared.edit);
    expect(pasted.past.length).toBe(d.past.length + 1);
    expect(pasted.network.constants[0]).toEqual(d.network.constants[0]);
    const mapped = new Map(pasted.network.constants.slice(1).map((x) => [x.name, x.id]));
    c.constants.forEach((x) => expect(mapped.get(x.name)).not.toBe(x.id));
    c.fragment.arcs.forEach((a) => {
      const arc = w.sourceComponent(pasted).net.arcs.find((x) => x.id === prepared.idMap[a.id])!;
      expect(arc.id).not.toBe(a.id);
      expect(arc.weight).toEqual({ constantId: mapped.get('K') });
      expect(arc).toMatchObject({ nameOffsetX: -23, nameOffsetY: 17 });
    });
    const t = w.sourceComponent(pasted).timing!;
    expect(t.intervals[prepared.idMap['ti']]).toEqual({
      lower: { constantId: mapped.get('Zero') },
      upper: { constantId: mapped.get('D') },
      lowerClosed: true,
      upperClosed: true,
    });
    expect(t.invariants[prepared.idMap['p']].upper).toEqual({ constantId: mapped.get('D') });
    expect(t.transports).toEqual([
      { inputArc: prepared.idMap['ti'], outputArc: prepared.idMap['to'] },
    ]);
    expect(w.undoDocument(pasted).network).toBe(d.network);
    expect(w.redoDocument(w.undoDocument(pasted)).network).toBe(pasted.network);
    expect(JSON.parse(serializeAuthoredJson(pasted.network)).version).toBe(3);
    expect(parseSharedJson(serializeAuthoredJson(pasted.network)).network).toEqual(pasted.network);
  });
  it('binds current source IDs after rename/value changes and refuses resurrecting a deleted ID', () => {
    let d = doc();
    const c = content(d),
      k = d.network.constants[0];
    d = w.transact(d, { kind: 'updateConstant', id: k.id, name: 'Batch', value: 3 });
    const pasted = paste(d, c);
    expect(pasted.network.constants).toEqual(d.network.constants);
    expect(w.activeNet(pasted).arcs.at(-1)!.weight).toBe(3);
    expect(w.sourceComponent(pasted).net.arcs.at(-1)!.weight).toEqual({ constantId: k.id });
    d = w.removeComponentElements(d, all(d));
    d = w.transact(d, { kind: 'deleteConstant', id: k.id });
    expect(() => paste(d, c)).toThrow(/no longer exists/);
    expect(d.network.constants.some((x) => x.id === k.id)).toBe(false);
  });
  it.each([2, 9])(
    'refuses a same-name collision with target value %i without changing source/history/checkpoint',
    (value) => {
      const c = content();
      let d = target();
      d = w.transact(d, { kind: 'addConstant', constant: { id: 'target-k', name: 'K', value } });
      const before = d;
      expect(() => paste(d, c)).toThrow(/K.*cannot be merged/);
      expect(d).toBe(before);
      expect(d.saved).toBe(before.saved);
    },
  );
  it('refuses repeated cross-document import but allows copying the pasted target for repeated same-document paste', () => {
    const c = content(),
      d = paste(target(), c);
    expect(() => paste(d, c)).toThrow(/already declares/);
    const again = paste(d, content(d));
    expect(again.network.constants).toEqual(d.network.constants);
    expect(w.sourceComponent(again).net.nodes).toHaveLength(10);
  });
  it('preserves initial ages, routes, rotation, hidden names, notes and exact literal spelling', () => {
    let d = w.setPlaceTokenAges(doc(), 'p', ['0.1', '2.50']);
    const source = w.sourceComponent(d);
    d = w.transact(d, {
      kind: 'patchNet',
      componentId: source.id,
      net: {
        ...source.net,
        nodes: [
          ...source.net.nodes,
          { id: 'urgent', name: 'Urgent', kind: 'transition', tokens: 0, x: 300, y: 200 },
        ],
        arcs: source.net.arcs.map((a) => ({
          ...a,
          bends: [{ x: 75, y: 75, curved: true }],
          curvedEnd: true,
        })),
        annotations: [
          { id: 'note', text: 'Hello', x: 30, y: 30, width: 100, height: 50, border: false },
        ],
      },
    });
    d = w.setTransitionUrgent(d, 'urgent', true);
    const c = content(d),
      destination = target(),
      p = prepareAuthoredPaste(destination, c);
    const next = w.transact(destination, p.edit);
    const s = w.sourceComponent(next);
    expect(s.timing!.ages[p.idMap['p']]).toEqual(['0.1', '2.50']);
    expect(s.timing!.urgent).toEqual([p.idMap['urgent']]);
    expect(s.net.nodes.find((n) => n.id === p.idMap['p'])!.nameVisible).toBe(false);
    expect(s.net.nodes.find((n) => n.id === p.idMap['t'])!.angle).toBe(90);
    expect(s.net.arcs[0].bends).toEqual([{ x: 105, y: 105, curved: true }]);
    expect(s.net.annotations![0]).toMatchObject({
      text: 'Hello',
      x: 60,
      y: 60,
      width: 100,
      height: 50,
      border: false,
    });
  });
  it('rejects a touched partial transport and equal-value but distinct authored pair bindings', () => {
    const d = doc();
    expect(() => copyAuthoredSelection(d, ['p', 't', 'ti'])).toThrow(/both transport halves/);
    const c = mutable();
    c.constants.push({ id: 'same-value', name: 'Same', value: 2 });
    c.fragment.arcs.find((a: any) => a.id === 'to').weight = { constantId: 'same-value' };
    expect(() => parseAuthoredClipboard(JSON.stringify(c))).toThrow(/transport|weight/i);
  });
  it('preserves existing symbolic terms and query protections without assigning protections to new nodes', () => {
    let d = doc();
    d = w.openNetworkDocument(
      {
        ...d.network,
        savedQueries: w.unwrap(captureAuthoredSavedQueries(d.network, ['<query name="Q"/>'])),
      },
      { timed: true },
    );
    const before = d.network,
      c = content(d),
      p = paste(d, c);
    expect(w.sourceComponent(p).net.arcs.slice(0, 5)).toEqual(before.components[0].net.arcs);
    expect(p.network.savedQueries).toEqual(before.savedQueries);
    expect(() => w.removeComponentElements(d, all(d))).toThrow();
    const newIds = w
      .sourceComponent(p)
      .net.nodes.slice(5)
      .map((n) => n.id);
    expect(w.removeComponentElements(p, newIds).network.components[0].net.nodes).toHaveLength(5);
  });
  it('retains native/v2 numeric copies even in a symbolic document and enforces model direction', () => {
    const numeric = copyAuthoredSelection(doc(), ['b']);
    expect(JSON.parse(numeric.webText).version).toBe(2);
    const c = content();
    expect(() => paste(w.createDocument({ name: 'Untimed' }), c)).toThrow(/timed selection/);
    const u = mutable();
    u.modelType = 'untimed';
    delete u.fragment.timing;
    u.constants = u.constants.filter((c: any) => c.name === 'K');
    const p = parseAuthoredClipboard(JSON.stringify(u));
    expect(w.sourceComponent(paste(target(), p)).timing).toEqual({
      intervals: {},
      invariants: {},
      urgent: [],
      transports: [],
      ages: {},
    });
    const plain = w.createDocument({ name: 'Numeric' });
    const n = w.commitComponentNet(plain, {
      ...w.activeNet(plain),
      nodes: [{ id: 'p', name: 'P', kind: 'place', tokens: 0, x: 50, y: 50 }],
    });
    expect(JSON.parse(copyAuthoredSelection(n, ['p']).nativeText).places).toHaveLength(1);
  });
  it('reads plain v3 in a fresh context and denied internal fallback, but refuses readable stale content', () => {
    const p = authoredClipboardPayload(content());
    expect(readSelectionClipboard({ text: p.webText }).content).toEqual(p.content);
    expect(readSelectionClipboard({ internal: p }).source).toBe('internal');
    expect(readSelectionClipboard({ webText: p.webText, text: p.webText }).source).toBe('web');
    for (const text of ['hello', '{', '', JSON.stringify({ ...mutable(), constants: [] })])
      expect(() => readSelectionClipboard({ text, internal: p })).toThrow();
    expect(() => readSelectionClipboard({ webText: 'broken', internal: p })).toThrow();
  });
  it.each([
    [
      'extra envelope',
      (c: any) => {
        c.native = 'flattened';
      },
    ],
    [
      'extra dependency',
      (c: any) => {
        c.constants.push({ id: 'unused', name: 'Unused', value: 1 });
      },
    ],
    [
      'missing dependency',
      (c: any) => {
        c.constants.pop();
      },
    ],
    [
      'unknown reference field',
      (c: any) => {
        c.fragment.arcs[0].weight.extra = 1;
      },
    ],
    [
      'missing reference',
      (c: any) => {
        c.fragment.arcs[0].weight = {};
      },
    ],
    [
      'null weight',
      (c: any) => {
        c.fragment.arcs[0].weight = null;
      },
    ],
    [
      'unknown dependency',
      (c: any) => {
        c.constants[0].extra = true;
      },
    ],
    [
      'unknown timing',
      (c: any) => {
        c.fragment.timing.simulatedAges = {};
      },
    ],
    [
      'missing model type',
      (c: any) => {
        delete c.modelType;
      },
    ],
    [
      'wrong version',
      (c: any) => {
        c.version = 4;
      },
    ],
    [
      'prototype field',
      (c: any) => {
        Object.defineProperty(c.fragment, '__proto__', {
          value: { polluted: true },
          enumerable: true,
        });
      },
    ],
  ])('rejects closed-schema violation: %s', (_name, mutate) => {
    const c = mutable();
    mutate(c);
    expect(() => parseAuthoredClipboard(JSON.stringify(c))).toThrow();
  });
  it('rejects hidden/accessor/inherited fields before invoking accessors or erasing evidence', () => {
    for (const mutate of [
      (c: any) => Object.defineProperty(c.fragment.arcs[0].weight, 'hidden', { value: 1 }),
      (c: any) => Object.setPrototypeOf(c.constants[0], { inherited: true }),
      (c: any) => Object.defineProperty(c.constants, 'hidden', { value: 1 }),
      (c: any) =>
        Object.defineProperty(c.fragment.arcs[0], 'weight', {
          get() {
            throw new Error('getter ran');
          },
          enumerable: true,
        }),
    ]) {
      const c = mutable();
      mutate(c);
      expect(() => validateAuthoredClipboard(c)).toThrow(/field|plain|data/);
    }
  });
  it('accepts prototype-looking IDs and names as own data and remaps them safely', () => {
    const c = mutable();
    const k = c.constants.find((c: any) => c.name === 'K');
    const old = k.id;
    k.id = '__proto__';
    k.name = 'constructor';
    c.fragment.arcs.forEach((a: any) => {
      if (a.weight.constantId === old) a.weight = { constantId: '__proto__' };
    });
    c.fragment.timing.intervals.in.lower = { constantId: '__proto__' };
    c.fragment.nodes.find((n: any) => n.id === 'p').id = '__proto__';
    c.fragment.arcs.forEach((a: any) => {
      if (a.source === 'p') a.source = '__proto__';
      if (a.target === 'p') a.target = '__proto__';
      if (a.id === 'in') a.id = 'constructor';
    });
    c.fragment.timing.invariants = Object.fromEntries(
      Object.entries(c.fragment.timing.invariants).map(([id, v]) => [
        id === 'p' ? '__proto__' : id,
        v,
      ]),
    );
    c.fragment.timing.intervals = Object.fromEntries(
      Object.entries(c.fragment.timing.intervals).map(([id, v]) => [
        id === 'in' ? 'constructor' : id,
        v,
      ]),
    );

    const p = parseAuthoredClipboard(JSON.stringify(c));
    const d = paste(target(), p);
    expect(d.network.constants.some((c) => c.name === 'constructor')).toBe(true);
    expect({}).not.toHaveProperty('polluted');
  });
  it('enforces text, node and bend bounds', () => {
    expect(() => parseAuthoredClipboard(' '.repeat(MAX_CLIPBOARD_TEXT + 1))).toThrow(/large/);
    const c = mutable();
    c.fragment.nodes = Array(5001).fill(c.fragment.nodes[0]);
    expect(() => validateAuthoredClipboard(c)).toThrow(/limit/);
    const b = mutable();
    b.fragment.arcs[0].bends = Array(100001).fill({ x: 1, y: 1, curved: false });
    expect(() => validateAuthoredClipboard(b)).toThrow(/limit/);
  });
});
