import type { ComponentTiming } from './documents';
import { checkClipboardTiming, selectionTiming } from './timed-clipboard';
import { translateArcBends } from './arc-geometry';
import {
  COORDINATE_LIMIT,
  MAX_ARC_BENDS,
  type Annotation,
  type Arc,
  type Net,
  type NetNode,
  validateNet,
} from './net';
import { freshIds, nativeNodeName, snapToNativeGrid } from './quick-draw';
import { deleteSelection } from './selection';

/**
 * Cross-net cut/copy/paste for uncoloured untimed and timed selections. Pure and immutable: callers own the
 * system clipboard, permissions and history. See design/CLIPBOARD.md for the native contract
 * (net/tapaal/copypaste/CopyPastImportExport.kt, PetriNetTab.copy/cut/past) and its limits.
 */

/** A copied subnet: original node/arc IDs, web centre coordinates. Deeply frozen. */
export interface ClipboardContent {
  readonly nodes: readonly NetNode[];
  readonly arcs: readonly Arc[];
  readonly annotations?: readonly Annotation[];
  /** Present even for all-default timed selections: timed → untimed is never implicit. */
  readonly timing?: ComponentTiming;
}
/** What a copy produces: `nativeText` for text/plain, `webText` for the web custom format. */
export interface ClipboardPayload {
  readonly content: ClipboardContent;
  /** text/plain: native JSON for representable untimed selections, otherwise a web envelope. */
  readonly nativeText: string;
  /** Lossless versioned web envelope, including model timing when present. */
  readonly webText: string;
}
export type ClipboardErrorCode = 'empty' | 'not-tapaal' | 'malformed' | 'unsupported' | 'too-large';
export class ClipboardError extends Error {
  constructor(
    readonly code: ClipboardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClipboardError';
  }
}

/** Chromium async-clipboard custom format; other browsers only offer text/plain. */
export const WEB_CLIPBOARD_TYPE = 'web application/x-tapaal-clipboard+json';
export const WEB_CLIPBOARD_FORMAT = 'tapaal-web-clipboard';
export const WEB_CLIPBOARD_VERSION = 1;
/** Native past() adds Constants.PLACE_TRANSITION_HEIGHT to every node and path point. */
export const NATIVE_PASTE_OFFSET = 30;
export const MAX_CLIPBOARD_TEXT = 4_000_000;
export const MAX_CLIPBOARD_NODES = 5_000;
export const MAX_CLIPBOARD_ARCS = 20_000;
export const MAX_CLIPBOARD_BENDS = 100_000;
const HALF_NODE = 15;
// Native untimed lenses write TimeInvariant.LESS_THAN_INFINITY and TimeInterval.ZERO_INF.
const UNTIMED_INVARIANT = /^<\s*(inf|∞)$/i;
const UNTIMED_GUARD = /^\[\s*0\s*,\s*(inf|∞)\s*\)$/i;

function fail(code: ClipboardErrorCode, message: string): never {
  throw new ClipboardError(code, message);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate a fragment with the net rules: names, kinds, weights, bends, duplicate edges. */
function checkContent(content: ClipboardContent): void {
  fields(
    content as unknown as Json,
    'Clipboard content',
    ['nodes', 'arcs'],
    ['annotations', 'timing'],
  );
  if (!content.nodes.length && !content.annotations?.length)
    fail('empty', 'The clipboard contains no places, transitions or annotations.');
  if (content.nodes.length > MAX_CLIPBOARD_NODES || content.arcs.length > MAX_CLIPBOARD_ARCS)
    fail(
      'too-large',
      `Clipboard selections are limited to ${MAX_CLIPBOARD_NODES} nodes and ${MAX_CLIPBOARD_ARCS} arcs.`,
    );
  for (const note of content.annotations ?? [])
    fields(
      note as unknown as Json,
      'Clipboard annotation',
      ['id', 'text', 'x', 'y', 'width', 'height'],
      ['border', 'filled'],
    );
  for (const node of content.nodes) {
    fields(
      node as unknown as Record<string, unknown>,
      'Clipboard node',
      [],
      [
        'id',
        'kind',
        'name',
        'x',
        'y',
        'tokens',
        'nameOffsetX',
        'nameOffsetY',
        'angle',
        'nameVisible',
      ],
    );
  }
  for (const arc of content.arcs) {
    fields(
      arc as unknown as Record<string, unknown>,
      'Clipboard arc',
      [],
      [
        'id',
        'source',
        'target',
        'kind',
        'weight',
        'bends',
        'curvedEnd',
        'nameOffsetX',
        'nameOffsetY',
      ],
    );
  }
  for (const arc of content.arcs) {
    for (const bend of arc.bends ?? [])
      fields(bend as unknown as Json, 'Clipboard bend', [], ['x', 'y', 'curved']);
  }
  let bends = 0;
  for (const arc of content.arcs) bends += Array.isArray(arc.bends) ? arc.bends.length : 0;
  if (bends > MAX_CLIPBOARD_BENDS)
    fail('too-large', `Clipboard selections are limited to ${MAX_CLIPBOARD_BENDS} arc bends.`);
  try {
    validateNet({
      name: 'Clipboard',
      template: 'Clipboard',
      nodes: content.nodes as NetNode[],
      arcs: content.arcs as Arc[],
      annotations: content.annotations ? [...content.annotations] : undefined,
    });
    if (Object.hasOwn(content, 'timing'))
      checkClipboardTiming(
        {
          name: 'Clipboard',
          template: 'Clipboard',
          nodes: [...content.nodes],
          arcs: [...content.arcs],
        },
        content.timing,
      );
  } catch (error) {
    fail('malformed', `Invalid clipboard selection: ${(error as Error).message}`);
  }
}
function contentOf(
  nodes: NetNode[],
  arcs: Arc[],
  annotations: Annotation[] = [],
): ClipboardContent {
  const content = { nodes, arcs, ...(annotations.length ? { annotations } : {}) };
  checkContent(content);
  return freeze(structuredClone(content));
}

/**
 * Selected nodes plus every arc with both endpoints selected. Selected arcs with an unselected
 * endpoint are not copied: native copies them but its paste silently drops them.
 */
export function copySelection(
  net: Net,
  selectedIds: readonly string[],
  options: { selectedArcsOnly?: boolean; timing?: ComponentTiming } = {},
): ClipboardPayload {
  validateNet(net);
  const ids = new Set(selectedIds);
  const nodes = net.nodes.filter((node) => ids.has(node.id));
  const annotations = (net.annotations ?? []).filter((note) => ids.has(note.id));
  const copied = new Set(nodes.map((node) => node.id));
  const arcs = net.arcs.filter(
    (arc) =>
      copied.has(arc.source) &&
      copied.has(arc.target) &&
      (!options.selectedArcsOnly || ids.has(arc.id)),
  );
  const timing = options.timing
    ? selectionTiming(
        net,
        options.timing,
        nodes.map((n) => n.id),
        arcs.map((a) => a.id),
        selectedIds,
      )
    : undefined;
  if (!nodes.length && !annotations.length)
    fail('empty', 'Select at least one place, transition or annotation to copy.');
  const content = contentOf(nodes, arcs, annotations);
  return clipboardPayload(timing ? { ...content, timing } : content);
}

/**
 * The deleted net and its clipboard payload, computed together; nothing is committed. Copy the
 * payload (system or internal fallback) first, then commit `net` as one history entry. Deletion
 * matches native cut: selected nodes with all incident arcs, plus selected arcs.
 */
export function cutSelection(
  net: Net,
  selectedIds: readonly string[],
  options: { selectedArcsOnly?: boolean; timing?: ComponentTiming } = {},
): { net: Net; clipboard: ClipboardPayload } {
  const clipboard = copySelection(net, selectedIds, options);
  return { net: deleteSelection(net, selectedIds), clipboard };
}

export function clipboardPayload(content: ClipboardContent): ClipboardPayload {
  checkContent(content);
  const frozen = freeze(structuredClone(content));
  if (frozen.timing) {
    const webText = serializeWebClipboard(frozen, '');
    return freeze({ content: frozen, nativeText: webText, webText });
  }
  const nativeText =
    frozen.annotations?.length ||
    frozen.nodes.some((n) => n.nameVisible === false) ||
    frozen.arcs.some((a) => a.nameOffsetX || a.nameOffsetY)
      ? serializeWebClipboard(
          frozen,
          serializeNativeClipboard({ nodes: frozen.nodes, arcs: frozen.arcs }, true),
        )
      : serializeNativeClipboard(frozen);
  return freeze({
    content: frozen,
    nativeText,
    webText: serializeWebClipboard(frozen, nativeText),
  });
}

// ---------------------------------------------------------------------------------------------
// Native TAPAALCopyPastModel. kotlinx Json defaults: strict keys, defaults (empty path, curve
// false) omitted on encode, Int coordinates, top-left node positions, endpoints inside `path`.

interface NativePoint {
  x: number;
  y: number;
  curve?: true;
}

function nativePath(arc: Arc, from: NetNode, to: NetNode): { path?: NativePoint[] } {
  if (!arc.bends?.length && !arc.curvedEnd) return {};
  const point = (x: number, y: number, curve = false): NativePoint => ({
    x: Math.round(x),
    y: Math.round(y),
    ...(curve ? { curve: true as const } : {}),
  });
  // Native recomputes the endpoint anchors on paste (ArcPath.updateArc); centres suffice.
  return {
    path: [
      point(from.x, from.y),
      ...(arc.bends ?? []).map((bend) => point(bend.x, bend.y, bend.curved)),
      point(to.x, to.y, arc.curvedEnd === true),
    ],
  };
}

export function serializeNativeClipboard(
  content: ClipboardContent,
  envelopeProjection = false,
): string {
  if (content.timing)
    fail(
      'unsupported',
      'Timed clipboard transfer uses the versioned web envelope; desktop clipboard import/export is not supported.',
    );
  if (
    content.annotations?.length ||
    (!envelopeProjection &&
      (content.nodes.some((n) => n.nameVisible === false) ||
        content.arcs.some((a) => a.nameOffsetX || a.nameOffsetY)))
  )
    fail(
      'unsupported',
      'Desktop clipboard cannot carry annotations, hidden names or arc label offsets; use the web clipboard envelope.',
    );
  if (content.nodes.length || !envelopeProjection) checkContent(content);
  const nodes = new Map(content.nodes.map((node) => [node.id, node]));
  const corner = (node: NetNode) => ({
    x: Math.round(node.x - HALF_NODE),
    y: Math.round(node.y - HALF_NODE),
  });
  const model = {
    places: content.nodes
      .filter((node) => node.kind === 'place')
      .map((node) => ({
        name: node.name,
        ...corner(node),
        tokens: node.tokens,
        invariant: '< inf',
      })),
    transitions: content.nodes
      .filter((node) => node.kind === 'transition')
      .map((node) => ({
        name: node.name,
        ...corner(node),
        uncontrollable: false,
        urgent: false,
        rotation: node.angle ?? 0,
      })),
    inputArcs: [] as object[],
    outputArc: [] as object[],
    inhibitorArc: [] as object[],
    transportArcs: [] as object[],
  };
  for (const arc of content.arcs) {
    const from = nodes.get(arc.source)!,
      to = nodes.get(arc.target)!;
    const ends = { source: from.name, target: to.name };
    const rest = { weight: String(arc.weight), ...nativePath(arc, from, to) };
    if (arc.kind === 'inhibitor') model.inhibitorArc.push({ ...ends, ...rest });
    else if (from.kind === 'place') model.inputArcs.push({ ...ends, guard: '[0,inf)', ...rest });
    else model.outputArc.push({ ...ends, ...rest });
  }
  return JSON.stringify(model);
}

type Json = Record<string, unknown>;
const NATIVE_KEYS = [
  'places',
  'transitions',
  'inputArcs',
  'outputArc',
  'inhibitorArc',
  'transportArcs',
] as const;

function parseJson(text: unknown): unknown {
  if (typeof text === 'string' && text.length > MAX_CLIPBOARD_TEXT)
    fail('too-large', 'The clipboard contents are too large to paste.');
  if (typeof text !== 'string' || !text.trim())
    fail('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  try {
    return JSON.parse(text);
  } catch {
    fail('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  }
}
function record(value: unknown, label: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('malformed', `${label} must be an object.`);
  return value as Json;
}
function list(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value)) fail('malformed', `${label} must be a list.`);
  if (value.length > limit) fail('too-large', `${label} has more than ${limit} entries.`);
  return value;
}
/** Unknown fields are unsupported semantics (or a newer format), never silently dropped. */
function fields(value: Json, label: string, required: string[], optional: string[] = []): void {
  for (const key of Object.keys(value))
    if (!required.includes(key) && !optional.includes(key))
      fail('unsupported', `${label} has an unsupported field: ${key}.`);
  for (const key of required)
    if (!(key in value)) fail('malformed', `${label} is missing the field ${key}.`);
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string') fail('malformed', `${label} must be text.`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT)
    fail('malformed', `${label} must be a finite number within ±${COORDINATE_LIMIT}.`);
  return value;
}
function count(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    fail('malformed', `${label} must be an integer ≥ ${minimum}.`);
  return value as number;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail('malformed', `${label} must be true or false.`);
  return value;
}

function nativeWeight(value: unknown, label: string): number {
  const text = string(value, label).trim();
  if (/^\d+$/.test(text)) {
    const weight = Number(text);
    if (!Number.isSafeInteger(weight) || weight < 1)
      fail('malformed', `${label} must be a positive integer.`);
    return weight;
  }
  fail('unsupported', `${label} "${text.slice(0, 40)}" uses constants, which are not supported.`);
}
function nativeArcPath(value: unknown, label: string): Pick<Arc, 'bends' | 'curvedEnd'> {
  if (value === undefined) return {};
  const points = list(value, label, MAX_ARC_BENDS + 2).map((item, index) => {
    const point = record(item, `${label} point ${index + 1}`);
    fields(point, `${label} point ${index + 1}`, ['x', 'y'], ['curve']);
    return {
      x: Math.trunc(finite(point['x'], `${label} x`)),
      y: Math.trunc(finite(point['y'], `${label} y`)),
      curved: point['curve'] === undefined ? false : boolean(point['curve'], `${label} curve`),
    };
  });
  // Like TapnXmlLoader: first and last points are endpoint anchors, recomputed on paste.
  const bends = points.length > 2 ? points.slice(1, -1) : [];
  const curvedEnd = points.length > 1 && points[points.length - 1].curved;
  return { ...(bends.length ? { bends } : {}), ...(curvedEnd ? { curvedEnd: true } : {}) };
}

/**
 * Accept a native-authored (or web-written) TAPAALCopyPastModel. Timing, game and
 * transport content is rejected rather than flattened. Arcs naming an endpoint absent from the
 * payload are dropped like native past(); every other inconsistency rejects the whole payload.
 */
export function parseNativeClipboard(text: string): {
  content: ClipboardContent;
  droppedArcs: number;
} {
  const value = parseJson(text);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  const model = value as Json;
  if (model['format'] === WEB_CLIPBOARD_FORMAT)
    return { content: parseWebClipboard(text), droppedArcs: 0 };
  if (!NATIVE_KEYS.some((key) => key in model))
    fail('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  fields(model, 'Clipboard', [...NATIVE_KEYS]);
  const nodes: NetNode[] = [];
  for (const [index, item] of list(model['places'], 'Places', MAX_CLIPBOARD_NODES).entries()) {
    const place = record(item, `Place ${index + 1}`);
    fields(place, `Place ${index + 1}`, ['name', 'x', 'y', 'tokens', 'invariant']);
    const name = string(place['name'], 'Place name');
    if (!UNTIMED_INVARIANT.test(string(place['invariant'], 'Place invariant').trim()))
      fail(
        'unsupported',
        `Place ${name} has a time invariant; desktop timed clipboard import is not supported; use a timed TAPAAL Web copy.`,
      );
    nodes.push({
      id: name,
      kind: 'place',
      name,
      x: finite(place['x'], 'Place x') + HALF_NODE,
      y: finite(place['y'], 'Place y') + HALF_NODE,
      tokens: count(place['tokens'], 0, 'Place tokens'),
    });
  }
  const transitions = list(model['transitions'], 'Transitions', MAX_CLIPBOARD_NODES);
  for (const [index, item] of transitions.entries()) {
    const transition = record(item, `Transition ${index + 1}`);
    fields(transition, `Transition ${index + 1}`, [
      'name',
      'x',
      'y',
      'uncontrollable',
      'urgent',
      'rotation',
    ]);
    const name = string(transition['name'], 'Transition name');
    if (boolean(transition['urgent'], 'Transition urgent'))
      fail(
        'unsupported',
        `Transition ${name} is urgent; desktop timed clipboard import is not supported; use a timed TAPAAL Web copy.`,
      );
    if (boolean(transition['uncontrollable'], 'Transition uncontrollable'))
      fail('unsupported', `Transition ${name} is uncontrollable; games are not supported.`);
    const rotation = transition['rotation'];
    if (!Number.isSafeInteger(rotation))
      fail('malformed', 'Transition rotation must be a safe integer.');
    nodes.push({
      id: name,
      kind: 'transition',
      ...((rotation as number) % 360 ? { angle: (rotation as number) % 360 } : {}),
      name,
      x: finite(transition['x'], 'Transition x') + HALF_NODE,
      y: finite(transition['y'], 'Transition y') + HALF_NODE,
      tokens: 0,
    });
  }
  if (list(model['transportArcs'], 'Transport arcs', MAX_CLIPBOARD_ARCS).length)
    fail(
      'unsupported',
      'Desktop timed transport clipboard import is not supported; use a timed TAPAAL Web copy.',
    );
  const names = new Set(nodes.map((node) => node.name));
  const arcs: Arc[] = [];
  let droppedArcs = 0;
  const kinds = [
    ['inputArcs', 'Input arc', 'normal'],
    ['outputArc', 'Output arc', 'normal'],
    ['inhibitorArc', 'Inhibitor arc', 'inhibitor'],
  ] as const;
  for (const [key, label, kind] of kinds) {
    for (const [index, item] of list(model[key], label + 's', MAX_CLIPBOARD_ARCS).entries()) {
      const arc = record(item, `${label} ${index + 1}`);
      const guarded = key === 'inputArcs';
      fields(
        arc,
        `${label} ${index + 1}`,
        ['source', 'target', ...(guarded ? ['guard'] : []), 'weight'],
        ['path'],
      );
      const source = string(arc['source'], `${label} source`),
        target = string(arc['target'], `${label} target`);
      if (guarded && !UNTIMED_GUARD.test(string(arc['guard'], `${label} guard`).trim()))
        fail(
          'unsupported',
          `${label} ${source} → ${target} has a time guard; desktop timed clipboard import is not supported.`,
        );
      const weight = nativeWeight(arc['weight'], `${label} weight`);
      const path = nativeArcPath(arc['path'], `${label} path`);
      if (!names.has(source) || !names.has(target)) {
        droppedArcs++;
        continue;
      }
      const from = nodes.find((node) => node.name === source)!;
      if ((key === 'outputArc') !== (from.kind === 'transition'))
        fail('malformed', `${label} ${source} → ${target} connects the wrong node kinds.`);
      arcs.push({ id: `arc${arcs.length}`, source, target, kind, weight, ...path });
    }
  }
  return { content: contentOf(nodes, arcs), droppedArcs };
}

// ---------------------------------------------------------------------------------------------
// Web envelope: web-only fields, and `native` to detect a stale custom format.

export function serializeWebClipboard(
  content: ClipboardContent,
  nativeText = content.timing
    ? ''
    : serializeNativeClipboard({ nodes: content.nodes, arcs: content.arcs }, true),
): string {
  checkContent(content);
  const text = JSON.stringify({
    format: WEB_CLIPBOARD_FORMAT,
    version: content.timing ? 2 : WEB_CLIPBOARD_VERSION,
    ...(content.timing ? { modelType: 'timed', timing: content.timing } : {}),
    native: nativeText,
    nodes: content.nodes,
    arcs: content.arcs,
    ...(content.annotations?.length ? { annotations: content.annotations } : {}),
  });
  if (text.length > MAX_CLIPBOARD_TEXT)
    fail('too-large', 'The clipboard contents are too large to copy.');
  return text;
}

function webEnvelope(text: string): { native: string; content: ClipboardContent } {
  const envelope = record(parseJson(text), 'Clipboard');
  if (envelope['format'] !== WEB_CLIPBOARD_FORMAT)
    fail('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  const timed = envelope['version'] === 2;
  if (envelope['version'] !== WEB_CLIPBOARD_VERSION && !timed)
    fail('unsupported', 'The clipboard was written by an unsupported TAPAAL web version.');
  fields(
    envelope,
    'Clipboard',
    ['format', 'version', 'native', 'nodes', 'arcs', ...(timed ? ['modelType', 'timing'] : [])],
    ['annotations'],
  );
  if (timed && envelope['native'] !== '')
    fail('malformed', 'Timed web clipboard must not contain a native projection.');
  if (timed && envelope['modelType'] !== 'timed')
    fail('unsupported', 'Unsupported clipboard model type.');
  const nodes = list(envelope['nodes'], 'Nodes', MAX_CLIPBOARD_NODES).map((item, index) => {
    const node = record(item, `Node ${index + 1}`);
    fields(
      node,
      `Node ${index + 1}`,
      ['id', 'kind', 'name', 'x', 'y', 'tokens'],
      ['nameOffsetX', 'nameOffsetY', 'angle', 'nameVisible'],
    );
    if (node['kind'] !== 'place' && node['kind'] !== 'transition')
      fail('unsupported', `Node ${index + 1} has an unsupported kind.`);
    return {
      id: string(node['id'], 'Node id'),
      kind: node['kind'],
      name: string(node['name'], 'Node name'),
      x: finite(node['x'], 'Node x'),
      y: finite(node['y'], 'Node y'),
      tokens: count(node['tokens'], 0, 'Node tokens'),
      ...(node['angle'] !== undefined ? { angle: finite(node['angle'], 'Transition angle') } : {}),
      ...(node['nameVisible'] !== undefined
        ? { nameVisible: boolean(node['nameVisible'], 'Name visibility') }
        : {}),
      ...(node['nameOffsetX'] !== undefined
        ? { nameOffsetX: finite(node['nameOffsetX'], 'Label offset') }
        : {}),
      ...(node['nameOffsetY'] !== undefined
        ? { nameOffsetY: finite(node['nameOffsetY'], 'Label offset') }
        : {}),
    } satisfies NetNode;
  });
  const ids = new Set(nodes.map((node) => node.id));
  const arcs = list(envelope['arcs'], 'Arcs', MAX_CLIPBOARD_ARCS).map((item, index) => {
    const arc = record(item, `Arc ${index + 1}`);
    fields(
      arc,
      `Arc ${index + 1}`,
      ['id', 'source', 'target', 'kind', 'weight'],
      ['bends', 'curvedEnd', 'nameOffsetX', 'nameOffsetY'],
    );
    if (arc['kind'] !== 'normal' && arc['kind'] !== 'inhibitor')
      fail('unsupported', `Arc ${index + 1} has an unsupported kind.`);
    const source = string(arc['source'], 'Arc source'),
      target = string(arc['target'], 'Arc target');
    if (!ids.has(source) || !ids.has(target))
      fail('malformed', `Arc ${index + 1} refers to a node that is not in the clipboard.`);
    const bends = arc['bends'] === undefined ? [] : list(arc['bends'], 'Arc bends', MAX_ARC_BENDS);
    const curvedEnd =
      arc['curvedEnd'] === undefined ? false : boolean(arc['curvedEnd'], 'Arc end curvature');
    return {
      id: string(arc['id'], 'Arc id'),
      source,
      target,
      kind: arc['kind'],
      weight: count(arc['weight'], 1, 'Arc weight'),
      ...(bends.length
        ? {
            bends: bends.map((item) => {
              const bend = record(item, 'Arc bend');
              fields(bend, 'Arc bend', ['x', 'y', 'curved']);
              return {
                x: finite(bend['x'], 'Bend x'),
                y: finite(bend['y'], 'Bend y'),
                curved: boolean(bend['curved'], 'Bend curvature'),
              };
            }),
          }
        : {}),
      ...(['nameOffsetX', 'nameOffsetY'] as const).reduce(
        (offsets, key) =>
          arc[key] === undefined
            ? offsets
            : { ...offsets, [key]: finite(arc[key], 'Arc label offset') },
        {},
      ),
      ...(curvedEnd ? { curvedEnd: true } : {}),
    } satisfies Arc;
  });
  const annotations =
    envelope['annotations'] === undefined
      ? []
      : list(envelope['annotations'], 'Annotations', 10000).map((item) => {
          const note = record(item, 'Annotation');
          fields(
            note,
            'Annotation',
            ['id', 'text', 'x', 'y', 'width', 'height'],
            ['border', 'filled'],
          );
          return {
            id: string(note['id'], 'Annotation id'),
            text: string(note['text'], 'Annotation text'),
            x: finite(note['x'], 'Annotation x'),
            y: finite(note['y'], 'Annotation y'),
            width: finite(note['width'], 'Annotation width'),
            height: finite(note['height'], 'Annotation height'),
            ...(note['border'] === undefined
              ? {}
              : { border: boolean(note['border'], 'Annotation border') }),
            ...(note['filled'] === undefined
              ? {}
              : { filled: boolean(note['filled'], 'Annotation fill') }),
          };
        });
  return {
    native: string(envelope['native'], 'Native clipboard text'),
    content: timed
      ? clipboardPayload({
          ...contentOf(nodes, arcs, annotations),
          timing: envelope['timing'] as ComponentTiming,
        }).content
      : contentOf(nodes, arcs, annotations),
  };
}

export function parseWebClipboard(text: string): ClipboardContent {
  return webEnvelope(text).content;
}

export interface ClipboardSources {
  /** WEB_CLIPBOARD_TYPE contents, when the browser exposes them. */
  webText?: string | null;
  /** text/plain contents; null/undefined when unavailable or permission was denied. */
  text?: string | null;
  /** The app's own last copy/cut, kept whether or not the system write succeeded. */
  internal?: ClipboardPayload | null;
}
export interface ResolvedClipboard {
  content: ClipboardContent;
  source: 'web' | 'internal' | 'native';
  /** Native-authored arcs whose endpoints were not copied (native drops them silently). */
  droppedArcs: number;
}

/**
 * Pick the freshest faithful source: the web format if it matches text/plain, the internal copy if
 * text/plain is still what we wrote (or unreadable), otherwise the native text/plain payload.
 */
export function readClipboard(sources: ClipboardSources): ResolvedClipboard {
  const { webText, text, internal } = sources;
  if (webText != null) {
    const envelope = webEnvelope(webText);
    if (text == null || text === envelope.native || text === webText)
      return { content: envelope.content, source: 'web', droppedArcs: 0 };
  }
  if (internal && (text == null || text === internal.nativeText))
    return { content: internal.content, source: 'internal', droppedArcs: 0 };
  if (text == null) fail('empty', 'Nothing has been copied.');
  return { ...parseNativeClipboard(text), source: 'native' };
}

// ---------------------------------------------------------------------------------------------
// Paste

export interface PasteOptions {
  /** Added to every node and bend. Default: native +30, +30 (the same spot on every paste). */
  offset?: { x: number; y: number };
  /** Place the fragment's top-left (node corners and bends) here instead of using `offset`. */
  at?: { x: number; y: number };
  /** Snap the first pasted node's top-left to this grid; null (default) keeps native no-snap. */
  grid?: number | null;
  /** New element IDs are `${idPrefix}<n>`, above existing ones. */
  idPrefix?: string;
  /** Document-owned allocator (stateful NameGenerator); defaults to stateless nativeNodeName. */
  nodeName?: (net: Net, kind: NetNode['kind']) => string;
  /** Caller must commit remapped timing atomically through commitTimedComponent. */
  timedTarget?: boolean;
  /** Optional persistent element-ID allocator, shared with other app graph edits. */
  elementId?: () => string;
}
export interface PasteResult {
  net: Net;
  /** Every pasted node and arc, as native selects the pasted elements. */
  selectedIds: string[];
  /** Clipboard node/arc ID → new ID. */
  idMap: Record<string, string>;
}

/** Native past(): every node is renamed by the name generator; places are named first. */
export function pasteClipboard(
  net: Net,
  content: ClipboardContent,
  options: PasteOptions = {},
): PasteResult {
  validateNet(net);
  checkContent(content);
  if (content.timing && !options.timedTarget)
    fail(
      'unsupported',
      'Cannot paste a timed selection into an untimed model. Open or create a timed model first.',
    );
  const { grid = null, idPrefix = 'web-', nodeName = nativeNodeName } = options;
  if (grid !== null && !(Number.isFinite(grid) && grid > 0))
    throw new Error('Grid spacing must be a positive number or null.');
  const corners = [
    ...content.nodes.map((node) => ({ x: node.x - HALF_NODE, y: node.y - HALF_NODE })),
    ...content.arcs.flatMap((arc) => arc.bends ?? []),
    ...(content.annotations ?? []),
  ];
  const left = Math.min(...corners.map((point) => point.x)),
    top = Math.min(...corners.map((point) => point.y));
  let { x: dx, y: dy } = options.at
    ? { x: options.at.x - left, y: options.at.y - top }
    : (options.offset ?? { x: NATIVE_PASTE_OFFSET, y: NATIVE_PASTE_OFFSET });
  if (![dx, dy].every(Number.isFinite)) throw new Error('Paste position must be finite.');
  const anchor = content.nodes[0] ?? content.annotations![0];
  if (grid !== null) {
    const snapped = snapToNativeGrid({ x: anchor.x + dx, y: anchor.y + dy }, grid);
    dx = snapped.x - anchor.x;
    dy = snapped.y - anchor.y;
  }
  // Keep the canvas origin: shift right/down (by whole grid steps when snapping) instead.
  const step = (deficit: number) => (grid === null ? deficit : Math.ceil(deficit / grid) * grid);
  if (left + dx < 0) dx += step(-(left + dx));
  if (top + dy < 0) dy += step(-(top + dy));

  const ordered = [
    ...content.nodes.filter((node) => node.kind === 'place'),
    ...content.nodes.filter((node) => node.kind === 'transition'),
  ];
  const count = ordered.length + content.arcs.length + (content.annotations?.length ?? 0);
  const reserved = new Set((net.annotations ?? []).map((note) => note.id));
  const fresh = options.elementId
    ? Array.from({ length: count }, options.elementId)
    : freshIds(net, count + reserved.size, idPrefix)
        .filter((id) => !reserved.has(id))
        .slice(0, count);
  const idMap: Record<string, string> = Object.create(null);
  const next: Net = structuredClone(net);
  for (const node of ordered) {
    const id = fresh[Object.keys(idMap).length];
    idMap[node.id] = id;
    next.nodes.push({
      ...structuredClone(node),
      id,
      name: nodeName(next, node.kind),
      x: node.x + dx,
      y: node.y + dy,
    });
  }
  for (const arc of content.arcs) {
    const id = fresh[Object.keys(idMap).length];
    idMap[arc.id] = id;
    next.arcs.push({
      ...translateArcBends(arc, dx, dy),
      id,
      source: idMap[arc.source],
      target: idMap[arc.target],
    });
  }
  for (const note of content.annotations ?? []) {
    const id = fresh[Object.keys(idMap).length];
    idMap[note.id] = id;
    next.annotations = [
      ...(next.annotations ?? []),
      { ...structuredClone(note), id, x: note.x + dx, y: note.y + dy },
    ];
  }
  validateNet(next);
  return { net: next, selectedIds: Object.values(idMap), idMap };
}
