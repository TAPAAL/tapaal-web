// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as workspace from './editor-workspace';
import * as editor from './constants-editor';
import {
  parseSharedTapn as parseAuthoredTapn,
  parseSharedJson as parseAuthoredJson,
  serializeSharedJson as serializeAuthoredJson,
  serializeSharedTapn as serializeAuthoredTapn,
} from './core/shared-files';
import {
  sharedConstantUses as constantUses,
  captureSharedQueries as captureAuthoredSavedQueries,
  sharedFromAuthored,
} from './core/authored-shared';
import { authoredDocumentFromNumeric } from './core/authored-documents';
import * as numeric from './core/documents';
import { serializeNetworkJson, parseNetworkJson } from './core/network-files';
import { DocumentSimulation } from './timed-ui';
import { rotateTransitions, setNodeNameVisible } from './core/element-layout';
import { copySelection, pasteClipboard } from './core/clipboard';
import { pasteTiming } from './core/timed-clipboard';
const scalar = readFileSync(
  'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn',
  'utf8',
);
const real = readFileSync('../src/main/resources/Example nets/webserver.tapn', 'utf8');
function open(text = scalar) {
  return workspace.openNetworkDocument(parseAuthoredTapn(text).network, {
    saved: true,
    timed: true,
  });
}
function declaration(doc: workspace.NetworkDocument, name: string) {
  return doc.network.constants.find((c) => c.name === name)!;
}
function change(doc: workspace.NetworkDocument, name: string, value: string, newName = name) {
  return editor.editDeclaration(doc, { id: declaration(doc, name).id, name: newName, value });
}
function element(doc: workspace.NetworkDocument, id: string) {
  return [...workspace.activeNet(doc).nodes, ...workspace.activeNet(doc).arcs].find(
    (e) => e.id === id,
  )!;
}
function edit(
  doc: workspace.NetworkDocument,
  id: string,
  weightText: string,
  draft = editor.timingDraft(doc, element(doc, id)),
) {
  return editor.editElement(doc, { element: element(doc, id), weightText, timing: draft });
}

describe('authored editor workspace Interface', () => {
  it('opens the unchanged real webserver, resolves a run and saves source including queries', () => {
    const doc = open(real),
      source = doc.network;
    expect(source.constants.map((c) => c.name)).toEqual(['deadline', 'min', 'periodA', 'periodB']);
    const simulation = new DocumentSimulation(source);
    expect(simulation.revision).not.toHaveProperty('constants');
    expect(simulation.revision).not.toHaveProperty('savedQueries');
    expect(source.savedQueries?.xml.length).toBeGreaterThan(0);
    const json = serializeAuthoredJson(source);
    expect(JSON.parse(json).version).toBe(3);
    expect(JSON.parse(json).network.shared).toEqual({ places: [], transitions: [] });
    expect(parseAuthoredJson(json).network).toEqual(source);
    expect(
      parseAuthoredTapn(serializeAuthoredTapn(source)).network.constants.map((c) => [
        c.name,
        c.value,
      ]),
    ).toEqual(source.constants.map((c) => [c.name, c.value]));
    expect(doc.network).toBe(source);
  });
  it('validates inactive uses and preserves all identities on failure; one undo restores exact terms', () => {
    let doc = open();
    doc = workspace.copyComponent(doc, doc.session.componentId, 'Inactive');
    doc = workspace.setComponentActive(doc, doc.session.componentId, false);
    doc = workspace.setPlaceTokenAges(doc, 'p', ['3']);
    const before = doc;
    expect(() => change(doc, 'D', '2')).toThrow(/Uses:.*invariant/);
    expect(doc).toBe(before);
    doc = change(doc, 'D', '4');
    expect(doc.past).toHaveLength(before.past.length + 1);
    expect(workspace.undoDocument(doc).network).toBe(before.network);
    expect(workspace.redoDocument(workspace.undoDocument(doc)).network).toBe(doc.network);
    expect(workspace.sourceComponent(doc).timing!.ages).toEqual({ p: ['3'] });
  });
  it('no-op property edits preserve ordered urgency and transport lists with redo available', () => {
    const source = open().network;
    const component = source.components[0];
    const doc = workspace.openNetworkDocument(
      {
        ...source,
        components: [
          {
            ...component,
            timing: {
              ...component.timing!,
              intervals: {},
              urgent: ['t', 'o'],
              transports: [
                { inputArc: 'ti', outputArc: 'to' },
                { inputArc: 'in', outputArc: 'out' },
              ],
            },
          },
        ],
      },
      { timed: true },
    );
    const undone = workspace.undoDocument(change(doc, 'K', '3'));
    expect(edit(undone, 't', '')).toBe(undone);
    expect(edit(undone, 'ti', 'K')).toBe(undone);
    expect(undone.future).toHaveLength(1);
  });
  it('renames stable bindings, refuses in-use deletion, and distinguishes saved-query protection', () => {
    let doc = open();
    const k = declaration(doc, 'K');
    doc = change(doc, 'K', '2', '_Batch');
    expect(declaration(doc, '_Batch').id).toBe(k.id);
    expect(editor.termText(doc.network, workspace.sourceComponent(doc).net.arcs[0].weight)).toBe(
      '_Batch',
    );
    expect(() => workspace.transact(doc, { kind: 'deleteConstant', id: k.id })).toThrow(
      /still in use/,
    );
    const query = workspace.unwrap(
      captureAuthoredSavedQueries(doc.network, ['<query name="keep"/>']),
    );
    doc = workspace.openNetworkDocument({ ...doc.network, savedQueries: query }, { timed: true });
    expect(() => change(doc, '_Batch', '2', 'Other')).toThrow(/Saved queries protect/);
    doc = change(doc, '_Batch', '3');
    expect(doc.network.savedQueries).toEqual(query);
    expect(
      constantUses(doc.network, k.id).filter((u) => u.field === 'saved-query-protection'),
    ).toHaveLength(1);
    const protectedSource = doc.network;
    doc = workspace.removeSavedQueries(doc);
    doc = change(doc, '_Batch', '3', 'Other');
    expect(workspace.undoDocument(workspace.undoDocument(doc)).network).toBe(protectedSource);
  });
  it('no-op declaration/property edits keep future and saved snapshot identities', () => {
    const doc = open(),
      changed = change(doc, 'K', '3'),
      undone = workspace.undoDocument(changed);
    expect(change(undone, 'K', '2')).toBe(undone);
    expect(edit(undone, 'ti', 'K')).toBe(undone);
    expect(undone.saved).toBe(doc.saved);
    expect(undone.future[0]).toBe(changed.network);
  });
  it.each(['ti', 'to', 'in', 'out', 'inh'])(
    'sets a symbolic weight on %s with pairing and geometry intact',
    (id) => {
      let doc = open();
      const source = workspace.sourceComponent(doc);
      doc = edit(doc, id, '3');
      doc = edit(doc, id, 'K');
      expect(workspace.sourceComponent(doc).net.arcs.find((a) => a.id === id)?.weight).toEqual({
        constantId: declaration(doc, 'K').id,
      });
      expect(workspace.sourceComponent(doc).net.arcs).toEqual(source.net.arcs);
      expect(workspace.sourceComponent(doc).timing).toEqual(source.timing);
    },
  );
  it('retains symbolic zero guards, edits both bounds and rejects arithmetic and urgent symbolic guards', () => {
    let doc = open();
    doc = edit(doc, 'ti', 'K', {
      ...editor.timingDraft(doc, element(doc, 'ti')),
      interval: '[Zero,inf)',
    });
    expect(workspace.sourceComponent(doc).timing!.intervals.ti.lower).toEqual({
      constantId: declaration(doc, 'Zero').id,
    });
    expect(workspace.numeric(doc.network).components[0].timing!.intervals).not.toHaveProperty('ti');
    expect(() => workspace.setTransitionUrgent(doc, 't', true)).toThrow(/Symbolic urgent input/);
    expect(() => edit(doc, 'ti', 'K + 1')).toThrow(/Arithmetic/);
    expect(() =>
      edit(doc, 'ti', 'K', { ...editor.timingDraft(doc, element(doc, 'ti')), interval: '[D,K]' }),
    ).toThrow();
    doc = edit(doc, 'ti', 'K', {
      ...editor.timingDraft(doc, element(doc, 'ti')),
      interval: '[K,D]',
    });
    expect(editor.timingDraft(doc, element(doc, 'ti')).interval).toBe('[K,D]');
  });
  it('edits invariant, marking/ages, urgency, kind and pairing atomically without flattening other fields', () => {
    let doc = open();
    doc = editor.editElement(doc, {
      element: { ...element(doc, 'p'), tokens: 4 } as import('./core/net').NetNode,
      weightText: '',
      timing: { ...editor.timingDraft(doc, element(doc, 'p')), invariant: '< D', ages: '0.1, 2.5' },
    });
    expect(editor.timingDraft(doc, element(doc, 'p')).invariant).toBe('< D');
    expect(workspace.sourceComponent(doc).timing!.ages.p).toEqual(['0.1', '2.5']);
    const before = doc.network;
    doc = edit(doc, 'ti', 'K', {
      ...editor.timingDraft(doc, element(doc, 'ti')),
      outputArc: '',
      interval: '[0,inf)',
    });
    doc = workspace.setTransitionUrgent(doc, 't', true);
    expect(workspace.sourceComponent(doc).timing!.urgent).toContain('t');
    expect(workspace.undoDocument(workspace.undoDocument(doc)).network).toBe(before);
    const arc = workspace.activeNet(doc).arcs.find((a) => a.id === 'inh')!;
    doc = editor.editElement(doc, {
      element: { ...arc, kind: 'normal' },
      weightText: 'K',
      timing: editor.timingDraft(doc, arc),
    });
    expect(workspace.sourceComponent(doc).net.arcs.find((a) => a.id === 'inh')?.weight).toEqual({
      constantId: declaration(doc, 'K').id,
    });
  });
  it('preserves source terms through layout, notes, hidden names, rotation and same-document copy', () => {
    let doc = open(),
      net = workspace.activeNet(doc);
    net = rotateTransitions(setNodeNameVisible(net, ['p'], false), ['t'], 45);
    net = {
      ...net,
      nodes: net.nodes.map((n) => ({ ...n, x: n.x + 23 })),
      arcs: net.arcs.map((a) => ({ ...a, bends: [{ x: 90, y: 80, curved: true }] })),
      annotations: [{ id: 'note', text: 'Keep', x: 3, y: 4, width: 90, height: 40 }],
    };
    // A disposable projection's changed value is never interpreted as replacement intent.
    net.arcs[0].weight = 99;
    doc = workspace.commitComponentNet(doc, net);
    expect(workspace.sourceComponent(doc).net.arcs[0].weight).toEqual({
      constantId: declaration(doc, 'K').id,
    });
    const before = workspace.sourceComponent(doc);
    doc = workspace.copyComponent(doc, before.id, 'Clone');
    expect(workspace.sourceComponent(doc).timing).toEqual(before.timing);
    expect(workspace.sourceComponent(doc).net).toEqual({ ...before.net, template: 'Clone' });
  });
  it('changes enabling and legal delay on resolution, with fresh native AST and initial source saves', () => {
    let doc = open(),
      run = new DocumentSimulation(doc.network);
    expect(run.enabled.some((e) => e.elementId === 't')).toBe(true);
    run.delay('0.25');
    const saved = parseAuthoredJson(serializeAuthoredJson(doc.network)).network;
    expect(saved.components[0].timing!.ages).toEqual({});
    doc = change(doc, 'K', '4');
    run = new DocumentSimulation(doc.network);
    expect(run.enabled).toHaveLength(0);
    doc = change(doc, 'D', '7');
    expect(new DocumentSimulation(doc.network).legalDelay).toBe('[0,7]');
    const output = serializeAuthoredTapn(doc.network);
    expect(output).toContain('weight="K"');
    expect(output).toContain('numberconstant value="4"');
    expect(parseAuthoredTapn(output).network.components).toEqual(doc.network.components);
  });
  it('preserves symbol-bearing fragments and supports numeric fragments in a constants document', () => {
    let doc = open();
    const symbolic = workspace.copySelection(doc, ['p', 't', 'q', 'ti', 'to']);
    expect(JSON.parse(symbolic.webText).version).toBe(3);
    expect(JSON.parse(symbolic.webText).fragment.arcs[0].weight).toEqual({
      constantId: declaration(doc, 'K').id,
    });
    expect(JSON.parse(workspace.copySelection(doc, ['b']).webText).version).toBe(2);
    const payload = copySelection(workspace.activeNet(doc), ['b'], {
      timing: workspace.numeric(doc.network).components[0].timing,
      selectedArcsOnly: true,
    });
    const pasted = pasteClipboard(workspace.activeNet(doc), payload.content, { timedTarget: true });
    doc = workspace.commitTimedComponent(
      doc,
      pasted.net,
      pasteTiming(
        workspace.numeric(doc.network).components[0].timing!,
        payload.content.timing,
        pasted.idMap,
      ),
    );
    expect(doc.network.constants).toEqual(open().network.constants);
    expect(workspace.sourceComponent(doc).net.nodes).toHaveLength(6);
    expect(workspace.sourceComponent(doc).timing!.intervals).toEqual(
      open().network.components[0].timing!.intervals,
    );
  });
  it('migrates legacy current/saved/past/future and retains scalar history while V3 dispatch migrates files and numeric codecs stay gated', () => {
    let old = numeric.createDocument({ name: 'Legacy' });
    old = numeric.markSaved(old);
    old = numeric.renameDocument(old, 'Next');
    old = numeric.renameDocument(old, 'Third');
    old = numeric.undoDocument(numeric.undoDocument(old));
    const doc = workspace.unwrap(authoredDocumentFromNumeric(old));
    expect(doc.network.constants).toEqual([]);
    expect(doc.saved).toBe(doc.network);
    expect(doc.future).toHaveLength(2);
    const legacyFile = serializeNetworkJson(old.network);
    expect(parseAuthoredJson(legacyFile).network).toEqual(
      workspace.unwrap(sharedFromAuthored(doc.network)),
    );
    expect(() =>
      parseNetworkJson(serializeAuthoredJson(workspace.unwrap(sharedFromAuthored(doc.network)))),
    ).toThrow(/version/);
    expect(workspace.redoDocument(doc).network.name).toBe('Next');
    expect(workspace.redoDocument(workspace.redoDocument(doc)).network.name).toBe('Third');
  });
  it.each(['inf', 'bad name', '1Bad', 'K'])(
    'refuses invalid or duplicate declaration name %s',
    (name) => {
      expect(() => editor.editDeclaration(open(), { name, value: '1' })).toThrow();
    },
  );
  it.each(['-1', '2147483648', '1.5', '2+2'])('refuses declaration value %s', (value) => {
    expect(() => editor.editDeclaration(open(), { name: 'New', value })).toThrow();
  });
  it('supports an unused declaration and atomic deletion', () => {
    let doc = editor.editDeclaration(open(), { name: 'Inf', value: '2147483647' });
    const before = doc.network;
    doc = workspace.transact(doc, { kind: 'deleteConstant', id: declaration(doc, 'Inf').id });
    expect(doc.network.constants.some((c) => c.name === 'Inf')).toBe(false);
    expect(workspace.undoDocument(doc).network).toBe(before);
  });
});
