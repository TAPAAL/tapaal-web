/**
 * Native arc-path geometry and immutable bend editing. Ports pipe.gui.petrinet.graphicElements
 * ArcPath/ArcPathPoint/Place/Transition (rotated transitions included, 100% zoom). See
 * design/ARC-PATHS.md.
 */
import { type Arc, type ArcBend, type Net, type NetNode, validateNet } from './net';

export interface Point {
  x: number;
  y: number;
}
export interface ArcPathVertex extends Point {
  /** Native point type: the segment ending here is curved. The source vertex is always straight. */
  curved: boolean;
  /** Cubic control points of the segment ending here (unused for the source vertex). */
  control1: Point;
  control2: Point;
}
export interface ArcGeometry {
  /** Source anchor, interior bends, target anchor. */
  vertices: ArcPathVertex[];
  /** SVG path data from source anchor to target anchor (no arrowhead shortening). */
  d: string;
  start: Point;
  end: Point;
  /** Direction of travel into the target, in SVG radians (atan2(dy, dx), y down). */
  endAngle: number;
  /** Native label anchor: half the vertex polyline length (ArcPath.createPath). */
  midpoint: Point;
}

const RADIUS = 15;
const TRANSITION_HEIGHT = 30;
const TRANSITION_WIDTH = TRANSITION_HEIGHT / 3;
const CONTROL_CONSTANT = 3; // Constants.ARC_CONTROL_POINT_CONSTANT
const SPLIT_DELTA = 10; // ArcPathPoint.DELTA
const ROOT_THREE_OVER_TWO = Math.sqrt(3) / 2;

const mod = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const copy = (p: Point): Point => ({ x: p.x, y: p.y });

/** ArcPath.getControlPoint: control point for curve CD with incoming vector AB. */
function controlPoint(a: Point, b: Point, c: Point, d: Point): Point {
  const modAB = mod(a, b);
  if (modAB < 7) return copy(c);
  const modCD = mod(c, d);
  return {
    x: c.x + (((b.x - a.x) / modAB) * modCD) / CONTROL_CONSTANT,
    y: c.y + (((b.y - a.y) / modAB) * modCD) / CONTROL_CONSTANT,
  };
}

/** ArcPath.calcNaturalCubic, returning the two Bézier control coordinates of each piece. */
function naturalCubic(n: number, x: number[]): [number, number][] {
  const gamma = new Array<number>(n + 1),
    delta = new Array<number>(n + 1),
    d = new Array<number>(n + 1);
  gamma[0] = 1 / 2;
  for (let i = 1; i < n; i++) gamma[i] = 1 / (4 - gamma[i - 1]);
  gamma[n] = 1 / (2 - gamma[n - 1]);
  delta[0] = 3 * (x[1] - x[0]) * gamma[0];
  for (let i = 1; i < n; i++) delta[i] = (3 * (x[i + 1] - x[i - 1]) - delta[i - 1]) * gamma[i];
  delta[n] = (3 * (x[n] - x[n - 1]) - delta[n - 1]) * gamma[n];
  d[n] = delta[n];
  for (let i = n - 1; i >= 0; i--) d[i] = delta[i] - gamma[i] * d[i + 1];
  const pieces: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = x[i],
      b = d[i],
      c = 3 * (x[i + 1] - x[i]) - 2 * d[i] - d[i + 1];
    pieces.push([(b + 3 * a) / 3, (c + 2 * b + 3 * a) / 3]);
  }
  return pieces;
}

/**
 * ArcPath.setControlPoints. `transitionAngle` is the native side angle (degrees) of the
 * transition end, used only for curved segments touching it.
 */
function setControlPoints(
  path: ArcPathVertex[],
  sourceIsTransition: boolean,
  transitionAngle: number,
) {
  const end = path.length - 1;
  path[0].curved = false;
  // setCurveControlPoints (the inner loop deliberately includes the first straight point after a run).
  for (let c = 1; c <= end;) {
    let current = path[c];
    if (!current.curved) {
      c++;
      continue;
    }
    const start = c - 1;
    let last = 0;
    for (; c <= end && current.curved; c++) {
      current = path[c];
      last = c;
    }
    const length = last - start;
    const xs: number[] = [],
      ys: number[] = [];
    let k = 0;
    for (; k <= length; k++) {
      xs[k] = Math.trunc(path[start + k].x);
      ys[k] = Math.trunc(path[start + k].y);
    }
    xs[k] = xs[k - 1];
    ys[k] = ys[k - 1];
    const cx = naturalCubic(k, xs),
      cy = naturalCubic(k, ys);
    for (let i = 1; i <= length; i++) {
      path[start + i].control1 = { x: cx[i - 1][0], y: cy[i - 1][0] };
      path[start + i].control2 = { x: cx[i - 1][1], y: cy[i - 1][1] };
    }
  }
  // setStraightControlPoints
  for (let c = 1; c <= end; c++) {
    const previous = path[c - 1],
      current = path[c];
    if (!current.curved) {
      current.control1 = controlPoint(previous, current, previous, current);
      current.control2 = controlPoint(current, previous, current, previous);
    } else {
      if (c > 1 && !previous.curved)
        current.control1 = controlPoint(path[c - 2], previous, previous, current);
      if (c < end && !path[c + 1].curved)
        current.control2 = controlPoint(path[c + 1], current, current, previous);
    }
  }
  // setEndControlPoints
  if (end <= 0) return;
  const angle = (transitionAngle * Math.PI) / 180;
  if (sourceIsTransition && path[1].curved) {
    const distance = mod(path[1], path[0]) / CONTROL_CONSTANT;
    path[1].control1 = {
      x: path[0].x + Math.cos(angle) * distance,
      y: path[0].y + Math.sin(angle) * distance,
    };
    const last = path[end];
    last.control2 = controlPoint(last, last.control1, last, last.control1);
  } else if (!sourceIsTransition && path[end].curved) {
    const distance = mod(path[end], path[end - 1]) / CONTROL_CONSTANT;
    path[end].control2 = {
      x: path[end].x + Math.cos(angle) * distance,
      y: path[end].y + Math.sin(angle) * distance,
    };
    path[1].control1 = controlPoint(path[0], path[1].control2, path[0], path[1].control2);
  }
}

interface Working {
  arc: Arc;
  from: NetNode;
  to: NetNode;
  path: ArcPathVertex[];
  transitionAngle: number;
}

const vertex = (p: Point, curved: boolean): ArcPathVertex => ({
  x: p.x,
  y: p.y,
  curved,
  control1: copy(p),
  control2: copy(p),
});

/** Place.updateEndPoint: rounded circumference point facing the adjacent control point. */
function placeAnchor(place: NetNode, anchor: Point, control: Point): Point {
  const angle = Math.atan2(control.y - anchor.y, anchor.x - control.x);
  return {
    x: Math.round(place.x - RADIUS * Math.cos(angle)),
    y: Math.round(place.y + RADIUS * Math.sin(angle)),
  };
}

/**
 * Transition.updateEndPoint(s) and ArcAngleCompare.calcAngle: side classification relative to the
 * rotated outline and port distribution along it. Sides are named for angle 0.
 */
function anchorTransition(transition: NetNode, arcs: Working[]) {
  const rotation = transition.angle ?? 0;
  const entries = arcs.map((work) => {
    const isTarget = work.arc.target === transition.id;
    const neighbour = work.path[isTarget ? work.path.length - 2 : 1];
    let angle = Math.atan2(transition.x - neighbour.x, neighbour.y - transition.y);
    if (angle < ((30 + rotation) * Math.PI) / 180) angle += 2 * Math.PI;
    return { work, isTarget, angle };
  });
  entries.sort((a, b) => a.angle - b.angle);
  // Native names these top/bottom; in SVG coordinates (y down) they are below/above.
  const below: typeof entries = [],
    above: typeof entries = [],
    left: typeof entries = [],
    right: typeof entries = [];
  for (const entry of entries) {
    const relative = entry.angle - (rotation * Math.PI) / 180;
    if (Math.cos(relative) > ROOT_THREE_OVER_TWO) {
      below.push(entry);
      entry.work.transitionAngle = rotation + 90;
    } else if (Math.cos(relative) < -ROOT_THREE_OVER_TWO) {
      above.push(entry);
      entry.work.transitionAngle = rotation + 270;
    } else if (Math.sin(relative) > 0) {
      left.push(entry);
      entry.work.transitionAngle = rotation + 180;
    } else {
      right.push(entry);
      entry.work.transitionAngle = rotation;
    }
  }
  // Native rotates ports by Math.toRadians(angle + Math.PI): an extra π degrees, not π radians.
  const skew = ((rotation + Math.PI) * Math.PI) / 180;
  const place = (entry: (typeof entries)[number], offset: Point) => {
    const cos = Math.cos(skew),
      sin = Math.sin(skew);
    // Arc.setSource/TargetLocation -> ArcPath.setPointLocation rounds to whole pixels.
    const point = {
      x: Math.round(transition.x + offset.x * cos - offset.y * sin),
      y: Math.round(transition.y + offset.x * sin + offset.y * cos),
    };
    const path = entry.work.path,
      index = entry.isTarget ? path.length - 1 : 0;
    path[index].x = point.x;
    path[index].y = point.y;
  };
  for (const entry of below) place(entry, { x: 1, y: TRANSITION_HEIGHT / 2 });
  for (const entry of above) place(entry, { x: -1, y: -TRANSITION_HEIGHT / 2 });
  let inc = Math.trunc(TRANSITION_HEIGHT / (left.length + 1)),
    current = TRANSITION_HEIGHT / 2 - inc;
  for (const entry of left) {
    place(entry, { x: -TRANSITION_WIDTH / 2, y: current + 1 });
    current -= inc;
  }
  inc = Math.trunc(TRANSITION_HEIGHT / (right.length + 1));
  current = -TRANSITION_HEIGHT / 2 + inc;
  for (const entry of right) {
    place(entry, { x: TRANSITION_WIDTH / 2, y: current });
    current += inc;
  }
}

function svgPath(path: ArcPathVertex[]): string {
  let d = `M ${path[0].x} ${path[0].y}`;
  for (const p of path.slice(1)) {
    d += p.curved
      ? ` C ${p.control1.x} ${p.control1.y} ${p.control2.x} ${p.control2.y} ${p.x} ${p.y}`
      : ` L ${p.x} ${p.y}`;
  }
  return d;
}

/** ArcPath.createPath label mid-point (vertex polyline, ignoring curvature). */
function midpoint(path: ArcPathVertex[]): Point {
  const end = path.length - 1;
  if (end < 2) return { x: (path[0].x + path[1].x) * 0.5, y: (path[0].y + path[1].y) * 0.5 };
  let length = 0;
  for (let c = 1; c <= end; c++) length += mod(path[c], path[c - 1]);
  length /= 2;
  let accumulated = 0,
    percent = 0,
    c = 1;
  for (; c <= end; c++) {
    const increment = mod(path[c], path[c - 1]);
    if (accumulated + increment > length) {
      percent = (length - accumulated) / increment;
      break;
    }
    accumulated += increment;
  }
  // Native reuses the last visited point when the loop runs to completion.
  const current = path[Math.min(c, end)],
    previous = path[c - 1];
  return {
    x: previous.x + (current.x - previous.x) * percent,
    y: previous.y + (current.y - previous.y) * percent,
  };
}

/**
 * Geometry for every arc, computed together because native transition ports depend on all arcs
 * meeting a transition. Endpoints are automatic anchors; only interior bends come from the model.
 */
export function netArcGeometry(net: Net): Map<string, ArcGeometry> {
  validateNet(net);
  const nodes = new Map(net.nodes.map((node) => [node.id, node]));
  const work: Working[] = net.arcs.map((arc) => {
    const from = nodes.get(arc.source)!,
      to = nodes.get(arc.target)!;
    return {
      arc,
      from,
      to,
      transitionAngle: 0,
      path: [
        vertex(from, false),
        ...(arc.bends ?? []).map((bend) => vertex(bend, bend.curved)),
        vertex(to, arc.curvedEnd === true),
      ],
    };
  });
  const byTransition = new Map<string, Working[]>();
  for (const w of work) {
    const transition = w.from.kind === 'transition' ? w.from : w.to;
    byTransition.set(transition.id, [...(byTransition.get(transition.id) ?? []), w]);
  }
  const controls = () => {
    for (const w of work) setControlPoints(w.path, w.from.kind === 'transition', w.transitionAngle);
  };
  // Arc.updateArcPosition updates both endpoints twice; mirror that two-pass convergence.
  for (let pass = 0; pass < 2; pass++) {
    for (const [id, arcs] of byTransition) anchorTransition(nodes.get(id)!, arcs);
    controls();
    for (const w of work) {
      const end = w.path.length - 1;
      if (w.from.kind === 'place') {
        const anchor = placeAnchor(w.from, w.path[0], w.path[1].control2);
        Object.assign(w.path[0], anchor);
      } else {
        // Arc.getEndAngle uses control1 for a place target.
        const anchor = placeAnchor(w.to, w.path[end], w.path[end].control1);
        Object.assign(w.path[end], anchor);
      }
      setControlPoints(w.path, w.from.kind === 'transition', w.transitionAngle);
    }
  }
  const result = new Map<string, ArcGeometry>();
  for (const w of work) {
    const path = w.path,
      last = path[path.length - 1];
    const reference = w.to.kind === 'transition' ? last.control2 : last.control1;
    let endAngle = Math.atan2(last.y - reference.y, last.x - reference.x);
    if (reference.x === last.x && reference.y === last.y) {
      const before = path[path.length - 2];
      endAngle = Math.atan2(last.y - before.y, last.x - before.x);
    }
    result.set(w.arc.id, {
      vertices: path,
      d: svgPath(path),
      start: copy(path[0]),
      end: copy(last),
      endAngle,
      midpoint: midpoint(path),
    });
  }
  return result;
}

export function arcGeometry(net: Net, arcId: string): ArcGeometry {
  const geometry = netArcGeometry(net).get(arcId);
  if (!geometry) throw new Error('Arc not found.');
  return geometry;
}

/** Extent of every interior bend, for fit-to-content and canvas sizing (native includes them). */
export function bendBounds(
  net: Net,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bends = net.arcs.flatMap((arc) => arc.bends ?? []);
  if (!bends.length) return null;
  return {
    minX: Math.min(...bends.map((b) => b.x)),
    minY: Math.min(...bends.map((b) => b.y)),
    maxX: Math.max(...bends.map((b) => b.x)),
    maxY: Math.max(...bends.map((b) => b.y)),
  };
}

/** Normalise optional fields so default arcs keep their pre-bend JSON shape. */
export function withBends(arc: Arc, bends: readonly ArcBend[], curvedEnd = arc.curvedEnd): Arc {
  const { bends: _bends, curvedEnd: _curvedEnd, ...rest } = arc;
  return {
    ...rest,
    ...(bends.length ? { bends: bends.map((b) => ({ x: b.x, y: b.y, curved: b.curved })) } : {}),
    ...(curvedEnd ? { curvedEnd: true } : {}),
  };
}

export function translateArcBends(arc: Arc, dx: number, dy: number): Arc {
  if (![dx, dy].every(Number.isFinite)) throw new Error('Translation must be finite.');
  return withBends(
    arc,
    (arc.bends ?? []).map((b) => ({ x: b.x + dx, y: b.y + dy, curved: b.curved })),
  );
}

function editArc(net: Net, arcId: string, change: (arc: Arc) => Arc): Net {
  validateNet(net);
  const index = net.arcs.findIndex((arc) => arc.id === arcId);
  if (index < 0) throw new Error('Arc not found.');
  const next = structuredClone(net);
  next.arcs[index] = change(next.arcs[index]);
  validateNet(next);
  return next;
}

function bendIndex(arc: Arc, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= (arc.bends?.length ?? 0))
    throw new Error('Arc bend point not found.');
}

function finitePoint(point: Point) {
  if (![point.x, point.y].every(Number.isFinite))
    throw new Error('Arc bend coordinates must be finite.');
}

/**
 * ArcPath.insertPoint: split the segment whose vertex midpoint is nearest to `point` (ties go to
 * the earliest segment). Coordinates truncate to whole pixels like the native constructor; snap
 * to the grid before calling when the grid is enabled.
 */
export function insertArcBend(
  net: Net,
  arcId: string,
  point: Point,
  curved = false,
): { net: Net; index: number } {
  finitePoint(point);
  const { vertices } = arcGeometry(net, arcId);
  let segment = 0,
    shortest = Infinity;
  for (let i = 0; i < vertices.length - 1; i++) {
    const distance = Math.hypot(
      (vertices[i].x + vertices[i + 1].x) / 2 - point.x,
      (vertices[i].y + vertices[i + 1].y) / 2 - point.y,
    );
    if (distance < shortest) {
      shortest = distance;
      segment = i;
    }
  }
  const bend = { x: Math.trunc(point.x) || 0, y: Math.trunc(point.y) || 0, curved };
  return {
    net: editArc(net, arcId, (arc) => {
      const bends = [...(arc.bends ?? [])];
      bends.splice(segment, 0, bend);
      return withBends(arc, bends);
    }),
    index: segment,
  };
}

/** ArcPathPoint.splitPoint: a same-type point 10 px to the right, inserted after `index`. */
export function splitArcBend(net: Net, arcId: string, index: number): Net {
  return editArc(net, arcId, (arc) => {
    bendIndex(arc, index);
    const bends = [...arc.bends!];
    bends.splice(index + 1, 0, { ...bends[index], x: bends[index].x + SPLIT_DELTA });
    return withBends(arc, bends);
  });
}

/** ArcPath.setPointLocation rounds to whole pixels; snap before calling when the grid is on. */
export function moveArcBend(net: Net, arcId: string, index: number, point: Point): Net {
  finitePoint(point);
  return editArc(net, arcId, (arc) => {
    bendIndex(arc, index);
    const bends = [...arc.bends!];
    bends[index] = { ...bends[index], x: Math.round(point.x) || 0, y: Math.round(point.y) || 0 };
    return withBends(arc, bends);
  });
}

export function deleteArcBend(net: Net, arcId: string, index: number): Net {
  return editArc(net, arcId, (arc) => {
    bendIndex(arc, index);
    return withBends(
      arc,
      arc.bends!.filter((_, i) => i !== index),
    );
  });
}

/** ArcPathPoint.togglePointType for an interior point. */
export function toggleArcBendCurved(net: Net, arcId: string, index: number): Net {
  return editArc(net, arcId, (arc) => {
    bendIndex(arc, index);
    const bends = [...arc.bends!];
    bends[index] = { ...bends[index], curved: !bends[index].curved };
    return withBends(arc, bends);
  });
}

/** Native also offers Change to Curved/Straight on the target endpoint (never the source). */
export function toggleArcEndCurved(net: Net, arcId: string): Net {
  return editArc(net, arcId, (arc) => withBends(arc, arc.bends ?? [], !arc.curvedEnd));
}

/** LabelHandler translates unzoomed integer offsets without grid snapping. */
export function moveArcLabel(net: Net, arcId: string, delta: Point): Net {
  validateNet(net);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new Error('Invalid label delta.');
  if (!net.arcs.some((a) => a.id === arcId)) throw new Error('Arc not found.');
  const next = {
    ...net,
    arcs: net.arcs.map((arc) => {
      if (arc.id !== arcId) return arc;
      const { nameOffsetX = 0, nameOffsetY = 0, ...rest } = arc;
      const x = nameOffsetX + Math.trunc(delta.x),
        y = nameOffsetY + Math.trunc(delta.y);
      return { ...rest, ...(x ? { nameOffsetX: x } : {}), ...(y ? { nameOffsetY: y } : {}) };
    }),
  };
  validateNet(next);
  return next;
}

/** Existing web baseline at zero, plus the native relative offset in model units. */
export function arcLabelPosition(arc: Arc, midpoint: Point): Point {
  return { x: midpoint.x + (arc.nameOffsetX ?? 0), y: midpoint.y - 12 + (arc.nameOffsetY ?? 0) };
}
