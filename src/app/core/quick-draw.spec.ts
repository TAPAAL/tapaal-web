import { describe, expect, it } from 'vitest';
import { NetEditor, validateNet, type Net } from './net';
import {
  applyQuickDraw,
  freshIds,
  isQuickDrawCancelKey,
  isQuickDrawModifier,
  nativeNodeName,
  planQuickDraw,
  quickDrawPress,
  snapToNativeGrid,
  type QuickDrawPress,
} from './quick-draw';

function example(): Net {
  return {
    name: 'Quick draw',
    template: 'Main',
    nodes: [
      { id: 'p', kind: 'place', name: 'P0', x: 15, y: 15, tokens: 1 },
      { id: 't', kind: 'transition', name: 'T0', x: 105, y: 15, tokens: 0 },
      { id: 'q', kind: 'place', name: 'Done', x: 195, y: 15, tokens: 0 },
    ],
    arcs: [{ id: 'a', source: 'p', target: 't', kind: 'normal', weight: 1 }],
  };
}

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

const node = (nodeId: string, ctrlKey = false): QuickDrawPress => ({
  target: 'node',
  nodeId,
  ctrlKey,
});
const canvas = (x: number, y: number, ctrlKey = false): QuickDrawPress => ({
  target: 'canvas',
  point: { x, y },
  ctrlKey,
});

describe('native modifier contract', () => {
  it('uses Ctrl only, like MouseEvent.isControlDown', () => {
    expect(isQuickDrawModifier({ ctrlKey: true })).toBe(true);
    expect(isQuickDrawModifier({ ctrlKey: false })).toBe(false);
  });

  it('cancels a pending arc on Escape, Delete and menu-shortcut Z/Y', () => {
    const key = (key: string, ctrlKey = false, metaKey = false) => ({ key, ctrlKey, metaKey });
    expect(isQuickDrawCancelKey(key('Escape'))).toBe(true);
    expect(isQuickDrawCancelKey(key('Delete'))).toBe(true);
    expect(isQuickDrawCancelKey(key('z', true))).toBe(true);
    expect(isQuickDrawCancelKey(key('Y', false, true))).toBe(true);
    expect(isQuickDrawCancelKey(key('z'))).toBe(false);
    expect(isQuickDrawCancelKey(key('Backspace'))).toBe(false);
  });
});

describe('native naming, ids and grid', () => {
  it('allows a document-owned naming allocator without changing atomic helper results', () => {
    const net = example();
    const result = quickDrawPress(net, 'arc', 'p', canvas(300, 100, true), {
      nodeName: (_net, kind) => (kind === 'place' ? 'P100' : 'T200'),
    });
    expect(result.net.nodes.at(-1)?.name).toBe('T200');
    expect(result.createdNodeIds).toHaveLength(1);
    expect(result.createdArcIds).toHaveLength(1);
    expect(net.nodes).toHaveLength(3);
  });

  it('continues after the highest P<n>/T<n>, case-insensitively, from P0/T0', () => {
    const empty: Net = { name: 'Empty', template: 'Main', nodes: [], arcs: [] };
    expect(nativeNodeName(empty, 'place')).toBe('P0');
    expect(nativeNodeName(empty, 'transition')).toBe('T0');
    const net = example();
    net.nodes.push({ id: 'r', kind: 'place', name: 'p7', x: 0, y: 0, tokens: 0 });
    expect(nativeNodeName(net, 'place')).toBe('P8');
    expect(nativeNodeName(net, 'transition')).toBe('T1');
  });

  it('skips a candidate already used by the other node kind', () => {
    const net = example();
    net.nodes.push({ id: 'x', kind: 'transition', name: 'P1', x: 0, y: 0, tokens: 0 });
    expect(nativeNodeName(net, 'place')).toBe('P2');
  });

  it('handles counters beyond safe integers', () => {
    const net = example();
    net.nodes.push({ id: 'big', kind: 'place', name: 'P9007199254740993', x: 0, y: 0, tokens: 0 });
    expect(nativeNodeName(net, 'place')).toBe('P9007199254740994');
  });

  it('allocates ids above every existing prefixed id, never colliding', () => {
    const net = example();
    net.nodes.push({ id: 'web-4', kind: 'place', name: 'X', x: 0, y: 0, tokens: 0 });
    net.arcs.push({ id: 'web-9', source: 't', target: 'web-4', kind: 'normal', weight: 1 });
    expect(freshIds(net, 2)).toEqual(['web-10', 'web-11']);
    expect(freshIds(net, 1, 'qd-')).toEqual(['qd-0']);
  });

  it('aligns the 30×30 top-left corner to the grid, like adjustPointToGridAndZoom', () => {
    expect(snapToNativeGrid({ x: 37, y: 38 })).toEqual({ x: 30, y: 45 });
    expect(snapToNativeGrid({ x: 37, y: 38 }, 30)).toEqual({ x: 45, y: 45 });
    expect(snapToNativeGrid({ x: 37, y: 38 }, 7.5)).toEqual({ x: 38, y: 38 });
    expect(snapToNativeGrid({ x: 37.4, y: -7.5 }, null)).toEqual({ x: 37, y: -7 });
    expect(() => snapToNativeGrid({ x: NaN, y: 0 })).toThrow();
    expect(() => snapToNativeGrid({ x: 0, y: 0 }, 0)).toThrow();
  });
});

describe('planning presses', () => {
  const net = frozen(example());

  it('applies only to the arc and inhibitor tools', () => {
    for (const tool of ['select', 'pan', 'place', 'transition'] as const) {
      expect(planQuickDraw(net, tool, null, canvas(0, 0, true))).toEqual({
        action: 'ignore',
        reason: 'not-an-arc-tool',
      });
    }
  });

  it('starts at either node kind with the arc tool, but only at places for inhibitors', () => {
    expect(planQuickDraw(net, 'arc', null, node('t', true))).toEqual({
      action: 'start',
      sourceId: 't',
    });
    expect(planQuickDraw(net, 'inhibitor', null, node('t'))).toMatchObject({
      reason: 'inhibitor-must-start-at-place',
    });
    expect(planQuickDraw(net, 'inhibitor', null, node('p'))).toEqual({
      action: 'start',
      sourceId: 'p',
    });
  });

  it('ignores same-kind targets, the source itself and plain canvas presses', () => {
    expect(planQuickDraw(net, 'arc', 'p', node('q', true)).action).toBe('ignore');
    expect(planQuickDraw(net, 'arc', 'p', node('p', true)).action).toBe('ignore');
    expect(planQuickDraw(net, 'arc', null, canvas(0, 0))).toMatchObject({
      reason: 'plain-canvas-press',
    });
    expect(planQuickDraw(net, 'arc', 'p', canvas(0, 0))).toMatchObject({
      reason: 'bend-points-unsupported',
    });
    expect(planQuickDraw(net, 'arc', null, node('missing'))).toMatchObject({
      reason: 'unknown-node',
    });
  });

  it('creates the opposite kind on Ctrl+canvas and chains only for the arc tool', () => {
    expect(planQuickDraw(net, 'arc', 'p', canvas(0, 0, true))).toMatchObject({
      action: 'create-and-connect',
      kind: 'transition',
      arcKind: 'normal',
      chain: true,
    });
    expect(planQuickDraw(net, 'arc', 't', canvas(0, 0, true))).toMatchObject({ kind: 'place' });
    expect(planQuickDraw(net, 'inhibitor', 'p', canvas(0, 0, true))).toMatchObject({
      kind: 'transition',
      arcKind: 'inhibitor',
      chain: false,
    });
    expect(planQuickDraw(net, 'arc', 'p', node('t', false))).toMatchObject({ chain: false });
  });

  it('treats a stale pending source as no pending arc', () => {
    expect(planQuickDraw(net, 'arc', 'gone', canvas(0, 0, true))).toMatchObject({
      action: 'create-and-start',
      kind: 'place',
    });
  });
});

describe('applying presses', () => {
  it('Ctrl+canvas without a pending arc adds a native-named place and starts from it', () => {
    const net = frozen(example());
    const result = quickDrawPress(net, 'arc', null, canvas(301, 92, true));
    expect(result.changed).toBe(true);
    expect(result.createdArcIds).toEqual([]);
    expect(result.sourceId).toBe(result.createdNodeIds[0]);
    expect(result.net.nodes.at(-1)).toEqual({
      id: 'web-0',
      kind: 'place',
      name: 'P1',
      x: 300,
      y: 90,
      tokens: 0,
    });
  });

  it('chains P → T → P with alternating kinds and atomic node-plus-arc edits', () => {
    let net: Net = frozen(example());
    let result = quickDrawPress(net, 'arc', 'p', canvas(100, 100, true));
    expect(result.createdNodeIds).toHaveLength(1);
    expect(result.createdArcIds).toHaveLength(1);
    const transition = result.net.nodes.find((n) => n.id === result.createdNodeIds[0])!;
    expect(transition).toMatchObject({ kind: 'transition', name: 'T1', x: 105, y: 105 });
    expect(result.net.arcs.at(-1)).toEqual({
      id: result.createdArcIds[0],
      source: 'p',
      target: transition.id,
      kind: 'normal',
      weight: 1,
    });
    expect(result.sourceId).toBe(transition.id);

    net = frozen(result.net);
    result = quickDrawPress(net, 'arc', result.sourceId, canvas(200, 100, true));
    const place = result.net.nodes.find((n) => n.id === result.createdNodeIds[0])!;
    expect(place).toMatchObject({ kind: 'place', name: 'P1' });
    expect(result.net.arcs.at(-1)).toMatchObject({ source: transition.id, target: place.id });
    expect(result.sourceId).toBe(place.id);
    expect(new Set([...result.createdNodeIds, ...result.createdArcIds, transition.id]).size).toBe(
      3,
    );
    validateNet(result.net);
  });

  it('connects existing nodes and continues from the target only while Ctrl is held', () => {
    const net = frozen(example());
    const plain = quickDrawPress(net, 'arc', 't', node('q'));
    expect(plain.net.arcs.at(-1)).toMatchObject({ source: 't', target: 'q', kind: 'normal' });
    expect(plain.sourceId).toBeNull();
    const chained = quickDrawPress(net, 'arc', 't', node('q', true));
    expect(chained.sourceId).toBe('q');
  });

  it('completes inhibitor arcs from Ctrl+canvas without chaining', () => {
    const net = frozen(example());
    const result = quickDrawPress(net, 'inhibitor', 'q', canvas(300, 0, true));
    expect(result.net.arcs.at(-1)).toMatchObject({ source: 'q', kind: 'inhibitor', weight: 1 });
    expect(result.net.nodes.at(-1)).toMatchObject({ kind: 'transition', name: 'T1' });
    expect(result.sourceId).toBeNull();
  });

  it('rejects duplicate arcs without changing the net, clearing or chaining like native', () => {
    const net = frozen(example());
    const plain = quickDrawPress(net, 'arc', 'p', node('t'));
    expect(plain).toMatchObject({ changed: false, sourceId: null, createdArcIds: [] });
    expect(plain.net).toBe(net);
    expect(plain.error).toMatch(/Duplicate arcs/);
    expect(quickDrawPress(net, 'arc', 'p', node('t', true)).sourceId).toBe('t');
    expect(quickDrawPress(net, 'inhibitor', 'p', node('t', true)).sourceId).toBeNull();
  });

  it('returns the original net for starts and ignored presses, keeping the pending source', () => {
    const net = frozen(example());
    const start = quickDrawPress(net, 'arc', null, node('q'));
    expect(start).toMatchObject({ changed: false, sourceId: 'q' });
    expect(start.net).toBe(net);
    const ignored = quickDrawPress(net, 'arc', 'p', canvas(50, 50));
    expect(ignored).toMatchObject({ changed: false, sourceId: 'p' });
    expect(ignored.net).toBe(net);
    expect(quickDrawPress(net, 'arc', 'gone', node('q', true)).sourceId).toBe('q');
  });

  it('honours the configured grid and id prefix', () => {
    const result = quickDrawPress(example(), 'arc', null, canvas(37, 38, true), {
      gridSpacing: null,
      idPrefix: 'qd-',
    });
    expect(result.net.nodes.at(-1)).toMatchObject({ id: 'qd-0', x: 37, y: 38 });
  });

  it('rejects invalid input and unappliable plans without mutation', () => {
    const net = frozen(example());
    expect(() => applyQuickDraw(net, { action: 'ignore', reason: 'plain-canvas-press' })).toThrow();
    expect(() => applyQuickDraw(net, { action: 'start', sourceId: 'missing' })).toThrow();
    const invalid = { ...example(), name: '' };
    expect(() => quickDrawPress(invalid, 'arc', null, canvas(0, 0, true))).toThrow();
    expect(() =>
      quickDrawPress(net, 'arc', null, {
        target: 'canvas',
        point: { x: Infinity, y: 0 },
        ctrlKey: true,
      }),
    ).toThrow();
  });
});

describe('undo transaction boundary', () => {
  it('commits each changing press as exactly one undo step', () => {
    const editor = new NetEditor(example());
    const result = quickDrawPress(editor.model, 'arc', 'p', canvas(100, 100, true));
    editor.commit(result.net);
    expect(editor.model.nodes).toHaveLength(4);
    expect(editor.model.arcs).toHaveLength(2);
    editor.undo();
    expect(editor.model).toEqual(example());
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.model).toEqual(result.net);
  });

  it('leaves history untouched for no-op presses', () => {
    const editor = new NetEditor(example());
    const result = quickDrawPress(editor.model, 'arc', null, node('p'));
    if (result.changed) editor.commit(result.net);
    expect(editor.canUndo).toBe(false);
  });
});
