import { freshAnnotationIds, normalizeAngle } from './element-layout';
import { Annotation, Arc, ArcBend, Net, NetNode, validateNet } from './net';
export interface ImportResult {
  net: Net;
  warnings: string[];
}
const FORMAT = 'tapaal-web-untimed';
export function serializeJson(net: Net): string {
  validateNet(net);
  return JSON.stringify({ format: FORMAT, version: 1, net }, null, 2);
}
export function parseJson(source: string): ImportResult {
  const document = JSON.parse(source);
  if (document.format !== FORMAT || document.version !== 1)
    throw new Error('Unsupported JSON format or version. Open a TAPAAL Web untimed model.');
  validateNet(document.net);
  return { net: document.net, warnings: [] };
}
const children = (element: Element, tag: string) =>
  Array.from(element.children).filter((e) => e.localName === tag);
const descendants = (element: Element, tag: string) =>
  Array.from(element.getElementsByTagName('*')).filter((e) => e.localName === tag);
const all = (element: Element, tag: string) =>
  [...children(element, tag), ...descendants(element, tag)].filter((e, i, a) => a.indexOf(e) === i);
const number = (element: Element, key: string, fallback?: number) => {
  const value = element.getAttribute(key);
  if (value === null || value.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${key} on ${element.localName}.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid ${key}: ${value}.`);
  return result;
};
/** Integer.parseInt as used by TapnXmlLoader for angles and annotation geometry. */
const javaInt = (element: Element, key: string, fallback: number) => {
  const value = element.getAttribute(key);
  if (value === null || value === '') return fallback;
  if (!/^[-+]?\d+$/.test(value) || Math.abs(Number(value)) > 2147483647)
    throw new Error(`Invalid ${key}: ${value} (desktop TAPAAL expects a whole number).`);
  return Number(value);
};
/** TAPAAL's attribute-based PNML dialect, deliberately restricted to untimed P/T nets. */
export function parseTapn(source: string, filename = 'Imported model'): ImportResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('XML document types and entities are not supported.');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('The XML file is malformed.');
  const root = document.documentElement;
  if (root.localName !== 'pnml') throw new Error('Expected a TAPAAL PNML document.');
  const features = children(root, 'feature');
  if (features.length !== 1 || features[0].getAttribute('isTimed') !== 'false')
    throw new Error('Only explicitly untimed TAPAAL files are supported.');
  for (const key of ['isColored', 'isGame', 'isStochastic']) {
    const value = features[0].getAttribute(key);
    if (value !== null && value !== 'false')
      throw new Error('Coloured, game and stochastic nets are not supported.');
  }
  const templates = children(root, 'net');
  if (templates.length !== 1 || templates[0].getAttribute('active') === 'false')
    throw new Error('Open a model with exactly one active template.');
  if (children(root, 'shared-place').length || children(root, 'shared-transition').length)
    throw new Error('Shared places and transitions are not supported.');
  const template = templates[0];
  const constants = new Map(
    children(root, 'constant').map((e) => [e.getAttribute('name')!, number(e, 'value')]),
  );
  const nodes: NetNode[] = [];
  for (const element of Array.from(template.children)) {
    if (element.localName !== 'place' && element.localName !== 'transition') continue;
    const place = element.localName === 'place';
    const invariant = element.getAttribute('invariant');
    if (place && invariant && !/^<\s*(inf|∞)$/i.test(invariant))
      throw new Error('Timed invariants are not supported.');
    if (all(element, 'initialMarkingAge').length) throw new Error('Token ages are not supported.');
    if (
      all(element, 'colorinvariant').length ||
      all(element, 'colorinterval').length ||
      all(element, 'hlinitialMarking').length ||
      all(element, 'condition').length
    )
      throw new Error('Coloured expressions are not supported.');
    if (
      !place &&
      (element.getAttribute('urgent') === 'true' ||
        number(element, 'player', 0) !== 0 ||
        number(element, 'priority', 0) !== 0)
    )
      throw new Error('Urgent, game or priority transitions are not supported.');
    const id = element.getAttribute('id') || element.getAttribute('name') || '';
    // Transition constructor: angle = 0; rotate(angle) leaves angle % 360 with Java's sign.
    const angle = place ? 0 : normalizeAngle(javaInt(element, 'angle', 0));
    nodes.push({
      id,
      kind: place ? 'place' : 'transition',
      name: element.getAttribute('name') || id,
      x: number(element, 'positionX', 0) + 15,
      y: number(element, 'positionY', 0) + 15,
      tokens: place ? number(element, 'initialMarking', 0) : 0,
      ...(number(element, 'nameOffsetX', 0) !== 0
        ? { nameOffsetX: number(element, 'nameOffsetX', 0) }
        : {}),
      ...(number(element, 'nameOffsetY', 35) !== 35
        ? { nameOffsetY: number(element, 'nameOffsetY', 35) }
        : {}),
      // TapnXmlLoader: only the exact string "false" hides the name.
      ...(element.getAttribute('displayName') === 'false' ? { nameVisible: false } : {}),
      ...(angle ? { angle } : {}),
    });
  }
  const arcs: Arc[] = [];
  const usedIds = new Set(nodes.map((node) => node.id));
  let repairedIds = false;
  let expandedConstants = false,
    incompletePaths = false;
  for (const element of Array.from(template.children)) {
    if (
      !['arc', 'inputArc', 'outputArc', 'inhibitorArc', 'transportArc'].includes(element.localName)
    )
      continue;
    // TapnXmlLoader.parseArcPath: first and last points are the automatic endpoint anchors.
    const path = descendants(element, 'arcpath').map((point) => ({
      x: Math.trunc(number(point, 'xCoord')) || 0,
      y: Math.trunc(number(point, 'yCoord')) || 0,
      curved: point.getAttribute('arcPointType')?.toLowerCase() === 'true',
    }));
    if (path.length === 1) incompletePaths = true;
    const bends: ArcBend[] = path.length > 2 ? path.slice(1, -1) : [];
    const curvedEnd = path.length > 1 && path[path.length - 1].curved;
    const type =
      element.getAttribute('type') ||
      (
        { inputArc: 'timed', inhibitorArc: 'inhibitor', transportArc: 'transport' } as Record<
          string,
          string
        >
      )[element.localName] ||
      'normal';
    if (!['normal', 'timed', 'tapnInhibitor', 'inhibitor'].includes(type))
      throw new Error(`Unsupported arc type: ${type}.`);
    if (all(element, 'hlinscription').length || all(element, 'colorinterval').length)
      throw new Error('Coloured arc expressions are not supported.');
    const sourceId = element.getAttribute('source') || '',
      targetId = element.getAttribute('target') || '';
    const input = nodes.find((n) => n.id === sourceId)?.kind === 'place';
    const inscription = element.getAttribute('inscription');
    if (input && inscription && !/^\[0,\s*(inf|∞)\)$/i.test(inscription))
      throw new Error('Timed arc intervals are not supported.');
    const raw = element.getAttribute('weight') || '1';
    const weight = constants.has(raw) ? constants.get(raw)! : Number(raw);
    if (constants.has(raw)) expandedConstants = true;
    const originalId = element.getAttribute('id') || `arc-${arcs.length + 1}`;
    let id = originalId,
      suffix = 1;
    while (usedIds.has(id)) {
      id = `${originalId}_${suffix++}`;
      repairedIds = true;
    }
    usedIds.add(id);
    arcs.push({
      id,
      source: sourceId,
      target: targetId,
      kind: ['tapnInhibitor', 'inhibitor'].includes(type) ? 'inhibitor' : 'normal',
      weight,
      ...(['nameOffsetX', 'nameOffsetY'] as const).reduce((offsets, key) => {
        const value = Math.trunc(number(element, key, 0));
        // Native loader treats the two attributes as a pair (old files may omit both).
        if (!element.getAttribute('nameOffsetX') || !element.getAttribute('nameOffsetY'))
          return offsets;
        return value ? { ...offsets, [key]: value } : offsets;
      }, {}),
      ...(bends.length ? { bends } : {}),
      ...(curvedEnd ? { curvedEnd } : {}),
    });
  }
  // TapnXmlLoader.parseAnnotation: absent or empty values default; IDs are web-only.
  const labels = children(template, 'labels');
  const ids = freshAnnotationIds({ nodes, arcs }, labels.length);
  const annotations: Annotation[] = labels.map((element, i) => {
    const border = element.getAttribute('border');
    return {
      id: ids[i],
      text: (element.textContent ?? '').replace(/\r\n?/g, '\n'),
      x: javaInt(element, 'positionX', 0),
      y: javaInt(element, 'positionY', 0),
      width: javaInt(element, 'width', 0),
      height: javaInt(element, 'height', 0),
      ...(border && border.toLowerCase() !== 'true' ? { border: false } : {}),
    };
  });
  const net: Net = {
    name: root.getAttribute('name') || filename.replace(/\.(tapn|pnml|xml)$/i, ''),
    template: template.getAttribute('id') || 'Net',
    nodes,
    arcs,
    ...(annotations.length ? { annotations } : {}),
  };
  validateNet(net);
  const warnings: string[] = [];
  if (repairedIds)
    warnings.push(
      'Duplicate arc IDs were replaced with unique IDs; connections and weights are unchanged.',
    );
  const queries = children(root, 'query').length;
  if (queries)
    warnings.push(
      `${queries} saved queries will not be imported or included when saving this model. Verification is not implemented yet.`,
    );
  if (incompletePaths)
    warnings.push('Arc paths with a single point were replaced with straight connections.');
  if (expandedConstants || constants.size)
    warnings.push(
      'Constants will be expanded to numeric arc weights; constant definitions will not be saved.',
    );
  if (all(template, 'place').some((e) => all(e, 'type').length))
    throw new Error('Coloured place declarations are not supported.');
  return { net, warnings };
}
export function parseModel(source: string, filename: string): ImportResult {
  return source.trimStart().startsWith('{') ? parseJson(source) : parseTapn(source, filename);
}
export function serializeTapn(net: Net): string {
  validateNet(net);
  if (
    net.arcs.some(
      (a) => !Number.isInteger(a.nameOffsetX ?? 0) || !Number.isInteger(a.nameOffsetY ?? 0),
    )
  ) {
    throw new Error(
      'Desktop TAPAAL stores integer arc label offsets; save JSON to retain fractional values.',
    );
  }
  if (
    net.nodes.some((node) => node.tokens > 2147483647) ||
    net.arcs.some((arc) => arc.weight > 2147483647)
  ) {
    throw new Error(
      'Desktop TAPAAL supports token counts and arc weights up to 2,147,483,647. Reduce these values or save JSON instead.',
    );
  }
  const document = new DOMParser().parseFromString(
    '<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb"/>',
    'application/xml',
  );
  const root = document.documentElement;
  root.setAttribute('name', net.name);
  const add = (parent: Element, tag: string, attributes: Record<string, string | number>) => {
    const element = document.createElementNS(root.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    parent.appendChild(element);
    return element;
  };
  const template = add(root, 'net', { id: net.template, active: 'true', type: 'P/T net' });
  // Writer order: annotations, places, transitions, arcs. Annotation IDs are not written.
  for (const note of net.annotations ?? []) {
    const element = add(template, 'labels', {
      positionX: note.x,
      positionY: note.y,
      width: note.width,
      height: note.height,
      border: String(note.border !== false),
    });
    element.appendChild(document.createTextNode(note.text));
  }
  for (const node of net.nodes) {
    const common = {
      id: node.id,
      name: node.name,
      positionX: node.x - 15,
      positionY: node.y - 15,
      displayName: String(node.nameVisible !== false),
      nameOffsetX: node.nameOffsetX ?? 0,
      nameOffsetY: node.nameOffsetY ?? 35,
    };
    if (node.kind === 'place')
      add(template, 'place', { ...common, initialMarking: node.tokens, invariant: '< inf' });
    else
      add(template, 'transition', {
        ...common,
        angle: node.angle ?? 0,
        infiniteServer: 'false',
        priority: 0,
        urgent: 'false',
        player: 0,
      });
  }
  for (const arc of net.arcs) {
    const input = net.nodes.find((n) => n.id === arc.source)!.kind === 'place';
    const element = add(template, 'arc', {
      id: arc.id,
      source: arc.source,
      target: arc.target,
      type: arc.kind === 'inhibitor' ? 'tapnInhibitor' : input ? 'timed' : 'normal',
      weight: arc.weight,
      inscription: input ? '[0,inf)' : '1',
      nameOffsetX: arc.nameOffsetX ?? 0,
      nameOffsetY: arc.nameOffsetY ?? 0,
    });
    // Endpoints are written at node centres; desktop recomputes both anchors on load.
    const source = net.nodes.find((n) => n.id === arc.source)!,
      target = net.nodes.find((n) => n.id === arc.target)!;
    [
      { x: source.x, y: source.y, curved: false },
      ...(arc.bends ?? []),
      { x: target.x, y: target.y, curved: arc.curvedEnd === true },
    ].forEach((point, i) =>
      add(element, 'arcpath', {
        id: i,
        xCoord: point.x,
        yCoord: point.y,
        arcPointType: String(point.curved),
      }),
    );
  }
  add(root, 'k-bound', { bound: 3 });
  add(root, 'feature', {
    isTimed: 'false',
    isColored: 'false',
    isGame: 'false',
    isStochastic: 'false',
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(document)
  );
}
