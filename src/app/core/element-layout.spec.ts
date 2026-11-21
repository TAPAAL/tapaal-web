import { describe, expect, it } from 'vitest';
import { arcGeometry, netArcGeometry } from './arc-geometry';
import {
  ANNOTATION_MIN_WIDTH,
  annotationBox,
  annotationHandles,
  annotationTextBox,
  createAnnotation,
  editAnnotationText,
  freshAnnotationIds,
  layoutBounds,
  moveAnnotation,
  moveNodeLabel,
  nodeLabelBox,
  nodeOutline,
  normalizeAngle,
  resizeAnnotation,
  rotateTransitions,
  setAnnotationBorder,
  setAnnotationFilled,
  setNodeLabelOffset,
  setNodeNameVisible,
  wheelRotation,
} from './element-layout';
import { fireTransition, initialMarking, Net, validateNet } from './net';

const net = (): Net => ({
  name: 'Layout',
  template: 'Main',
  nodes: [
    { id: 'p', kind: 'place', name: 'P', x: 100, y: 30, tokens: 1 },
    { id: 't', kind: 'transition', name: 'T', x: 100, y: 100, tokens: 0 },
    { id: 'q', kind: 'place', name: 'Q', x: 170, y: 100, tokens: 0 },
  ],
  arcs: [
    { id: 'a', source: 'p', target: 't', kind: 'normal', weight: 1 },
    { id: 'b', source: 't', target: 'q', kind: 'normal', weight: 1 },
  ],
});
const frozen = <T>(value: T): T => {
  const deep = (v: unknown) => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(deep);
      Object.freeze(v);
    }
  };
  deep(value);
  return value;
};

describe('node name labels', () => {
  it('moves labels in whole units, keeping the default shape when offsets return', () => {
    const original = frozen(net());
    const moved = moveNodeLabel(original, 'p', { x: 10.4, y: -5.6 });
    expect(moved.nodes[0]).toMatchObject({ nameOffsetX: 10, nameOffsetY: 29 });
    expect(original.nodes[0]).not.toHaveProperty('nameOffsetX');
    const back = setNodeLabelOffset(moved, 'p', { x: 0, y: 35 });
    expect(back).toEqual(original);
    expect(back.nodes[1]).toEqual(original.nodes[1]);
    expect(() => moveNodeLabel(original, 'p', { x: NaN, y: 0 })).toThrow(/finite/);
    expect(() => moveNodeLabel(original, 'missing', { x: 1, y: 0 })).toThrow(/not found/);
    expect(() => setNodeLabelOffset(original, 'p', { x: 2e6, y: 0 })).toThrow(/Label offsets/);
  });
  it('hides and shows names without touching offsets or semantics', () => {
    const original = frozen(moveNodeLabel(net(), 't', { x: 4, y: 0 }));
    const hidden = setNodeNameVisible(original, ['p', 't'], false);
    expect(hidden.nodes.map((n) => n.nameVisible)).toEqual([false, false, undefined]);
    expect(hidden.nodes[1].nameOffsetX).toBe(4);
    expect(nodeLabelBox(hidden.nodes[0])).toBeNull();
    expect(setNodeNameVisible(hidden, ['p', 't'], true)).toEqual(original);
    expect(() => setNodeNameVisible(original, ['nope'], false)).toThrow(/not found/);
  });
  it('places the label box by NameLabel.updatePosition', () => {
    expect(nodeLabelBox(net().nodes[0], { width: 20, height: 13 })).toEqual({
      x: 100 - 15 + 0 - 20,
      y: 30 - 15 + 35 - 12,
      width: 20,
      height: 13,
    });
  });
});

describe('transition rotation', () => {
  it('follows Transition.rotate remainder semantics and native wheel increments', () => {
    expect([wheelRotation(-1), wheelRotation(1), wheelRotation(-2), wheelRotation(0)]).toEqual([
      135, 45, 270, 0,
    ]);
    expect([normalizeAngle(405), normalizeAngle(-45), normalizeAngle(-360)]).toEqual([45, -45, 0]);
    const original = frozen(net());
    const once = rotateTransitions(original, ['t'], 135);
    expect(once.nodes[1].angle).toBe(135);
    const full = rotateTransitions(rotateTransitions(once, ['t'], 135), ['t'], 90);
    expect(full).toEqual(original);
    expect(rotateTransitions(once, ['t'], -135)).toEqual(original);
    expect(() => rotateTransitions(original, ['p'], 45)).toThrow(/Only transitions/);
    expect(() => rotateTransitions(original, ['t'], 4.5)).toThrow(/whole/);
    expect(() => validateNet({ ...net(), nodes: [{ ...net().nodes[0], angle: 45 }] })).toThrow(
      /Only transitions rotate/,
    );
    expect(() =>
      validateNet({ ...net(), nodes: [net().nodes[0], { ...net().nodes[1], angle: 360 }] }),
    ).toThrow(/Only transitions rotate/);
  });
  it('does not change firing semantics', () => {
    const rotated = rotateTransitions(net(), ['t'], 45);
    expect(fireTransition(rotated, initialMarking(rotated), 't')).toEqual(
      fireTransition(net(), initialMarking(net()), 't'),
    );
  });
  it('rotates the 10x30 outline about its centre', () => {
    const [vertical] = [nodeOutline(net().nodes[1])];
    expect(vertical).toEqual([
      { x: 95, y: 85 },
      { x: 105, y: 85 },
      { x: 105, y: 115 },
      { x: 95, y: 115 },
    ]);
    const horizontal = nodeOutline(rotateTransitions(net(), ['t'], 90).nodes[1]);
    expect(horizontal.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: 115, y: 95 },
      { x: 115, y: 105 },
      { x: 85, y: 105 },
      { x: 85, y: 95 },
    ]);
  });
  it('attaches arcs to the rotated sides like Transition.updateEndPoints', () => {
    // Angle 0: the place above uses the top port, the place to the right a right-side port.
    expect(arcGeometry(net(), 'a').end).toEqual({ x: 100, y: 85 });
    expect(arcGeometry(net(), 'b').start).toEqual({ x: 105, y: 100 });
    // Angle 90: the outline lies horizontally; ports move to its long sides and short ends.
    const rotated = rotateTransitions(net(), ['t'], 90);
    expect(arcGeometry(rotated, 'a').end).toEqual({ x: 99, y: 95 });
    expect(arcGeometry(rotated, 'b').start).toEqual({ x: 115, y: 100 });
    // Angle 180 is geometrically the same rectangle but native ports keep their orientation.
    const all = netArcGeometry(rotateTransitions(net(), ['t'], 180));
    expect(all.get('a')!.end).toEqual({ x: 100, y: 85 });
  });
  it('uses the rotated side angle for curved end control points', () => {
    const curved = (n: Net): Net => ({
      ...n,
      arcs: [{ ...n.arcs[0], bends: [{ x: 60, y: 60, curved: true }], curvedEnd: true }, n.arcs[1]],
    });
    const straight = arcGeometry(curved(net()), 'a').vertices.at(-1)!;
    const turned = arcGeometry(curved(rotateTransitions(net(), ['t'], 45)), 'a').vertices.at(-1)!;
    expect(turned.control2).not.toEqual(straight.control2);
  });
});

describe('annotations', () => {
  it('creates notes with stable fresh IDs and refuses blank text like native', () => {
    const original = frozen(net());
    const { net: one, id } = createAnnotation(original, { x: 40.4, y: 10 }, 'Hello\r\nworld');
    expect(id).toBe('annotation-1');
    expect(one.annotations).toEqual([
      { id, text: 'Hello\nworld', x: 40, y: 10, width: 100, height: 16 },
    ]);
    expect(original.annotations).toBeUndefined();
    expect(createAnnotation(one, { x: 0, y: 0 }, 'x').id).toBe('annotation-2');
    expect(() => createAnnotation(original, { x: 0, y: 0 }, '  \n')).toThrow(/required/);
    expect(() => createAnnotation(original, { x: Infinity, y: 0 }, 'x')).toThrow(/finite/);
    expect(() => createAnnotation(original, { x: 0, y: 0 }, 'bad \u0001')).toThrow(/XML text/);
    const clash = { ...net(), nodes: [...net().nodes] };
    clash.nodes[2] = { ...clash.nodes[2], id: 'annotation-1' };
    clash.arcs = [clash.arcs[0], { ...clash.arcs[1], target: 'annotation-1' }];
    expect(freshAnnotationIds(clash, 2)).toEqual(['annotation-2', 'annotation-3']);
  });
  it('edits, moves and styles notes immutably and drops default flags', () => {
    const { net: base, id } = createAnnotation(net(), { x: 40, y: 10 }, 'Note');
    frozen(base);
    const edited = editAnnotationText(base, id, '', { width: 80.6, height: 30 });
    expect(edited.annotations![0]).toMatchObject({ text: '', width: 81, height: 30 });
    const moved = moveAnnotation(base, id, { x: 7.5, y: -3 });
    expect(moved.annotations![0]).toMatchObject({ x: 8, y: -3 });
    const styled = setAnnotationFilled(setAnnotationBorder(base, id, false), id, false);
    expect(styled.annotations![0]).toMatchObject({ border: false, filled: false });
    expect(setAnnotationFilled(setAnnotationBorder(styled, id, true), id, true)).toEqual(base);
    expect(() => moveAnnotation(base, 'p', { x: 0, y: 0 })).toThrow(/Annotation not found/);
    expect(() => moveAnnotation(base, id, { x: 2e6, y: 0 })).toThrow(/within/);
  });
  it('resizes from each handle with the opposite edge fixed and native minimums', () => {
    const { net: base, id } = createAnnotation(net(), { x: 40, y: 10 }, 'Note', {
      width: 100,
      height: 40,
    });
    const note = (n: Net) => n.annotations![0];
    expect(note(resizeAnnotation(base, id, 'bottom-right', { x: 20, y: 10 }))).toMatchObject({
      x: 40,
      y: 10,
      width: 120,
      height: 50,
    });
    expect(note(resizeAnnotation(base, id, 'top-left', { x: 20, y: 10 }))).toMatchObject({
      x: 60,
      y: 20,
      width: 80,
      height: 30,
    });
    const tiny = note(resizeAnnotation(base, id, 'left', { x: 500, y: 0 }));
    expect(tiny).toMatchObject({ x: 40 + 100 - ANNOTATION_MIN_WIDTH, width: ANNOTATION_MIN_WIDTH });
    expect(note(resizeAnnotation(base, id, 'top', { x: 0, y: 500 }, 25))).toMatchObject({
      y: 25,
      height: 25,
    });
    expect(() => resizeAnnotation(base, id, 'middle' as never, { x: 1, y: 1 })).toThrow(/handle/);
  });
  it('derives the drawn box, text area and eight handles from Note.updateBounds', () => {
    const note = { id: 'n', text: 'x', x: 40, y: 10, width: 100, height: 20 };
    expect(annotationBox(note)).toEqual({ x: 46, y: 16, width: 112, height: 32 });
    expect(annotationTextBox(note)).toEqual({ x: 52, y: 22, width: 100, height: 20 });
    const handles = annotationHandles(note);
    expect(Object.keys(handles)).toHaveLength(8);
    expect(handles['top-left']).toEqual({ x: 46, y: 16 });
    expect(handles.right).toEqual({ x: 158, y: 32 });
  });
  it('validates finite geometry, text limits and unique element IDs', () => {
    const note = { id: 'n', text: 'x', x: 0, y: 0, width: 10, height: 10 };
    const bad: [Partial<typeof note> & Record<string, unknown>, RegExp][] = [
      [{ id: 'p' }, /unique/],
      [{ x: NaN }, /finite/],
      [{ width: -1 }, /sizes/],
      [{ text: 'a\rb' }, /carriage/],
      [{ text: 'x'.repeat(100001) }, /at most/],
      [{ border: 'no' }, /border/],
    ];
    for (const [change, message] of bad)
      expect(() =>
        validateNet({ ...net(), annotations: [{ ...note, ...change } as never] }),
      ).toThrow(message);
    expect(() => validateNet({ ...net(), annotations: {} as never })).toThrow(/list/);
  });
});

describe('layout bounds', () => {
  it('covers rotated nodes, visible labels, notes and arc bends', () => {
    const empty: Net = { name: 'E', template: 'E', nodes: [], arcs: [] };
    expect(layoutBounds(empty)).toBeNull();
    let n = net();
    n.arcs[1] = { ...n.arcs[1], bends: [{ x: 300, y: 250, curved: false }] };
    n = createAnnotation(n, { x: -80, y: 400 }, 'Far note', { width: 60, height: 20 }).net;
    const bounds = layoutBounds(n, () => ({ width: 10, height: 13 }))!;
    expect(bounds).toEqual({ minX: -74, minY: 15, maxX: 300, maxY: 438 });
    const hidden = setNodeNameVisible(n, ['p'], false);
    expect(layoutBounds(hidden, () => ({ width: 500, height: 13 }))!.minX).toBeLessThan(-74);
    expect(layoutBounds(setNodeNameVisible(n, ['p', 't', 'q'], false))!.minX).toBe(-74);
  });
});
