// @vitest-environment jsdom
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ElementRef } from '@angular/core';
import * as w from './editor-workspace';
import { DocumentSimulation } from './timed-ui';
import { sharedDraft, sharedPlaceCommand, adoptionDiffers } from './shared-places';
import { captureSharedQueries, SharedPlace } from './core/authored-shared';
import {
  serializeSharedJson,
  parseSharedJson,
  serializeSharedTapn,
  parseSharedTapn,
} from './core/shared-files';
import * as constants from './constants-editor';
import { App } from './app';
function fixture() {
  let doc = w.createTimedDocument({ name: 'Sharing', componentName: 'Main' });
  doc = w.commitComponentNet(doc, {
    name: 'Sharing',
    template: 'Main',
    nodes: [
      { id: 'p', kind: 'place', name: 'P', tokens: 2, x: 90, y: 90 },
      { id: 't', kind: 'transition', name: 'T', tokens: 0, x: 240, y: 90 },
      { id: 'q', kind: 'place', name: 'Q', tokens: 0, x: 390, y: 90 },
      { id: 'local', kind: 'place', name: 'Local', tokens: 1, x: 90, y: 240 },
    ],
    arcs: [
      { id: 'i', source: 'p', target: 't', kind: 'normal', weight: 1 },
      { id: 'o', source: 't', target: 'q', kind: 'normal', weight: 1 },
    ],
  });
  doc = w.setPlaceTokenAges(doc, 'p', ['1', '2']);
  doc = w.sharedTransact(doc, {
    kind: 'makeShared',
    componentId: doc.session.componentId,
    elementId: 'p',
    poolId: 'pool',
    name: 'Pool',
  });
  return doc;
}
const pool = (doc: w.NetworkDocument) => doc.network.shared.places[0];
describe('shared place workspace and UI contract', () => {
  it('keeps one source, symbolic pool values, independent geometry and exact whole-source history', () => {
    let doc = fixture();
    doc = constants.editDeclaration(doc, { name: 'Limit', value: '7' });
    const before = doc.network;
    doc = w.sharedTransact(doc, {
      kind: 'editPool',
      pool: {
        ...pool(doc),
        timing: {
          ages: ['1', '2'],
          invariant: { upper: { constantId: doc.network.constants[0].id }, upperClosed: true },
        },
      },
    });
    const member = w.sourceComponent(doc).net.nodes[0];
    expect(member).toEqual({ id: 'p', kind: 'place', x: 90, y: 90, sharedId: 'pool' });
    expect(w.sourceComponent(doc).timing!.ages).not.toHaveProperty('p');
    const source = doc.network;
    doc = w.copyComponent(doc, doc.session.componentId, 'Copy');
    doc = w.commitComponentNet(doc, {
      ...w.activeNet(doc),
      nodes: w
        .activeNet(doc)
        .nodes.map((n) => (n.id === 'p' ? { ...n, x: 600, nameOffsetY: 21 } : n)),
    });
    expect(doc.network.shared.places).toEqual(source.shared.places);
    expect(doc.network.components[0].net.nodes[0].x).toBe(90);
    expect(w.sourceComponent(doc).net.nodes[0]).toMatchObject({
      x: 600,
      sharedId: 'pool',
      nameOffsetY: 21,
    });
    expect(
      w.constantUses(doc.network, doc.network.constants[0].id).filter((u) => u.poolId),
    ).toHaveLength(1);
    expect(w.undoDocument(w.undoDocument(w.undoDocument(doc))).network).toBe(before);
    expect(w.redoDocument(w.undoDocument(doc)).network).toBe(doc.network);
  });
  it('refuses projected shared semantics, permits unrelated local/arc/layout edits and retains labels', () => {
    let doc = fixture();
    const render = w.activeNet(doc);
    expect(() =>
      w.commitComponentNet(doc, {
        ...render,
        nodes: render.nodes.map((n) => (n.id === 'p' ? { ...n, tokens: 99 } : n)),
      }),
    ).toThrow(/pool/i);
    doc = w.transact(doc, {
      kind: 'setWeightTerm',
      componentId: doc.session.componentId,
      arcId: 'i',
      term: 2,
    });
    doc = w.commitComponentNet(doc, {
      ...w.activeNet(doc),
      nodes: w.activeNet(doc).nodes.map((n) => (n.id === 'local' ? { ...n, tokens: 3 } : n)),
      annotations: [{ id: 'n', text: 'note', x: 3, y: 4, width: 90, height: 40 }],
    });
    expect(w.activeNet(doc).nodes.find((n) => n.id === 'local')!.tokens).toBe(3);
    expect(pool(doc).tokens).toBe(2);
    expect(
      w.useLabel(doc.network, {
        constantId: 'x',
        componentId: doc.session.componentId,
        elementId: 'i',
        field: 'weight',
      }),
    ).toContain('Pool → T');
  });
  it('requires explicit adoption, never sums tokens, detaches authored values under a fresh name', () => {
    let doc = fixture();
    const target = {
      kind: 'place' as const,
      componentId: doc.session.componentId,
      elementId: 'local',
    };
    let draft = { ...sharedDraft(doc.network, target), action: 'use' as const, poolId: 'pool' };
    // Native allows one occurrence per component; join in a different component.
    doc = w.addComponent(doc, 'Other');
    doc = w.commitComponentNet(doc, {
      ...w.activeNet(doc),
      nodes: [{ id: 'local', name: 'L', kind: 'place', tokens: 9, x: 90, y: 90 }],
    });
    target.componentId = doc.session.componentId;
    expect(adoptionDiffers(doc.network, target, 'pool')).toBe(true);
    expect(() => w.sharedTransact(doc, sharedPlaceCommand(doc.network, target, draft))).toThrow(
      /explicitly/,
    );
    doc = w.sharedTransact(
      doc,
      sharedPlaceCommand(doc.network, target, { ...draft, accept: true }),
    );
    expect(pool(doc).tokens).toBe(2);
    const source = doc.network;
    draft = sharedDraft(doc.network, target);
    expect(draft.name).toBe('Pool_local1');
    doc = w.sharedTransact(doc, sharedPlaceCommand(doc.network, target, draft));
    expect(w.sourceComponent(doc).net.nodes[0]).toMatchObject({ name: 'Pool_local1', tokens: 2 });
    expect(w.sourceComponent(doc).timing!.ages.local).toEqual(['1', '2']);
    expect(w.undoDocument(doc).network).toBe(source);
  });
  it('blocks protected conversions/detach/rename/delete, allows numeric edits; query removal is undoable', () => {
    let doc = fixture();
    doc = w.openNetworkDocument(
      {
        ...doc.network,
        savedQueries: w.unwrap(captureSharedQueries(doc.network, ['<query name="keep"/>'])),
      },
      { timed: true },
    );
    const before = doc.network;
    expect(() =>
      w.sharedTransact(doc, {
        kind: 'detach',
        componentId: doc.session.componentId,
        elementId: 'p',
        name: 'Fresh',
      }),
    ).toThrow(/protect/i);
    expect(() =>
      w.sharedTransact(doc, { kind: 'editPool', pool: { ...pool(doc), name: 'Renamed' } }),
    ).toThrow(/protect/i);
    doc = w.sharedTransact(doc, { kind: 'editPool', pool: { ...pool(doc), tokens: 3 } });
    expect(pool(doc).tokens).toBe(3);
    doc = w.removeSavedQueries(doc);
    doc = w.sharedTransact(doc, {
      kind: 'detach',
      componentId: doc.session.componentId,
      elementId: 'p',
      name: 'Fresh',
    });
    doc = w.sharedTransact(doc, { kind: 'deletePool', poolId: 'pool' });
    expect(doc.network.shared.places).toHaveLength(0);
    expect(w.undoDocument(w.undoDocument(w.undoDocument(w.undoDocument(doc)))).network).toBe(
      before,
    );
  });
  it('counts unused/inactive invariant uses once and rejects constant conflicts atomically', () => {
    let doc = constants.editDeclaration(fixture(), { name: 'Limit', value: '7' });
    const k = doc.network.constants[0];
    const unused: SharedPlace = {
      id: 'unused',
      name: 'Unused',
      tokens: 0,
      timing: { ages: [], invariant: { upper: { constantId: k.id }, upperClosed: false } },
    };
    doc = w.sharedTransact(doc, { kind: 'createPool', pool: unused });
    doc = w.setComponentActive(doc, doc.session.componentId, false);
    const use = w.constantUses(doc.network, k.id)[0];
    expect(use).toMatchObject({ poolId: 'unused', activeMemberCount: 0 });
    expect(w.useLabel(doc.network, use)).toContain('Shared place Unused');
    const before = doc;
    expect(() => constants.editDeclaration(doc, { id: k.id, name: 'Limit', value: '0' })).toThrow(
      /invariant/,
    );
    expect(doc).toBe(before);
    expect(new DocumentSimulation(doc.network).enabled).toEqual([]);
  });
  it('refuses shared occurrence or touching arc before transfer, copies unrelated symbolic subsets and retains pools on paste', () => {
    let doc = fixture();
    for (const selection of [['p'], ['i'], ['o', 'p']])
      expect(() => w.copySelection(doc, selection)).toThrow(/Shared place occurrences/);
    const payload = w.copySelection(doc, ['local']);
    expect(JSON.parse(payload.webText).version).toBe(2);
    const c = payload.content;
    const result = importNumericPaste(doc, c);
    expect(result.network.shared).toEqual(doc.network.shared);
    expect(w.undoDocument(result).network).toBe(doc.network);
    doc = constants.editDeclaration(doc, { name: 'K', value: '1' });
    doc = w.setPlaceInvariant(doc, 'local', {
      upper: { constantId: doc.network.constants[0].id },
      upperClosed: true,
    });
    const symbolic = w.copySelection(doc, ['local']);
    expect(JSON.parse(symbolic.webText).version).toBe(3);
    const pasted = w.pasteAuthoredSelection(
      doc,
      symbolic.content as import('./core/authored-clipboard').AuthoredClipboard,
    ).document;
    expect(pasted.network.shared).toEqual(doc.network.shared);
    expect(w.sourceComponent(pasted).timing!.invariants).toHaveProperty('local');
  });
  it('removes only an occurrence and its incident transport partner, retaining the global pool', () => {
    let doc = fixture();
    doc = w.transact(doc, {
      kind: 'editElement',
      componentId: doc.session.componentId,
      element: w.activeNet(doc).arcs[0],
      timing: { invariant: null, interval: null, ages: [], urgent: false, outputArc: 'o' },
    });
    const before = doc.network;
    doc = w.removeComponentElements(doc, ['p']);
    expect(w.sourceComponent(doc).net.arcs).toEqual([]);
    expect(w.sourceComponent(doc).timing!.transports).toEqual([]);
    expect(pool(doc).tokens).toBe(2);
    expect(w.undoDocument(doc).network).toBe(before);
  });
  it('uses physical totals, one exact global clock, inactive live occurrences and dormant pools; saves authored initial state midrun', () => {
    let doc = fixture();
    const first = doc.session.componentId;
    doc = w.copyComponent(doc, first, 'Inactive');
    const second = doc.session.componentId;
    doc = w.setComponentActive(doc, second, false);
    doc = w.sharedTransact(doc, {
      kind: 'createPool',
      pool: {
        id: 'dormant',
        name: 'Dormant',
        tokens: 1,
        timing: { ages: ['1'], invariant: { upper: '1', upperClosed: true } },
      },
    });
    const run = new DocumentSimulation(doc.network, () => 0);
    expect(run.totalTokens).toBe(5); // pool 2 + local 1 in each component + dormant 1
    run.delay('0.1');
    run.delay('0.2');
    expect(run.time).toBe('0.3');
    expect(run.ages('p', second)).toEqual(['1.3', '2.3']);
    expect(run.ages('local', second)).toEqual(['0']);
    run.fire(first, 't', 'oldest');
    expect(run.markingFor(second).p).toBe(1);
    expect(run.totalTokens).toBe(5);
    run.back();
    expect(run.markingFor(second).p).toBe(2);
    run.forward();
    expect(run.markingFor(second).p).toBe(1);
    const inputs = run.eligibleInputs({ componentId: first, elementId: 't' });
    expect(inputs[0].placeName).toBe('Pool');
    run.fire(first, 't', { mode: 'manual', bindings: { i: [inputs[0].tokens[0].id] } });
    expect(run.markingFor(second).p).toBe(0);
    expect(parseSharedJson(serializeSharedJson(doc.network)).network).toEqual(doc.network);
    expect(
      parseSharedTapn(serializeSharedTapn(doc.network)).network.shared.places.map((p) => p.tokens),
    ).toEqual([2, 1]);
    expect(() => run.assertRevision(w.renameDocument(doc, 'Changed').network)).toThrow(
      /revision changed/,
    );
    run.assertRevision(doc.network);
  });
  it('shows App pool constant conflicts including unused pools and retains source on failure', () => {
    let doc = constants.editDeclaration(fixture(), { name: 'Limit', value: '5' });
    const declaration = doc.network.constants[0];
    doc = w.sharedTransact(doc, {
      kind: 'createPool',
      pool: {
        id: 'unused',
        name: 'Unused',
        tokens: 0,
        timing: {
          ages: [],
          invariant: { upper: { constantId: declaration.id }, upperClosed: false },
        },
      },
    });
    const app = new App(),
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(app, { canvas: new ElementRef(svg) });
    app.workspace.set(w.openDocument(w.createWorkspace(), doc, { timed: true }));
    app.switchComponent(doc.session.componentId);
    const before = app.activeDocument()!.network;
    app.openConstant(declaration);
    app.saveConstant({ name: 'Limit', value: '0' });
    expect(app.constantError()).toContain('Shared place Unused / invariant');
    expect(app.activeDocument()!.network).toBe(before);
    app.closeConstant();
    app.deleteSharedPool('pool');
    expect(app.error()).toContain('occurrences');
    expect(app.activeDocument()!.network).toBe(before);
  });
  it('keeps oversized shared source saveable and gives an actionable execution capacity refusal; untimed pools have no delay', () => {
    let doc = w.createDocument({ name: 'Untimed' });
    doc = w.sharedTransact(doc, {
      kind: 'createPool',
      pool: { id: 'pool', name: 'Pool', tokens: 100001 },
    });
    expect(parseSharedJson(serializeSharedJson(doc.network)).network).toEqual(doc.network);
    expect(() => new DocumentSimulation(doc.network)).toThrow(/100000.*Reduce the initial marking/);
    doc = w.sharedTransact(doc, { kind: 'editPool', pool: { ...pool(doc), tokens: 1 } });
    const run = new DocumentSimulation(doc.network);
    expect(run.legalDelay).toBe('');
    expect(() => run.delay('1')).toThrow(/timed/);
    expect(run.time).toBe('0');
    expect(run.totalTokens).toBe(1);
  });
  it.each(['oldest', 'youngest', 'random'] as const)(
    'dispatches shared %s policy and replays exact choices',
    (policy) => {
      const doc = fixture(),
        run = new DocumentSimulation(doc.network, () => 0);
      run.fire(doc.session.componentId, 't', policy);
      const after = run.ages('p', doc.session.componentId);
      expect(after).toEqual(policy === 'oldest' ? ['1'] : ['2']);
      run.back();
      run.forward();
      expect(run.ages('p', doc.session.componentId)).toEqual(after);
    },
  );
  it('integrates App create/use/detach, stale draft guards and occurrence navigation without replacing source', () => {
    const app = new App();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(app, { canvas: new ElementRef(svg) });
    const original = app.activeDocument()!;
    app.openSharedPlace('idle');
    let dialog = app.sharedDialog()!;
    app.saveSharedPlace({ ...sharedDraft(original.network, dialog.target), name: 'Pool' });
    expect(app.poolForOccurrence('idle')?.name).toBe('Pool');
    expect(app.physicalTokens()).toBe(1);
    app.openSharedPool();
    dialog = app.sharedDialog()!;
    app.saveSharedPlace({
      ...sharedDraft(app.activeDocument()!.network, dialog.target),
      name: 'Unused',
      tokens: 2,
    });
    expect(app.activeDocument()!.network.shared.places).toHaveLength(2);
    app.openSharedPool('bad');
    const draft = sharedDraft(app.activeDocument()!.network, app.sharedDialog()!.target);
    app.undo();
    app.redo();
    app.saveSharedPlace({ ...draft, name: 'Stale' });
    expect(app.sharedError()).toContain('document changed');
    app.closeSharedDialog();
    app.openEditor('idle');
    expect(app.editingElement()).toBeNull();
    expect(app.sharedDialog()?.target.kind).toBe('place');
    app.saveSharedPlace(sharedDraft(app.activeDocument()!.network, app.sharedDialog()!.target));
    expect(app.poolForOccurrence('idle')).toBeUndefined();
    app.deleteSharedPool(app.activeDocument()!.network.shared.places[0].id);
    expect(app.activeDocument()!.network.shared.places.map((p) => p.name)).toEqual(['Unused']);
  });
});
import { pasteClipboard } from './core/clipboard';
import { pasteTiming } from './core/timed-clipboard';
function importNumericPaste(
  doc: w.NetworkDocument,
  content: ReturnType<typeof w.copySelection>['content'],
) {
  const result = pasteClipboard(
    w.activeNet(doc),
    content as import('./core/clipboard').ClipboardContent,
    { timedTarget: true },
  );
  return w.commitTimedComponent(
    doc,
    result.net,
    pasteTiming(
      w.numeric(doc.network).components[0].timing!,
      'timing' in content
        ? (content.timing as import('./core/documents').ComponentTiming)
        : undefined,
      result.idMap,
    ),
  );
}
