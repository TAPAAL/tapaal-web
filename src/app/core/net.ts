/** Single-template, uncoloured P/T nets. Coordinates are SVG centres. */
export type Tool =
  | 'select'
  | 'pan'
  | 'place'
  | 'transition'
  | 'arc'
  | 'inhibitor'
  | 'annotation'
  | 'add-token'
  | 'remove-token';
export interface NetNode {
  id: string;
  kind: 'place' | 'transition';
  name: string;
  x: number;
  y: number;
  tokens: number;
  /** Native label offsets, relative to the node's top-left. */
  nameOffsetX?: number;
  nameOffsetY?: number;
  /** Native `displayName`; omitted means shown. Only `false` is ever written by helpers. */
  nameVisible?: boolean;
  /** Transitions only: native `angle` in whole degrees, |angle| < 360; omitted means 0. */
  angle?: number;
}
/**
 * A native interior arc-path point (TAPN `arcpath` between the endpoints), in the same absolute
 * model coordinates as node centres. `curved` is native `arcPointType`: the segment ending at this
 * point is part of a curve. See design/ARC-PATHS.md.
 */
export interface ArcBend {
  x: number;
  y: number;
  curved: boolean;
}
export interface Arc {
  /** Native unzoomed offsets relative to the path midpoint; absent means zero. */
  nameOffsetX?: number;
  nameOffsetY?: number;
  id: string;
  source: string;
  target: string;
  kind: 'normal' | 'inhibitor';
  weight: number;
  /** Interior points only; endpoint anchors stay automatic. Absent or empty means straight. */
  bends?: ArcBend[];
  /** Native `arcPointType` of the target endpoint: the final segment is curved. */
  curvedEnd?: boolean;
}
/**
 * A native text annotation (TAPN `<labels>`), never a Petri-net element: no semantics, no query
 * symbol. Fields mirror the native attributes as written; see design/ELEMENT-LAYOUT.md.
 */
export interface Annotation {
  /** Web-only; native `<labels>` has no ID, so TAPN load numbers them in document order. */
  id: string;
  text: string;
  /** Native positionX/positionY: top-left of the annotation component. */
  x: number;
  y: number;
  /** Native width/height: the inner text area; the drawn box adds a reserved border. */
  width: number;
  height: number;
  /** Native `border`; omitted means drawn. */
  border?: boolean;
  /** Native solid/transparent background; omitted means solid. Desktop never saves it. */
  filled?: boolean;
}
export interface Net {
  name: string;
  template: string;
  nodes: NetNode[];
  arcs: Arc[];
  /** Omitted when empty so annotation-free nets keep their original shape. */
  annotations?: Annotation[];
}
export type Marking = Record<string, number>;
export const COORDINATE_LIMIT = 1e6;
export const MAX_ARC_BENDS = 1000;
export const MAX_ANNOTATIONS = 10000;
export const MAX_ANNOTATION_TEXT = 100000;
/** XML 1.0 characters without carriage return: XML parsers rewrite CR, so it cannot round-trip. */
const ANNOTATION_TEXT = /^[\t\n\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]*$/u;

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function integer(value: unknown, minimum: number, label: string): asserts value is number {
  require(Number.isSafeInteger(value) &&
    Number(value) >= minimum, `${label} must be a safe integer ≥ ${minimum}.`);
}
export function validateName(name: unknown, label = 'Name'): asserts name is string {
  require(typeof name === 'string' &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) &&
    !/^(true|false)$/i.test(
      name,
    ), `${label} must start with a letter or underscore and contain only letters, digits or underscores; true and false are reserved.`);
}
/** Validate at every editing/file seam; invalid documents never replace working state. */
export function validateNet(value: unknown): asserts value is Net {
  require(!!value && typeof value === 'object', 'Invalid net document.');
  const net = value as Net;
  require(typeof net.name === 'string' &&
    net.name.trim().length > 0 &&
    net.name.length <= 200, 'Model name is required (maximum 200 characters).');
  validateName(net.template, 'Template name');
  require(Array.isArray(net.nodes) && Array.isArray(net.arcs), 'Nodes and arcs must be arrays.');
  const ids = new Set<string>(),
    names = new Set<string>();
  for (const node of net.nodes) {
    require(!!node && typeof node === 'object', 'Invalid node.');
    require(typeof node.id === 'string' &&
      node.id.length > 0 &&
      !ids.has(node.id), 'Element IDs must be nonempty and unique.');
    ids.add(node.id);
    require(node.kind === 'place' || node.kind === 'transition', 'Unsupported node type.');
    validateName(node.name);
    require(!names.has(node.name), `The name ${node.name} is already used.`);
    names.add(node.name);
    require(Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      Math.abs(node.x) <= 1e6 &&
      Math.abs(node.y) <= 1e6, 'Coordinates must be finite and within ±1,000,000.');
    for (const offset of [node.nameOffsetX, node.nameOffsetY]) {
      require(offset === undefined ||
        (Number.isFinite(offset) &&
          Math.abs(offset) <= 1e6), 'Label offsets must be finite and within ±1,000,000.');
    }
    integer(node.tokens, 0, 'Token count');
    require(node.kind === 'place' || node.tokens === 0, 'Transitions cannot contain tokens.');
    require(node.nameVisible === undefined ||
      typeof node.nameVisible === 'boolean', 'Name visibility must be true or false.');
    require(node.angle === undefined ||
      (node.kind === 'transition' &&
        Number.isSafeInteger(node.angle) &&
        Math.abs(node.angle) <
          360), 'Only transitions rotate, by whole degrees between -359 and 359.');
  }
  const edges = new Set<string>();
  for (const arc of net.arcs) {
    require(!!arc && typeof arc === 'object', 'Invalid arc.');
    require(typeof arc.id === 'string' &&
      arc.id.length > 0 &&
      !ids.has(arc.id), 'Element IDs must be nonempty and unique.');
    ids.add(arc.id);
    require(arc.kind === 'normal' ||
      arc.kind === 'inhibitor', 'Only normal and inhibitor arcs are supported.');
    integer(arc.weight, 1, 'Arc weight');
    for (const offset of [arc.nameOffsetX, arc.nameOffsetY]) {
      require(offset === undefined ||
        (Number.isFinite(offset) &&
          Math.abs(offset) <=
            COORDINATE_LIMIT), 'Arc label offsets must be finite within ±1,000,000.');
    }
    const from = net.nodes.find((n) => n.id === arc.source),
      to = net.nodes.find((n) => n.id === arc.target);
    require(from &&
      to &&
      from.kind !== to.kind, 'Arcs must connect an existing place and transition.');
    require(arc.kind !== 'inhibitor' ||
      from.kind === 'place', 'Inhibitor arcs must go from a place to a transition.');
    require(arc.curvedEnd === undefined ||
      typeof arc.curvedEnd === 'boolean', 'Arc end curvature must be true or false.');
    require(arc.bends === undefined ||
      (Array.isArray(arc.bends) &&
        arc.bends.length <=
          MAX_ARC_BENDS), `Arc bend points must be a list of at most ${MAX_ARC_BENDS} points.`);
    for (const bend of arc.bends ?? []) {
      require(!!bend &&
        typeof bend === 'object' &&
        Number.isFinite(bend.x) &&
        Number.isFinite(bend.y) &&
        Math.abs(bend.x) <= COORDINATE_LIMIT &&
        Math.abs(bend.y) <= COORDINATE_LIMIT &&
        typeof bend.curved ===
          'boolean', 'Arc bend points must have finite coordinates within ±1,000,000 and a straight/curved type.');
    }
    const key = JSON.stringify([arc.source, arc.target]);
    require(!edges.has(
      key,
    ), 'Duplicate arcs between the same endpoints are not supported; edit the existing arc type or weight.');
    edges.add(key);
  }
  require(net.annotations === undefined ||
    (Array.isArray(net.annotations) &&
      net.annotations.length <=
        MAX_ANNOTATIONS), `Annotations must be a list of at most ${MAX_ANNOTATIONS} notes.`);
  for (const note of net.annotations ?? []) {
    require(!!note && typeof note === 'object', 'Invalid annotation.');
    require(typeof note.id === 'string' &&
      note.id.length > 0 &&
      !ids.has(note.id), 'Element IDs must be nonempty and unique.');
    ids.add(note.id);
    require(typeof note.text === 'string' &&
      note.text.length <= MAX_ANNOTATION_TEXT &&
      ANNOTATION_TEXT.test(
        note.text,
      ), `Annotation text must be at most ${MAX_ANNOTATION_TEXT} characters of XML text without carriage returns or control characters.`);
    require([note.x, note.y].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT,
    ), 'Coordinates must be finite and within ±1,000,000.');
    require([note.width, note.height].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= COORDINATE_LIMIT,
    ), 'Annotation sizes must be finite and between 0 and 1,000,000.');
    for (const flag of [note.border, note.filled])
      require(flag === undefined ||
        typeof flag === 'boolean', 'Annotation border and background must be true or false.');
  }
}
export function initialMarking(net: Net): Marking {
  return Object.fromEntries(
    net.nodes.filter((n) => n.kind === 'place').map((n) => [n.id, n.tokens]),
  );
}
export function isEnabled(net: Net, marking: Marking, transitionId: string): boolean {
  if (!net.nodes.some((n) => n.id === transitionId && n.kind === 'transition')) return false;
  return net.arcs
    .filter((a) => a.target === transitionId)
    .every((a) =>
      a.kind === 'inhibitor' ? marking[a.source] < a.weight : marking[a.source] >= a.weight,
    );
}
export function fireTransition(net: Net, marking: Marking, transitionId: string): Marking {
  if (!isEnabled(net, marking, transitionId)) throw new Error('Transition is not enabled.');
  const next = { ...marking };
  // Consume first: outputs cannot enable inputs or cause transient numeric overflow in self-loops.
  for (const arc of net.arcs) {
    if (arc.kind === 'inhibitor') continue;
    if (arc.target === transitionId) next[arc.source] -= arc.weight;
  }
  for (const arc of net.arcs) {
    if (arc.kind === 'inhibitor') continue;
    if (arc.source === transitionId) next[arc.target] += arc.weight;
  }
  for (const tokens of Object.values(next)) integer(tokens, 0, 'Resulting token count');
  return next;
}
/** History is document history only; simulation never modifies the initial marking. */
export class NetEditor {
  private past: Net[] = [];
  private future: Net[] = [];
  private document: Net;
  private saved: string;
  constructor(net: Net) {
    validateNet(net);
    this.document = structuredClone(net);
    this.saved = JSON.stringify(this.document);
  }
  get model(): Net {
    return structuredClone(this.document);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get dirty() {
    return JSON.stringify(this.document) !== this.saved;
  }
  commit(net: Net) {
    validateNet(net);
    if (JSON.stringify(net) === JSON.stringify(this.document)) return;
    this.past.push(this.document);
    this.document = structuredClone(net);
    this.future = [];
  }
  undo() {
    const prior = this.past.pop();
    if (prior) {
      this.future.push(this.document);
      this.document = prior;
    }
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.document);
      this.document = next;
    }
  }
  replace(net: Net) {
    validateNet(net);
    this.document = structuredClone(net);
    this.past = [];
    this.future = [];
    this.saved = JSON.stringify(this.document);
  }
  markSaved() {
    this.saved = JSON.stringify(this.document);
  }
}
export interface SimulationState {
  transitionId: string | null;
  marking: Marking;
}
export class Simulation {
  private net: Net;
  private states: SimulationState[];
  private position = 0;
  constructor(net: Net) {
    validateNet(net);
    this.net = structuredClone(net);
    this.states = [{ transitionId: null, marking: initialMarking(net) }];
  }
  get marking(): Marking {
    return { ...this.states[this.position].marking };
  }
  get trace(): SimulationState[] {
    return structuredClone(this.states);
  }
  get cursor() {
    return this.position;
  }
  get canBack() {
    return this.position > 0;
  }
  get canForward() {
    return this.position < this.states.length - 1;
  }
  get enabled(): string[] {
    return this.net.nodes
      .filter((n) => n.kind === 'transition' && isEnabled(this.net, this.marking, n.id))
      .map((n) => n.id);
  }
  fire(id: string) {
    const marking = fireTransition(this.net, this.marking, id);
    this.states = [...this.states.slice(0, this.position + 1), { transitionId: id, marking }];
    this.position++;
  }
  back() {
    if (this.canBack) this.position--;
  }
  forward() {
    if (this.canForward) this.position++;
  }
  reset() {
    this.states = this.states.slice(0, 1);
    this.position = 0;
  }
}
