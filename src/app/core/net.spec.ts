import { describe, expect, it } from 'vitest';
import {
  fireTransition,
  initialMarking,
  isEnabled,
  NetEditor,
  Simulation,
  validateNet,
  type Net,
} from './net';

function example(): Net {
  return {
    name: 'Weighted choice',
    template: 'Main',
    nodes: [
      { id: 'p', kind: 'place', name: 'Input', x: 0, y: 0, tokens: 3 },
      { id: 'q', kind: 'place', name: 'Output', x: 100, y: 0, tokens: 0 },
      { id: 't', kind: 'transition', name: 'Move', x: 50, y: 0, tokens: 0 },
      { id: 'u', kind: 'transition', name: 'Return', x: 50, y: 100, tokens: 0 },
    ],
    arcs: [
      { id: 'a', source: 'p', target: 't', kind: 'normal', weight: 2 },
      { id: 'b', source: 't', target: 'q', kind: 'normal', weight: 3 },
      { id: 'c', source: 'q', target: 'u', kind: 'normal', weight: 1 },
      { id: 'd', source: 'u', target: 'p', kind: 'normal', weight: 1 },
    ],
  };
}

describe('untimed execution', () => {
  it('uses input/output weights and preserves the original marking', () => {
    const net = example(),
      marking = initialMarking(net);
    expect(isEnabled(net, marking, 't')).toBe(true);
    expect(fireTransition(net, marking, 't')).toEqual({ p: 1, q: 3 });
    expect(marking).toEqual({ p: 3, q: 0 });
    expect(isEnabled(net, { p: 1, q: 0 }, 't')).toBe(false);
    expect(() => fireTransition(net, { p: 1, q: 0 }, 't')).toThrow();
    expect(isEnabled(net, marking, 'p')).toBe(false);
    expect(isEnabled(net, marking, 'missing')).toBe(false);
  });
  it('uses strict less-than for inhibitors and never consumes their tokens', () => {
    const net = example();
    net.arcs.push({ id: 'inhibit', source: 'q', target: 't', kind: 'inhibitor', weight: 2 });
    expect(isEnabled(net, { p: 3, q: 2 }, 't')).toBe(false);
    expect(isEnabled(net, { p: 3, q: 3 }, 't')).toBe(false);
    expect(fireTransition(net, { p: 3, q: 1 }, 't')).toEqual({ p: 1, q: 4 });
  });
  it('checks self-loops against pre-firing tokens', () => {
    const net = example();
    net.arcs = [
      { id: 'consume', source: 'p', target: 't', kind: 'normal', weight: 2 },
      { id: 'produce', source: 't', target: 'p', kind: 'normal', weight: 3 },
    ];
    expect(isEnabled(net, { p: 1, q: 0 }, 't')).toBe(false);
    expect(fireTransition(net, { p: 2, q: 0 }, 't')).toEqual({ p: 3, q: 0 });
  });
  it.each([false, true])(
    'preserves exact maximum-safe self-loop tokens with output-first = %s',
    (outputFirst) => {
      const net = example();
      net.arcs = [
        { id: 'consume', source: 'p', target: 't', kind: 'normal', weight: 2 },
        { id: 'produce', source: 't', target: 'p', kind: 'normal', weight: 2 },
      ];
      if (outputFirst) net.arcs.reverse();
      const marking = { p: Number.MAX_SAFE_INTEGER, q: 0 };
      expect(fireTransition(net, marking, 't')).toEqual(marking);
    },
  );
  it('returns the same exact result when input and output arcs are permuted', () => {
    const net = example();
    net.arcs = [
      { id: 'produce', source: 't', target: 'p', kind: 'normal', weight: 2 },
      { id: 'consume', source: 'p', target: 't', kind: 'normal', weight: 3 },
      { id: 'otherOutput', source: 't', target: 'q', kind: 'normal', weight: 1 },
    ];
    const marking = { p: Number.MAX_SAFE_INTEGER, q: 0 };
    const expected = { p: Number.MAX_SAFE_INTEGER - 1, q: 1 };
    expect(fireTransition(net, marking, 't')).toEqual(expected);
    net.arcs.reverse();
    expect(fireTransition(net, marking, 't')).toEqual(expected);
  });
  it('supports source transitions and rejects overflowing results without mutation', () => {
    const net = example();
    net.arcs = [{ id: 'produce', source: 't', target: 'p', kind: 'normal', weight: 1 }];
    expect(isEnabled(net, { p: 0, q: 0 }, 't')).toBe(true);
    expect(fireTransition(net, { p: 0, q: 0 }, 't')).toEqual({ p: 1, q: 0 });
    const marking = { p: Number.MAX_SAFE_INTEGER, q: 0 };
    expect(() => fireTransition(net, marking, 't')).toThrow(/safe integer/);
    expect(marking.p).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('document validation', () => {
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid weight %s',
    (weight) => {
      const net = example();
      net.arcs[0].weight = weight;
      expect(() => validateNet(net)).toThrow();
    },
  );
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid tokens %s',
    (tokens) => {
      const net = example();
      net.nodes[0].tokens = tokens;
      expect(() => validateNet(net)).toThrow();
    },
  );
  it.each(['', '1place', 'two words', 'a.b', 'true', 'FALSE'])(
    'rejects invalid node/template name %s',
    (name) => {
      const net = example();
      net.nodes[0].name = name;
      expect(() => validateNet(net)).toThrow();
      net.nodes[0].name = 'Valid';
      net.template = name;
      expect(() => validateNet(net)).toThrow();
    },
  );
  it('rejects duplicate IDs, names and edges, including mixed normal and inhibitor edges', () => {
    const ids = example();
    ids.arcs[0].id = ids.nodes[0].id;
    expect(() => validateNet(ids)).toThrow(/IDs/);
    const names = example();
    names.nodes[1].name = names.nodes[0].name;
    expect(() => validateNet(names)).toThrow(/already used/);
    const edges = example();
    edges.arcs.push({ ...edges.arcs[0], id: 'extra' });
    expect(() => validateNet(edges)).toThrow(/Duplicate arcs/);
    edges.arcs[4].kind = 'inhibitor';
    expect(() => validateNet(edges)).toThrow(/Duplicate arcs/);
  });
  it('permits arcs between the same place and transition in opposing directions', () => {
    const net = example();
    net.arcs.push({ id: 'returnLoop', source: 't', target: 'p', kind: 'normal', weight: 1 });
    expect(() => validateNet(net)).not.toThrow();
    net.arcs[0].kind = 'inhibitor';
    expect(() => validateNet(net)).not.toThrow();
  });
  it('rejects missing/same-kind endpoints, reversed inhibitors and transition tokens', () => {
    for (const target of ['missing', 'q']) {
      const net = example();
      net.arcs[0].target = target;
      expect(() => validateNet(net)).toThrow(/connect/);
    }
    const inhibitor = example();
    inhibitor.arcs[1].kind = 'inhibitor';
    expect(() => validateNet(inhibitor)).toThrow(/place to a transition/);
    const transition = example();
    transition.nodes[2].tokens = 1;
    expect(() => validateNet(transition)).toThrow(/Transitions/);
  });
});

describe('document history', () => {
  it('isolates constructor inputs, commit inputs and returned documents', () => {
    const original = example(),
      editor = new NetEditor(original);
    original.nodes[0].tokens = 99;
    const read = editor.model;
    read.nodes[0].tokens = 88;
    expect(editor.model.nodes[0].tokens).toBe(3);
    const edited = editor.model;
    edited.nodes[0].tokens = 4;
    editor.commit(edited);
    edited.nodes[0].tokens = 77;
    expect(editor.model.nodes[0].tokens).toBe(4);
    editor.undo();
    expect(editor.model.nodes[0].tokens).toBe(3);
    editor.redo();
    expect(editor.model.nodes[0].tokens).toBe(4);
  });
  it('tracks saved state through undo/redo and clears future on branching', () => {
    const editor = new NetEditor(example());
    editor.commit(editor.model);
    expect(editor.canUndo).toBe(false);
    const edit = editor.model;
    edit.name = 'Edited';
    editor.commit(edit);
    expect(editor.dirty).toBe(true);
    editor.markSaved();
    expect(editor.dirty).toBe(false);
    editor.undo();
    expect(editor.dirty).toBe(true);
    editor.redo();
    expect(editor.dirty).toBe(false);
    editor.undo();
    const branch = editor.model;
    branch.name = 'Branch';
    editor.commit(branch);
    expect(editor.canRedo).toBe(false);
    editor.replace(example());
    expect(editor.dirty).toBe(false);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
  });
  it('preserves the document/history when invalid commit or replacement fails', () => {
    const editor = new NetEditor(example()),
      invalid = editor.model;
    invalid.nodes[0].tokens = -1;
    expect(() => editor.commit(invalid)).toThrow();
    expect(() => editor.replace(invalid)).toThrow();
    expect(editor.model).toEqual(example());
    expect(editor.dirty).toBe(false);
    expect(editor.canUndo).toBe(false);
  });
});

describe('simulation history', () => {
  it('supports Back/Forward and replaces future trace after a new firing', () => {
    const simulation = new Simulation(example());
    expect(simulation.enabled).toEqual(['t']);
    expect(simulation.canBack).toBe(false);
    simulation.back();
    simulation.fire('t');
    simulation.fire('u');
    expect(simulation.marking).toEqual({ p: 2, q: 2 });
    simulation.back();
    expect(simulation.marking).toEqual({ p: 1, q: 3 });
    expect(simulation.canForward).toBe(true);
    simulation.forward();
    expect(simulation.cursor).toBe(2);
    simulation.back();
    simulation.back();
    simulation.fire('t');
    expect(simulation.trace).toHaveLength(2);
    expect(simulation.canForward).toBe(false);
    simulation.forward();
    expect(simulation.cursor).toBe(1);
  });
  it('isolates simulation and exported state, preserves initial document tokens and resets', () => {
    const net = example(),
      editor = new NetEditor(net),
      simulation = new Simulation(net);
    net.nodes[0].tokens = 99;
    simulation.fire('t');
    const marking = simulation.marking;
    marking.p = 99;
    const trace = simulation.trace;
    trace[0].marking.p = 99;
    expect(simulation.marking).toEqual({ p: 1, q: 3 });
    expect(editor.model.nodes[0].tokens).toBe(3);
    expect(editor.dirty).toBe(false);
    simulation.reset();
    expect(simulation.marking).toEqual({ p: 3, q: 0 });
    expect(simulation.trace).toEqual([{ transitionId: null, marking: { p: 3, q: 0 } }]);
    expect(simulation.cursor).toBe(0);
    expect(simulation.canForward).toBe(false);
  });
  it('preserves cursor and trace when a disabled transition is rejected', () => {
    const simulation = new Simulation(example());
    expect(() => simulation.fire('u')).toThrow(/not enabled/);
    expect(simulation.cursor).toBe(0);
    expect(simulation.trace).toHaveLength(1);
  });
});

describe('arc bend geometry validation', () => {
  it('accepts old arcs without geometry and arcs with typed bends', () => {
    const net = example();
    validateNet(net);
    net.arcs[0].bends = [{ x: -1e6, y: 1e6, curved: true }];
    net.arcs[0].curvedEnd = false;
    net.arcs[1].bends = [];
    expect(() => validateNet(net)).not.toThrow();
  });
  it.each([
    ['NaN coordinate', { bends: [{ x: NaN, y: 0, curved: false }] }],
    ['infinite coordinate', { bends: [{ x: 0, y: -Infinity, curved: false }] }],
    ['out-of-bounds coordinate', { bends: [{ x: 1e6 + 1, y: 0, curved: false }] }],
    ['string coordinate', { bends: [{ x: '1', y: 0, curved: false }] }],
    ['missing type', { bends: [{ x: 1, y: 0 }] }],
    ['null bend', { bends: [null] }],
    ['non-array bends', { bends: { x: 1, y: 2, curved: false } }],
    [
      'too many bends',
      { bends: Array.from({ length: 1001 }, () => ({ x: 0, y: 0, curved: false })) },
    ],
    ['non-boolean end type', { curvedEnd: 1 }],
  ])('rejects %s', (_label, geometry) => {
    const net = example();
    Object.assign(net.arcs[0], geometry);
    expect(() => validateNet(net)).toThrow(/Arc (bend|end)/);
  });
  it('treats bend edits as undoable document changes', () => {
    const editor = new NetEditor(example());
    const net = editor.model;
    net.arcs[0].bends = [{ x: 20, y: 40, curved: false }];
    editor.commit(net);
    expect(editor.dirty).toBe(true);
    editor.undo();
    expect(editor.model.arcs[0].bends).toBeUndefined();
  });
});
