import type { Network } from './documents';

/** Opaque native XML, never executable. Protections are the original symbol snapshot. */
export interface SavedQueries {
  readonly xml: readonly string[];
  readonly protectedComponents: readonly {
    readonly id: string;
    readonly name: string;
    readonly nodes: readonly {
      readonly id: string;
      readonly name: string;
      readonly kind: 'place' | 'transition';
    }[];
  }[];
}
const NS = 'http://www.informatik.hu-berlin.de/top/pnml/ptNetb';
const MAX_XML = 4_000_000;
function check(ok: unknown, message = 'Malformed saved-query metadata.'): asserts ok {
  if (!ok) throw new Error(message);
}
function record<K extends string>(value: unknown, keys: K[]): asserts value is Record<K, unknown> {
  check(!!value && typeof value === 'object' && !Array.isArray(value));
  check(
    Object.keys(value).length === keys.length &&
      Object.keys(value).every((k) => keys.includes(k as K)),
  );
}
function text(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 10000);
}
/** Only one query root; no executable XML machinery or model declarations hidden inside. */
export function parseSavedQuery(xml: string): Element {
  check(typeof xml === 'string' && xml.length > 0 && xml.length <= MAX_XML);
  check(
    !/<!DOCTYPE|<!ENTITY|<\?/i.test(xml),
    'Saved queries cannot contain DTDs, entities or processing instructions.',
  );
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  check(!doc.getElementsByTagName('parsererror').length, 'Malformed saved-query XML.');
  const root = doc.documentElement;
  check(
    root.localName === 'query' &&
      !root.prefix &&
      (root.namespaceURI === NS || root.namespaceURI === null),
  );
  let count = 0;
  const visit = (node: Node, depth: number) => {
    check(++count <= 50000 && depth <= 128, 'Saved-query XML is too large or deeply nested.');
    if (node.nodeType === node.ELEMENT_NODE) {
      const e = node as Element;
      check(
        e.namespaceURI === root.namespaceURI && !e.prefix,
        'Foreign XML structures are not saved-query content.',
      );
      if (e !== root)
        check(
          ![
            'pnml',
            'net',
            'query',
            'constant',
            'declaration',
            'feature',
            'k-bound',
            'shared-place',
            'shared-transition',
            'arc',
          ].includes(e.localName),
          'Model declarations are not saved-query content.',
        );
      if (e.localName === 'place' || e.localName === 'transition')
        check(
          e.attributes.length === 0 && e.children.length === 0,
          'Model nodes are not saved-query content.',
        );
      for (const attr of Array.from(e.attributes))
        check(
          !attr.namespaceURI || (attr.name === 'xmlns' && attr.value === (root.namespaceURI ?? '')),
          'Foreign query attributes are not supported.',
        );
    } else
      check(
        ([node.TEXT_NODE, node.CDATA_SECTION_NODE, node.COMMENT_NODE] as number[]).includes(
          node.nodeType,
        ),
        'Unsupported saved-query XML node.',
      );
    for (const child of Array.from(node.childNodes)) visit(child, depth + 1);
  };
  check(
    Array.from(doc.childNodes).every(
      (n) => n === root || (n.nodeType === n.TEXT_NODE && !n.textContent?.trim()),
    ),
  );
  visit(root, 0);
  return root;
}
export function captureSavedQueries(network: Network, xml: readonly string[]): SavedQueries {
  return {
    xml: [...xml],
    protectedComponents: network.components.map((c) => ({
      id: c.id,
      name: c.net.template,
      nodes: c.net.nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    })),
  };
}
export function validateSavedQueries(network: Network): void {
  const metadata = network.savedQueries;
  if (metadata === undefined) return;
  record(metadata, ['xml', 'protectedComponents']);
  check(Array.isArray(metadata.xml) && metadata.xml.length > 0 && metadata.xml.length <= 1000);
  let size = 0;
  for (const xml of metadata.xml) {
    check(typeof xml === 'string');
    size += xml.length;
    check(size <= MAX_XML, 'Saved-query XML exceeds the 4,000,000 character limit.');
    parseSavedQuery(xml);
  }
  check(
    Array.isArray(metadata.protectedComponents) &&
      metadata.protectedComponents.length > 0 &&
      metadata.protectedComponents.length <= 10000,
  );
  const ids = new Set<string>();
  let nodeCount = 0;
  for (const c of metadata.protectedComponents) {
    record(c, ['id', 'name', 'nodes']);
    text(c.id);
    text(c.name);
    check(!ids.has(c.id));
    ids.add(c.id);
    check(Array.isArray(c.nodes));
    nodeCount += c.nodes.length;
    check(nodeCount <= 100000);
    const actual = network.components.find((item) => item.id === c.id);
    const message = `Saved queries protect component "${c.name}" and its original nodes. Remove saved queries explicitly before renaming or deleting protected symbols.`;
    check(actual && actual.net.template === c.name, message);
    const nodes = new Set<string>();
    for (const n of c.nodes) {
      record(n, ['id', 'name', 'kind']);
      text(n.id);
      text(n.name);
      check(n.kind === 'place' || n.kind === 'transition');
      check(!nodes.has(n.id));
      nodes.add(n.id);
      check(
        actual.net.nodes.some(
          (item) => item.id === n.id && item.name === n.name && item.kind === n.kind,
        ),
        message,
      );
    }
  }
}
