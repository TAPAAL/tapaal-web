import { describe, expect, it } from 'vitest';
import {
  arcGeometry,
  bendBounds,
  deleteArcBend,
  insertArcBend,
  moveArcBend,
  netArcGeometry,
  splitArcBend,
  toggleArcBendCurved,
  toggleArcEndCurved,
  translateArcBends,
  withBends,
} from './arc-geometry';
import { Net } from './net';

const net: Net = {
  name: 'Bends',
  template: 'Main',
  nodes: [
    { id: 'p', name: 'P', kind: 'place', x: 100, y: 100, tokens: 1 },
    { id: 't', name: 'T', kind: 'transition', x: 300, y: 100, tokens: 0 },
    { id: 'q', name: 'Q', kind: 'place', x: 300, y: 300, tokens: 0 },
  ],
  arcs: [
    { id: 'a', source: 'p', target: 't', kind: 'normal', weight: 1 },
    {
      id: 'b',
      source: 't',
      target: 'q',
      kind: 'normal',
      weight: 2,
      bends: [
        { x: 400, y: 150, curved: false },
        { x: 400, y: 250, curved: true },
      ],
      curvedEnd: true,
    },
  ],
};

describe('native arc geometry', () => {
  it('anchors a straight arc on the place circumference and the facing transition side', () => {
    const geometry = arcGeometry(net, 'a');
    expect(geometry.start).toEqual({ x: 115, y: 100 });
    // Left port of an unrotated transition, including native's +1 and π-degree skew.
    expect(geometry.end).toEqual({ x: 295, y: 101 });
    expect(geometry.d).toBe('M 115 100 L 295 101');
    expect(geometry.midpoint).toEqual({ x: 205, y: 100.5 });
    expect(Math.abs(geometry.endAngle)).toBeLessThan(0.01);
  });
  it('passes through every interior bend, curving only the typed segments', () => {
    const geometry = arcGeometry(net, 'b');
    expect(geometry.vertices.map(({ x, y, curved }) => ({ x, y, curved }))).toEqual([
      { x: 305, y: 100, curved: false },
      { x: 400, y: 150, curved: false },
      { x: 400, y: 250, curved: true },
      { ...geometry.end, curved: true },
    ]);
    expect(geometry.d).toMatch(/^M 305 100 L 400 150 C [-\d. ]+ 400 250 C [-\d. ]+$/);
    expect(Math.hypot(geometry.end.x - 300, geometry.end.y - 300)).toBeCloseTo(15, 0);
    for (const vertex of geometry.vertices)
      for (const value of [
        vertex.control1.x,
        vertex.control1.y,
        vertex.control2.x,
        vertex.control2.y,
      ])
        expect(Number.isFinite(value)).toBe(true);
  });
  it('distributes several arcs on one transition side like native ports', () => {
    const crowded = structuredClone(net);
    crowded.nodes.push({ id: 'r', name: 'R', kind: 'place', x: 100, y: 140, tokens: 0 });
    crowded.arcs.push({ id: 'c', source: 'r', target: 't', kind: 'normal', weight: 1 });
    const all = netArcGeometry(crowded);
    expect(all.get('a')!.end.x).toBe(all.get('c')!.end.x);
    expect(new Set([all.get('a')!.end.y, all.get('c')!.end.y]).size).toBe(2);
  });
  it('keeps endpoint anchors automatic when nodes move', () => {
    const moved = structuredClone(net);
    moved.nodes[0].y = 400;
    const geometry = arcGeometry(moved, 'b');
    expect(geometry.vertices.slice(1, 3).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 400, y: 150 },
      { x: 400, y: 250 },
    ]);
  });
  it('reports bend bounds and rejects unknown arcs', () => {
    expect(bendBounds(net)).toEqual({ minX: 400, minY: 150, maxX: 400, maxY: 250 });
    expect(bendBounds({ ...net, arcs: [net.arcs[0]] })).toBeNull();
    expect(() => arcGeometry(net, 'missing')).toThrow(/Arc not found/);
  });
});

describe('immutable bend editing', () => {
  it('inserts into the segment with the nearest midpoint, truncating like native', () => {
    const { net: next, index } = insertArcBend(net, 'b', { x: 401.9, y: 199.5 }, true);
    expect(index).toBe(1);
    expect(next.arcs[1].bends).toEqual([
      { x: 400, y: 150, curved: false },
      { x: 401, y: 199, curved: true },
      { x: 400, y: 250, curved: true },
    ]);
    const first = insertArcBend(net, 'a', { x: 200, y: 60 });
    expect(first.net.arcs[0].bends).toEqual([{ x: 200, y: 60, curved: false }]);
    expect(net.arcs[0].bends).toBeUndefined();
  });
  it('splits, moves, toggles and deletes without mutating the input', () => {
    const before = structuredClone(net);
    expect(splitArcBend(net, 'b', 0).arcs[1].bends![1]).toEqual({ x: 410, y: 150, curved: false });
    expect(moveArcBend(net, 'b', 1, { x: 420.5, y: 239.4 }).arcs[1].bends![1]).toEqual({
      x: 421,
      y: 239,
      curved: true,
    });
    expect(toggleArcBendCurved(net, 'b', 0).arcs[1].bends![0].curved).toBe(true);
    expect(toggleArcEndCurved(net, 'b').arcs[1].curvedEnd).toBeUndefined();
    expect(toggleArcEndCurved(net, 'a').arcs[0].curvedEnd).toBe(true);
    const straight = deleteArcBend(deleteArcBend(net, 'b', 0), 'b', 0);
    expect(straight.arcs[1]).toEqual({ ...withBends(net.arcs[1], []), curvedEnd: true });
    expect('bends' in straight.arcs[1]).toBe(false);
    expect(net).toEqual(before);
  });
  it('preserves weights, kinds and IDs while editing geometry', () => {
    const inhibitor = structuredClone(net);
    inhibitor.arcs[0] = { ...inhibitor.arcs[0], kind: 'inhibitor', weight: 3 };
    const edited = insertArcBend(inhibitor, 'a', { x: 200, y: 50 }).net.arcs[0];
    expect(edited).toMatchObject({
      id: 'a',
      source: 'p',
      target: 't',
      kind: 'inhibitor',
      weight: 3,
    });
  });
  it.each([
    ['index past the end', () => moveArcBend(net, 'b', 2, { x: 0, y: 0 })],
    ['negative index', () => deleteArcBend(net, 'b', -1)],
    ['fractional index', () => toggleArcBendCurved(net, 'b', 0.5)],
    ['arc without bends', () => splitArcBend(net, 'a', 0)],
    ['unknown arc', () => toggleArcEndCurved(net, 'missing')],
    ['nonfinite move', () => moveArcBend(net, 'b', 0, { x: NaN, y: 0 })],
    ['nonfinite insert', () => insertArcBend(net, 'a', { x: 0, y: Infinity })],
    ['out-of-bounds move', () => moveArcBend(net, 'b', 0, { x: 2e6, y: 0 })],
    ['nonfinite translation', () => translateArcBends(net.arcs[1], Infinity, 0)],
  ])('rejects %s', (_label, edit) => expect(edit).toThrow());
});
