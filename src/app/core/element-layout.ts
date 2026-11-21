import { arcLabelPosition } from './arc-geometry';
/**
 * Persisted modelling geometry beyond nodes and arcs: node name labels (offset and visibility),
 * transition rotation, and text annotations. Immutable, validated edits; no rendering. Ports
 * PetriNetObjectWithLabel/NameLabel/LabelHandler, Transition.rotate and Note/AnnotationNote at 100%
 * zoom. See design/ELEMENT-LAYOUT.md.
 */
import { netArcGeometry, type Point } from './arc-geometry';
import { type Annotation, MAX_ANNOTATIONS, type Net, type NetNode, validateNet } from './net';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const HALF_NODE = 15; // Constants.PLACE_TRANSITION_HEIGHT / 2
const TRANSITION_HALF_WIDTH = 5; // Transition.TRANSITION_WIDTH / 2
/** Absent offsets mean the web default (0, 35); absent native attributes load as 0 instead. */
export const DEFAULT_LABEL_OFFSET: Readonly<Point> = Object.freeze({ x: 0, y: 35 });
const NAMELABEL_OFFSET = 12; // Constants.NAMELABEL_OFFSET
/** Approximate Dialog bold 10 metrics; pass measured sizes when the renderer has them. */
export const LABEL_LINE_HEIGHT = 13;
const LABEL_CHARACTER_WIDTH = 6.5;
export const ANNOTATION_RESERVED_BORDER = 12; // Constants.RESERVED_BORDER
export const ANNOTATION_MIN_WIDTH = 40; // Constants.ANNOTATION_MIN_WIDTH
/** Native's minimum height is the text's preferred height; one Helvetica 12 line by default. */
export const ANNOTATION_MIN_HEIGHT = 16;
export const ANNOTATION_DEFAULT_SIZE: Readonly<{ width: number; height: number }> = Object.freeze({
  width: 100,
  height: 16,
});
/** TAPNTransitionEditor rotation choices "0°, +45°, +90°, -45°" are these increments. */
export const EDITOR_ROTATIONS = Object.freeze([0, 45, 90, 135] as const);

function fail(message: string): never {
  throw new Error(message);
}
function finitePoint(point: Point, label: string) {
  if (!point || ![point.x, point.y].every(Number.isFinite)) fail(`${label} must be finite.`);
}
function nodeIndex(net: Net, id: string): number {
  const index = net.nodes.findIndex((node) => node.id === id);
  if (index < 0) fail('Node not found.');
  return index;
}
function annotationIndex(net: Net, id: string): number {
  const index = (net.annotations ?? []).findIndex((note) => note.id === id);
  if (index < 0) fail('Annotation not found.');
  return index;
}
function edit(net: Net, change: (next: Net) => void): Net {
  validateNet(net);
  const next = structuredClone(net);
  change(next);
  if (next.annotations && !next.annotations.length) delete next.annotations;
  validateNet(next);
  return next;
}

// ---- Node name labels

export function labelOffset(node: NetNode): Point {
  return {
    x: node.nameOffsetX ?? DEFAULT_LABEL_OFFSET.x,
    y: node.nameOffsetY ?? DEFAULT_LABEL_OFFSET.y,
  };
}

/** Normalise optional label fields so default nodes keep their original JSON shape. */
export function withLabel(
  node: NetNode,
  offset: Point = labelOffset(node),
  visible = node.nameVisible !== false,
): NetNode {
  const { nameOffsetX: _x, nameOffsetY: _y, nameVisible: _visible, ...rest } = node;
  return {
    ...rest,
    ...(offset.x !== DEFAULT_LABEL_OFFSET.x ? { nameOffsetX: offset.x } : {}),
    ...(offset.y !== DEFAULT_LABEL_OFFSET.y ? { nameOffsetY: offset.y } : {}),
    ...(visible ? {} : { nameVisible: false }),
  };
}

/**
 * LabelHandler drag: offsets are native ints, so the result rounds to whole units. Unlike native
 * (which only records undo when both axes change), any change is one commit.
 */
export function moveNodeLabel(net: Net, nodeId: string, delta: Point): Net {
  finitePoint(delta, 'Label offset change');
  const node = net.nodes[nodeIndex(net, nodeId)];
  const offset = labelOffset(node);
  return setNodeLabelOffset(net, nodeId, { x: offset.x + delta.x, y: offset.y + delta.y });
}

export function setNodeLabelOffset(net: Net, nodeId: string, offset: Point): Net {
  finitePoint(offset, 'Label offset');
  const rounded = { x: Math.round(offset.x) || 0, y: Math.round(offset.y) || 0 };
  return edit(net, (next) => {
    const index = nodeIndex(next, nodeId);
    next.nodes[index] = withLabel(next.nodes[index], rounded);
  });
}

/** ShowHideInfoAction / editor "show name" checkbox, applied to each listed node. */
export function setNodeNameVisible(net: Net, nodeIds: readonly string[], visible: boolean): Net {
  if (typeof visible !== 'boolean') fail('Name visibility must be true or false.');
  return edit(net, (next) => {
    for (const id of nodeIds) {
      const index = nodeIndex(next, id);
      next.nodes[index] = withLabel(next.nodes[index], undefined, visible);
    }
  });
}

/**
 * NameLabel.updatePosition at 100%: the label's right edge sits at the node's top-left plus the
 * offset, and its top 12 units above that. Hidden names have no box.
 */
export function nodeLabelBox(
  node: NetNode,
  size: { width: number; height: number } = {
    width: node.name.length * LABEL_CHARACTER_WIDTH,
    height: LABEL_LINE_HEIGHT,
  },
  detail = '',
): Box | null {
  if (node.nameVisible === false && !detail) return null;
  if (detail) {
    size = {
      width: Math.max(
        node.nameVisible === false ? 0 : size.width,
        detail.length * LABEL_CHARACTER_WIDTH,
      ),
      height: size.height + LABEL_LINE_HEIGHT,
    };
  }
  const offset = labelOffset(node);
  return {
    x: node.x - HALF_NODE + offset.x - size.width,
    y: node.y - HALF_NODE + offset.y - NAMELABEL_OFFSET,
    width: size.width,
    height: size.height,
  };
}

// ---- Transition rotation

/** Java `%` keeps the dividend's sign; -0 is stored as 0 (omitted). */
export function normalizeAngle(angle: number): number {
  if (!Number.isSafeInteger(angle)) fail('Rotation must be a whole number of degrees.');
  return angle % 360 || 0;
}

/** PetriNetTab.timedTranstionMouseWheelWithShift: up is +135° per notch, down +45° per notch. */
export function wheelRotation(wheelNotches: number): number {
  if (!Number.isSafeInteger(wheelNotches)) fail('Wheel rotation must be whole notches.');
  return wheelNotches < 0 ? -wheelNotches * 135 : wheelNotches * 45;
}

/** Transition.rotate: angle = (angle + increment) % 360 about the centre, for each transition. */
export function rotateTransitions(
  net: Net,
  transitionIds: readonly string[],
  increment: number,
): Net {
  if (!Number.isSafeInteger(increment)) fail('Rotation must be a whole number of degrees.');
  return edit(net, (next) => {
    for (const id of new Set(transitionIds)) {
      const index = nodeIndex(next, id);
      const { angle = 0, ...node } = next.nodes[index];
      if (node.kind !== 'transition') fail('Only transitions can be rotated.');
      const result = normalizeAngle(angle + normalizeAngle(increment));
      next.nodes[index] = result ? { ...node, angle: result } : node;
    }
  });
}

/** The four corners of the (rotated) node outline; places return their bounding square. */
export function nodeOutline(node: NetNode): Point[] {
  const angle = node.kind === 'transition' ? ((node.angle ?? 0) * Math.PI) / 180 : 0;
  const half = node.kind === 'transition' ? TRANSITION_HALF_WIDTH : HALF_NODE;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return [
    { x: -half, y: -HALF_NODE },
    { x: half, y: -HALF_NODE },
    { x: half, y: HALF_NODE },
    { x: -half, y: HALF_NODE },
  ].map((p) => ({ x: node.x + p.x * cos - p.y * sin, y: node.y + p.x * sin + p.y * cos }));
}

// ---- Annotations

/**
 * Note.updateBounds: the drawn rectangle is inset by half the reserved border from the stored
 * position and grows the text area by the full border; the text area is centred within it.
 */
export function annotationBox(note: Annotation): Box {
  const half = ANNOTATION_RESERVED_BORDER / 2;
  return {
    x: note.x + half,
    y: note.y + half,
    width: note.width + ANNOTATION_RESERVED_BORDER,
    height: note.height + ANNOTATION_RESERVED_BORDER,
  };
}
export function annotationTextBox(note: Annotation): Box {
  return {
    x: note.x + ANNOTATION_RESERVED_BORDER,
    y: note.y + ANNOTATION_RESERVED_BORDER,
    width: note.width,
    height: note.height,
  };
}

/** Lowest free `annotation-N`; deterministic so reopening a TAPN file yields the same IDs. */
export function freshAnnotationIds(
  net: Pick<Net, 'nodes' | 'arcs' | 'annotations'>,
  count: number,
) {
  const used = new Set(
    [...net.nodes, ...net.arcs, ...(net.annotations ?? [])].map((element) => element.id),
  );
  const ids: string[] = [];
  for (let n = 1; ids.length < count; n++) {
    const id = `annotation-${n}`;
    if (!used.has(id)) ids.push(id);
  }
  return ids;
}

/** Line endings normalise to LF: XML cannot carry a bare CR through a desktop round trip. */
export function normalizeAnnotationText(text: string): string {
  if (typeof text !== 'string') fail('Annotation text must be text.');
  return text.replace(/\r\n?/g, '\n');
}

function wholeSize(value: number, minimum: number, label: string): number {
  if (!Number.isFinite(value)) fail(`${label} must be finite.`);
  return Math.max(minimum, Math.round(value));
}

/**
 * GuiModelManager.addAnnotationNote: the note's top-left is the (grid-snapped) click point, and
 * blank text adds nothing, so this refuses it. Size defaults approximate one line of text.
 */
export function createAnnotation(
  net: Net,
  at: Point,
  text: string,
  size: { width: number; height: number } = ANNOTATION_DEFAULT_SIZE,
): { net: Net; id: string } {
  finitePoint(at, 'Annotation position');
  const normalized = normalizeAnnotationText(text);
  if (!normalized.trim()) fail('Annotation text is required.');
  if ((net.annotations?.length ?? 0) >= MAX_ANNOTATIONS)
    fail(`A component can hold at most ${MAX_ANNOTATIONS} annotations.`);
  const [id] = freshAnnotationIds(net, 1);
  const note: Annotation = {
    id,
    text: normalized,
    x: Math.round(at.x) || 0,
    y: Math.round(at.y) || 0,
    width: wholeSize(size.width, ANNOTATION_MIN_WIDTH, 'Annotation width'),
    height: wholeSize(size.height, 0, 'Annotation height'),
  };
  return { net: edit(net, (next) => (next.annotations = [...(next.annotations ?? []), note])), id };
}

/**
 * AnnotationPanel OK. Unlike creation, native allows a later edit to blank text. Note.setText also
 * resizes to the preferred text size; pass the measured size to mirror that.
 */
export function editAnnotationText(
  net: Net,
  id: string,
  text: string,
  size?: { width: number; height: number },
): Net {
  const normalized = normalizeAnnotationText(text);
  return edit(net, (next) => {
    const note = next.annotations![annotationIndex(next, id)];
    note.text = normalized;
    if (size) {
      note.width = wholeSize(size.width, 0, 'Annotation width');
      note.height = wholeSize(size.height, 0, 'Annotation height');
    }
  });
}

/** Absolute top-left placement; group drags use moveSelection, which clamps at the origin. */
export function moveAnnotation(net: Net, id: string, to: Point): Net {
  finitePoint(to, 'Annotation position');
  return edit(net, (next) => {
    const note = next.annotations![annotationIndex(next, id)];
    note.x = Math.round(to.x) || 0;
    note.y = Math.round(to.y) || 0;
  });
}

export type ResizeHandle =
  'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';
const HANDLE_EDGES: Record<ResizeHandle, { top?: true; bottom?: true; left?: true; right?: true }> =
  {
    'top-left': { top: true, left: true },
    top: { top: true },
    'top-right': { top: true, right: true },
    right: { right: true },
    'bottom-right': { bottom: true, right: true },
    bottom: { bottom: true },
    'bottom-left': { bottom: true, left: true },
    left: { left: true },
  };

/** The eight AnnotationNote.ResizePoint positions on the drawn rectangle. */
export function annotationHandles(note: Annotation): Record<ResizeHandle, Point> {
  const box = annotationBox(note);
  const [left, centre, right] = [box.x, box.x + box.width / 2, box.x + box.width];
  const [top, middle, bottom] = [box.y, box.y + box.height / 2, box.y + box.height];
  return {
    'top-left': { x: left, y: top },
    top: { x: centre, y: top },
    'top-right': { x: right, y: top },
    right: { x: right, y: middle },
    'bottom-right': { x: right, y: bottom },
    bottom: { x: centre, y: bottom },
    'bottom-left': { x: left, y: bottom },
    left: { x: left, y: middle },
  };
}

/**
 * Note.adjustTop/Bottom/Left/Right for one handle drag, from the pre-drag note by the total
 * (grid-aligned) delta. Native rejects each mouse event that would undercut the minimum; a total
 * delta instead clamps at it, keeping the opposite edge fixed. `minHeight` is the text's
 * preferred height when the renderer can measure it. A callback measures at the resized width.
 */
export function resizeAnnotation(
  net: Net,
  id: string,
  handle: ResizeHandle,
  delta: Point,
  minHeight: number | ((width: number) => number) = ANNOTATION_MIN_HEIGHT,
): Net {
  finitePoint(delta, 'Resize offset');
  const edges = HANDLE_EDGES[handle] ?? fail('Unknown resize handle.');
  const dx = Math.round(delta.x) || 0,
    dy = Math.round(delta.y) || 0;
  return edit(net, (next) => {
    const note = next.annotations![annotationIndex(next, id)];
    const minWidth = Math.min(ANNOTATION_MIN_WIDTH, note.width);
    if (edges.left) {
      const width = Math.max(minWidth, note.width - dx);
      note.x += note.width - width;
      note.width = width;
    }
    if (edges.right) note.width = Math.max(minWidth, note.width + dx);
    const measuredHeight = typeof minHeight === 'function' ? minHeight(note.width) : minHeight;
    if (!Number.isFinite(measuredHeight) || measuredHeight < 0)
      fail('Minimum height must be finite.');
    const minimumHeight = Math.ceil(measuredHeight);
    if (edges.top) {
      const height = Math.max(minimumHeight, note.height - dy);
      note.y += note.height - height;
      note.height = height;
    }
    if (edges.bottom) note.height = Math.max(minimumHeight, note.height + dy);
    // Native Note.updateBounds grows wrapped content after a horizontal resize.
    note.height = Math.max(note.height, minimumHeight);
  });
}

/** EditAnnotationBorderAction ("Enable/Disable Border"). */
export function setAnnotationBorder(net: Net, id: string, border: boolean): Net {
  if (typeof border !== 'boolean') fail('Annotation border must be true or false.');
  return edit(net, (next) => {
    const index = annotationIndex(next, id);
    const { border: _border, ...note } = next.annotations![index];
    next.annotations![index] = border ? note : { ...note, border: false };
  });
}

/**
 * EditAnnotationBackgroundAction ("Transparent"/"Solid Background"). Desktop neither undoes nor
 * saves this; TAPN export refuses transparent notes rather than drop the style silently.
 */
export function setAnnotationFilled(net: Net, id: string, filled: boolean): Net {
  if (typeof filled !== 'boolean') fail('Annotation background must be true or false.');
  return edit(net, (next) => {
    const index = annotationIndex(next, id);
    const { filled: _filled, ...note } = next.annotations![index];
    next.annotations![index] = filled ? note : { ...note, filled: false };
  });
}

// ---- Fit-to-content

/**
 * Extent of everything drawn: node outlines (rotated), visible name labels (approximate unless
 * `labelSize` measures them), annotation boxes, and arc vertices with curve controls (cubics stay
 * inside their control hull, so this is conservative). Null for an empty component.
 */
export function layoutBounds(
  net: Net,
  labelSize?: (node: NetNode) => { width: number; height: number },
  arcLabelSize?: (id: string) => { width: number; height: number },
  labelDetail?: (node: NetNode) => string,
): Bounds | null {
  validateNet(net);
  const points: Point[] = [];
  const box = (b: Box) => points.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height });
  for (const node of net.nodes) {
    points.push(...nodeOutline(node));
    const label = nodeLabelBox(node, labelSize?.(node), labelDetail?.(node));
    if (label) box(label);
  }
  for (const note of net.annotations ?? []) box(annotationBox(note));
  for (const [id, geometry] of netArcGeometry(net)) {
    for (const v of geometry.vertices)
      points.push(v, ...(v.curved ? [v.control1, v.control2] : []));
    const arc = net.arcs.find((a) => a.id === id)!;
    const label = arcLabelPosition(arc, geometry.midpoint);
    const size = arcLabelSize?.(id) ?? {
      width: Math.max(20, String(arc.weight).length * 8 + 16),
      height: 16,
    };
    box({
      x: label.x - size.width / 2,
      y: label.y - size.height,
      width: size.width,
      height: size.height + 4,
    });
  }
  if (!points.length) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  }
  return bounds;
}
