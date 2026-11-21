import { translateArcBends } from './arc-geometry';
import { annotationBox, freshAnnotationIds } from './element-layout';
import { validateNet, type Net } from './net';

export interface SelectionRectangle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Node centres on the boundary count; internal arcs join the selection. Native marquees never
 * select annotations (SelectionManager.processSelection visits places and transitions only);
 * `annotations: true` adds notes whose drawn box intersects the rectangle, after the arcs.
 */
export function selectInRectangle(
  net: Net,
  rectangle: SelectionRectangle,
  options: { annotations?: boolean } = {},
): string[] {
  const { x1, y1, x2, y2 } = rectangle;
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new Error('Selection coordinates must be finite.');
  }
  const nodes = net.nodes.filter(
    (node) =>
      node.x >= Math.min(x1, x2) &&
      node.x <= Math.max(x1, x2) &&
      node.y >= Math.min(y1, y2) &&
      node.y <= Math.max(y1, y2),
  );
  const ids = new Set(nodes.map((node) => node.id));
  const notes = options.annotations
    ? (net.annotations ?? []).filter((note) => {
        const box = annotationBox(note);
        return (
          box.x <= Math.max(x1, x2) &&
          box.x + box.width >= Math.min(x1, x2) &&
          box.y <= Math.max(y1, y2) &&
          box.y + box.height >= Math.min(y1, y2)
        );
      })
    : [];
  return [
    ...ids,
    ...net.arcs.filter((arc) => ids.has(arc.source) && ids.has(arc.target)).map((arc) => arc.id),
    ...notes.map((note) => note.id),
  ];
}

/** Delete nodes and their incident arcs together, or individual selected arcs and annotations. */
export function deleteSelection(net: Net, selectedIds: readonly string[]): Net {
  const ids = new Set(selectedIds);
  const next = structuredClone(net);
  next.nodes = next.nodes.filter((node) => !ids.has(node.id));
  next.arcs = next.arcs.filter(
    (arc) => !ids.has(arc.id) && !ids.has(arc.source) && !ids.has(arc.target),
  );
  if (next.annotations) {
    next.annotations = next.annotations.filter((note) => !ids.has(note.id));
    if (!next.annotations.length) delete next.annotations;
  }
  validateNet(next);
  return next;
}

function freshCopyName(original: string, used: Set<string>): string {
  let candidate = `${original}_copy`;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${original}_copy${suffix++}`;
  used.add(candidate);
  return candidate;
}

/**
 * Duplicate the selected subgraph and annotations; external connections remain on the originals.
 * Copied annotations take fresh `annotation-N` IDs and keep their text and style.
 */
export function duplicateSelection(
  net: Net,
  selectedIds: readonly string[],
  offset: { x: number; y: number } = { x: 40, y: 40 },
): { net: Net; selectedIds: string[] } {
  validateNet(net);
  if (![offset.x, offset.y].every(Number.isFinite)) {
    throw new Error('Duplicate offset must be finite.');
  }
  const selected = new Set(selectedIds);
  const next = structuredClone(net);
  const ids = new Set([...net.nodes, ...net.arcs].map((element) => element.id));
  const names = new Set(net.nodes.map((node) => node.name));
  const copiedIds = new Map<string, string>();
  const selection: string[] = [];
  for (const node of net.nodes.filter((node) => selected.has(node.id))) {
    const id = freshCopyName(node.id, ids);
    copiedIds.set(node.id, id);
    selection.push(id);
    next.nodes.push({
      ...node,
      id,
      name: freshCopyName(node.name, names),
      x: node.x + offset.x,
      y: node.y + offset.y,
    });
  }
  for (const arc of net.arcs) {
    const source = copiedIds.get(arc.source);
    const target = copiedIds.get(arc.target);
    if (!source || !target) continue;
    const id = freshCopyName(arc.id, ids);
    next.arcs.push({ ...translateArcBends(arc, offset.x, offset.y), id, source, target });
    selection.push(id);
  }
  const notes = (net.annotations ?? []).filter((note) => selected.has(note.id));
  const noteIds = freshAnnotationIds(next, notes.length);
  notes.forEach((note, i) => {
    next.annotations!.push({ ...note, id: noteIds[i], x: note.x + offset.x, y: note.y + offset.y });
    selection.push(noteIds[i]);
  });
  validateNet(next);
  return { net: next, selectedIds: selection };
}

/**
 * Move selected nodes, annotations and the bends of selected arcs (native selects an arc's path
 * points with it and leaves unselected arcs' bends in place). Like
 * SelectionManager.translateSelection, the delta is reduced so no moved node's top-left, note's
 * top-left or bend crosses 0; snap the delta before calling. Label offsets are node-relative.
 */
export function moveSelection(
  net: Net,
  selectedIds: readonly string[],
  delta: { x: number; y: number },
): Net {
  validateNet(net);
  if (![delta.x, delta.y].every(Number.isFinite)) throw new Error('Move offset must be finite.');
  const ids = new Set(selectedIds);
  const nodes = net.nodes.filter((node) => ids.has(node.id));
  const bends = net.arcs.filter((arc) => ids.has(arc.id)).flatMap((arc) => arc.bends ?? []);
  const notes = (net.annotations ?? []).filter((note) => ids.has(note.id));
  const lowest = (values: number[]) => (values.length ? Math.min(...values) : Infinity);
  const minX = lowest([
      ...nodes.map((node) => node.x - 15),
      ...bends.map((bend) => bend.x),
      ...notes.map((note) => note.x),
    ]),
    minY = lowest([
      ...nodes.map((node) => node.y - 15),
      ...bends.map((bend) => bend.y),
      ...notes.map((note) => note.y),
    ]);
  const dx = minX + delta.x < 0 ? Math.max(delta.x, -minX) : delta.x,
    dy = minY + delta.y < 0 ? Math.max(delta.y, -minY) : delta.y;
  const next: Net = {
    ...net,
    nodes: net.nodes.map((node) =>
      ids.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : { ...node },
    ),
    arcs: net.arcs.map((arc) =>
      ids.has(arc.id) ? translateArcBends(arc, dx, dy) : structuredClone(arc),
    ),
    ...(net.annotations
      ? {
          annotations: net.annotations.map((note) =>
            ids.has(note.id) ? { ...note, x: note.x + dx, y: note.y + dy } : { ...note },
          ),
        }
      : {}),
  };
  validateNet(next);
  return next;
}
