import { describe, expect, it } from 'vitest';
import {
  ClipboardError,
  MAX_CLIPBOARD_TEXT,
  copySelection,
  cutSelection,
  parseNativeClipboard,
  parseWebClipboard,
  pasteClipboard,
  readClipboard,
} from './clipboard';
import { NetEditor, type Net, validateNet } from './net';

function source(): Net {
  return {
    name: 'Source',
    template: 'Main',
    nodes: [
      { id: 'p', name: 'P0', kind: 'place', x: 45, y: 45, tokens: 3, nameOffsetX: 7 },
      { id: 't', name: 'T0', kind: 'transition', x: 135, y: 45, tokens: 0 },
      { id: 'q', name: 'P1', kind: 'place', x: 225, y: 45, tokens: 0, nameOffsetY: -12 },
      { id: 'outside', name: 'Elsewhere', kind: 'place', x: 135, y: 300, tokens: 1 },
    ],
    arcs: [
      {
        id: 'in',
        source: 'p',
        target: 't',
        kind: 'normal',
        weight: 2,
        bends: [
          { x: 80, y: 10, curved: false },
          { x: 100, y: 20, curved: true },
        ],
        curvedEnd: true,
      },
      { id: 'inh', source: 'q', target: 't', kind: 'inhibitor', weight: 4 },
      { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 1 },
      { id: 'external', source: 'outside', target: 't', kind: 'normal', weight: 1 },
    ],
  };
}
function target(): Net {
  return {
    name: 'Target',
    template: 'Other',
    nodes: [
      { id: 'web-0', name: 'P0', kind: 'place', x: 45, y: 45, tokens: 0 },
      { id: 'web-1', name: 'P7', kind: 'place', x: 100, y: 45, tokens: 0 },
      { id: 'web-2', name: 'T2', kind: 'transition', x: 100, y: 100, tokens: 0 },
    ],
    arcs: [{ id: 'web-3', source: 'web-1', target: 'web-2', kind: 'normal', weight: 1 }],
  };
}
const SELECTED = ['p', 't', 'q', 'external'];
function code(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ClipboardError) return error.code;
    throw error;
  }
  throw new Error('Expected a ClipboardError.');
}

describe('copying a selection', () => {
  it('copies selected nodes and only arcs between them, whether or not the arcs were selected', () => {
    const { content } = copySelection(source(), SELECTED);
    expect(content.nodes.map((node) => node.id)).toEqual(['p', 't', 'q']);
    expect(content.arcs.map((arc) => arc.id)).toEqual(['in', 'inh', 'out']);
    expect(copySelection(source(), ['p', 't']).content.arcs.map((arc) => arc.id)).toEqual(['in']);
  });

  it('rejects selections without nodes, including arc-only selections', () => {
    expect(code(() => copySelection(source(), []))).toBe('empty');
    expect(code(() => copySelection(source(), ['in']))).toBe('empty');
  });

  it('writes the native TAPAALCopyPastModel shape with top-left corners and full paths', () => {
    const native = JSON.parse(copySelection(source(), SELECTED).nativeText);
    expect(Object.keys(native)).toEqual([
      'places',
      'transitions',
      'inputArcs',
      'outputArc',
      'inhibitorArc',
      'transportArcs',
    ]);
    expect(native.places[0]).toEqual({ name: 'P0', x: 30, y: 30, tokens: 3, invariant: '< inf' });
    expect(native.transitions[0]).toEqual({
      name: 'T0',
      x: 120,
      y: 30,
      uncontrollable: false,
      urgent: false,
      rotation: 0,
    });
    expect(native.inputArcs).toEqual([
      {
        source: 'P0',
        target: 'T0',
        guard: '[0,inf)',
        weight: '2',
        path: [
          { x: 45, y: 45 },
          { x: 80, y: 10 },
          { x: 100, y: 20, curve: true },
          { x: 135, y: 45, curve: true },
        ],
      },
    ]);
    expect(native.outputArc).toEqual([{ source: 'T0', target: 'P1', weight: '1' }]);
    expect(native.inhibitorArc).toEqual([{ source: 'P1', target: 'T0', weight: '4' }]);
    expect(native.transportArcs).toEqual([]);
  });

  it('is deeply frozen and detached from the source net', () => {
    const net = source();
    const { content } = copySelection(net, SELECTED);
    expect(Object.isFrozen(content.arcs[0].bends![0])).toBe(true);
    net.arcs[0].bends![0].x = 999;
    expect(content.arcs[0].bends![0].x).toBe(80);
  });
});

describe('pasting into another net', () => {
  it('remaps IDs, renames with native P/T high-water names and keeps markings, weights, kinds', () => {
    const clipboard = copySelection(source(), SELECTED);
    const { net, selectedIds, idMap } = pasteClipboard(target(), clipboard.content);
    validateNet(net);
    const pasted = net.nodes.slice(3);
    // Places first (native past order): P8, P9; transitions above T2: T3.
    expect(pasted.map((node) => node.name)).toEqual(['P8', 'P9', 'T3']);
    expect(pasted.map((node) => node.id)).toEqual(['web-4', 'web-5', 'web-6']);
    expect(pasted.map((node) => node.tokens)).toEqual([3, 0, 0]);
    expect(pasted[0]).toMatchObject({ x: 75, y: 75, nameOffsetX: 7 });
    expect(pasted[1]).toMatchObject({ nameOffsetY: -12 });
    const arcs = net.arcs.slice(1);
    expect(arcs.map((arc) => [arc.source, arc.target, arc.kind, arc.weight])).toEqual([
      [idMap['p'], idMap['t'], 'normal', 2],
      [idMap['q'], idMap['t'], 'inhibitor', 4],
      [idMap['t'], idMap['q'], 'normal', 1],
    ]);
    expect(arcs[0].bends).toEqual([
      { x: 110, y: 40, curved: false },
      { x: 130, y: 50, curved: true },
    ]);
    expect(arcs[0].curvedEnd).toBe(true);
    expect(selectedIds).toEqual([...pasted.map((n) => n.id), ...arcs.map((a) => a.id)]);
  });

  it('gives every repeated paste unique IDs and names', () => {
    const { content } = copySelection(source(), SELECTED);
    let net = target();
    for (let i = 0; i < 3; i++) net = pasteClipboard(net, content).net;
    validateNet(net);
    expect(net.nodes).toHaveLength(12);
    expect(new Set(net.nodes.map((node) => node.name)).size).toBe(12);
    expect(net.nodes.filter((node) => node.kind === 'place').map((node) => node.name)).toEqual([
      'P0',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P12',
      'P13',
    ]);
  });

  it('pastes into the same net without touching the originals', () => {
    const net = source();
    const before = structuredClone(net);
    const { content } = copySelection(net, SELECTED);
    const result = pasteClipboard(net, content);
    expect(net).toEqual(before);
    expect(result.net.nodes.slice(0, 4)).toEqual(before.nodes);
    expect(result.net.arcs.slice(0, 4)).toEqual(before.arcs);
  });

  it('shares no bend arrays between the clipboard, source and pasted nets', () => {
    const { content } = copySelection(source(), SELECTED);
    const first = pasteClipboard(target(), content).net;
    const second = pasteClipboard(target(), content).net;
    first.arcs[1].bends![0].x = -1;
    expect(second.arcs[1].bends![0].x).toBe(110);
    expect(content.arcs[0].bends![0].x).toBe(80);
    expect(first.arcs[1].bends).not.toBe(content.arcs[0].bends);
  });

  it('accepts an injected document name allocator', () => {
    let counter = 40;
    const { content } = copySelection(source(), SELECTED);
    const { net } = pasteClipboard(target(), content, {
      nodeName: (_net, kind) => `${kind === 'place' ? 'P' : 'T'}${counter++}`,
    });
    expect(net.nodes.slice(3).map((node) => node.name)).toEqual(['P40', 'P41', 'T42']);
  });

  it('places the fragment at a point, snaps to the grid and never crosses the origin', () => {
    const { content } = copySelection(source(), ['p', 't']);
    // Fragment top-left: node corner (30, 30), bend (80, 10) → (30, 10).
    const at = pasteClipboard(target(), content, { at: { x: 300, y: 200 } }).net;
    expect(at.nodes[3]).toMatchObject({ x: 315, y: 235 });
    expect(at.arcs[1].bends![0]).toMatchObject({ x: 350, y: 200 });

    const snapped = pasteClipboard(target(), content, { offset: { x: 7, y: 8 }, grid: 15 }).net;
    expect(snapped.nodes[3]).toMatchObject({ x: 45, y: 60 });

    const clamped = pasteClipboard(target(), content, { offset: { x: -100, y: -100 } }).net;
    expect(clamped.nodes[3]).toMatchObject({ x: 15, y: 35 });
    expect(clamped.arcs[1].bends![0]).toMatchObject({ x: 50, y: 0 });

    const gridClamped = pasteClipboard(target(), content, {
      offset: { x: -100, y: -100 },
      grid: 15,
    }).net;
    expect(gridClamped.nodes[3].y).toBeGreaterThanOrEqual(15);
    expect((gridClamped.nodes[3].x - 15) % 15).toBe(0);
    expect((gridClamped.nodes[3].y - 15) % 15).toBe(0);
  });

  it('is one history entry: a single commit and a single undo', () => {
    const editor = new NetEditor(target());
    const { content } = copySelection(source(), SELECTED);
    editor.commit(pasteClipboard(editor.model, content).net);
    expect(editor.model.nodes).toHaveLength(6);
    editor.undo();
    expect(editor.model).toEqual(target());
    expect(editor.canUndo).toBe(false);
  });
});

describe('cutting a selection', () => {
  it('returns the deleted net and the payload together, without mutating the input', () => {
    const net = source();
    const before = structuredClone(net);
    const cut = cutSelection(net, ['p', 't']);
    expect(net).toEqual(before);
    expect(cut.net.nodes.map((node) => node.id)).toEqual(['q', 'outside']);
    expect(cut.net.arcs).toEqual([]);
    expect(cut.clipboard.content.arcs.map((arc) => arc.id)).toEqual(['in']);
    validateNet(cut.net);
  });

  it('deletes nothing when there is nothing to copy', () => {
    expect(code(() => cutSelection(source(), ['external']))).toBe('empty');
  });

  it('undoes back to the original net in one step after the caller commits', () => {
    const editor = new NetEditor(source());
    const cut = cutSelection(editor.model, SELECTED);
    editor.commit(cut.net);
    editor.undo();
    expect(editor.model).toEqual(source());
  });
});

describe('native clipboard payloads', () => {
  const native = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      places: [
        { name: 'A', x: 0, y: 0, tokens: 2, invariant: '< inf' },
        { name: 'B', x: 90, y: 0, tokens: 0, invariant: '< inf' },
      ],
      transitions: [{ name: 'X', x: 45, y: 0, uncontrollable: false, urgent: false, rotation: 0 }],
      inputArcs: [
        {
          source: 'A',
          target: 'X',
          guard: '[0,inf)',
          weight: '3',
          path: [
            { x: 15, y: 15 },
            { x: 30, y: 60, curve: true },
            { x: 60, y: 15 },
          ],
        },
      ],
      outputArc: [{ source: 'X', target: 'B', weight: '1' }],
      inhibitorArc: [],
      transportArcs: [],
      ...overrides,
    });

  it('accepts native-authored payloads and round-trips web copies through native text', () => {
    const { content, droppedArcs } = parseNativeClipboard(native());
    expect(droppedArcs).toBe(0);
    expect(content.nodes.map((node) => [node.name, node.x, node.y, node.tokens])).toEqual([
      ['A', 15, 15, 2],
      ['B', 105, 15, 0],
      ['X', 60, 15, 0],
    ]);
    expect(content.arcs[0]).toMatchObject({
      kind: 'normal',
      weight: 3,
      bends: [{ x: 30, y: 60, curved: true }],
    });
    expect(content.arcs[0].curvedEnd).toBeUndefined();

    const copied = copySelection(source(), SELECTED);
    const reparsed = parseNativeClipboard(copied.nativeText).content;
    // Native groups places before transitions and arcs by kind; label offsets are web-only.
    const nodes = (content: typeof reparsed) =>
      content.nodes
        .map((node) => [node.name, node.kind, node.x, node.y, node.tokens])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const arcs = (content: typeof reparsed) =>
      content.arcs
        .map(({ id: _id, source: _s, target: _t, ...arc }) => arc)
        .sort((a, b) => a.weight - b.weight);
    expect(nodes(reparsed)).toEqual(nodes(copied.content));
    expect(arcs(reparsed)).toEqual(arcs(copied.content));
  });

  it('drops arcs whose endpoints were not copied, like native past()', () => {
    const text = native({ inhibitorArc: [{ source: 'Missing', target: 'X', weight: '1' }] });
    const { content, droppedArcs } = parseNativeClipboard(text);
    expect(droppedArcs).toBe(1);
    expect(content.arcs).toHaveLength(2);
  });

  it.each([
    ['time invariant', { places: [{ name: 'A', x: 0, y: 0, tokens: 0, invariant: '<= 5' }] }],
    [
      'urgent transition',
      {
        transitions: [{ name: 'X', x: 0, y: 0, uncontrollable: false, urgent: true, rotation: 0 }],
      },
    ],
    [
      'game transition',
      {
        transitions: [{ name: 'X', x: 0, y: 0, uncontrollable: true, urgent: false, rotation: 0 }],
      },
    ],
    ['time guard', { inputArcs: [{ source: 'A', target: 'X', guard: '[2,5]', weight: '1' }] }],
    ['constant weight', { outputArc: [{ source: 'X', target: 'B', weight: 'k' }] }],
    [
      'transport arc',
      {
        transportArcs: [{ source: 'A', mid: 'X', target: 'B', guard: '[0,inf)', weight: '1' }],
      },
    ],
    ['unknown field', { colors: [] }],
  ])('rejects %s instead of flattening it', (_label, overrides) => {
    expect(code(() => parseNativeClipboard(native(overrides)))).toBe('unsupported');
  });

  it.each([
    ['missing list', JSON.stringify({ places: [] })],
    [
      'duplicate names',
      native({
        outputArc: [],
        inputArcs: [],
        transitions: [{ name: 'A', x: 0, y: 0, uncontrollable: false, urgent: false, rotation: 0 }],
      }),
    ],
    ['wrong arc direction', native({ outputArc: [{ source: 'A', target: 'X', weight: '1' }] })],
    ['zero weight', native({ outputArc: [{ source: 'X', target: 'B', weight: '0' }] })],
    [
      'negative tokens',
      native({ places: [{ name: 'A', x: 0, y: 0, tokens: -1, invariant: '< inf' }] }),
    ],
    [
      'nonnumeric coordinate',
      native({ places: [{ name: 'A', x: '0', y: 0, tokens: 0, invariant: '< inf' }] }),
    ],
    [
      'invalid name',
      native({
        places: [{ name: '<b>', x: 0, y: 0, tokens: 0, invariant: '< inf' }],
        inputArcs: [],
      }),
    ],
    ['duplicate arc', native({ inhibitorArc: [{ source: 'A', target: 'X', weight: '1' }] })],
  ])('rejects malformed payload: %s', (_label, text) => {
    expect(code(() => parseNativeClipboard(text))).toBe('malformed');
  });

  it('distinguishes non-TAPAAL text and oversized input', () => {
    expect(code(() => parseNativeClipboard('hello'))).toBe('not-tapaal');
    expect(code(() => parseNativeClipboard('{"a":1}'))).toBe('not-tapaal');
    expect(code(() => parseNativeClipboard('<pnml/>'))).toBe('not-tapaal');
    expect(code(() => parseNativeClipboard(' '.repeat(MAX_CLIPBOARD_TEXT + 1)))).toBe('too-large');
  });

  it('leaves a target net unchanged when a malformed payload is rejected', () => {
    const net = target();
    const before = structuredClone(net);
    expect(() =>
      pasteClipboard(
        net,
        parseNativeClipboard(native({ outputArc: [{ source: 'A', target: 'X', weight: '1' }] }))
          .content,
      ),
    ).toThrow(ClipboardError);
    expect(net).toEqual(before);
  });
});

describe('web clipboard envelope and source resolution', () => {
  it('round-trips web-only fields and fractional coordinates', () => {
    const net = source();
    net.nodes[0].x = 45.5;
    const copied = copySelection(net, SELECTED);
    expect(parseWebClipboard(copied.webText)).toEqual(copied.content);
    expect(JSON.parse(copied.nativeText).places[0].x).toBe(31);
  });

  it('rejects dangling arcs and unknown fields in the web envelope', () => {
    const envelope = JSON.parse(copySelection(source(), SELECTED).webText);
    const dangling = structuredClone(envelope);
    dangling.arcs[0].source = 'nowhere';
    expect(code(() => parseWebClipboard(JSON.stringify(dangling)))).toBe('malformed');
    const extra = structuredClone(envelope);
    extra.nodes[0].shared = true;
    expect(code(() => parseWebClipboard(JSON.stringify(extra)))).toBe('unsupported');
    const proto = JSON.stringify(envelope).replace('"format"', '"__proto__":{},"format"');
    expect(code(() => parseWebClipboard(proto))).toBe('unsupported');
  });

  it('prefers matching web data, then internal fallback, then native text', () => {
    const copied = copySelection(source(), SELECTED);
    expect(readClipboard({ webText: copied.webText, text: copied.nativeText }).source).toBe('web');
    expect(readClipboard({ text: copied.nativeText, internal: copied }).source).toBe('internal');
    // Clipboard read denied or unavailable: the app's own copy still pastes.
    expect(readClipboard({ text: null, internal: copied }).source).toBe('internal');
    // Something else was copied since: the newer system text wins.
    const other = copySelection(source(), ['p']);
    const resolved = readClipboard({ text: other.nativeText, internal: copied });
    expect(resolved.source).toBe('native');
    expect(resolved.content.nodes).toHaveLength(1);
    // A stale web format is ignored when text/plain changed.
    expect(readClipboard({ webText: copied.webText, text: other.nativeText }).source).toBe(
      'native',
    );
    expect(code(() => readClipboard({}))).toBe('empty');
    expect(code(() => readClipboard({ text: 'shopping list', internal: copied }))).toBe(
      'not-tapaal',
    );
  });

  it('accepts the web envelope pasted as plain text', () => {
    const copied = copySelection(source(), SELECTED);
    expect(readClipboard({ text: copied.webText }).content).toEqual(copied.content);
  });
});

describe('explicit native arc selection', () => {
  it('preserves deselected internal arcs when requested, retaining helper defaults', () => {
    const net = source();
    expect(copySelection(net, ['p', 't']).content.arcs.map((a) => a.id)).toEqual(['in']);
    expect(copySelection(net, ['p', 't'], { selectedArcsOnly: true }).content.arcs).toEqual([]);
    expect(
      copySelection(net, ['p', 't', 'in'], { selectedArcsOnly: true }).content.arcs.map(
        (a) => a.id,
      ),
    ).toEqual(['in']);
    expect(
      cutSelection(net, ['p', 't'], { selectedArcsOnly: true }).clipboard.content.arcs,
    ).toEqual([]);
  });
  it.each(['hidden', 'rotation'])('rejects unsupported %s metadata before serializing', (field) => {
    const net = source();
    Object.assign(net.nodes[0], { [field]: 1 });
    expect(code(() => copySelection(net, ['p']))).toBe('unsupported');
  });
});

it('moves only explicitly selected arc bends with a node group', async () => {
  const { moveSelection } = await import('./selection');
  const net = source();
  const excluded = moveSelection(net, ['p', 't'], { x: 30, y: 30 });
  const included = moveSelection(net, ['p', 't', 'in'], { x: 30, y: 30 });
  expect(excluded.arcs[0].bends).toEqual(net.arcs[0].bends);
  expect(included.arcs[0].bends?.[0]).toMatchObject({ x: 110, y: 40 });
  expect(copySelection(net, ['p', 't'], { selectedArcsOnly: true }).content.arcs).toEqual([]);
});

describe('element layout clipboard', () => {
  it('carries positive and negative native rotations', () => {
    for (const angle of [-45, 45, 135, 270]) {
      const net = source();
      net.nodes[1].angle = angle;
      const payload = copySelection(net, ['t']);
      expect(JSON.parse(payload.nativeText).transitions[0].rotation).toBe(angle);
      expect(parseNativeClipboard(payload.nativeText).content.nodes[0].angle).toBe(angle);
      expect(parseWebClipboard(payload.webText).nodes[0].angle).toBe(angle);
    }
  });
  it('uses a lossless plain web envelope for notes and hidden names without internal state', () => {
    const net = source();
    net.nodes[1].angle = 45;
    net.nodes[1].nameVisible = false;
    net.annotations = [
      {
        id: 'note',
        text: '<tag>& literal',
        x: 300,
        y: 200,
        width: 120,
        height: 32,
        border: false,
        filled: false,
      },
    ];
    const payload = copySelection(net, ['t', 'note']);
    expect(JSON.parse(payload.nativeText).format).toBe('tapaal-web-clipboard');
    const content = readClipboard({ text: payload.nativeText }).content;
    expect(content).toEqual(payload.content);
    expect(parseWebClipboard(payload.webText)).toEqual(content);
    const pasted = pasteClipboard(target(), content);
    expect(pasted.net.nodes.at(-1)).toMatchObject({ angle: 45, nameVisible: false });
    expect(pasted.net.annotations![0]).toMatchObject({
      ...net.annotations[0],
      id: pasted.idMap['note'],
      x: 330,
      y: 230,
    });
    expect(pasted.selectedIds).toContain(pasted.idMap['note']);
  });
  it('cuts and pastes note-only selections and avoids annotation ID collisions', () => {
    const net = source();
    net.annotations = [{ id: 'web-4', text: 'Only note', x: 300, y: 200, width: 120, height: 32 }];
    const cut = cutSelection(net, ['web-4']);
    expect(cut.net.annotations).toBeUndefined();
    const content = parseNativeClipboard(cut.clipboard.nativeText).content;
    const destination = target();
    destination.annotations = net.annotations;
    const pasted = pasteClipboard(destination, content);
    expect(pasted.net.annotations).toHaveLength(2);
    expect(pasted.idMap['web-4']).not.toBe('web-4');
    expect(pasted.net.annotations![1]).toMatchObject({ text: 'Only note', x: 330 });
  });
  it('rejects malformed angles, visibility and annotation fields', () => {
    const net = source();
    net.annotations = [{ id: 'note', text: 'Note', x: 1, y: 2, width: 100, height: 16 }];
    const payload = copySelection(net, ['t', 'note']);
    for (const [group, key, value] of [
      ['nodes', 'angle', 1.5],
      ['nodes', 'nameVisible', 'false'],
      ['annotations', 'width', -1],
      ['annotations', 'html', '<script>'],
    ] as const) {
      const envelope = JSON.parse(payload.webText);
      envelope[group][0][key] = value;
      expect(() => parseWebClipboard(JSON.stringify(envelope))).toThrow();
    }
  });
});
