import { validateNet, type Arc, type Net, type NetNode, type Tool } from './net';

/**
 * Native Quick Draw: Ctrl-modified presses in the arc tools (PetriNetTab
 * AbstractCanvasArcDrawController and its subclasses). See web/design/QUICK-DRAW.md.
 * Smart Draw (automatic layout) is unrelated and not modelled here.
 */
export type QuickDrawTool = 'arc' | 'inhibitor';
export interface Point {
  x: number;
  y: number;
}
/** A primary-button press: on an existing place/transition, or on empty canvas (model coordinates). */
export type QuickDrawPress =
  | { target: 'node'; nodeId: string; ctrlKey: boolean }
  | { target: 'canvas'; point: Point; ctrlKey: boolean };
export type QuickDrawPlan =
  /** Begin a pending arc at an existing node; nothing is committed. */
  | { action: 'start'; sourceId: string }
  /** Ctrl+press on empty canvas without a pending arc: new place, pending arc from it. */
  | { action: 'create-and-start'; kind: 'place'; point: Point }
  | { action: 'connect'; sourceId: string; targetId: string; arcKind: Arc['kind']; chain: boolean }
  /** Ctrl+press on empty canvas with a pending arc: new opposite-kind node, then connect to it. */
  | {
      action: 'create-and-connect';
      sourceId: string;
      kind: NetNode['kind'];
      point: Point;
      arcKind: Arc['kind'];
      chain: boolean;
    }
  | { action: 'ignore'; reason: QuickDrawIgnoreReason };
export type QuickDrawIgnoreReason =
  | 'not-an-arc-tool'
  | 'unknown-node'
  | 'inhibitor-must-start-at-place'
  | 'same-kind-or-source'
  | 'plain-canvas-press'
  | 'bend-points-unsupported';
export interface QuickDrawResult {
  plan: QuickDrawPlan;
  /** The input reference when nothing changed; commit only when `changed` is true. */
  net: Net;
  changed: boolean;
  /** Pending arc source after this press; null means no pending arc. */
  sourceId: string | null;
  createdNodeIds: string[];
  createdArcIds: string[];
  /** Set when the arc was rejected; `net` is then the unchanged input. */
  error?: string;
}
export interface QuickDrawOptions {
  /** Native default 15 (PLACE_TRANSITION_HEIGHT / 2); 30 and 7.5 are the other native levels; null disables snapping. */
  gridSpacing?: number | null;
  idPrefix?: string;
  /** Optional document-owned name allocator; default remains stateless for standalone callers. */
  nodeName?: (net: Net, kind: NetNode['kind']) => string;
}

export const NATIVE_GRID_SPACING = 15;
/** Native nodes are 30×30; grid alignment applies to their top-left corner. */
const HALF_NODE = 15;

/** Native `MouseEvent.isControlDown()`: Ctrl only; Meta/Cmd is not a Quick Draw modifier. */
export function isQuickDrawModifier(event: { ctrlKey: boolean }): boolean {
  return event.ctrlKey;
}

/** Native Arc.enableDrawingKeyBindings: these keys only cancel a pending arc, never undo/redo. */
export function isQuickDrawCancelKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  const key = event.key.toLowerCase();
  return (
    key === 'escape' ||
    key === 'delete' ||
    ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y'))
  );
}

/** Java Math.round: halves round towards positive infinity. */
function javaRound(value: number) {
  return Math.floor(value + 0.5);
}

/** DrawingSurfaceImpl.adjustPointToGridAndZoom at 100% zoom, expressed for web centre coordinates. */
export function snapToNativeGrid(
  point: Point,
  spacing: number | null = NATIVE_GRID_SPACING,
): Point {
  if (![point.x, point.y].every(Number.isFinite)) throw new Error('Points must be finite.');
  if (spacing !== null && !(Number.isFinite(spacing) && spacing > 0)) {
    throw new Error('Grid spacing must be a positive number or null.');
  }
  const align = (centre: number) => {
    const corner = javaRound(centre) - HALF_NODE;
    return (
      (spacing === null ? corner : javaRound(javaRound(corner / spacing) * spacing)) + HALF_NODE
    );
  };
  return { x: align(point.x), y: align(point.y) };
}

/**
 * NameGenerator: one more than the largest P<n>/T<n> (case-insensitive) among nodes of that
 * kind, starting at P0/T0. Skips names taken by the other kind, since web names are global.
 */
export function nativeNodeName(net: Net, kind: NetNode['kind']): string {
  const prefix = kind === 'place' ? 'P' : 'T';
  const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let next = 0n;
  for (const node of net.nodes) {
    const match = node.kind === kind ? pattern.exec(node.name) : null;
    if (match && BigInt(match[1]) >= next) next = BigInt(match[1]) + 1n;
  }
  const names = new Set(net.nodes.map((node) => node.name));
  while (names.has(`${prefix}${next}`)) next++;
  return `${prefix}${next}`;
}

/** `count` fresh ids `${prefix}<n>`, above every existing id with that prefix. */
export function freshIds(net: Net, count: number, prefix = 'web-'): string[] {
  const taken = new Set([...net.nodes, ...net.arcs].map((element) => element.id));
  let next = 0;
  for (const id of taken) {
    const suffix = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    if (Number.isSafeInteger(suffix) && suffix >= next) next = suffix + 1;
  }
  const ids: string[] = [];
  while (ids.length < count) {
    const id = `${prefix}${next++}`;
    if (!taken.has(id)) ids.push(id);
  }
  return ids;
}

function opposite(kind: NetNode['kind']): NetNode['kind'] {
  return kind === 'place' ? 'transition' : 'place';
}

/** Resolve one press into a native intention, without touching the net. */
export function planQuickDraw(
  net: Net,
  tool: Tool,
  sourceId: string | null,
  press: QuickDrawPress,
): QuickDrawPlan {
  if (tool !== 'arc' && tool !== 'inhibitor')
    return { action: 'ignore', reason: 'not-an-arc-tool' };
  // A pending source deleted meanwhile (undo, file load) behaves as no pending arc.
  const source = net.nodes.find((node) => node.id === sourceId);
  const arcKind: Arc['kind'] = tool === 'inhibitor' ? 'inhibitor' : 'normal';
  // Only the arc tool continues from the target; the inhibitor controller ignores Ctrl there.
  const chain = tool === 'arc' && press.ctrlKey;
  if (press.target === 'node') {
    const node = net.nodes.find((candidate) => candidate.id === press.nodeId);
    if (!node) return { action: 'ignore', reason: 'unknown-node' };
    if (!source) {
      if (tool === 'inhibitor' && node.kind !== 'place') {
        return { action: 'ignore', reason: 'inhibitor-must-start-at-place' };
      }
      return { action: 'start', sourceId: node.id };
    }
    if (node.kind === source.kind) return { action: 'ignore', reason: 'same-kind-or-source' };
    return { action: 'connect', sourceId: source.id, targetId: node.id, arcKind, chain };
  }
  if (!source) {
    if (!press.ctrlKey) return { action: 'ignore', reason: 'plain-canvas-press' };
    return { action: 'create-and-start', kind: 'place', point: press.point };
  }
  // Native adds an arc bend point here; the web schema stores straight arcs only.
  if (!press.ctrlKey) return { action: 'ignore', reason: 'bend-points-unsupported' };
  const kind = opposite(source.kind);
  return {
    action: 'create-and-connect',
    sourceId: source.id,
    kind,
    point: press.point,
    arcKind,
    chain,
  };
}

/** Apply a plan as one atomic, validated edit; the input net is never mutated. */
export function applyQuickDraw(
  net: Net,
  plan: QuickDrawPlan,
  options: QuickDrawOptions = {},
): QuickDrawResult {
  validateNet(net);
  const unchanged = (sourceId: string | null, error?: string): QuickDrawResult => ({
    plan,
    net,
    changed: false,
    sourceId,
    createdNodeIds: [],
    createdArcIds: [],
    ...(error === undefined ? {} : { error }),
  });
  switch (plan.action) {
    case 'ignore':
      throw new Error('An ignored press has no effect; keep the current pending source.');
    case 'start':
      if (!net.nodes.some((node) => node.id === plan.sourceId)) throw new Error('Unknown node.');
      return unchanged(plan.sourceId);
    case 'connect': {
      const [arcId] = freshIds(net, 1, options.idPrefix);
      const arc: Arc = {
        id: arcId,
        source: plan.sourceId,
        target: plan.targetId,
        kind: plan.arcKind,
        weight: 1,
      };
      const next = { ...net, arcs: [...net.arcs, arc] };
      try {
        validateNet(next);
      } catch (error) {
        // Native shows the error, clears the pending arc and still continues on Ctrl.
        return unchanged(plan.chain ? plan.targetId : null, (error as Error).message);
      }
      return {
        plan,
        net: structuredClone(next),
        changed: true,
        sourceId: plan.chain ? plan.targetId : null,
        createdNodeIds: [],
        createdArcIds: [arcId],
      };
    }
    case 'create-and-start':
    case 'create-and-connect': {
      const connect = plan.action === 'create-and-connect';
      const [nodeId, arcId] = freshIds(net, connect ? 2 : 1, options.idPrefix);
      const point = snapToNativeGrid(
        plan.point,
        options.gridSpacing === undefined ? NATIVE_GRID_SPACING : options.gridSpacing,
      );
      const node: NetNode = {
        id: nodeId,
        kind: plan.kind,
        name: (options.nodeName ?? nativeNodeName)(net, plan.kind),
        ...point,
        tokens: 0,
      };
      const arcs = connect
        ? [
            ...net.arcs,
            { id: arcId, source: plan.sourceId, target: nodeId, kind: plan.arcKind, weight: 1 },
          ]
        : net.arcs;
      const next: Net = structuredClone({ ...net, nodes: [...net.nodes, node], arcs });
      validateNet(next);
      return {
        plan,
        net: next,
        changed: true,
        sourceId: !connect || plan.chain ? nodeId : null,
        createdNodeIds: [nodeId],
        createdArcIds: connect ? [arcId] : [],
      };
    }
  }
}

/**
 * One press end to end. Ignored presses return the input net and keep `sourceId`
 * (normalised to null when that node no longer exists).
 */
export function quickDrawPress(
  net: Net,
  tool: Tool,
  sourceId: string | null,
  press: QuickDrawPress,
  options: QuickDrawOptions = {},
): QuickDrawResult {
  const plan = planQuickDraw(net, tool, sourceId, press);
  if (plan.action !== 'ignore') return applyQuickDraw(net, plan, options);
  validateNet(net);
  const pending = net.nodes.some((node) => node.id === sourceId) ? sourceId : null;
  return { plan, net, changed: false, sourceId: pending, createdNodeIds: [], createdArcIds: [] };
}
