import { newId } from './ids';
/** Authored clipboard v3 is independent of file JSON. No numeric snapshot is stored. */
import {
  AuthoredNet,
  AuthoredTiming,
  AuthoredNetwork,
  ConstantDecl,
  BoundTerm,
  WeightTerm,
  closedAuthored,
  freezeAuthored,
  resolveAuthored,
} from './authored-model';
import type { AuthoredDocument } from './authored-documents';
import {
  ClipboardPayload,
  ClipboardSources,
  ClipboardError,
  ClipboardContent,
  PasteOptions,
  MAX_CLIPBOARD_TEXT,
  MAX_CLIPBOARD_NODES,
  MAX_CLIPBOARD_ARCS,
  MAX_CLIPBOARD_BENDS,
  WEB_CLIPBOARD_FORMAT,
  copySelection,
  readClipboard,
  pasteClipboard,
} from './clipboard';
import { emptyTiming } from './documents';
import type { Net } from './net';

export interface AuthoredClipboard {
  readonly format: typeof WEB_CLIPBOARD_FORMAT;
  readonly version: 3;
  readonly modelType: 'timed' | 'untimed';
  readonly sourceDocumentId: string;
  readonly constants: readonly ConstantDecl[];
  readonly fragment: Omit<AuthoredNet, 'name' | 'template'> & { readonly timing?: AuthoredTiming };
}
export interface AuthoredClipboardPayload {
  readonly content: AuthoredClipboard;
  readonly nativeText: string;
  readonly webText: string;
}
export type SelectionPayload = ClipboardPayload | AuthoredClipboardPayload;
export function isAuthoredClipboard(
  content: ClipboardContent | AuthoredClipboard,
): content is AuthoredClipboard {
  return Object.hasOwn(content, 'version');
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new ClipboardError('malformed', message);
}
/** Validate data descriptors before inspecting, cloning or serializing any untrusted value. */
function plain(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  check(!seen.has(value), 'Clipboard data must be acyclic.');
  seen.add(value);
  if (Array.isArray(value)) {
    check(
      Object.getPrototypeOf(value) === Array.prototype &&
        Reflect.ownKeys(value).length === value.length + 1,
      'Clipboard lists must be plain and dense.',
    );
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, i);
      check(d && d.enumerable && 'value' in d, 'Clipboard entries must be own data.');
      plain(d.value, seen);
    }
  } else {
    closedAuthored(value);
    for (const v of Object.values(value)) plain(v, seen);
  }
  seen.delete(value);
}
function dependencies(fragment: AuthoredClipboard['fragment']): Set<string> {
  const ids = new Set<string>();
  const term = (v: BoundTerm | WeightTerm | null) => {
    if (v !== null && typeof v === 'object') {
      closedAuthored(v, ['constantId']);
      check(typeof v.constantId === 'string' && !!v.constantId, 'Malformed constant reference.');
      ids.add(v.constantId);
    }
  };
  fragment.arcs.forEach((a) => term(a.weight));
  Object.values(fragment.timing?.intervals ?? {}).forEach((i) => {
    term(i.lower);
    term(i.upper);
  });
  Object.values(fragment.timing?.invariants ?? {}).forEach((i) => term(i.upper));
  return ids;
}
function networkOf(content: AuthoredClipboard): AuthoredNetwork {
  const { timing, ...fragment } = content.fragment;
  return {
    name: 'Clipboard',
    type: { timed: content.modelType === 'timed', colored: false, game: false, stochastic: false },
    constants: content.constants,
    components: [
      {
        id: 'clipboard',
        active: true,
        net: { name: 'Clipboard', template: 'Clipboard', ...fragment },
        ...(timing ? { timing } : {}),
      },
    ],
  };
}
export function validateAuthoredClipboard(value: unknown): asserts value is AuthoredClipboard {
  try {
    plain(value);
    closedAuthored(value, [
      'format',
      'version',
      'modelType',
      'sourceDocumentId',
      'constants',
      'fragment',
    ]);
    const c = value as AuthoredClipboard;
    check(
      c.format === WEB_CLIPBOARD_FORMAT && c.version === 3,
      'Unsupported authored clipboard version.',
    );
    check(
      c.modelType === 'timed' || c.modelType === 'untimed',
      'Unsupported clipboard model type.',
    );
    check(
      typeof c.sourceDocumentId === 'string' && !!c.sourceDocumentId,
      'Clipboard source document ID is required.',
    );
    closedAuthored(c.fragment, ['nodes', 'arcs', 'annotations', 'timing']);
    check(
      Array.isArray(c.constants) &&
        Array.isArray(c.fragment.nodes) &&
        Array.isArray(c.fragment.arcs),
      'Clipboard lists are required.',
    );
    check(
      (c.modelType === 'timed') === Object.hasOwn(c.fragment, 'timing'),
      'Clipboard timing must match its model type.',
    );
    check(
      c.fragment.nodes.length || c.fragment.annotations?.length,
      'Select at least one place, transition or annotation to copy.',
    );
    if (
      c.fragment.nodes.length > MAX_CLIPBOARD_NODES ||
      c.fragment.arcs.length > MAX_CLIPBOARD_ARCS ||
      (c.fragment.annotations?.length ?? 0) > 10000 ||
      c.fragment.arcs.reduce((n, a) => n + (a.bends?.length ?? 0), 0) > MAX_CLIPBOARD_BENDS
    )
      throw new ClipboardError(
        'too-large',
        'Clipboard selection exceeds the node, arc, annotation or bend limit.',
      );
    const resolved = resolveAuthored(networkOf(c));
    check(resolved.ok, resolved.ok ? '' : resolved.issues.map((i) => i.message).join(' '));
    const used = dependencies(c.fragment);
    check(
      c.constants.length === used.size && c.constants.every((d) => used.has(d.id)),
      'Clipboard declarations must be exactly the referenced dependencies; missing or extra declarations are forbidden.',
    );
    if (JSON.stringify(c).length > MAX_CLIPBOARD_TEXT)
      throw new ClipboardError('too-large', 'The clipboard contents are too large.');
  } catch (e) {
    if (e instanceof ClipboardError) throw e;
    throw new ClipboardError('malformed', (e as Error).message);
  }
}
export function authoredClipboardPayload(content: AuthoredClipboard): AuthoredClipboardPayload {
  validateAuthoredClipboard(content);
  const frozen = freezeAuthored(structuredClone(content));
  const webText = JSON.stringify(frozen);
  return freezeAuthored({ content: frozen, nativeText: webText, webText });
}
export function parseAuthoredClipboard(text: string): AuthoredClipboard {
  if (text.length > MAX_CLIPBOARD_TEXT)
    throw new ClipboardError('too-large', 'The clipboard contents are too large.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ClipboardError('not-tapaal', 'The clipboard does not contain a TAPAAL selection.');
  }
  validateAuthoredClipboard(value);
  return freezeAuthored(value);
}
export function copyAuthoredSelection(
  doc: AuthoredDocument,
  selected: readonly string[],
): SelectionPayload {
  const source = doc.network.components.find((c) => c.id === doc.session.componentId)!;
  const ids = new Set(selected);
  const nodes = source.net.nodes.filter((n) => ids.has(n.id));
  const keptNodes = new Set(nodes.map((n) => n.id));
  const arcs = source.net.arcs.filter(
    (a) => ids.has(a.id) && keptNodes.has(a.source) && keptNodes.has(a.target),
  );
  const kept = new Set([...nodes, ...arcs].map((e) => e.id));
  const keep = <T>(map: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(map).filter(([id]) => kept.has(id)));
  const t = source.timing;
  for (const p of t?.transports ?? []) {
    const halves = source.net.arcs.filter((a) => a.id === p.inputArc || a.id === p.outputArc);
    check(
      !halves.some((a) => ids.has(a.id) || ids.has(a.source) || ids.has(a.target)) ||
        (kept.has(p.inputArc) && kept.has(p.outputArc)),
      'Select both transport halves and all three endpoints to copy, cut or duplicate this transport. Nothing was changed.',
    );
  }
  const annotations = source.net.annotations?.filter((n) => ids.has(n.id));
  const fragment: AuthoredClipboard['fragment'] = {
    nodes,
    arcs,
    ...(annotations?.length ? { annotations } : {}),
    ...(t
      ? {
          timing: {
            intervals: keep(t.intervals),
            invariants: keep(t.invariants),
            ages: keep(t.ages),
            urgent: t.urgent.filter((id) => kept.has(id)),
            transports: t.transports.filter((p) => kept.has(p.inputArc)),
          },
        }
      : {}),
  };
  const used = dependencies(fragment);
  if (!used.size) {
    // Only the verified reference-free fragment may reach existing numeric encoders.
    const net = {
      name: source.net.name,
      template: source.net.template,
      nodes,
      arcs,
      ...(annotations?.length ? { annotations } : {}),
    } as Net;
    return copySelection(net, selected, {
      selectedArcsOnly: true,
      timing: fragment.timing as import('./documents').ComponentTiming | undefined,
    });
  }
  return authoredClipboardPayload({
    format: WEB_CLIPBOARD_FORMAT,
    version: 3,
    modelType: t ? 'timed' : 'untimed',
    sourceDocumentId: doc.id,
    constants: doc.network.constants.filter((c) => used.has(c.id)),
    fragment,
  });
}
/** Dispatch without letting readable unrelated/malformed content use a stale internal copy. */
export function readSelectionClipboard(
  sources: Omit<ClipboardSources, 'internal'> & { internal?: SelectionPayload | null },
) {
  const { text, webText, internal } = sources;
  const decode = (s: string) => {
    if (s.length > MAX_CLIPBOARD_TEXT)
      throw new ClipboardError('too-large', 'The clipboard contents are too large.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return null;
    }
    return parsed && typeof parsed === 'object' && 'version' in parsed && parsed.version === 3
      ? parseAuthoredClipboard(s)
      : null;
  };
  if (webText != null) {
    const authored = decode(webText);
    if (authored) {
      if (text == null || text === webText)
        return { content: authored, source: 'web' as const, droppedArcs: 0 };
    } else {
      // Validate even a mismatched custom format, as the established reader does.
      const legacy = readClipboard({ webText });
      if (text == null || text === webText || text === JSON.parse(webText).native) return legacy;
    }
  }
  if (text != null) {
    const authored = decode(text);
    if (authored) return { content: authored, source: 'web' as const, droppedArcs: 0 };
  }
  if (
    internal &&
    isAuthoredClipboard(internal.content) &&
    (text == null || text === internal.nativeText)
  ) {
    validateAuthoredClipboard(internal.content);
    return { content: internal.content, source: 'internal' as const, droppedArcs: 0 };
  }
  return readClipboard({
    text,
    internal:
      internal && !isAuthoredClipboard(internal.content) ? (internal as ClipboardPayload) : null,
  });
}
/** Bind first, then allocate geometry. Every existing source term remains untouched. */
export function prepareAuthoredPaste(
  doc: AuthoredDocument,
  content: AuthoredClipboard,
  options: Pick<PasteOptions, 'nodeName' | 'elementId'> = {},
) {
  validateAuthoredClipboard(content);
  check(
    content.modelType !== 'timed' || doc.network.type.timed,
    'Cannot paste a timed selection into an untimed model.',
  );
  const bindings = new Map<string, string>();
  const constants: ConstantDecl[] = [];
  const reserved = new Set([...doc.network.constants, ...content.constants].map((c) => c.id));
  for (const c of content.constants) {
    if (doc.id === content.sourceDocumentId) {
      check(
        doc.network.constants.some((d) => d.id === c.id),
        `Constant ${c.name} no longer exists in the source document. Copy again; deleted bindings cannot be restored by paste.`,
      );
      bindings.set(c.id, c.id);
    } else {
      check(
        !doc.network.constants.some((d) => d.name === c.name),
        `Cannot paste: target already declares constant ${c.name}. Same-name constants cannot be merged, even when their values match. Rename explicitly or copy from this target document.`,
      );
      let id: string;
      do {
        id = newId();
      } while (reserved.has(id));
      reserved.add(id);
      bindings.set(c.id, id);
      constants.push({ ...c, id });
    }
  }
  const source = doc.network.components.find((c) => c.id === doc.session.componentId)!;
  // Reuse placement/naming only: inert geometry has no timing or binding semantics and is never encoded or committed.
  const geometry = (n: Pick<AuthoredNet, 'nodes' | 'arcs' | 'annotations'>): Net => ({
    name: source.net.name,
    template: source.net.template,
    nodes: structuredClone(n.nodes) as Net['nodes'],
    arcs: n.arcs.map((a) => ({ ...structuredClone(a), weight: 1 })) as Net['arcs'],
    ...(n.annotations ? { annotations: structuredClone(n.annotations) as Net['annotations'] } : {}),
  });
  const placed = pasteClipboard(geometry(source.net), geometryContent(content.fragment), options);
  function geometryContent(f: AuthoredClipboard['fragment']): ClipboardContent {
    const { nodes, arcs, annotations } = geometry(f);
    return { nodes, arcs, ...(annotations ? { annotations } : {}) };
  }
  const term = <T extends BoundTerm | WeightTerm | null>(v: T): T =>
    v && typeof v === 'object' ? ({ constantId: bindings.get(v.constantId)! } as T) : v;
  const old = new Map(source.net.arcs.map((a) => [a.id, a]));
  const incoming = new Map(content.fragment.arcs.map((a) => [placed.idMap[a.id], a]));
  const net: AuthoredNet = {
    ...placed.net,
    arcs: placed.net.arcs.map(
      (a) => old.get(a.id) ?? { ...a, weight: term(incoming.get(a.id)!.weight) },
    ),
  };
  const t = content.fragment.timing;
  const target = source.timing ?? emptyTiming();
  const map = <T, U>(m: Readonly<Record<string, T>>, f: (v: T) => U) =>
    Object.fromEntries(Object.entries(m).map(([id, v]) => [placed.idMap[id], f(v)]));
  const timing: AuthoredTiming | null = !doc.network.type.timed
    ? null
    : !t
      ? target
      : {
          intervals: {
            ...target.intervals,
            ...map(t.intervals, (i) => ({ ...i, lower: term(i.lower), upper: term(i.upper) })),
          },
          invariants: {
            ...target.invariants,
            ...map(t.invariants, (i) => ({ ...i, upper: term(i.upper) })),
          },
          ages: { ...target.ages, ...map(t.ages, (a) => a) },
          urgent: [...target.urgent, ...t.urgent.map((id) => placed.idMap[id])],
          transports: [
            ...target.transports,
            ...t.transports.map((p) => ({
              inputArc: placed.idMap[p.inputArc],
              outputArc: placed.idMap[p.outputArc],
            })),
          ],
        };
  return {
    edit: { kind: 'pasteElements' as const, componentId: source.id, constants, net, timing },
    selectedIds: placed.selectedIds,
    idMap: placed.idMap,
  };
}
