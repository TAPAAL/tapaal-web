// @vitest-environment jsdom
import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { ElementRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import * as editor from './constants-editor';
import * as workspace from './editor-workspace';
const scalar = readFileSync(
  'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn',
  'utf8',
);
const webserver = readFileSync('../src/main/resources/Example nets/webserver.tapn', 'utf8');
function inputFile(text: string | Promise<string>): Event {
  return {
    target: {
      files: [{ name: 'model.tapn', size: 100, text: () => Promise.resolve(text) }],
      value: 'model.tapn',
    },
  } as unknown as Event;
}
describe('constants App integration', () => {
  let app: App;
  let canvas: SVGSVGElement;
  beforeEach(async () => {
    vi.useFakeTimers();
    app = new App();
    canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(canvas);
    Object.assign(app, { canvas: new ElementRef(canvas) });
    await app.openFile(inputFile(scalar));
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    canvas.remove();
    vi.unstubAllGlobals();
  });
  it('opens the real native webserver without repairs and runs resolved values', async () => {
    await app.openFile(inputFile(webserver));
    expect(app.pending()).toBeNull();
    expect(app.error()).toBe('');
    expect(app.activeDocument()!.network.constants).toHaveLength(4);
    expect(app.savedQueryNames()).toEqual(['5 responses, no drops']);
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    app.delayAmount.set('0.25');
    app.delay();
    expect(app.globalTime()).toBe('0.25');
    expect(app.activeDocument()!.network.components[0].timing!.ages).toEqual({});
  });
  it('keeps invalid declaration edits open and leaves source/history untouched', () => {
    const original = app.activeDocument()!;
    app.openConstant(original.network.constants.find((c) => c.name === 'K')!);
    app.saveConstant({ name: 'K', value: '0' });
    expect(app.constantDraft()).not.toBeNull();
    expect(app.constantError()).toMatch(/Uses:/);
    expect(app.activeDocument()).toBe(original);
    app.saveConstant({ name: 'Batch', value: '3' });
    expect(app.constantDraft()).toBeNull();
    expect(app.activeDocument()!.past).toHaveLength(1);
    expect(app.weightText(app.net().arcs[0])).toBe('Batch');
    app.undo();
    expect(app.activeDocument()!.network).toBe(original.network);
    app.redo();
    expect(app.weightText(app.net().arcs[0])).toBe('Batch');
  });
  it('refuses stale constant/property drafts even after source identity ABA', () => {
    const doc = app.activeDocument()!,
      k = doc.network.constants[0];
    app.openConstant(k);
    app.editDocument('name', { target: { value: 'Changed' } } as unknown as Event);
    app.undo();
    expect(app.activeDocument()!.network).toBe(doc.network);
    app.saveConstant({ name: k.name, value: '3' });
    expect(app.constantError()).toMatch(/changed/);
    expect(app.activeDocument()!.network).toBe(doc.network);
    app.closeConstant();
    app.openEditor('in');
    const element = app.editingElement()!;
    const timing = app.editorTiming()!;
    app.editDocument('name', { target: { value: 'Changed' } } as unknown as Event);
    app.undo();
    app.applyAuthoredElement({ element, weightText: '3', timing });
    expect(app.dialogError()).toMatch(/changed/);
  });
  it('closes constant, element and component dialogs on tab switches', () => {
    const original = app.documents()[0].id;
    app.openConstant(app.activeDocument()!.network.constants[0]);
    app.switchDocument(original);
    expect(app.constantDraft()).toBeNull();
    app.switchDocument(app.documents()[1].id);
    app.openEditor('in');
    app.switchDocument(original);
    expect(app.editingElement()).toBeNull();
    app.componentDialog('copy');
    app.switchDocument(app.documents()[1].id);
    expect(app.documentDialog()).toBeNull();
  });
  it('copies, pastes, duplicates and cuts symbolic selections without flattening, with numeric compatibility', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: { writeText, readText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    app.selectAll();
    const before = app.activeDocument()!;
    await app.clipboardAction('copy');
    expect(app.error()).toBe('');
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied.version).toBe(3);
    expect(copied.constants).toEqual(before.network.constants);
    expect(copied.fragment.arcs[0].weight).toEqual(before.network.components[0].net.arcs[0].weight);
    expect(app.notice()).toMatch(/desktop.*unavailable/);
    await app.clipboardAction('paste');
    expect(app.error()).toBe('');
    expect(app.net().nodes).toHaveLength(10);
    expect(app.activeDocument()!.network.constants).toEqual(before.network.constants);
    expect(app.activeDocument()!.past).toHaveLength(1);
    expect(app.activeDocument()!.network.components[0].net.arcs[5].weight).toEqual(
      copied.fragment.arcs[0].weight,
    );
    const allocatedNames = app
      .net()
      .nodes.slice(5)
      .map((n) => n.name);
    app.undo();
    expect(app.activeDocument()!.network).toBe(before.network);
    app.selectAll();
    app.duplicate();
    expect(app.net().nodes).toHaveLength(10);
    expect(
      app
        .net()
        .nodes.slice(5)
        .every((n) => !allocatedNames.includes(n.name)),
    ).toBe(true);
    await app.clipboardAction('cut');
    expect(app.net().nodes).toHaveLength(5);
    expect(app.activeDocument()!.network.constants).toEqual(before.network.constants);
    app.selectElement('b');
    await app.clipboardAction('copy');
    expect(JSON.parse(writeText.mock.calls.at(-1)![0]).version).toBe(2);
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(6);
    expect(app.weightText(app.net().arcs[0])).toBe('K');
  });
  it('cancels pending numeric fragment cut when a constant revision changes', async () => {
    let finish!: () => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      },
    });
    app.selectElement('b');
    const pending = app.clipboardAction('cut');
    app.openConstant(app.activeDocument()!.network.constants[0]);
    app.saveConstant({ name: 'K', value: '3' });
    finish();
    await pending;
    expect(app.net().nodes.some((n) => n.id === 'b')).toBe(true);
    expect(app.notice()).toMatch(/cancelled/);
  });
  it.each([
    'rename',
    'value',
    'selection',
    'selection ABA',
    'tab ABA',
    'undo ABA',
    'new operation',
  ])('cancels asynchronous symbolic cut on %s', async (race) => {
    let finish!: () => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () =>
          new Promise<void>((r) => {
            finish = r;
          }),
        readText: async () => 'unrelated',
      },
    });
    app.selectAll();
    const pending = app.clipboardAction('cut');
    const original = app.activeDocument()!;
    if (race === 'rename' || race === 'value') {
      app.openConstant(original.network.constants[0]);
      app.saveConstant({
        name: race === 'rename' ? 'Batch' : 'K',
        value: race === 'value' ? '3' : '2',
      });
    } else if (race.startsWith('selection')) {
      app.selectElement('b');
      if (race === 'selection ABA') app.selectAll();
    } else if (race === 'tab ABA') {
      app.switchDocument(app.documents()[0].id);
      app.switchDocument(original.id);
    } else if (race === 'undo ABA') {
      app.editDocument('name', { target: { value: 'Changed' } } as unknown as Event);
      app.undo();
    } else {
      // A later invalid action still supersedes the pending cut.
      await app.clipboardAction('paste');
    }
    const current = app.activeDocument()!,
      selection = [...app.selectedIds()];
    finish();
    await pending;
    expect(app.notice()).toMatch(/cancelled/);
    expect(app.activeDocument()).toBe(current);
    expect(app.activeDocument()!.network.components[0].net.nodes).toHaveLength(5);
    expect(app.selectedIds()).toEqual(selection);
  });
  it('cancels asynchronous symbolic paste on a same-value rename and undo ABA', async () => {
    let text = '',
      finish!: (text: string) => void;
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async (s: string) => {
          text = s;
        },
        readText: () =>
          new Promise<string>((r) => {
            finish = r;
          }),
      },
    });
    app.selectAll();
    await app.clipboardAction('copy');
    const pending = app.clipboardAction('paste');
    const before = app.activeDocument()!;
    app.openConstant(before.network.constants[0]);
    app.saveConstant({ name: 'Batch', value: '2' });
    app.undo();
    const current = app.activeDocument();
    finish(text);
    await pending;
    expect(app.notice()).toMatch(/cancelled/);
    expect(app.activeDocument()).toBe(current);
    expect(app.activeDocument()!.network).toBe(before.network);
  });
  it('keeps a recoverable symbolic copy after query-protected cut and duplicates without copying protections', async () => {
    await app.openFile(inputFile(webserver));
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
        readText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });
    app.selectAll();
    const before = app.activeDocument()!,
      selection = [...app.selectedIds()];
    await app.clipboardAction('cut');
    expect(app.error()).toMatch(/quer/i);
    expect(app.activeDocument()).toBe(before);
    expect(app.selectedIds()).toEqual(selection);
    await app.clipboardAction('paste');
    expect(app.error()).toBe('');
    expect(app.activeDocument()!.network.constants).toEqual(before.network.constants);
    expect(app.activeDocument()!.network.savedQueries).toEqual(before.network.savedQueries);
    expect(app.activeDocument()!.past.length).toBe(before.past.length + 1);
    await app.clipboardAction('cut');
    expect(app.error()).toBe('');
    expect(app.activeDocument()!.network.components[0].net.nodes).toEqual(
      before.network.components[0].net.nodes,
    );
  });
  it('pastes plain v3 in a fresh App and refuses a repeated cross-document collision atomically', async () => {
    let text = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async (s: string) => {
          text = s;
        },
        readText: async () => text,
      },
    });
    app.selectAll();
    await app.clipboardAction('copy');
    const receiver = new App(),
      destination = workspace.createTimedDocument({ name: 'Fresh' });
    receiver.workspace.set(
      workspace.openDocument(receiver.workspace(), destination, { timed: true }),
    );
    receiver.switchComponent(destination.session.componentId);
    await receiver.clipboardAction('paste');
    expect(receiver.error()).toBe('');
    expect(receiver.net().nodes).toHaveLength(5);
    const before = receiver.activeDocument(),
      selection = [...receiver.selectedIds()];
    await receiver.clipboardAction('paste');
    expect(receiver.error()).toMatch(/already declares/);
    expect(receiver.activeDocument()).toBe(before);
    expect(receiver.selectedIds()).toEqual(selection);
    receiver.undo();
    expect(receiver.activeDocument()!.network).toBe(destination.network);
    receiver.redo();
    expect(receiver.activeDocument()!.network).toBe(before!.network);
  });
  it('cancels delayed file opening after a workspace change', async () => {
    let resolve!: (text: string) => void;
    const pending = app.openFile(
      inputFile(
        new Promise<string>((r) => {
          resolve = r;
        }),
      ),
    );
    app.openConstant(app.activeDocument()!.network.constants[0]);
    app.saveConstant({ name: 'K', value: '3' });
    const before = app.workspace();
    resolve(webserver);
    await pending;
    expect(app.workspace()).toBe(before);
    expect(app.notice()).toMatch(/Open cancelled/);
  });
  it('does not flatten an untimed symbolic weight on inspector blur or unrelated property edit', () => {
    let doc = workspace.createDocument({ name: 'Untimed' });
    doc = workspace.commitComponentNet(doc, {
      ...workspace.activeNet(doc),
      nodes: [
        { id: 'p', name: 'P', kind: 'place', x: 0, y: 0, tokens: 1 },
        { id: 't', name: 'T', kind: 'transition', x: 100, y: 0, tokens: 0 },
      ],
      arcs: [{ id: 'a', source: 'p', target: 't', kind: 'normal', weight: 1 }],
    });
    doc = editor.editDeclaration(doc, { name: 'One', value: '1' });
    doc = editor.editElement(doc, {
      element: workspace.activeNet(doc).arcs[0],
      weightText: 'One',
      timing: null,
    });
    app.workspace.set(workspace.openDocument(app.workspace(), doc));
    app.switchComponent(doc.session.componentId);
    app.selectElement('a');
    // A normal view publication occurs through a component navigation.
    app.switchDocument(app.documents()[0].id);
    app.switchDocument(doc.id);
    app.selectElement('a');
    const before = app.activeDocument()!.network;
    app.editArc('weight', { target: { value: 'One' } } as unknown as Event);
    expect(app.activeDocument()!.network).toBe(before);
    app.openEditor('a');
    app.applyAuthoredElement({
      element: { ...app.net().arcs[0], kind: 'inhibitor' },
      weightText: 'One',
      timing: null,
    });
    expect(app.weightText(app.net().arcs[0])).toBe('One');
  });
});
