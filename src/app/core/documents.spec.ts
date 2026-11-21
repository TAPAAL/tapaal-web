import { describe, expect, it } from 'vitest';
import { Net } from './net';
import * as d from './documents';
import { SUPPORTED_MODEL_TYPE } from './model-types';

function legacy(): Net {
  return {
    name: 'A model title',
    template: 'First',
    nodes: [
      { id: 'p', name: 'P0', kind: 'place', x: 10, y: 20, tokens: 1 },
      { id: 't', name: 'T0', kind: 'transition', x: 100, y: 20, tokens: 0 },
    ],
    arcs: [
      {
        id: 'a',
        source: 'p',
        target: 't',
        kind: 'normal',
        weight: 1,
        bends: [{ x: 40, y: 80, curved: true }],
        curvedEnd: true,
      },
    ],
  };
}
function loaded(id = 'a') {
  return d.openNetworkDocument(d.networkFromLegacyNet(legacy()), { id, saved: true });
}
function move(doc: d.NetworkDocument, x: number) {
  const net = d.activeNet(doc);
  net.nodes[0].x = x;
  return d.commitComponentNet(doc, net);
}

describe('immutable document workspace', () => {
  it('keeps two documents histories, saved checkpoints and dirty states independent across switching', () => {
    let workspace = d.openDocument(d.openDocument(d.createWorkspace(), loaded('a')), loaded('b'));
    workspace = d.updateDocument(workspace, 'a', (doc) => move(doc, 30));
    workspace = d.updateDocument(workspace, 'b', (doc) => move(doc, 50));
    workspace = d.updateDocument(workspace, 'a', d.markSaved);
    workspace = d.switchDocument(workspace, 'a');
    expect(d.isDirty(d.getDocument(workspace))).toBe(false);
    workspace = d.updateDocument(workspace, 'a', d.undoDocument);
    expect(d.isDirty(d.getDocument(workspace))).toBe(true);
    expect(d.activeNet(d.getDocument(workspace)).nodes[0].x).toBe(10);
    const b = d.getDocument(workspace, 'b');
    expect(b.past).toHaveLength(1);
    expect(d.activeNet(b).nodes[0].x).toBe(50);
    expect(d.isDirty(b)).toBe(true);
    workspace = d.updateDocument(workspace, 'a', d.redoDocument);
    expect(d.isDirty(d.getDocument(workspace))).toBe(false);
    expect(() => d.closeDocument(workspace, 'b')).toThrow('unsaved changes');
    workspace = d.closeDocument(workspace, 'a');
    expect(workspace.activeDocumentId).toBe('b');
    expect(d.closeDocument(workspace, 'b', { discard: true })).toEqual(d.createWorkspace());
  });
  it('supports copy with overlapping local IDs/names, stable component IDs, rename/reorder/remove and undo', () => {
    const original = loaded(),
      first = original.session.componentId;
    let doc = d.copyComponent(original, first, 'Second');
    const second = doc.session.componentId;
    expect(second).not.toBe(first);
    expect(doc.network.components.map((item) => item.net.nodes[0].id)).toEqual(['p', 'p']);
    doc = move(doc, 200);
    expect(doc.network.components[0].net.nodes[0].x).toBe(10);
    doc = d.renameComponent(doc, second, 'Renamed');
    expect(doc.session.componentId).toBe(second);
    doc = d.reorderComponents(doc, [second, first]);
    expect(doc.network.components[0].id).toBe(second);
    const beforeRemove = doc.network;
    doc = d.removeComponent(doc, second);
    expect(doc.session.componentId).toBe(first);
    doc = d.undoDocument(doc);
    expect(doc.network).toEqual(beforeRemove);
    doc = d.undoDocument(doc);
    expect(doc.network.components.map((item) => item.id)).toEqual([first, second]);
    doc = d.undoDocument(doc);
    expect(doc.network.components[1].net.template).toBe('Second');
    doc = d.undoDocument(d.undoDocument(doc));
    expect(doc.network).toEqual(original.network);
    expect(d.isDirty(doc)).toBe(false);
  });
  it('validates every operation before changing state, requiring one component and one active', () => {
    const single = loaded(),
      first = single.session.componentId;
    expect(() => d.removeComponent(single, first)).toThrow('at least one component');
    expect(() => d.setComponentActive(single, first, false)).toThrow('At least one component');
    const two = d.addComponent(single, 'Second'),
      second = two.session.componentId;
    const doc = d.setComponentActive(two, second, false),
      before = structuredClone(doc);
    const badNet = d.activeNet(doc);
    badNet.nodes.push({ ...legacy().nodes[0], tokens: -1 });
    const invalid = [
      () => d.removeComponent(doc, first),
      () => d.setComponentActive(doc, first, false),
      () => d.renameComponent(doc, second, 'First'),
      () => d.renameComponent(doc, second, 'bad name'),
      () => d.reorderComponents(doc, [first, first]),
      () => d.reorderComponents(doc, [first, 'missing']),
      () => d.copyComponent(doc, 'missing', 'Third'),
      () => d.switchComponent(doc, 'missing'),
      () => d.commitComponentNet(doc, badNet),
      () => d.renameDocument(doc, ''),
    ];
    for (const operation of invalid) {
      expect(operation).toThrow();
      expect(doc).toEqual(before);
    }
    expect(d.activeNet(doc).template).toBe('Second'); // inactive can still be viewed/edited
    expect(d.removeComponent(doc, second).network.components).toHaveLength(1);
  });
  it('keeps view state outside persistent history/checkpoints, isolated by component and document', () => {
    let doc = d.markSaved(d.addComponent(loaded(), 'Second'));
    const second = doc.session.componentId,
      first = doc.network.components[0].id;
    const view = { viewport: { x: 20, y: 30, zoom: 150 }, selectedIds: ['p'] };
    const network = doc.network,
      history = doc.past;
    doc = d.setComponentView(doc, view);
    view.viewport.x = 999;
    view.selectedIds.push('t');
    doc = d.switchComponent(doc, first);
    expect(doc.network).toBe(network);
    expect(doc.past).toBe(history);
    expect(d.isDirty(doc)).toBe(false);
    expect(doc.session.views[second]).toEqual({
      viewport: { x: 20, y: 30, zoom: 150 },
      selectedIds: ['p'],
    });
    expect(doc.session.views[first]).toBeUndefined();
    expect(loaded('b').session.views).toEqual({});
    doc = d.undoDocument(d.removeComponent(doc, second));
    expect(doc.session.views[second].viewport.x).toBe(20);
  });
  it('clones every input/output and preserves optional unknown nested geometry in adapters/history/copies', () => {
    const net = { ...legacy(), futureGeometry: { labels: [{ x: 12 }] } };
    const network = d.networkFromLegacyNet(net);
    expect(d.legacyNetFromNetwork(network)).toEqual(net);
    let doc = d.openNetworkDocument(network, { saved: true });
    net.arcs[0].bends![0].x = 999;
    net.futureGeometry.labels[0].x = 999;
    expect(doc.network.components[0].net.arcs[0].bends![0].x).toBe(40);
    const output = d.legacyNetFromNetwork(network) as typeof net;
    expect(output.futureGeometry.labels[0].x).toBe(12);
    output.futureGeometry.labels[0].x = 888;
    const edit = d.activeNet(doc);
    edit.arcs[0].bends![0].x = 70;
    doc = d.commitComponentNet(doc, edit);
    edit.arcs[0].bends![0].x = 777;
    expect(d.activeNet(doc).arcs[0].bends![0].x).toBe(70);
    expect(d.activeNet(d.undoDocument(doc)).arcs[0].bends![0].x).toBe(40);
    doc = d.copyComponent(doc, doc.session.componentId, 'Copy');
    expect((d.activeNet(doc) as typeof net).futureGeometry.labels[0].x).toBe(12);
    expect(() => {
      doc.network.components[0].net.nodes[0].x = 888;
    }).toThrow();
    expect(() => {
      doc.network.components[1].net.arcs[0].bends![0].x = 888;
    }).toThrow();
  });
  it('refuses lossy or unsupported legacy saves and unsupported editable opens', () => {
    const doc = d.addComponent(loaded(), 'Second');
    expect(d.networkCapabilities(doc.network)).toEqual({
      editable: true,
      executable: true,
      reason: null,
    });
    expect(d.networkCapabilities(loaded().network)).toEqual({
      editable: true,
      executable: true,
      reason: null,
    });
    expect(() => d.legacyNetFromNetwork(doc.network)).toThrow('lose components');
    const base = loaded().network;
    const unsupported = {
      ...base,
      type: { ...SUPPORTED_MODEL_TYPE, timed: true },
      components: base.components.map((c) => ({ ...c, timing: d.emptyTiming() })),
    };
    expect(() => d.legacyNetFromNetwork(unsupported)).toThrow('Unsupported timed');
    expect(() => d.openNetworkDocument(unsupported)).toThrow('Unsupported timed');
    expect(d.networkCapabilities(unsupported)).toMatchObject({
      editable: false,
      executable: false,
    });
  });
  it('handles new unsaved documents, no-op commits, redo branching, and explicit name semantics', () => {
    expect(d.isDirty(d.createDocument({ name: 'Free form model title' }))).toBe(true);
    const initial = loaded();
    expect(d.commitComponentNet(initial, d.activeNet(initial))).toBe(initial);
    expect(d.undoDocument(initial)).toBe(initial);
    expect(d.redoDocument(initial)).toBe(initial);
    let doc = d.undoDocument(move(move(initial, 20), 30));
    expect(doc.future).toHaveLength(1);
    doc = move(doc, 40);
    expect(doc.future).toHaveLength(0);
    doc = d.renameDocument(d.addComponent(doc, 'Second'), 'New display title');
    expect(doc.network.components.map((item) => item.net.name)).toEqual([
      'New display title',
      'New display title',
    ]);
    const edit = d.activeNet(doc);
    edit.template = 'AccidentalRename';
    expect(() => d.commitComponentNet(doc, edit)).toThrow('Use renameDocument/renameComponent');
    expect(() =>
      d.createDocument({ name: 'Valid title', componentName: 'Invalid component' }),
    ).toThrow();
  });
  it('rejects duplicate document IDs and preserves the workspace on failed edits/switches', () => {
    const workspace = d.openDocument(d.createWorkspace(), loaded());
    expect(() => d.openDocument(workspace, loaded())).toThrow('already open');
    expect(() => d.switchDocument(workspace, 'missing')).toThrow('Unknown document');
    expect(() => d.updateDocument(workspace, 'a', (doc) => d.renameDocument(doc, ''))).toThrow();
    expect(d.getDocument(workspace).network.name).toBe('A model title');
  });
});

describe('timed component metadata', () => {
  function timedDoc() {
    let doc = d.createTimedDocument({ name: 'Timed', componentName: 'Clock', id: 't' });
    const net = d.activeNet(doc);
    net.nodes = [
      { id: 'p', name: 'P0', kind: 'place', x: 0, y: 0, tokens: 2 },
      { id: 'q', name: 'P1', kind: 'place', x: 200, y: 0, tokens: 0 },
      { id: 't', name: 'T0', kind: 'transition', x: 100, y: 0, tokens: 0 },
    ];
    net.arcs = [
      { id: 'in', source: 'p', target: 't', kind: 'normal', weight: 1 },
      { id: 'out', source: 't', target: 'q', kind: 'normal', weight: 1 },
    ];
    doc = d.commitComponentNet(doc, net);
    doc = d.setArcInterval(doc, 'in', {
      lower: '1',
      upper: '3',
      lowerClosed: false,
      upperClosed: true,
    });
    doc = d.setPlaceInvariant(doc, 'p', { upper: '5', upperClosed: true });
    doc = d.setTransport(doc, 'in', 'out');
    return d.setPlaceTokenAges(doc, 'p', ['0.1', '0']);
  }
  const timing = (doc: d.NetworkDocument) => doc.network.components[0].timing!;

  it('creates timed documents only through explicit opt-ins and keeps default gates untimed', () => {
    const doc = d.createTimedDocument({ name: 'Timed' });
    expect(doc.network.type).toEqual({
      timed: true,
      colored: false,
      game: false,
      stochastic: false,
    });
    expect(timing(doc)).toEqual(d.emptyTiming());
    expect(d.isDirty(doc)).toBe(true);
    expect(() => d.createDocument({ name: 'X', type: doc.network.type })).toThrow(
      'Unsupported timed',
    );
    expect(() => d.openNetworkDocument(doc.network)).toThrow('Unsupported timed');
    expect(() => d.openDocument(d.createWorkspace(), doc)).toThrow('Unsupported timed');
    let workspace = d.openDocument(d.createWorkspace(), doc, { timed: true });
    // An opened timed document stays editable; untimed documents cannot become timed by commit.
    workspace = d.updateDocument(workspace, doc.id, (current) => d.addComponent(current, 'Second'));
    expect(d.getDocument(workspace).network.components[1].timing).toEqual(d.emptyTiming());
    const untimed = d.createDocument({ name: 'Plain' });
    expect(() =>
      d.commitNetwork(untimed, { ...untimed.network, type: doc.network.type }),
    ).toThrow();
    expect(() => d.setArcInterval(untimed, 'a', null)).toThrow('requires a timed network');
    expect(untimed.network.components[0]).not.toHaveProperty('timing');
    expect(d.networkCapabilities(doc.network)).toMatchObject({
      editable: false,
      executable: false,
    });
  });
  it('records timing edits as undoable, frozen, fingerprinted network history', () => {
    const doc = timedDoc();
    expect(timing(doc)).toEqual({
      intervals: { in: { lower: '1', upper: '3', lowerClosed: false, upperClosed: true } },
      invariants: { p: { upper: '5', upperClosed: true } },
      urgent: [],
      transports: [{ inputArc: 'in', outputArc: 'out' }],
      ages: { p: ['0.1'] },
    });
    expect(Object.isFrozen(timing(doc).intervals['in'])).toBe(true);
    // Defaults are never stored, so restoring one returns to an equal fingerprint.
    const restored = d.setArcInterval(d.setArcInterval(d.markSaved(doc), 'in', null), 'in', {
      lower: '1',
      upper: '3',
      lowerClosed: false,
      upperClosed: true,
    });
    expect(d.isDirty(restored)).toBe(false);
    expect(
      timing(
        d.setArcInterval(doc, 'in', {
          lower: '0',
          upper: null,
          lowerClosed: true,
          upperClosed: false,
        }),
      ).intervals,
    ).toEqual({});
    expect(
      timing(d.setPlaceInvariant(doc, 'p', { upper: null, upperClosed: false })).invariants,
    ).toEqual({});
    const urgent = d.setTransitionUrgent(d.setArcInterval(doc, 'in', null), 't', true);
    expect(timing(urgent).urgent).toEqual(['t']);
    expect(timing(d.undoDocument(urgent)).urgent).toEqual([]);
    expect(timing(d.redoDocument(d.undoDocument(urgent))).urgent).toEqual(['t']);
    expect(timing(d.undoDocument(d.removeTransport(doc, 'out'))).transports).toHaveLength(1);
    expect(timing(d.removeTransport(doc, 'out')).transports).toEqual([]);
  });
  it('validates timing coherence and leaves the document untouched on refusal', () => {
    const doc = timedDoc();
    const refusals: [() => unknown, string][] = [
      [() => d.setTransitionUrgent(doc, 't', true), 'requires [0,inf) on every input arc'],
      [
        () =>
          d.setArcInterval(doc, 'out', {
            lower: '1',
            upper: null,
            lowerClosed: true,
            upperClosed: false,
          }),
        'input arc',
      ],
      [
        () =>
          d.setArcInterval(doc, 'in', {
            lower: '3',
            upper: '1',
            lowerClosed: true,
            upperClosed: true,
          }),
        'Empty or reversed',
      ],
      [() => d.setPlaceInvariant(doc, 'p', { upper: '0', upperClosed: false }), '< 0 is invalid'],
      [
        () => d.setPlaceInvariant(doc, 'p', { upper: '0.05', upperClosed: true }),
        'violates the invariant',
      ],
      [() => d.setPlaceTokenAges(doc, 'p', ['1e2']), 'plain decimal'],
      [() => d.setPlaceTokenAges(doc, 't', ['1']), 'Unknown place'],
      [() => d.setTransport(doc, 'in', 'out'), 'more than one transport'],
      [() => d.removeTransport(doc, 'missing'), 'not part of a transport'],
    ];
    for (const [edit, message] of refusals) expect(edit).toThrow(message);
    const weighted = d.activeNet(doc);
    weighted.arcs[0].weight = 2;
    expect(() => d.commitComponentNet(doc, weighted)).toThrow('equal weights');
    const inhibitor = d.activeNet(doc);
    inhibitor.arcs[0].kind = 'inhibitor';
    expect(() => d.commitComponentNet(doc, inhibitor)).toThrow();
    expect(doc.past).toHaveLength(5);
  });
  it('reconciles graph commits: additive defaults, orphan cleanup, no silent age or transport loss', () => {
    const doc = timedDoc();
    const added = d.activeNet(doc);
    added.nodes.push({ id: 'r', name: 'P2', kind: 'place', x: 0, y: 100, tokens: 4 });
    added.nodes[0].tokens = 3;
    const grown = d.commitComponentNet(doc, added);
    expect(timing(grown)).toEqual(timing(doc));
    expect(
      d
        .timedModelForNetwork(grown.network)
        .initial.filter((t) => t.place === 'r')
        .map((t) => t.age),
    ).toEqual(['0', '0', '0', '0']);
    const shrunk = d.activeNet(doc);
    shrunk.nodes[0].tokens = 0;
    expect(() => d.commitComponentNet(doc, shrunk)).toThrow('use setPlaceTokenAges');
    shrunk.nodes[0].tokens = 1;
    expect(timing(d.commitComponentNet(doc, shrunk)).ages).toEqual({ p: ['0.1'] });
    const half = d.activeNet(doc);
    half.nodes = half.nodes.filter((n) => n.id !== 'q');
    half.arcs = half.arcs.filter((a) => a.id !== 'out');
    expect(() => d.commitComponentNet(doc, half)).toThrow('Deleting one half of transport');
    // Cascading delete removes the partner half and all timing of removed elements in one step.
    const removed = d.removeComponentElements(doc, ['q']);
    expect(d.activeNet(removed).arcs).toEqual([]);
    expect(timing(removed)).toEqual({
      ...d.emptyTiming(),
      invariants: timing(doc).invariants,
      ages: timing(doc).ages,
    });
    expect(timing(d.undoDocument(removed))).toEqual(timing(doc));
    expect(timing(d.removeComponentElements(doc, ['p'])).ages).toEqual({});
  });
  it('sets token counts with exact ages and copies/renames timing with components', () => {
    let doc = d.setPlaceTokenAges(timedDoc(), 'p', ['0', '4.75', '0.25', '0']);
    expect(d.activeNet(doc).nodes[0].tokens).toBe(4);
    expect(timing(doc).ages).toEqual({ p: ['4.75', '0.25'] });
    doc = d.setPlaceTokenAges(doc, 'p', []);
    expect(d.activeNet(doc).nodes[0].tokens).toBe(0);
    expect(timing(doc).ages).toEqual({});
    doc = d.copyComponent(doc, doc.network.components[0].id, 'Copy');
    expect(doc.network.components[1].timing).toEqual(timing(doc));
    doc = d.renameComponent(
      d.renameDocument(doc, 'Renamed title'),
      doc.network.components[0].id,
      'Clock2',
    );
    expect(doc.network.components[0].timing).toEqual(doc.network.components[1].timing);
  });
  it('adapts exactly one supported timed component to TimedModel and nothing else', () => {
    const doc = timedDoc();
    const model = d.timedModelForNetwork(doc.network);
    expect(model.net).toEqual(d.activeNet(doc));
    expect(model.net).not.toBe(doc.network.components[0].net);
    expect(model.transports).toEqual([{ inputArc: 'in', outputArc: 'out' }]);
    expect(model.initial).toEqual([
      { id: 'initial:p:0', place: 'p', age: '0.1' },
      { id: 'initial:p:1', place: 'p', age: '0' },
    ]);
    expect(() => d.timedModelForNetwork(d.addComponent(doc, 'Other').network)).toThrow(
      'exactly one component',
    );
    expect(() => d.timedModelForNetwork(d.createDocument({ name: 'Plain' }).network)).toThrow(
      'untimed',
    );
    expect(() =>
      d.timedModelForNetwork({ ...doc.network, type: { ...doc.network.type, game: true } }),
    ).toThrow('does not support game');
    const many = d.setPlaceTokenAges(doc, 'p', Array(100_001).fill('0'));
    expect(() => d.timedModelForNetwork(many.network)).toThrow('at most 100000 initial tokens');
  });
});
