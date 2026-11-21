import { describe, expect, it } from 'vitest';
import { type Net, validateNet } from './net';
import { deleteSelection, duplicateSelection, moveSelection, selectInRectangle } from './selection';

function example(): Net {
  return {
    name: 'Selection example',
    template: 'Main',
    nodes: [
      { id: 'p', name: 'Input', kind: 'place', x: 10, y: 20, tokens: 4 },
      { id: 't', name: 'Move', kind: 'transition', x: 60, y: 20, tokens: 0 },
      { id: 'q', name: 'Output', kind: 'place', x: 110, y: 20, tokens: 0 },
    ],
    arcs: [
      { id: 'a', source: 'p', target: 't', kind: 'inhibitor', weight: 5 },
      { id: 'b', source: 't', target: 'p', kind: 'normal', weight: 3 },
      { id: 'c', source: 't', target: 'q', kind: 'normal', weight: 2 },
    ],
  };
}

describe('marquee selection', () => {
  it('includes boundary centres and internal arcs, regardless of drag direction', () => {
    const net = example();
    const expected = ['p', 't', 'a', 'b'];
    expect(selectInRectangle(net, { x1: 10, y1: 20, x2: 60, y2: 20 })).toEqual(expected);
    expect(selectInRectangle(net, { x1: 60, y1: 20, x2: 10, y2: 20 })).toEqual(expected);
  });

  it('excludes nodes outside the rectangle and arcs with an unselected endpoint', () => {
    expect(selectInRectangle(example(), { x1: 11, y1: 19, x2: 60, y2: 21 })).toEqual(['t']);
    expect(selectInRectangle(example(), { x1: 0, y1: 0, x2: 5, y2: 5 })).toEqual([]);
  });

  it('rejects nonfinite selection coordinates', () => {
    expect(() => selectInRectangle(example(), { x1: NaN, y1: 0, x2: 1, y2: 1 })).toThrow();
  });
});

describe('deleting a selection', () => {
  it('removes selected nodes and every incident arc while preserving disconnected nodes', () => {
    const net = example();
    const next = deleteSelection(net, ['p', 't']);
    expect(next.nodes.map((node) => node.id)).toEqual(['q']);
    expect(next.arcs).toEqual([]);
    expect(net.nodes).toHaveLength(3);
    expect(net.arcs).toHaveLength(3);
  });

  it('can delete an arc without removing either endpoint', () => {
    const next = deleteSelection(example(), ['a']);
    expect(next.nodes).toHaveLength(3);
    expect(next.arcs.map((arc) => arc.id)).toEqual(['b', 'c']);
  });

  it('ignores stale selection IDs and produces an independent document', () => {
    const net = example();
    const next = deleteSelection(net, ['missing']);
    expect(next).toEqual(net);
    next.nodes[0].tokens = 99;
    expect(net.nodes[0].tokens).toBe(4);
  });
});

describe('duplicating a selection', () => {
  it('copies the internal subgraph with weights, types and tokens, leaving external arcs alone', () => {
    const net = example();
    const result = duplicateSelection(net, ['p', 't']);
    const copies = result.net.nodes.slice(3);
    expect(copies).toEqual([
      { ...net.nodes[0], id: 'p_copy', name: 'Input_copy', x: 50, y: 60 },
      { ...net.nodes[1], id: 't_copy', name: 'Move_copy', x: 100, y: 60 },
    ]);
    expect(result.net.arcs.slice(3)).toEqual([
      { ...net.arcs[0], id: 'a_copy', source: 'p_copy', target: 't_copy' },
      { ...net.arcs[1], id: 'b_copy', source: 't_copy', target: 'p_copy' },
    ]);
    expect(result.selectedIds).toEqual(['p_copy', 't_copy', 'a_copy', 'b_copy']);
    expect(net).toEqual(example());
    expect(() => validateNet(result.net)).not.toThrow();
  });

  it('allocates collision-free IDs across nodes and arcs, and unique TAPAAL names', () => {
    const net = example();
    net.nodes.push({ id: 'a_copy', name: 'Input_copy', kind: 'place', x: 0, y: 0, tokens: 0 });
    net.nodes.push({ id: 'p_copy', name: 'Input_copy2', kind: 'place', x: 0, y: 0, tokens: 0 });
    const first = duplicateSelection(net, ['p', 't']);
    expect(first.net.nodes.find((node) => node.id === 'p_copy2')?.name).toBe('Input_copy3');
    expect(first.net.arcs.find((arc) => arc.id === 'a_copy2')?.source).toBe('p_copy2');
    const second = duplicateSelection(first.net, ['p', 't']);
    expect(second.net.nodes.find((node) => node.id === 'p_copy3')?.name).toBe('Input_copy4');
    expect(() => validateNet(second.net)).not.toThrow();
  });

  it('does not duplicate a lone arc or connect a lone copied node to existing nodes', () => {
    expect(duplicateSelection(example(), ['a']).selectedIds).toEqual([]);
    const result = duplicateSelection(example(), ['p', 'a']);
    expect(result.net.nodes).toHaveLength(4);
    expect(result.net.arcs).toHaveLength(3);
    expect(result.selectedIds).toEqual(['p_copy']);
  });

  it('supports an explicit offset and ignores stale or repeated IDs', () => {
    const result = duplicateSelection(example(), ['p', 'p', 'missing'], { x: -5, y: 10 });
    expect(result.net.nodes[3]).toMatchObject({ x: 5, y: 30, tokens: 4 });
    expect(result.selectedIds).toEqual(['p_copy']);
  });

  it('rejects invalid offsets and out-of-bounds copies without mutating the source', () => {
    const net = example();
    expect(() => duplicateSelection(net, ['p'], { x: Infinity, y: 0 })).toThrow();
    net.nodes[0].x = 1e6;
    expect(() => duplicateSelection(net, ['p'])).toThrow(/Coordinates/);
    expect(net.nodes).toHaveLength(3);
  });
});

function bent(): Net {
  const net = example();
  net.arcs[2] = {
    ...net.arcs[2],
    bends: [
      { x: 80, y: 60, curved: false },
      { x: 95, y: 70, curved: true },
    ],
    curvedEnd: true,
  };
  return net;
}

describe('arc bends in selection edits', () => {
  it('duplicates internal arcs with translated, independent bends', () => {
    const net = bent();
    const result = duplicateSelection(net, ['t', 'q']);
    const copy = result.net.arcs.find((arc) => arc.id === 'c_copy')!;
    expect(copy).toMatchObject({ source: 't_copy', target: 'q_copy', weight: 2, curvedEnd: true });
    expect(copy.bends).toEqual([
      { x: 120, y: 100, curved: false },
      { x: 135, y: 110, curved: true },
    ]);
    copy.bends![0].x = 0;
    expect(net.arcs[2].bends![0].x).toBe(80);
    expect(result.net.arcs[2]).toEqual(net.arcs[2]);
  });
  it('moves selected nodes and the bends of selected arcs only', () => {
    const net = bent();
    const moved = moveSelection(net, selectInRectangle(net, { x1: 50, y1: 0, x2: 120, y2: 30 }), {
      x: 30,
      y: 15,
    });
    expect(moved.nodes.map(({ x, y }) => [x, y])).toEqual([
      [10, 20],
      [90, 35],
      [140, 35],
    ]);
    expect(moved.arcs[2].bends).toEqual([
      { x: 110, y: 75, curved: false },
      { x: 125, y: 85, curved: true },
    ]);
    const nodesOnly = moveSelection(net, ['t', 'q'], { x: 30, y: 15 });
    expect(nodesOnly.arcs[2].bends).toEqual(net.arcs[2].bends);
    expect(net).toEqual(bent());
  });
  it('clamps the delta so no moved node or bend crosses the origin, like native', () => {
    const net = bent();
    net.arcs[2].bends![0] = { x: 4, y: 60, curved: false };
    const moved = moveSelection(net, ['t', 'q', 'c'], { x: -50, y: -100 });
    expect(moved.arcs[2].bends![0]).toEqual({ x: 0, y: 55, curved: false });
    expect(moved.nodes[1]).toMatchObject({ x: 56, y: 15 });
    expect(() => moveSelection(net, ['t'], { x: NaN, y: 0 })).toThrow();
  });
});

describe('annotations and layout fields in group edits', () => {
  const annotated = (): Net => ({
    ...example(),
    nodes: example().nodes.map((node) =>
      node.id === 't' ? { ...node, angle: 45, nameVisible: false, nameOffsetX: 7 } : node,
    ),
    annotations: [
      { id: 'annotation-1', text: 'Keep', x: 100, y: 100, width: 50, height: 20 },
      { id: 'annotation-2', text: 'Other', x: 300, y: 0, width: 40, height: 16, border: false },
    ],
  });
  const deepFreeze = (net: Net) => {
    const freeze = (v: unknown) => {
      if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
      }
    };
    freeze(net);
    return net;
  };
  it('leaves annotations out of native marquees unless asked, then uses box intersection', () => {
    const net = annotated();
    const box = { x1: 0, y1: 0, x2: 120, y2: 120 };
    expect(selectInRectangle(net, box)).toEqual(selectInRectangle(example(), box));
    expect(selectInRectangle(net, box, { annotations: true })).toEqual([
      ...selectInRectangle(example(), box),
      'annotation-1',
    ]);
    // The drawn box starts 6 units inside the stored position.
    expect(
      selectInRectangle(net, { x1: 0, y1: 0, x2: 105, y2: 105 }, { annotations: true }),
    ).toEqual(selectInRectangle(example(), { x1: 0, y1: 0, x2: 105, y2: 105 }));
  });
  it('deletes selected annotations only, dropping an emptied list', () => {
    const net = deepFreeze(annotated());
    const one = deleteSelection(net, ['annotation-2']);
    expect(one.annotations!.map((a) => a.id)).toEqual(['annotation-1']);
    expect(one.nodes).toEqual(net.nodes);
    const none = deleteSelection(one, ['annotation-1', 'q']);
    expect(none).not.toHaveProperty('annotations');
    expect(none.nodes.map((n) => n.id)).toEqual(['p', 't']);
  });
  it('duplicates notes with fresh IDs and keeps rotation and label settings on node copies', () => {
    const net = deepFreeze(annotated());
    const { net: next, selectedIds } = duplicateSelection(net, ['t', 'annotation-2']);
    expect(selectedIds).toEqual(['t_copy', 'annotation-3']);
    expect(next.annotations![2]).toEqual({
      id: 'annotation-3',
      text: 'Other',
      x: 340,
      y: 40,
      width: 40,
      height: 16,
      border: false,
    });
    expect(next.nodes.at(-1)).toMatchObject({ angle: 45, nameVisible: false, nameOffsetX: 7 });
    expect(next.annotations!.slice(0, 2)).toEqual(net.annotations);
  });
  it('moves notes with the group and clamps at the origin including notes', () => {
    const net = deepFreeze(annotated());
    const moved = moveSelection(net, ['p', 'annotation-1'], { x: -200, y: 5 });
    // Place p's top-left is at x=-5, so the clamp brings it back to the origin.
    expect(moved.nodes[0]).toMatchObject({ x: 15, y: 25 });
    expect(moved.annotations![0]).toMatchObject({ x: 105, y: 105 });
    expect(moved.annotations![1]).toEqual(net.annotations![1]);
    const noteOnly = moveSelection(net, ['annotation-2'], { x: 10, y: -50 });
    expect(noteOnly.annotations![1]).toMatchObject({ x: 310, y: 0 });
    expect(moveSelection(example(), ['p'], { x: 5, y: 5 })).not.toHaveProperty('annotations');
  });
});
