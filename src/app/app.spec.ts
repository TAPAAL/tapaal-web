// @vitest-environment jsdom
import '@angular/compiler';
import { ElementRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { parseModel, serializeJson, serializeTapn } from './core/files';
import {
  parseSharedModel as parseNetworkModel,
  serializeSharedJson as serializeNetworkJson,
} from './core/shared-files';
import * as docs from './editor-workspace';
import { captureSharedQueries as captureAuthoredSavedQueries } from './core/authored-shared';
const captureSavedQueries = (network: docs.Network, xml: readonly string[]) =>
  docs.unwrap(captureAuthoredSavedQueries(network, xml));
import { netArcGeometry } from './core/arc-geometry';

describe('canvas context actions', () => {
  let app: App;
  let svg: SVGSVGElement;

  beforeEach(() => {
    vi.useFakeTimers();
    app = new App();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('tabindex', '0');
    document.body.append(svg);
    Object.assign(app, { canvas: new ElementRef(svg) });
    vi.spyOn(app, 'point').mockImplementation(
      (event) => ({ x: event.clientX, y: event.clientY }) as DOMPoint,
    );
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    svg.remove();
  });

  function rightClick(id: string | null, x = 113, y = 157) {
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (id)
      target.setAttribute(
        app.net().nodes.some((node) => node.id === id) ? 'data-node' : 'data-arc',
        id,
      );
    svg.append(target);
    const event = new MouseEvent('contextmenu', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: target });
    Object.defineProperty(event, 'currentTarget', { value: svg });
    app.openContext(event);
    expect(event.defaultPrevented).toBe(true);
  }

  it('preserves a selected group when right-clicking a member, and selects an outside member', () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    rightClick('idle');
    expect(app.selectedIds()).toEqual(['idle', 'start', 'a1']);
    expect(app.contextActions().find((action) => action.id === 'delete')?.label).toBe(
      'Delete selection',
    );
    rightClick('done');
    expect(app.selectedIds()).toEqual(['done']);
  });

  it('opens an action menu without immediately opening the element editor', () => {
    rightClick('idle');
    expect(app.editingElement()).toBeNull();
    expect(app.context()?.id).toBe('idle');
    app.contextAction('edit');
    expect(app.context()).toBeNull();
    expect(app.editingElement()?.id).toBe('idle');
  });

  it('adds and removes initial tokens as undoable document edits', () => {
    rightClick('idle');
    app.contextAction('add-token');
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(2);
    expect(app.dirty()).toBe(true);
    rightClick('idle');
    app.contextAction('remove-token');
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(1);
    app.undo();
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(2);
    app.undo();
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(1);
    expect(app.dirty()).toBe(false);
  });

  it('disables removing a token at zero and does not expose place actions for transitions', () => {
    rightClick('busy');
    expect(app.contextActions().find((action) => action.id === 'remove-token')?.disabled).toBe(
      true,
    );
    rightClick('start');
    expect(app.contextActions().some((action) => action.id === 'add-token')).toBe(false);
  });

  it.each(['place', 'transition'] as const)(
    'creates a %s at the right-click position snapped to the grid',
    (kind) => {
      rightClick(null);
      app.contextAction(kind);
      const node = app.net().nodes.at(-1);
      expect(node).toMatchObject({ kind, x: 120, y: 150, tokens: 0 });
      expect(app.selectedIds()).toEqual([node?.id]);
      app.undo();
      expect(app.net().nodes).toHaveLength(6);
    },
  );

  it('disables firing a transition without input tokens and offers simulation actions only', () => {
    app.setMode('Simulate');
    rightClick('finish');
    expect(app.contextActions().find((action) => action.id === 'fire')?.disabled).toBe(true);
    expect(app.contextActions().some((action) => action.id === 'delete')).toBe(false);
    rightClick('start');
    expect(app.contextActions().find((action) => action.id === 'fire')?.disabled).toBe(false);
    app.contextAction('fire');
    expect(app.marking()['busy']).toBe(1);
    expect(app.cursor()).toBe(1);
    expect(app.net().nodes.find((node) => node.id === 'busy')?.tokens).toBe(0);
    expect(app.dirty()).toBe(false);
  });

  function openDisjointNetwork() {
    const original = app.activeDocument()!.network;
    const network = {
      ...original,
      components: ['A', 'B', 'Off'].map((id) => ({
        id,
        active: id !== 'Off',
        net: { ...structuredClone(original.components[0].net), template: id },
      })),
    };
    const doc = docs.openNetworkDocument(network, { saved: true });
    app.workspace.update((workspace) => docs.openDocument(workspace, doc));
    app.switchComponent('B');
    app.switchComponent('A');
    return app.activeDocument()!;
  }

  it('retains one network run across repeated local IDs and view switches, navigation, branching and reset', () => {
    const doc = openDisjointNetwork();
    app.selectElement('idle');
    app.setMode('Simulate');
    expect(app.enabledTransitions()).toEqual([
      { componentId: 'A', elementId: 'start' },
      { componentId: 'B', elementId: 'start' },
    ]);
    app.fireSelected();
    expect(app.marking()).toMatchObject({ idle: 0, busy: 1 });
    app.switchComponent('B');
    expect(app.mode()).toBe('Simulate');
    expect(app.cursor()).toBe(1);
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    app.fireSelected();
    expect(app.trace().map((state) => app.transitionName(state.transition))).toEqual([
      'Initial marking',
      'A.Start',
      'B.Start',
    ]);
    const history = app.trace();
    expect(app.markingText(history[2].marking)).toContain('A.Processing=1');
    expect(app.markingText(history[2].marking)).toContain('B.Processing=1');
    app.back();
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    app.switchComponent('A');
    expect(app.marking()).toMatchObject({ idle: 0, busy: 1 });
    expect(app.canForward()).toBe(true);
    app.step();
    expect(app.trace()).toEqual(history);
    app.jumpToMarking(0);
    app.fireEnabled({ componentId: 'B', elementId: 'start' });
    expect(app.trace()).toHaveLength(2);
    expect(app.trace()[1].transition).toEqual({ componentId: 'B', elementId: 'start' });
    expect(app.canForward()).toBe(false);
    app.switchComponent('B');
    expect(app.marking()).toMatchObject({ idle: 0, busy: 1 });
    app.resetSimulation();
    expect(app.trace()).toHaveLength(1);
    expect(app.cursor()).toBe(0);
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    expect(app.activeDocument()!.network).toEqual(doc.network);
    expect(app.activeDocument()!.past).toEqual(doc.past);
    expect(app.dirty()).toBe(false);
    app.setMode('Edit');
    app.switchComponent('A');
    expect(app.selectedIds()).toEqual(['idle']);
  });

  it('excludes inactive components without mistaking an inactive view for network deadlock', () => {
    openDisjointNetwork();
    app.setMode('Simulate');
    app.switchComponent('Off');
    expect(app.inactiveView()).toBe(true);
    expect(app.enabledIds()).toEqual([]);
    expect(app.deadlocked()).toBe(false);
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    rightClick('start');
    expect(app.contextActions().find((action) => action.id === 'fire')?.disabled).toBe(true);
    const history = app.trace();
    app.fire(app.transitions()[0]);
    expect(app.error()).toMatch(/inactive/);
    expect(app.trace()).toEqual(history);
    app.step();
    expect(app.cursor()).toBe(1);
    expect(app.trace()[1].transition?.componentId).toBe('A');
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    app.selectEnabled({ componentId: 'B', elementId: 'start' });
    expect(app.inactiveView()).toBe(false);
    expect(app.activeDocument()!.session.componentId).toBe('B');
    expect(app.selection()).toBe('start');
    expect(app.cursor()).toBe(1);
  });

  it('saves all initial components during simulation and ends the run on tab switches', () => {
    const doc = openDisjointNetwork();
    const contents: string[] = [];
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      'Blob',
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          contents.push(String(parts[0]));
        }
      },
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:simulation', revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      app.setMode('Simulate');
      app.fireSelected();
      app.switchComponent('B');
      app.fireSelected();
      for (const format of ['json', 'tapn'] as const) {
        app.save(format);
        const reopened = parseNetworkModel(contents.at(-1)!, `run.${format}`).network;
        if (format === 'json') expect(reopened).toEqual(doc.network);
        // TAPN derives component IDs from template names on import.
        expect(reopened.components.map(({ active, net }) => ({ active, net }))).toEqual(
          doc.network.components.map(({ active, net }) => ({ active, net })),
        );
        expect(app.mode()).toBe('Simulate');
        expect(app.cursor()).toBe(2);
      }
      const other = docs.createDocument({ name: 'Other' });
      app.workspace.update((workspace) => ({
        ...workspace,
        documents: [...workspace.documents, other],
      }));
      app.switchDocument(other.id);
      expect(app.mode()).toBe('Edit');
      expect(app.trace()).toEqual([]);
      app.switchDocument(doc.id);
      expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
      app.setMode('Simulate');
      expect(app.cursor()).toBe(0);
      expect(app.trace()).toHaveLength(1);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('preserves unsaved editing history and initial tokens when leaving a network run', () => {
    openDisjointNetwork();
    app.selectElement('idle');
    rightClick('idle');
    app.contextAction('add-token');
    const before = app.activeDocument()!;
    expect(app.dirty()).toBe(true);
    app.setMode('Simulate');
    app.fireSelected();
    app.switchComponent('B');
    app.fireSelected();
    app.setMode('Edit');
    expect(app.activeDocument()!.network).toEqual(before.network);
    expect(app.activeDocument()!.past).toEqual(before.past);
    expect(app.activeDocument()!.future).toEqual(before.future);
    expect(app.activeDocument()!.saved).toEqual(before.saved);
    expect(app.dirty()).toBe(true);
    app.switchComponent('A');
    expect(app.tokens(app.places()[0])).toBe(2);
    app.undo();
    expect(app.tokens(app.places()[0])).toBe(1);
    expect(app.dirty()).toBe(false);
  });

  it('ends a run when its document revision changes instead of migrating history', () => {
    const doc = openDisjointNetwork();
    app.setMode('Simulate');
    app.fireSelected();
    app.workspace.update((workspace) =>
      docs.updateDocument(workspace, doc.id, (current) => docs.renameDocument(current, 'Changed')),
    );
    app.step();
    expect(app.mode()).toBe('Edit');
    expect(app.trace()).toEqual([]);
    expect(app.marking()).toMatchObject({ idle: 1, busy: 0 });
    expect(app.notice()).toMatch(/revision changed/);
  });

  it('requires an explicit game transition choice and preserves game source while firing/replaying', () => {
    const doc = openDisjointNetwork();
    app.workspace.set({
      documents: [
        { ...doc, network: { ...doc.network, type: { ...doc.network.type, game: true } } },
      ],
      activeDocumentId: doc.id,
    });
    app.selectedIds.set([]);
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    app.step();
    expect(app.cursor()).toBe(0);
    expect(app.notice()).toMatch(/Choose a Controller or Environment/);
    app.selectEnabled({ componentId: 'A', elementId: 'start' });
    app.step();
    expect(app.cursor()).toBe(1);
    expect(app.activeDocument()!.network.type.game).toBe(true);
    app.back();
    app.step();
    expect(app.cursor()).toBe(1);
  });

  it.each(['timed', 'colored', 'stochastic'] as const)(
    'refuses explicit %s semantics at the execution boundary',
    (flag) => {
      const doc = openDisjointNetwork();
      // Bypass import/editor refusal to exercise execution's independent guard.
      app.workspace.set({
        documents: [
          { ...doc, network: { ...doc.network, type: { ...doc.network.type, [flag]: true } } },
        ],
        activeDocumentId: doc.id,
      });
      app.setMode('Simulate');
      expect(app.mode()).toBe('Edit');
      expect(app.trace()).toEqual([]);
      expect(app.error()).toMatch(
        flag === 'timed' ? /timing metadata/ : /Unsupported|Stochastic models require/,
      );
    },
  );

  it('deletes the selected group and its incident arcs as a single undoable edit', () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    rightClick('idle');
    app.contextAction('delete');
    expect(app.net().nodes.map((node) => node.id)).toEqual(['busy', 'finish', 'done', 'reset']);
    expect(app.net().arcs.map((arc) => arc.id)).toEqual(['a3', 'a4', 'a5']);
    expect(app.selectedIds()).toEqual([]);
    app.undo();
    expect(app.net().nodes).toHaveLength(6);
    expect(app.net().arcs).toHaveLength(6);
  });
  it('selects enabled transitions automatically and navigates history without firing new steps', () => {
    app.setMode('Simulate');
    expect(app.selectedIds()).toEqual(['start']);
    app.fireSelected();
    expect(app.selectedIds()).toEqual(['finish']);
    app.fireSelected();
    expect(app.selectedIds()).toEqual(['reset']);
    const history = app.trace();
    app.jumpToMarking(0);
    expect(app.cursor()).toBe(0);
    expect(app.marking()).toEqual(history[0].marking[app.activeDocument()!.session.componentId]);
    expect(app.canForward()).toBe(true);
    app.jumpToMarking(2);
    expect(app.marking()).toEqual(history[2].marking[app.activeDocument()!.session.componentId]);
    expect(app.trace()).toEqual(history);
    app.jumpToMarking(-1);
    app.jumpToMarking(100);
    expect(app.cursor()).toBe(2);
    expect(app.dirty()).toBe(false);
    app.setMode('Edit');
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(1);
  });

  function key(key: string, modifiers: KeyboardEventInit = {}, target: Element = svg) {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers });
    Object.defineProperty(event, 'target', { value: target });
    app.key(event);
    return event;
  }

  it('scrolls ordinary and horizontal wheel events, and uses native modifier zoom direction', () => {
    app.viewport.set({ x: 100, y: 50, zoom: 100 });
    const scroll = new WheelEvent('wheel', { deltaY: 40, cancelable: true });
    app.wheel(scroll);
    expect(scroll.defaultPrevented).toBe(true);
    expect(app.viewport()).toEqual({ x: 100, y: 90, zoom: 100 });
    app.wheel(new WheelEvent('wheel', { deltaY: 20, shiftKey: true }));
    expect(app.viewport()).toEqual({ x: 120, y: 90, zoom: 100 });
    app.wheel(new WheelEvent('wheel', { deltaX: 30 }));
    expect(app.viewport().x).toBe(150);
    app.wheel(new WheelEvent('wheel', { deltaY: 1, ctrlKey: true }));
    expect(app.zoom()).toBe(110);
    expect(app.viewport().x).toBeCloseTo(15000 / 110);
    app.wheel(new WheelEvent('wheel', { deltaY: -1, metaKey: true }));
    expect(app.zoom()).toBe(100);
    expect(app.dirty()).toBe(false);
    expect(app.canUndo()).toBe(false);
  });

  it('supports native shortcuts while preserving text and range input keyboard behavior', () => {
    key('p');
    expect(app.tool()).toBe('place');
    key('s');
    expect(app.tool()).toBe('select');
    expect(key('j', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(app.zoom()).toBe(110);
    key('k', { metaKey: true });
    expect(app.zoom()).toBe(100);
    key('g');
    expect(app.gridSpacing()).toBe(30);
    const input = document.createElement('input');
    input.type = 'range';
    expect(key('j', { ctrlKey: true }, input).defaultPrevented).toBe(false);
    expect(app.zoom()).toBe(100);
    key('g', {}, input);
    expect(app.gridSpacing()).toBe(30);
  });

  it('cycles snapping off and back on without changing the document or its undo history', () => {
    key('g');
    key('g');
    expect(app.gridSpacing()).toBe(0);
    expect(app.dirty()).toBe(false);
    rightClick(null, 113, 157);
    app.contextAction('place');
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 113, y: 157 });
    app.undo();
    expect(app.dirty()).toBe(false);
    key('g');
    expect(app.gridSpacing()).toBe(7.5);
    rightClick(null, 113, 157);
    app.contextAction('transition');
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 113, y: 158 });
  });

  it('fits and restores 100% with the native toggle shortcut', () => {
    app.canvasSize.set({ width: 800, height: 400 });
    key('F', { ctrlKey: true, shiftKey: true });
    expect(app.fitted()).toBe(true);
    expect(app.zoom()).toBeGreaterThanOrEqual(20);
    expect(app.zoom()).toBeLessThanOrEqual(300);
    key('F', { ctrlKey: true, shiftKey: true });
    expect(app.zoom()).toBe(100);
    expect(app.fitted()).toBe(false);
  });

  it('aligns all nodes with the native upper-left grid origin as one undoable edit', () => {
    const before = structuredClone(app.net());
    key('g'); // 30-unit grid
    key('G', { shiftKey: true });
    for (const node of app.net().nodes) {
      expect((node.x - 15) % 30).toBe(0);
      expect((node.y - 15) % 30).toBe(0);
    }
    expect(app.dirty()).toBe(true);
    app.undo();
    expect(app.net()).toEqual(before);
    expect(app.dirty()).toBe(false);
  });

  it('registers a cancellable wheel listener and removes it on destruction', () => {
    const observe = vi.fn(),
      disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callback(
            [{ contentRect: { width: 743, height: 426 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const add = vi.spyOn(svg, 'addEventListener');
    app.ngAfterViewInit();
    expect(app.canvasSize()).toEqual({ width: 743, height: 426 });
    expect(app.visible().width).toBe(743);
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: 10, cancelable: true });
    svg.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(app.zoom()).toBe(110);
    app.ngOnDestroy();
    svg.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 10 }));
    expect(app.zoom()).toBe(110);
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  function pointer(
    type: string,
    target: Element,
    x: number,
    y: number,
    button = 0,
    modifiers: MouseEventInit = {},
  ) {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button,
      cancelable: true,
      ...modifiers,
    });
    Object.defineProperties(event, {
      target: { value: target },
      currentTarget: { value: svg },
      pointerId: { value: 1 },
    });
    return event as PointerEvent;
  }

  function press(id: string | null, ctrlKey = false, x = 301, y = 92, button = 0, metaKey = false) {
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (id) target.setAttribute('data-node', id);
    svg.append(target);
    const event = pointer('pointerdown', target, x, y, button, { ctrlKey, metaKey });
    app.pointerDown(event);
    return event;
  }

  it('copies prototype-backed DOMPoint coordinates when updating the pending preview', () => {
    app.setTool('arc');
    press('idle');
    const point = Object.create({ x: 430, y: 310 }) as DOMPoint;
    vi.mocked(app.point).mockReturnValueOnce(point);
    app.pointerMove(pointer('pointermove', svg, 430, 310));
    expect(app.arcPointer()).toEqual({ x: 430, y: 310 });
    expect(app.prototypeArcPath()).toMatch(/^M /);
    expect(app.prototypeArcPath()).not.toContain('NaN');
  });

  it('lets focused text fields handle Delete and undo while an arc is pending', () => {
    app.setTool('arc');
    press('idle');
    const panel = document.createElement('div');
    panel.className = 'inspector';
    const input = document.createElement('input');
    panel.append(input);
    document.body.append(panel);
    expect(key('Delete', {}, input).defaultPrevented).toBe(false);
    expect(key('z', { ctrlKey: true }, input).defaultPrevented).toBe(false);
    expect(app.arcStart()).toBe('idle');
    expect(app.canUndo()).toBe(false);
    panel.remove();
  });

  it('Ctrl Quick Draw alternates nodes and undoes each arc before its node', () => {
    app.setTool('arc');
    press(null, true);
    const place = app.net().nodes.at(-1)!;
    expect(place).toMatchObject({ name: 'P0', kind: 'place', x: 300, y: 90 });
    expect(app.arcStart()).toBe(place.id);
    press(null, true, 450, 150);
    const transition = app.net().nodes.at(-1)!;
    expect(transition).toMatchObject({ name: 'T0', kind: 'transition' });
    expect(app.net().arcs.at(-1)).toMatchObject({ source: place.id, target: transition.id });
    expect(app.arcStart()).toBe(transition.id);
    app.undo();
    expect(app.net().nodes).toContainEqual(transition);
    expect(app.net().arcs).toHaveLength(6);
    app.undo();
    expect(app.net().nodes).not.toContainEqual(transition);
    app.redo();
    app.redo();
    expect(app.net().arcs).toHaveLength(7);
    press(transition.id, true);
    press(null, true, 600, 150);
    expect(app.net().nodes.at(-1)).toMatchObject({ kind: 'place', name: 'P1' });
  });

  it('chains existing nodes, ignores same-kind presses and completes without Ctrl', () => {
    app.setTool('arc');
    press('done');
    press('idle', true);
    expect(app.arcStart()).toBe('done');
    expect(app.canUndo()).toBe(false);
    press('start', true);
    expect(app.arcStart()).toBe('start');
    press('idle');
    expect(app.arcStart()).toBeNull();
    expect(app.net().arcs.at(-1)).toMatchObject({ source: 'start', target: 'idle' });
    app.undo();
    expect(app.net().arcs.at(-1)).toMatchObject({ source: 'done', target: 'start' });
  });

  it('rejects duplicates and still continues Ctrl chains after rejection', () => {
    app.setTool('arc');
    const before = app.net();
    press('idle');
    press('start');
    expect(app.error()).toContain('Duplicate');
    expect(app.arcStart()).toBeNull();
    expect(app.net()).toBe(before);
    press('idle');
    press('start', true);
    expect(app.arcStart()).toBe('start');
    expect(app.error()).toContain('Duplicate');
    expect(app.canUndo()).toBe(false);
  });

  it('inhibitors start only at places and terminate even with Ctrl held', () => {
    app.setTool('inhibitor');
    press('start');
    expect(app.arcStart()).toBeNull();
    press(null, true);
    const source = app.arcStart();
    press(null, true, 450, 150);
    expect(app.arcStart()).toBeNull();
    expect(app.net().arcs.at(-1)).toMatchObject({ source, kind: 'inhibitor' });
    app.undo();
    expect(app.net().nodes.at(-1)?.kind).toBe('transition');
  });

  it.each([
    ['Escape', {}],
    ['Delete', {}],
    ['z', { ctrlKey: true }],
    ['y', { ctrlKey: true }],
    ['z', { metaKey: true }],
    ['y', { metaKey: true }],
  ] as const)('cancels pending before global %s', (name, modifiers) => {
    app.setTool('arc');
    press(null, true);
    const before = app.net();
    expect(key(name, modifiers).defaultPrevented).toBe(true);
    expect(app.arcStart()).toBeNull();
    expect(app.net()).toBe(before);
    expect(app.canUndo()).toBe(true);
    expect(app.canRedo()).toBe(false);
    expect(app.tool()).toBe('arc');
    key('z', { ctrlKey: true });
    expect(app.net().nodes).toHaveLength(6);
  });

  it('cancels before redo even with redo history and a selected element', () => {
    app.setTool('place');
    press(null);
    app.undo();
    app.selectElement('idle');
    app.setTool('arc');
    press('idle');
    const before = app.net();
    const listener = (event: KeyboardEvent) => app.key(event);
    window.addEventListener('keydown', listener);
    try {
      svg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    } finally {
      window.removeEventListener('keydown', listener);
    }
    expect(app.arcStart()).toBeNull();
    expect(app.net()).toBe(before);
    expect(app.canRedo()).toBe(true);
    expect(app.selectedIds()).toEqual(['idle']);
    key('y', { ctrlKey: true });
    expect(app.net().nodes).toHaveLength(7);
  });

  it('reports a rejected warning-bearing import without changing the workspace', () => {
    const before = app.workspace();
    app.pending.set({
      network: {
        ...docs.networkFromLegacyNet(app.net()),
        type: { timed: false, colored: true, game: false, stochastic: false },
      },
      warnings: ['An arc ID was repaired.'],
      action: 'Open',
    });
    expect(() => app.acceptPending()).not.toThrow();
    expect(app.workspace()).toBe(before);
    expect(app.pending()).toBeNull();
    expect(app.error()).toContain('Unsupported colored');
  });
  it('seeds naming from replacement names and advances for manual renames', () => {
    app.pending.set({
      net: {
        name: 'Loaded',
        template: 'Net',
        nodes: [
          { id: 'p', kind: 'place', name: 'p99', x: 100, y: 100, tokens: 0 },
          { id: 't', kind: 'transition', name: 'T42', x: 200, y: 100, tokens: 0 },
        ],
        arcs: [],
      },
      warnings: [],
      action: 'Open',
    });
    app.acceptPending();
    app.selectElement('p');
    app.remove();
    app.setTool('arc');
    press(null, true);
    expect(app.net().nodes.at(-1)?.name).toBe('P100');
    press(null, true, 450, 150);
    expect(app.net().nodes.at(-1)?.name).toBe('T43');
    const node = app.net().nodes.at(-1)!;
    app.selectElement(node.id);
    const input = document.createElement('input');
    input.value = 'T80';
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: input });
    app.edit('name', event);
    app.setTool('transition');
    press(null);
    expect(app.net().nodes.at(-1)?.name).toBe('T81');
  });

  it('updates the prototype without a drag, attaching to opposite-kind hover targets', () => {
    app.setTool('arc');
    press('idle');
    app.pointerMove(pointer('pointermove', svg, 450, 250));
    expect(app.prototypeArcPath()).toContain('450 250');
    const target = document.createElementNS(svg.namespaceURI, 'g');
    target.setAttribute('data-node', 'start');
    app.pointerMove(pointer('pointermove', target, 450, 250));
    expect(app.prototypeArcPath()).not.toContain('450 250');
    expect(app.dirty()).toBe(false);
    app.setTool('select');
    expect(app.prototypeArcPath()).toBe('');
  });

  it('uses physical Ctrl, suppresses Ctrl context menus and preserves Ctrl selection', () => {
    app.setTool('arc');
    press(null, false, 301, 92, 0, true);
    expect(app.canUndo()).toBe(false);
    press(null, true);
    const event = new MouseEvent('contextmenu', { ctrlKey: true, cancelable: true });
    app.openContext(event);
    expect(event.defaultPrevented).toBe(true);
    expect(app.context()).toBeNull();
    app.setTool('select');
    press('idle');
    press('start', true);
    expect(app.selectedIds()).toEqual(['idle', 'start', 'a1']);
  });

  it('middle-click chains alternating nodes, cancels pointercancel and preserves native two-step undo', () => {
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    app.setTool('arc');
    const before = app.net();
    press(null, false, 300, 300, 1);
    expect(app.net()).toBe(before);
    app.pointerUp(pointer('pointerup', svg, 300, 300, 1));
    const first = app.net();
    expect(first.nodes.length).toBe(before.nodes.length + 1);
    expect(first.nodes.at(-1)?.kind).toBe('place');
    press(null, false, 450, 300, 1);
    app.pointerUp(pointer('pointerup', svg, 450, 300, 1));
    expect(app.net().nodes.at(-1)?.kind).toBe('transition');
    expect(app.net().arcs.length).toBe(before.arcs.length + 1);
    app.cancelDraft();
    app.undo();
    expect(app.net().nodes.length).toBe(before.nodes.length + 2);
    expect(app.net().arcs.length).toBe(before.arcs.length);
    app.undo();
    expect(app.net()).toEqual(first);
    press(null, false, 600, 300, 1);
    app.pointerUp(pointer('pointercancel', svg, 600, 300, 1));
    expect(app.net()).toEqual(first);
  });

  it('gives Ctrl middle panning precedence over Quick Draw', () => {
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    app.setTool('arc');
    press('idle');
    const before = app.net();
    press(null, true, 100, 100, 1);
    app.pointerMove(pointer('pointermove', svg, 80, 60, 1));
    app.pointerUp(pointer('pointerup', svg, 80, 60, 1));
    expect(app.viewport()).toMatchObject({ x: 20, y: 40 });
    expect(app.net()).toBe(before);
    expect(app.arcStart()).toBe('idle');
    expect(app.canUndo()).toBe(false);
  });

  it('uses model coordinates at zoom and maps grid-off to null', () => {
    vi.mocked(app.point).mockImplementation(
      (event) => ({ x: 100 + event.clientX / 2, y: 50 + event.clientY / 2 }) as DOMPoint,
    );
    app.viewport.set({ x: 100, y: 50, zoom: 200 });
    app.setTool('arc');
    app.cycleGrid();
    press(null, true, 213, 177);
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 195, y: 135 });
    app.cycleGrid();
    press(null, true, 213, 177);
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 207, y: 139 });
  });

  it('shares naming counters across normal creation and Quick Draw, retaining them through history', () => {
    app.setTool('arc');
    press(null, true);
    const first = app.net().nodes.at(-1)!;
    app.setTool('select');
    app.selectElement(first.id);
    app.remove();
    app.setTool('place');
    press(null);
    expect(app.net().nodes.at(-1)?.name).toBe('P1');
    app.undo();
    app.redo();
    app.undo();
    press(null);
    expect(app.net().nodes.at(-1)?.name).toBe('P2');
    app.setTool('arc');
    press(null, true);
    expect(app.net().nodes.at(-1)?.name).toBe('P3');
    app.newModel();
    app.submitDocumentDialog({ name: 'Untitled model', componentName: 'Net' });
    expect(app.arcStart()).toBeNull();
    app.setTool('place');
    press(null);
    expect(app.net().nodes.at(-1)?.name).toBe('P0');
    app.setTool('arc');
    press(app.net().nodes.at(-1)!.id);
    app.setMode('Simulate');
    expect(app.arcStart()).toBeNull();
  });

  it('routes plain pending canvas presses to the documented bend seam', () => {
    app.setTool('arc');
    press('idle');
    const bend = vi.spyOn(app, 'addPendingArcBend');
    press(null, false, 301, 92);
    expect(bend).toHaveBeenCalledWith({ x: 301, y: 92 }, false);
    expect(app.arcStart()).toBe('idle');
    expect(app.canUndo()).toBe(false);
  });

  function geometryModel() {
    app.pending.set({
      net: {
        name: 'Geometry',
        template: 'Net',
        nodes: [
          { id: 'p', kind: 'place', name: 'P', x: 90, y: 90, tokens: 0 },
          { id: 't', kind: 'transition', name: 'T', x: 390, y: 90, tokens: 0 },
        ],
        arcs: [
          {
            id: 'a',
            source: 'p',
            target: 't',
            kind: 'normal',
            weight: 2,
            bends: [
              { x: 210, y: 150, curved: false },
              { x: 300, y: 180, curved: true },
            ],
          },
        ],
      },
      warnings: [],
      action: 'Open',
    });
    app.acceptPending();
    app.selectElement('a');
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('data-arc', 'a');
    const handle = document.createElementNS(svg.namespaceURI, 'rect');
    handle.setAttribute('data-bend', '0');
    group.append(handle);
    svg.append(group);
    return { group, handle };
  }

  it('renders native straight/curved data and polyline label anchor', () => {
    geometryModel();
    const geometry = netArcGeometry(app.net()).get('a')!;
    expect(app.arcPath(app.net().arcs[0])).toBe(geometry.d);
    expect(geometry.d).toContain(' L 210 150');
    expect(geometry.d).toContain(' C ');
    expect(geometry.d).not.toMatch(/NaN|Infinity| Q /);
    expect(app.arcLabel(app.net().arcs[0])).toEqual({
      x: geometry.midpoint.x,
      y: geometry.midpoint.y - 12,
    });
    expect(app.arcGeometries()).toBe(app.arcGeometries());
  });

  it('drags a snapped bend with one undo and rolls back Escape/pointercancel', () => {
    const { handle } = geometryModel();
    const initial = app.net();
    app.pointerDown(pointer('pointerdown', handle, 210, 150));
    app.pointerMove(pointer('pointermove', svg, 232, 177));
    expect(app.net().arcs[0].bends![0]).toEqual({ x: 225, y: 180, curved: false });
    expect(app.canUndo()).toBe(false);
    app.pointerMove(pointer('pointermove', svg, 242, 181));
    app.pointerUp(pointer('pointerup', svg, 242, 181));
    expect(app.net().arcs[0].bends![0].x).toBe(240);
    app.undo();
    expect(app.net()).toEqual(initial);
    app.redo();
    const committed = app.net();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    app.pointerDown(pointer('pointerdown', handle, 240, 180));
    expect(document.activeElement).toBe(svg);
    input.remove();
    app.pointerMove(pointer('pointermove', svg, 330, 330));
    key('Escape');
    expect(app.net()).toEqual(committed);
    app.pointerDown(pointer('pointerdown', handle, 240, 180));
    app.pointerMove(pointer('pointermove', svg, 400, 400));
    app.pointerUp(pointer('pointercancel', svg, 400, 400));
    expect(app.net()).toEqual(committed);
  });

  it('offers native point/endpoint menus and Ctrl double-click insertion (Alt curved)', () => {
    const { group, handle } = geometryModel();
    app.openContext(pointer('contextmenu', handle, 210, 150));
    expect(app.contextActions().map((a) => a.label)).toEqual([
      'Change to Curved',
      'Split Point',
      'Delete',
    ]);
    app.contextAction('toggle-bend');
    expect(app.net().arcs[0].bends![0].curved).toBe(true);
    app.openContext(pointer('contextmenu', handle, 210, 150));
    app.contextAction('split-bend');
    expect(app.net().arcs[0].bends![1]).toEqual({ x: 220, y: 150, curved: true });
    app.openContext(pointer('contextmenu', handle, 210, 150));
    app.contextAction('delete-bend');
    expect(app.net().arcs[0].bends).toHaveLength(2);
    const endpoint = document.createElementNS(svg.namespaceURI, 'circle');
    endpoint.setAttribute('data-endpoint', 'true');
    group.append(endpoint);
    app.openContext(pointer('contextmenu', endpoint, 385, 90));
    expect(app.contextActions()).toHaveLength(1);
    app.contextAction('toggle-bend');
    expect(app.net().arcs[0].curvedEnd).toBe(true);
    app.openContext(pointer('contextmenu', group, 170, 120));
    expect(app.contextActions().some((a) => a.id === 'insert-bend')).toBe(true);
    app.contextAction('insert-bend');
    expect(app.net().arcs[0].bends).toContainEqual({ x: 165, y: 120, curved: false });
    app.editFromCanvas(pointer('dblclick', group, 260, 220, 0, { ctrlKey: true, altKey: true }));
    expect(app.net().arcs[0].bends).toContainEqual({ x: 255, y: 225, curved: true });
    expect(app.editingElement()).toBeNull();
  });

  it('translates selected arc bends with group drag, leaving unselected bends fixed', () => {
    geometryModel();
    app.selectAll();
    const node = document.createElementNS(svg.namespaceURI, 'g');
    node.setAttribute('data-node', 'p');
    svg.append(node);
    app.pointerDown(pointer('pointerdown', node, 90, 90));
    app.pointerMove(pointer('pointermove', svg, 119, 107));
    app.pointerUp(pointer('pointerup', svg, 119, 107));
    expect(app.net().nodes[0]).toMatchObject({ x: 120, y: 105 });
    expect(app.net().arcs[0].bends![0]).toMatchObject({ x: 240, y: 165 });
    app.undo();
    app.selectElement('p');
    app.pointerDown(pointer('pointerdown', node, 90, 90));
    app.pointerMove(pointer('pointermove', svg, 120, 105));
    app.pointerUp(pointer('pointerup', svg, 120, 105));
    expect(app.net().arcs[0].bends![0]).toMatchObject({ x: 210, y: 150 });
  });

  it('fits distant bends and curved control extents', () => {
    geometryModel();
    const zoom = app.zoom();
    app.context.set({ id: 'a', point: { x: 2200, y: 1800 }, x: 0, y: 0 });
    app.contextAction('insert-bend');
    app.fit();
    expect(app.zoom()).toBeLessThan(zoom);
    const visible = app.visible();
    for (const geometry of app.arcGeometries().values())
      for (const vertex of geometry.vertices)
        for (const point of vertex.curved ? [vertex, vertex.control1, vertex.control2] : [vertex]) {
          expect(point.x).toBeGreaterThanOrEqual(visible.x);
          expect(point.x).toBeLessThanOrEqual(visible.x + visible.width);
          expect(point.y).toBeGreaterThanOrEqual(visible.y);
          expect(point.y).toBeLessThanOrEqual(visible.y + visible.height);
        }
  });

  it('keeps drafts out of saves/history, retains committed bends and Quick Draw two-step undo', () => {
    app.newModel();
    app.submitDocumentDialog({ name: 'Untitled model', componentName: 'Net' });
    app.setTool('arc');
    press(null, true, 90, 90);
    const before = app.net();
    press(null, false, 210, 150);
    app.pointerDown(pointer('pointerdown', svg, 300, 180, 0, { shiftKey: true }));
    app.pointerMove(pointer('pointermove', svg, 390, 90, 0, { shiftKey: true }));
    expect(app.prototypeArcPath()).toContain(' L 210 150');
    expect(app.prototypeArcPath()).toContain(' C ');
    expect(app.draftBends()).toEqual([
      { x: 210, y: 150, curved: false },
      { x: 300, y: 180, curved: true },
    ]);
    expect(app.net()).toBe(before);
    for (const [text, filename] of [
      [serializeTapn(app.net()), 'saved.tapn'],
      [serializeJson(app.net()), 'saved.json'],
    ])
      expect(parseModel(text, filename).net.arcs).toHaveLength(0);
    press(null, true, 390, 90);
    const arc = app.net().arcs[0];
    expect(arc.bends).toHaveLength(2);
    expect(arc.curvedEnd).toBeUndefined();
    expect(app.draftBends()).toEqual([]);
    // The next Ctrl segment gets a fresh path.
    press(null, true, 500, 90);
    expect(app.net().arcs[1].bends).toBeUndefined();
    app.undo();
    expect(app.net().nodes).toHaveLength(3);
    app.undo();
    expect(app.net().nodes).toHaveLength(2);
    app.undo();
    expect(app.net().nodes).toHaveLength(2);
    expect(app.net().arcs).toHaveLength(0);
    app.undo();
    expect(app.net().nodes).toHaveLength(1);
    app.redo();
    app.redo();
    for (const [text, filename] of [
      [serializeTapn(app.net()), 'saved.tapn'],
      [serializeJson(app.net()), 'saved.json'],
    ]) {
      const reopened = parseModel(text, filename).net;
      expect(reopened.arcs[0].bends).toEqual(arc.bends);
      app.pending.set({ net: reopened, warnings: [], action: 'Reopen' });
      app.acceptPending();
      expect(app.draftBends()).toEqual([]);
      expect(app.net().arcs[0].bends).toEqual(arc.bends);
    }
    app.setTool('arc');
    press(app.net().nodes[1].id);
    press(null, false, 450, 180);
    press(app.net().nodes[0].id);
    expect(app.net().arcs[1].bends).toEqual([{ x: 450, y: 180, curved: false }]);
    expect(app.arcStart()).toBeNull();
    expect(app.draftBends()).toEqual([]);
  });

  it.each(['key', 'tool', 'mode', 'load'] as const)(
    'clears draft bends on %s cancellation',
    (reason) => {
      app.setTool('arc');
      press('idle');
      press(null, false, 210, 150);
      expect(app.draftBends()).toHaveLength(1);
      if (reason === 'key') key('Escape');
      if (reason === 'tool') app.setTool('select');
      if (reason === 'mode') app.setMode('Simulate');
      if (reason === 'load') {
        app.pending.set({ net: app.net(), warnings: [], action: 'Reopen' });
        app.acceptPending();
      }
      expect(app.arcStart()).toBeNull();
      expect(app.draftBends()).toEqual([]);
      expect(app.prototypeArcPath()).toBe('');
    },
  );

  it('uses inverse zoom model coordinates for bend dragging and draft presses', () => {
    const { handle } = geometryModel();
    vi.mocked(app.point).mockImplementation(
      (event) => ({ x: 100 + event.clientX / 2, y: 50 + event.clientY / 2 }) as DOMPoint,
    );
    app.viewport.set({ x: 100, y: 50, zoom: 200 });
    app.pointerDown(pointer('pointerdown', handle, 220, 200));
    app.pointerMove(pointer('pointermove', svg, 280, 260));
    app.pointerUp(pointer('pointerup', svg, 280, 260));
    expect(app.net().arcs[0].bends![0]).toMatchObject({ x: 240, y: 180 });
    app.setTool('arc');
    press('p');
    press(null, false, 220, 200);
    expect(app.draftBends()).toEqual([{ x: 210, y: 150, curved: false }]);
  });

  it('saves through App with drafts excluded, then reopens committed geometry', () => {
    geometryModel();
    const contents: string[] = [];
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      'Blob',
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          contents.push(String(parts[0]));
        }
      },
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:geometry'),
      revokeObjectURL: vi.fn(),
    });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      app.setTool('arc');
      press('t');
      press(null, false, 450, 240);
      app.save('json');
      expect(download).toHaveBeenCalledOnce();
      expect(app.draftBends()).toHaveLength(1);
      expect(
        parseNetworkModel(contents[0], 'draft.json').network.components[0].net.arcs,
      ).toHaveLength(1);
      press('p');
      app.save('tapn');
      expect(app.dirty()).toBe(false);
      const reopened = parseModel(contents[1], 'committed.tapn').net;
      expect(reopened.arcs[1].bends).toEqual([{ x: 450, y: 240, curved: false }]);
      app.pending.set({ net: reopened, warnings: [], action: 'Reopen download' });
      app.acceptPending();
      expect(app.net().arcs[1].bends).toEqual(reopened.arcs[1].bends);
      expect(app.draftBends()).toEqual([]);
      vi.runAllTimers();
    } finally {
      download.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each(['arc', 'inhibitor'] as const)(
    'retains %s draft bends and Shift final curvature on ordinary completion',
    (tool) => {
      geometryModel();
      // Reverse the normal example; inhibitor needs the valid place-to-transition direction.
      if (tool === 'inhibitor') {
        app.selectElement('a');
        app.remove();
      }
      app.setTool(tool);
      press(tool === 'arc' ? 't' : 'p');
      app.pointerDown(pointer('pointerdown', svg, 210, 240, 0, { shiftKey: true }));
      const node = document.createElementNS(svg.namespaceURI, 'g');
      node.setAttribute('data-node', tool === 'arc' ? 'p' : 't');
      svg.append(node);
      app.pointerDown(pointer('pointerdown', node, 90, 90, 0, { shiftKey: true }));
      expect(app.net().arcs.at(-1)).toMatchObject({
        bends: [{ x: 210, y: 240, curved: true }],
        curvedEnd: true,
      });
      expect(app.arcStart()).toBeNull();
      expect(app.draftBends()).toEqual([]);
    },
  );

  it('middle-button pans over a node without editing, changing tools or firing in simulation', () => {
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    target.setAttribute('data-node', 'start');
    svg.append(target);
    app.setMode('Simulate');
    app.viewport.set({ x: 100, y: 100, zoom: 200 });
    const before = app.net();
    const down = pointer('pointerdown', target, 100, 100, 1);
    app.pointerDown(down);
    expect(down.defaultPrevented).toBe(true);
    app.pointerMove(pointer('pointermove', target, 80, 60, 1));
    expect(app.viewport()).toEqual({ x: 110, y: 120, zoom: 200 });
    app.pointerMove(pointer('pointermove', target, 60, 40, 1));
    expect(app.viewport()).toEqual({ x: 120, y: 130, zoom: 200 });
    app.pointerUp(pointer('pointerup', target, 60, 40, 1));
    expect(app.panning()).toBe(false);
    expect(app.tool()).toBe('select');
    expect(app.net()).toBe(before);
    expect(app.cursor()).toBe(0);
    expect(app.dirty()).toBe(false);
  });

  it('snaps a group drag as one undoable edit and cancels previews on Escape', () => {
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    target.setAttribute('data-node', 'idle');
    svg.append(target);
    const before = structuredClone(app.net());
    const initialX = before.nodes.find((node) => node.id === 'idle')!.x;
    app.selectElement('idle');
    app.selectElement('start', true);
    app.pointerDown(pointer('pointerdown', target, 100, 100));
    app.pointerMove(pointer('pointermove', target, 123, 116));
    expect(app.net().nodes.find((node) => node.id === 'idle')?.x).toBe(initialX + 30);
    app.pointerUp(pointer('pointerup', target, 123, 116));
    app.undo();
    expect(app.net()).toEqual(before);
    app.pointerDown(pointer('pointerdown', target, 100, 100));
    app.pointerMove(pointer('pointermove', target, 130, 130));
    key('Escape');
    expect(app.net()).toEqual(before);
    expect(app.dirty()).toBe(false);
  });

  it('uses native redo and simulation history arrows without firing extra transitions', () => {
    rightClick(null);
    app.contextAction('place');
    app.undo();
    key('y', { ctrlKey: true });
    expect(app.net().nodes).toHaveLength(7);
    key('m');
    expect(app.mode()).toBe('Simulate');
    app.fireSelected();
    key('ArrowLeft');
    expect(app.cursor()).toBe(0);
    key('ArrowRight');
    expect(app.cursor()).toBe(1);
    key('ArrowRight');
    expect(app.cursor()).toBe(1);
    expect(app.trace()).toHaveLength(2);
    key('m');
    expect(app.mode()).toBe('Edit');
    expect(app.net().nodes.find((node) => node.id === 'idle')?.tokens).toBe(1);
  });

  it('navigates command menus with arrows and returns focus on Escape', () => {
    const menu = document.createElement('details');
    menu.className = 'folded-menu';
    menu.innerHTML =
      '<summary>File</summary><button disabled>Unavailable</button><button>Open</button><button>Save</button>';
    document.body.append(menu);
    const summary = menu.querySelector('summary')!;
    const send = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      Object.defineProperty(event, 'target', { value: document.activeElement });
      app.key(event);
    };
    summary.focus();
    send('ArrowDown');
    expect(menu.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Open');
    send('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Save');
    send('Escape');
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    menu.remove();
  });
  function createTab(name: string) {
    app.newModel();
    app.submitDocumentDialog({ name, componentName: 'Net' });
    return app.activeDocument()!.id;
  }
  it('keeps two document histories, dirty state and guarded close independent', () => {
    const a = app.activeDocument()!.id;
    app.setTool('place');
    press(null);
    const aCount = app.net().nodes.length;
    const b = createTab('B');
    app.setTool('place');
    press(null);
    expect(app.net().nodes).toHaveLength(1);
    app.switchDocument(a);
    app.undo();
    expect(app.net().nodes).toHaveLength(aCount - 1);
    expect(app.dirty()).toBe(false);
    app.switchDocument(b);
    expect(app.net().nodes).toHaveLength(1);
    expect(app.dirty()).toBe(true);
    const before = app.workspace();
    app.closeDocument(b);
    app.key(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(app.workspace()).toBe(before);
    app.closeDocument(b);
    app.closeDocument(b, true);
    expect(app.activeDocument()!.id).toBe(a);
    expect(app.dirty()).toBe(false);
  });
  it('copies local IDs, reorders by stable identity and preserves independent component views', () => {
    const first = app.activeDocument()!.session.componentId;
    app.selectElement('idle');
    app.viewport.set({ x: 123, y: 45, zoom: 170 });
    app.cycleGrid();
    app.componentDialog('copy');
    app.submitDocumentDialog({ name: '', componentName: 'Copy' });
    const copy = app.activeDocument()!.session.componentId;
    expect(copy).not.toBe(first);
    expect(app.net().nodes[0].id).toBe(app.components()[0].net.nodes[0].id);
    app.viewport.set({ x: 400, y: 200, zoom: 80 });
    app.moveComponent(-1);
    expect(app.components()[0].id).toBe(copy);
    app.switchComponent(first);
    expect(app.viewport()).toEqual({ x: 123, y: 45, zoom: 170 });
    expect(app.selectedIds()).toEqual(['idle']);
    expect(app.gridIndex()).toBe(1);
    app.switchComponent(copy);
    expect(app.viewport()).toEqual({ x: 400, y: 200, zoom: 80 });
    app.undo();
    expect(app.components()[0].id).toBe(first);
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    expect(app.error()).toBe('');
  });
  it('allows all-inactive V3 views, no fireable events and exact activity undo', () => {
    app.componentDialog('add');
    app.submitDocumentDialog({ name: '', componentName: 'B' });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    const event = { target: checkbox } as unknown as Event;
    app.toggleComponent(app.components()[0].id, event);
    app.switchComponent(app.components()[0].id);
    expect(app.net().template).toBe(app.components()[0].net.template);
    const before = app.activeDocument()!.network;
    checkbox.checked = false;
    app.toggleComponent(app.components()[1].id, event);
    expect(app.activeDocument()!.network.components.every((c) => !c.active)).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(app.error()).toBe('');
    app.setMode('Simulate');
    expect(app.enabledTransitions()).toEqual([]);
    app.setMode('Edit');
    app.undo();
    expect(app.activeDocument()!.network).toBe(before);
  });
  it('cancels New without changing documents or a pending drawing gesture', () => {
    app.setTool('arc');
    press('idle');
    const before = app.workspace();
    app.newModel();
    app.cancelDocumentDialog();
    expect(app.workspace()).toBe(before);
    expect(app.arcStart()).toBe('idle');
  });
  it('opens in another tab without a discard prompt for existing dirty work', async () => {
    app.setTool('place');
    press(null);
    const original = app.activeDocument()!;
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [
        { name: 'other.json', size: 100, text: async () => serializeNetworkJson(original.network) },
      ],
    });
    await app.openFile({ target: input } as unknown as Event);
    expect(app.pending()).toBeNull();
    expect(app.documents()).toHaveLength(2);
    expect(docs.getDocument(app.workspace(), original.id).network).toEqual(original.network);
    expect(docs.getDocument(app.workspace(), original.id).past).toEqual(original.past);
    expect(docs.isDirty(docs.getDocument(app.workspace(), original.id))).toBe(true);
    expect(app.dirty()).toBe(false);
  });
  it('saves the captured whole-network checkpoint even if download switches tabs', () => {
    app.componentDialog('copy');
    app.submitDocumentDialog({ name: '', componentName: 'Copy' });
    const a = app.activeDocument()!;
    const b = createTab('B');
    app.switchDocument(a.id);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:network'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => app.switchDocument(b));
    try {
      app.save('json');
      expect(app.activeDocument()!.id).toBe(b);
      expect(app.dirty()).toBe(true);
      const saved = docs.getDocument(app.workspace(), a.id);
      expect(saved.saved?.components).toHaveLength(2);
      expect(docs.isDirty(saved)).toBe(false);
      expect(saved.saved).toEqual(a.network);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('retains naming high water across document and component switches and undo', () => {
    const a = app.activeDocument()!.id;
    app.setTool('place');
    press(null);
    app.undo();
    const b = createTab('B');
    app.setTool('place');
    press(null);
    expect(app.net().nodes[0].name).toBe('P0');
    app.switchDocument(a);
    app.setTool('place');
    press(null);
    expect(app.net().nodes.at(-1)!.name).toBe('P1');
    app.switchDocument(b);
    app.closeDocument(b, true);
    app.closeDocument(a, true);
    expect(app.documents()).toHaveLength(0);
    createTab('C');
    expect(app.net().nodes).toEqual([]);
  });
  it('downloads and reopens every component, order and active flag through both file formats', () => {
    app.componentDialog('copy');
    app.submitDocumentDialog({ name: '', componentName: 'Copy' });
    app.moveComponent(-1);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    app.toggleComponent(app.components()[1].id, { target: checkbox } as unknown as Event);
    const network = app.activeDocument()!.network;
    const contents: string[] = [];
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal(
      'Blob',
      class extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          contents.push(String(parts[0]));
        }
      },
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:network'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      for (const format of ['json', 'tapn'] as const) {
        app.save(format);
        expect(app.error()).toBe('');
        const reopened = parseNetworkModel(contents.at(-1)!, `network.${format}`).network;
        expect(reopened.components.map((item) => [item.net.template, item.active])).toEqual([
          ['Copy', true],
          ['Producer', false],
        ]);
        expect(reopened.components.map((item) => item.net.nodes.map((node) => node.id))).toEqual(
          network.components.map((item) => item.net.nodes.map((node) => node.id)),
        );
        app.pending.set({ network: reopened, warnings: [], action: 'Open' });
        app.acceptPending();
        expect(app.documents()).toHaveLength(format === 'json' ? 2 : 3);
        expect(app.components()).toHaveLength(2);
      }
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  function noteTarget(id: string, handle?: string) {
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    target.setAttribute('data-note', id);
    if (handle) target.setAttribute('data-resize', handle);
    svg.append(target);
    return target;
  }
  function addNote(text = '<b>literal</b>\nsecond line') {
    app.openAnnotation({ x: 300, y: 200, text: '' });
    app.applyAnnotation(text);
    return app.net().annotations![0];
  }
  it('creates an annotation with N; cancel and blank OK add no history', () => {
    key('n');
    expect(app.tool()).toBe('annotation');
    app.pointerDown(pointer('pointerdown', svg, 303, 207));
    expect(app.annotationEditor()).not.toBeNull();
    app.closeAnnotation();
    expect(app.canUndo()).toBe(false);
    app.pointerDown(pointer('pointerdown', svg, 303, 207));
    app.applyAnnotation('  \n ');
    expect(app.net().annotations).toBeUndefined();
    expect(app.canUndo()).toBe(false);
    app.pointerDown(pointer('pointerdown', svg, 303, 207));
    app.applyAnnotation('<svg onload="bad()"> & text');
    expect(app.net().annotations![0].text).toContain('<svg');
    app.undo();
    expect(app.net().annotations).toBeUndefined();
    app.redo();
    expect(app.net().annotations).toHaveLength(1);
  });
  it('edits, duplicates and deletes selected notes through undoable selection actions', () => {
    const note = addNote();
    expect(app.canCopySelection()).toBe(true);
    app.openEditor(note.id);
    app.applyAnnotation('Edited');
    expect(app.net().annotations![0].text).toBe('Edited');
    app.undo();
    expect(app.net().annotations![0].text).toBe(note.text);
    app.duplicate();
    expect(app.net().annotations).toHaveLength(2);
    app.remove();
    expect(app.net().annotations).toHaveLength(1);
    app.undo();
    expect(app.net().annotations).toHaveLength(2);
  });
  it('moves and resizes notes once per drag and reverts pointer cancellation', () => {
    const note = addNote();
    app.setTool('select');
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    const target = noteTarget(note.id);
    app.pointerDown(pointer('pointerdown', target, 300, 200));
    app.pointerMove(pointer('pointermove', svg, 319.7, 213.2));
    app.pointerMove(pointer('pointermove', svg, 340, 220));
    app.pointerUp(pointer('pointerup', svg, 340, 220));
    expect(app.net().annotations![0].x).toBe(345);
    app.undo();
    expect(app.net().annotations![0]).toEqual(note);
    for (const handle of app.noteHandles(note)) {
      const target = noteTarget(note.id, handle.handle);
      app.pointerDown(pointer('pointerdown', target, handle.x, handle.y));
      app.pointerMove(pointer('pointermove', svg, handle.x + 20, handle.y + 20));
      app.pointerUp(pointer('pointercancel', svg, handle.x + 20, handle.y + 20));
      expect(app.net().annotations![0]).toEqual(note);
    }
    const resize = noteTarget(note.id, 'bottom-right');
    app.pointerDown(pointer('pointerdown', resize, 0, 0));
    app.pointerMove(pointer('pointermove', svg, 30, 20));
    app.pointerUp(pointer('pointerup', svg, 30, 20));
    expect(app.net().annotations![0].width).toBe(note.width + 30);
    app.undo();
    expect(app.net().annotations![0]).toEqual(note);
  });
  it('grows wrapped text when narrowing a note and undoes the whole resize', () => {
    const note = addNote();
    app.setTool('select');
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    app.pointerDown(pointer('pointerdown', noteTarget(note.id, 'right'), 0, 0));
    app.pointerMove(pointer('pointermove', svg, -500, 0));
    app.pointerUp(pointer('pointerup', svg, -500, 0));
    const narrowed = app.net().annotations![0];
    expect(narrowed.width).toBe(40);
    expect(narrowed.height).toBeGreaterThan(note.height);
    expect(narrowed.height).toBeGreaterThanOrEqual(app.noteLines(narrowed).length * 16);
    expect(narrowed.x).toBe(note.x);
    expect(narrowed.y).toBe(note.y);
    app.undo();
    expect(app.net().annotations![0]).toEqual(note);
  });
  it('opens note context controls and fits annotation-only models', () => {
    const note = addNote();
    const event = pointer('contextmenu', noteTarget(note.id), 310, 210);
    app.openContext(event);
    expect(app.contextActions().find((a) => a.id === 'duplicate')?.disabled).toBe(false);
    app.contextAction('note-border');
    expect(app.net().annotations![0].border).toBe(false);
    app.undo();
    expect(app.net().annotations![0].border).toBeUndefined();
    app.selectAll();
    app.selectElement(note.id, true);
    app.remove();
    expect(app.net().nodes).toHaveLength(0);
    app.fit();
    expect(app.fitted()).toBe(true);
    expect(Number.isFinite(app.zoom())).toBe(true);
  });
  it('drags only the native label offset, with one undo and Escape cancellation', () => {
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    const node = app.net().nodes[0];
    const target = document.createElementNS(svg.namespaceURI, 'g');
    target.setAttribute('data-node', node.id);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('class', 'node-name');
    target.append(label);
    svg.append(target);
    app.pointerDown(pointer('pointerdown', label, 100, 100));
    app.pointerMove(pointer('pointermove', svg, 120.6, 100));
    app.pointerUp(pointer('pointerup', svg, 120.6, 100));
    expect(app.net().nodes[0]).toEqual({ ...node, nameOffsetX: 21 });
    app.undo();
    expect(app.net().nodes[0]).toEqual(node);
    app.pointerDown(pointer('pointerdown', label, 100, 100));
    app.pointerMove(pointer('pointermove', svg, 120, 110));
    key('Escape');
    expect(app.net().nodes[0]).toEqual(node);
  });
  it('drags arc text independently of selected bend handles, commits once and cancels', () => {
    Object.assign(svg, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
    const before = app.net();
    const arc = before.arcs[0];
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('data-arc', arc.id);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('class', 'arc-label');
    group.append(label);
    svg.append(group);
    app.selectElement(arc.id);
    app.pointerDown(pointer('pointerdown', label, 100, 100));
    app.pointerMove(pointer('pointermove', svg, 121, 89));
    app.pointerUp(pointer('pointerup', svg, 121, 89));
    expect(app.net().arcs[0]).toEqual({ ...arc, nameOffsetX: 21, nameOffsetY: -11 });
    expect(app.net().nodes).toEqual(before.nodes);
    app.undo();
    expect(app.net()).toEqual(before);
    app.redo();
    expect(app.net().arcs[0].nameOffsetX).toBe(21);
    app.pointerDown(pointer('pointerdown', label, 100, 100));
    app.pointerMove(pointer('pointermove', svg, 120, 110));
    key('Escape');
    expect(app.net().arcs[0]).toEqual({ ...arc, nameOffsetX: 21, nameOffsetY: -11 });
  });
  function wheelOver(id: string, deltaY: number, modifiers: WheelEventInit = {}) {
    const target = document.createElementNS(svg.namespaceURI, 'g');
    target.setAttribute('data-node', id);
    svg.append(target);
    const event = new WheelEvent('wheel', { deltaY, cancelable: true, ...modifiers });
    Object.defineProperty(event, 'target', { value: target });
    app.wheel(event);
    return event;
  }
  it('rotates selected transitions before modifier zoom and updates attached arc ports', () => {
    app.selectElement('start');
    app.zoomTo(200);
    const geometry = app.arcGeometries().get('a1')!.d;
    const view = app.viewport();
    wheelOver('start', -100, { ctrlKey: true, shiftKey: true });
    expect(app.net().nodes.find((n) => n.id === 'start')?.angle).toBe(135);
    expect(app.arcGeometries().get('a1')!.d).not.toBe(geometry);
    expect(app.viewport()).toEqual(view);
    app.undo();
    expect(app.net().nodes.find((n) => n.id === 'start')?.angle).toBeUndefined();
    wheelOver('start', 100, { metaKey: true });
    expect(app.net().nodes.find((n) => n.id === 'start')?.angle).toBe(45);
    app.selectElement(null);
    wheelOver('start', 100, { ctrlKey: true });
    expect(app.zoom()).toBeGreaterThan(200);
  });
  it('uses selected-place wheel tokens before modifiers at zoom, protects bounds and simulation', () => {
    app.selectElement('idle');
    app.zoomTo(200);
    const view = app.viewport();
    wheelOver('idle', -100, { ctrlKey: true, altKey: true });
    expect(app.net().nodes[0].tokens).toBe(2);
    expect(app.viewport()).toEqual(view);
    app.undo();
    expect(app.net().nodes[0].tokens).toBe(1);
    app.changeTokens('idle', -1);
    const past = app.activeDocument()!.past.length;
    wheelOver('idle', 100);
    expect(app.net().nodes[0].tokens).toBe(0);
    expect(app.activeDocument()!.past.length).toBe(past);
    app.setTool('add-token');
    press('idle');
    expect(app.net().nodes[0].tokens).toBe(1);
    app.setTool('remove-token');
    press('idle');
    expect(app.net().nodes[0].tokens).toBe(0);
    app.changeTokens('idle', Number.MAX_SAFE_INTEGER);
    const full = app.net();
    app.changeTokens('idle', 1);
    expect(app.net()).toEqual(full);
    app.undo();
    app.setMode('Simulate');
    app.changeTokens('idle', 1);
    expect(app.net().nodes[0].tokens).toBe(0);
  });
  it('protects text editing shortcuts while allowing document save outside dialogs', () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const save = vi.spyOn(app, 'save').mockImplementation(() => {});
    for (const name of ['n', '+', '-', 'Delete']) key(name, {}, textarea);
    expect(app.tool()).toBe('select');
    expect(save).not.toHaveBeenCalled();
    key('s', { ctrlKey: true }, textarea);
    expect(save).toHaveBeenCalledTimes(1);
    app.openAnnotation({ x: 300, y: 200, text: '' });
    key('s', { ctrlKey: true }, textarea);
    expect(save).toHaveBeenCalledTimes(1);
    textarea.remove();
  });
  it('round-trips escaped annotation text, rotated ports and hidden names through saved files', () => {
    addNote('<b>escaped</b> & native');
    rightClick('start');
    app.contextAction('name-visible');
    rightClick('start');
    app.contextAction('rotate');
    const snapshot = app.net();
    const xml = serializeTapn(snapshot);
    expect(xml).toContain('&lt;b&gt;escaped&lt;/b&gt; &amp; native');
    const reopened = parseModel(xml, 'layout.tapn').net;
    expect(reopened.annotations![0].text).toBe(snapshot.annotations![0].text);
    expect(reopened.nodes.find((n) => n.id === 'start')).toMatchObject({
      angle: 45,
      nameVisible: false,
    });
    expect(netArcGeometry(reopened).get('a1')!.d).toBe(netArcGeometry(snapshot).get('a1')!.d);
    expect(parseModel(serializeJson(snapshot), 'layout.json').net).toEqual(snapshot);
  });
  it('hides names and rotates from context actions with undo', () => {
    rightClick('start');
    app.contextAction('name-visible');
    expect(app.net().nodes.find((n) => n.id === 'start')?.nameVisible).toBe(false);
    rightClick('start');
    app.contextAction('rotate');
    expect(app.net().nodes.find((n) => n.id === 'start')?.angle).toBe(45);
    app.undo();
    app.undo();
    expect(app.net().nodes.find((n) => n.id === 'start')?.nameVisible).toBeUndefined();
  });
});

describe('native clipboard integration', () => {
  let app: App;
  let system: string;
  beforeEach(() => {
    app = new App();
    system = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (text: string) => {
          system = text;
        }),
        readText: vi.fn(async () => system),
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function event(type: string, text = '', target: Element = document.body) {
    const data = new Map([['text/plain', text]]);
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, {
      target: { value: target },
      clipboardData: {
        value: {
          getData: (type: string) => data.get(type) ?? '',
          setData: (type: string, value: string) => data.set(type, value),
        },
      },
    });
    return { e: e as ClipboardEvent, data };
  }
  it('writes native JSON synchronously; pastes +30 with new IDs, selection and one undo', () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    const before = app.net();
    const copy = event('copy');
    app.clipboardEvent(copy.e);
    expect(copy.e.defaultPrevented).toBe(true);
    expect(JSON.parse(copy.data.get('text/plain')!).places).toHaveLength(1);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    app.clipboardEvent(event('paste', copy.data.get('text/plain')).e);
    const nodes = app.net().nodes.filter((n) => !before.nodes.some((old) => old.id === n.id));
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      x: before.nodes[0].x + 30,
      y: before.nodes[0].y + 30,
      name: 'P0',
    });
    expect(app.selectedIds()).toHaveLength(3);
    expect(app.activeDocument()!.past).toHaveLength(1);
    const pasted = app.net();
    app.undo();
    expect(app.net()).toEqual(before);
    app.redo();
    expect(app.net()).toEqual(pasted);
  });
  it('preserves explicit arc deselection until a node is reselected', async () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    expect(app.selectedIds()).toContain('a1');
    app.selectElement('a1', true);
    await app.clipboardAction('copy');
    expect(JSON.parse(system).inputArcs).toEqual([]);
    const { moveSelection } = await import('./core/selection');
    const before = app.net();
    const moved = moveSelection(before, app.selectedIds(), { x: 30, y: 30 });
    expect(moved.nodes[0].x).toBe(before.nodes[0].x + 30);
    expect(moved.arcs[0]).toEqual(before.arcs[0]);
    app.selectElement('start', true);
    app.selectElement('start', true);
    expect(app.selectedIds()).toContain('a1');
  });
  it('keeps a recoverable internal copy on denied write/read, including cut', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('denied'));
    app.selectElement('idle');
    await app.clipboardAction('cut');
    expect(app.notice()).toContain('inside TAPAAL Web only');
    expect(app.net().nodes.some((n) => n.id === 'idle')).toBe(false);
    await app.clipboardAction('paste');
    expect(app.notice()).toContain('pasted internal');
    expect(app.net().nodes.at(-1)?.tokens).toBe(1);
    expect(app.activeDocument()!.past).toHaveLength(2);
  });
  it.each(['input', 'textarea', 'div'])('leaves focused %s text clipboard untouched', (tag) => {
    const target = document.createElement(tag);
    if (tag === 'div') target.setAttribute('contenteditable', 'true');
    app.selectElement('idle');
    for (const action of ['copy', 'cut', 'paste']) {
      const e = event(action, 'text', target);
      app.clipboardEvent(e.e);
      expect(e.e.defaultPrevented).toBe(false);
      expect(e.data.get('text/plain')).toBe('text');
    }
    expect(app.activeDocument()!.past).toHaveLength(0);
  });
  it('leaves keydown to native clipboard events so a gesture is handled once', () => {
    app.selectElement('idle');
    for (const key of ['c', 'x', 'v']) {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
      Object.defineProperty(e, 'target', { value: document.body });
      app.key(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(app.activeDocument()!.past).toHaveLength(0);
  });
  it.each([false, true])(
    'reports an earlier-state copy accurately after an edit (denied=%s)',
    async (denied) => {
      app.selectElement('idle');
      let resolve!: () => void;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      vi.mocked(navigator.clipboard.writeText).mockImplementation(async (text) => {
        await pending;
        if (denied) throw new Error('denied');
        system = text;
      });
      const work = app.clipboardAction('copy');
      const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
      app.changeTokens('idle', 1);
      const edited = app.workspace();
      resolve();
      await work;
      expect(app.workspace()).toBe(edited);
      expect(app.notice()).toContain('Copied from the earlier state');
      expect(app.notice()).not.toContain('cancelled');
      if (denied) expect(app.notice()).toContain('inside TAPAAL Web only');
      else expect(system).toBe(copied);
    },
  );
  it.each([false, true])(
    'cancels a pending menu cut if the selection changes (timed=%s)',
    async (timed) => {
      if (timed) timedClipboardDocument();
      else app.selectElement('idle');
      const before = app.workspace();
      let resolve!: () => void;
      const pending = new Promise<void>((r) => {
        resolve = r;
      });
      vi.mocked(navigator.clipboard.writeText).mockImplementation(() => pending);
      const work = app.clipboardAction('cut');
      expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
      app.selectElement(timed ? 'q' : 'start');
      resolve();
      await work;
      expect(app.workspace()).toBe(before);
      expect(app.notice()).toContain('Clipboard action cancelled');
      expect(app.selectedIds()).toEqual([timed ? 'q' : 'start']);
    },
  );
  it.each(['cut', 'paste'] as const)('aborts async %s after a tab switch', async (action) => {
    app.selectElement('idle');
    await app.clipboardAction('copy');
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    if (action === 'cut')
      vi.mocked(navigator.clipboard.writeText).mockImplementation(() => pending.then(() => {}));
    else vi.mocked(navigator.clipboard.readText).mockReturnValue(pending);
    const original = app.activeDocument()!;
    const work = app.clipboardAction(action);
    app.workspace.update((w) => docs.openDocument(w, docs.createDocument({ name: 'Other' })));
    resolve(system);
    await work;
    expect(docs.getDocument(app.workspace(), original.id).network).toEqual(original.network);
    expect(app.activeDocument()!.past).toHaveLength(0);
    expect(app.notice()).toContain('cancelled');
  });
  it.each(['cut', 'paste'] as const)(
    'aborts async %s after an intervening edit',
    async (action) => {
      app.selectElement('idle');
      await app.clipboardAction('copy');
      let resolve!: (value: string) => void;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });
      if (action === 'cut')
        vi.mocked(navigator.clipboard.writeText).mockImplementation(() => pending.then(() => {}));
      else vi.mocked(navigator.clipboard.readText).mockReturnValue(pending);
      const work = app.clipboardAction(action);
      app.remove();
      const edited = app.net();
      resolve(system);
      await work;
      expect(app.net()).toEqual(edited);
      expect(app.activeDocument()!.past).toHaveLength(1);
      expect(app.notice()).toContain('cancelled');
    },
  );
  it('rejects protected cuts atomically through the real saved-query guard and keeps the copy', async () => {
    const original = app.activeDocument()!;
    const network = {
      ...original.network,
      savedQueries: captureSavedQueries(original.network, ['<query name="q"/>']),
    };
    const protectedDoc = docs.openNetworkDocument(network, { saved: true });
    app.workspace.update((w) => docs.openDocument(w, protectedDoc));
    app.switchDocument(original.id);
    app.switchDocument(protectedDoc.id);
    app.selectElement('idle');
    const before = app.net();
    await app.clipboardAction('cut');
    expect(app.error()).toContain('Saved queries protect');
    expect(app.net()).toEqual(before);
    expect(app.activeDocument()!.past).toHaveLength(0);
    expect(app.activeDocument()!.network.savedQueries).toEqual(network.savedQueries);
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('denied'));
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(before.nodes.length + 1);
    expect(app.activeDocument()!.network.savedQueries).toEqual(network.savedQueries);
  });
  it('pastes between components and documents with shared clipboard and independent histories', async () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    await app.clipboardAction('copy');
    const source = app.activeDocument()!;
    app.componentDialog('add');
    app.submitDocumentDialog({ name: source.network.name, componentName: 'Other' });
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(2);
    expect(app.net().arcs).toHaveLength(1);
    app.newModel();
    app.submitDocumentDialog({ name: 'Destination', componentName: 'Main' });
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(2);
    expect(app.activeDocument()!.past).toHaveLength(1);
    expect(
      docs.getDocument(app.workspace(), source.id).network.components[0].net.nodes,
    ).toHaveLength(6);
    app.undo();
    expect(app.net().nodes).toHaveLength(0);
  });
  it('preserves fractional geometry and label offsets internally while writing rounded native JSON', async () => {
    const original = app.activeDocument()!;
    const net = {
      ...app.net(),
      nodes: app
        .net()
        .nodes.map((n) => (n.id === 'idle' ? { ...n, x: 90.25, nameOffsetX: 12.5 } : n)),
    };
    app.workspace.update((w) =>
      docs.updateDocument(w, original.id, (d) => docs.commitComponentNet(d, net)),
    );
    const another = docs.createDocument({ name: 'Other' });
    app.workspace.update((w) => docs.openDocument(w, another));
    app.switchDocument(original.id);
    app.selectElement('idle');
    await app.clipboardAction('copy');
    await app.clipboardAction('paste');
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 120.25, nameOffsetX: 12.5 });
    app.undo();
    await app.clipboardAction('paste');
    expect(app.net().nodes.at(-1)?.name).toBe('P1');
  });
  it('accepts external native JSON after the system clipboard changes', async () => {
    app.selectElement('idle');
    await app.clipboardAction('copy');
    const model = JSON.parse(system);
    model.places[0].tokens = 8;
    system = JSON.stringify(model);
    await app.clipboardAction('paste');
    expect(app.net().nodes.at(-1)?.tokens).toBe(8);
  });
  it('reports malformed paste without changing data, selection or history', async () => {
    app.selectElement('idle');
    system = '{bad';
    const before = app.net(),
      selected = app.selectedIds();
    await app.clipboardAction('paste');
    expect(app.error()).toBeTruthy();
    expect(app.net()).toBe(before);
    expect(app.selectedIds()).toEqual(selected);
    expect(app.activeDocument()!.past).toHaveLength(0);
  });
  it('preserves explicit arc deselection across tab history restoration', async () => {
    app.selectElement('idle');
    app.selectElement('start', true);
    app.selectElement('a1', true);
    const original = app.activeDocument()!;
    app.newModel();
    app.submitDocumentDialog({ name: 'Other', componentName: 'Net' });
    app.switchDocument(original.id);
    expect(app.selectedIds()).toEqual(['idle', 'start']);
    await app.clipboardAction('copy');
    expect(JSON.parse(system).inputArcs).toEqual([]);
  });
  it('falls back to plain native text if custom clipboard formats are rejected', async () => {
    const write = vi.fn().mockRejectedValue(new Error('custom formats unsupported'));
    Object.assign(navigator.clipboard, { write });
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Blob>) {}
      },
    );
    try {
      app.selectElement('idle');
      await app.clipboardAction('copy');
      expect(write).toHaveBeenCalledOnce();
      expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
      expect(JSON.parse(system).places).toHaveLength(1);
      expect(app.notice()).toBe('Copied selection.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('reads a separate web envelope losslessly from the system clipboard', async () => {
    const { copySelection, WEB_CLIPBOARD_TYPE } = await import('./core/clipboard');
    const net = {
      ...app.net(),
      nodes: app
        .net()
        .nodes.map((n) => (n.id === 'idle' ? { ...n, x: 90.25, nameOffsetY: 4.5 } : n)),
    };
    const payload = copySelection(net, ['idle']);
    Object.assign(navigator.clipboard, {
      read: vi.fn(async () => [
        {
          types: ['text/plain', WEB_CLIPBOARD_TYPE],
          getType: async (type: string) => ({
            text: async () => (type === 'text/plain' ? payload.nativeText : payload.webText),
          }),
        },
      ]),
    });
    await app.clipboardAction('paste');
    expect(app.net().nodes.at(-1)).toMatchObject({ x: 120.25, nameOffsetY: 4.5 });
  });
  function timedClipboardDocument() {
    let doc = docs.createTimedDocument({ name: 'Timed clipboard', componentName: 'Main' });
    doc = docs.commitTimedComponent(
      doc,
      {
        ...docs.activeNet(doc),
        nodes: [
          { id: 'p', name: 'P0', kind: 'place', x: 50, y: 50, tokens: 3 },
          { id: 't', name: 'T0', kind: 'transition', x: 150, y: 50, tokens: 0 },
          { id: 'q', name: 'P1', kind: 'place', x: 250, y: 50, tokens: 0 },
        ],
        arcs: [
          { id: 'i', source: 'p', target: 't', weight: 2, kind: 'normal' },
          { id: 'o', source: 't', target: 'q', weight: 2, kind: 'normal' },
        ],
      },
      {
        intervals: { i: { lower: '1', upper: '5', lowerClosed: false, upperClosed: false } },
        invariants: { p: { upper: '4', upperClosed: true } },
        ages: { p: ['0.1', '2.5'] },
        urgent: [],
        transports: [{ inputArc: 'i', outputArc: 'o' }],
      },
    );
    const previous = app.activeDocument()!.id;
    app.workspace.set(docs.openDocument(app.workspace(), doc, { timed: true }));
    app.switchDocument(previous);
    app.switchDocument(doc.id);
    app.selectAll();
    return doc;
  }
  it('copies timed data synchronously and pastes across components/documents in one undo transaction', async () => {
    const source = timedClipboardDocument();
    const copy = event('copy');
    app.clipboardEvent(copy.e);
    expect(JSON.parse(copy.data.get('text/plain')!)).toMatchObject({
      version: 2,
      modelType: 'timed',
    });
    const other = docs.addComponent(app.activeDocument()!, 'Other');
    app.workspace.set(docs.updateDocument(app.workspace(), other.id, () => other));
    app.switchComponent(source.session.componentId);
    app.switchComponent(other.session.componentId);
    const before = app.activeDocument()!.network;
    app.clipboardEvent(event('paste', copy.data.get('text/plain')).e);
    expect(app.net().nodes).toHaveLength(3);
    expect(Object.values(app.timing()!.ages)).toEqual([['0.1', '2.5']]);
    expect(app.timing()!.transports).toHaveLength(1);
    const firstIds = app.selectedIds();
    app.undo();
    expect(app.activeDocument()!.network).toEqual(before);
    app.clipboardEvent(event('paste', copy.data.get('text/plain')).e);
    expect(app.selectedIds().every((id) => !firstIds.includes(id))).toBe(true);
    const target = docs.createTimedDocument({ name: 'Target', componentName: 'Main' });
    app.workspace.set(docs.openDocument(app.workspace(), target, { timed: true }));
    app.switchDocument(source.id);
    app.switchDocument(target.id);
    app.clipboardEvent(event('paste', copy.data.get('text/plain')).e);
    expect(app.timing()!.transports).toHaveLength(1);
    expect(
      app.workspace().documents.find((d) => d.id === source.id)!.network.components[0],
    ).toEqual(source.network.components[0]);
    app.undo();
    expect(app.net().nodes).toHaveLength(0);
    app.redo();
    expect(Object.values(app.timing()!.ages)).toEqual([['0.1', '2.5']]);
  });
  it('retains recoverable timed cut after denied clipboard, with one deletion undo and faithful paste', async () => {
    timedClipboardDocument();
    const before = app.activeDocument()!;
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('denied'));
    await app.clipboardAction('cut');
    expect(app.net().nodes).toHaveLength(0);
    expect(app.notice()).toMatch(/inside TAPAAL Web only/);
    expect(app.activeDocument()!.past.length).toBe(before.past.length + 1);
    app.undo();
    expect(app.activeDocument()!.network).toEqual(before.network);
    await app.clipboardAction('paste');
    expect(app.notice()).toMatch(/internal/);
    expect(app.timing()!.transports).toHaveLength(2);
    expect(Object.values(app.timing()!.ages)).toEqual([
      ['0.1', '2.5'],
      ['0.1', '2.5'],
    ]);
  });
  it('refuses partial timed transport copy/cut/duplicate before clipboard write or document mutation', async () => {
    timedClipboardDocument();
    app.selectElement('p');
    const before = app.activeDocument();
    for (const action of ['copy', 'cut'] as const) {
      await app.clipboardAction(action);
      expect(app.error()).toMatch(/both transport halves/);
      expect(app.activeDocument()).toBe(before);
    }
    app.duplicate();
    expect(app.error()).toMatch(/both transport halves/);
    expect(app.activeDocument()).toBe(before);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('refuses timed → untimed without mutation and accepts untimed → timed with default timing', async () => {
    const untimed = app.activeDocument()!;
    app.selectElement('idle');
    await app.clipboardAction('copy');
    const plain = system;
    const timed = timedClipboardDocument();
    system = plain;
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(4);
    expect(Object.keys(app.timing()!.ages)).toEqual(['p']);
    app.selectAll();
    await app.clipboardAction('copy');
    expect(app.notice()).toMatch(/desktop TAPAAL clipboard transfer is unavailable/);
    app.switchDocument(untimed.id);
    const before = app.activeDocument();
    await app.clipboardAction('paste');
    expect(app.error()).toMatch(/untimed model/);
    expect(app.activeDocument()).toBe(before);
    app.switchDocument(timed.id);
    app.setMode('Simulate');
    for (const action of ['copy', 'cut', 'paste'] as const) await app.clipboardAction(action);
    expect(app.activeDocument()!.network.components[0].timing!.ages).toEqual({ p: ['0.1', '2.5'] });
  });
  it.each(['cut', 'paste'] as const)(
    'cancels timed async %s after component revision changes',
    async (action) => {
      timedClipboardDocument();
      await app.clipboardAction('copy');
      let resolve!: (text: string) => void;
      const pending = new Promise<string>((r) => (resolve = r));
      if (action === 'cut')
        vi.mocked(navigator.clipboard.writeText).mockImplementation(() => pending.then(() => {}));
      else vi.mocked(navigator.clipboard.readText).mockReturnValue(pending);
      const work = app.clipboardAction(action);
      app.duplicate();
      const before = app.activeDocument();
      resolve(system);
      await work;
      expect(app.notice()).toMatch(/cancelled/);
      expect(app.activeDocument()).toBe(before);
    },
  );
  it('keeps a timed copy recoverable when saved-query guards reject cut atomically', async () => {
    timedClipboardDocument();
    const original = app.activeDocument()!;
    const network = {
      ...original.network,
      savedQueries: captureSavedQueries(original.network, ['<query name="Protected"/>']),
    };
    app.workspace.set(
      docs.updateDocument(app.workspace(), original.id, () =>
        docs.openNetworkDocument(network, { id: original.id, timed: true }),
      ),
    );
    app.switchDocument(original.id);
    app.selectAll();
    const before = app.activeDocument();
    await app.clipboardAction('cut');
    expect(app.error()).toMatch(/queries/i);
    expect(app.activeDocument()).toBe(before);
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('denied'));
    await app.clipboardAction('paste');
    expect(app.net().nodes).toHaveLength(6);
    expect(app.timing()!.transports).toHaveLength(2);
  });
  it('gates all clipboard actions during simulation like GuiFrame.setGUIMode', async () => {
    app.selectElement('idle');
    app.setMode('Simulate');
    for (const action of ['copy', 'cut', 'paste'] as const) await app.clipboardAction(action);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    expect(app.activeDocument()!.past).toHaveLength(0);
  });
  it('shows saved-query names and explicitly removes them in one undoable document action', async () => {
    const original = app.activeDocument()!;
    const network = {
      ...original.network,
      savedQueries: captureSavedQueries(original.network, ['<query name="Safety"/>']),
    };
    app.workspace.set(
      docs.openDocument(docs.createWorkspace(), docs.openNetworkDocument(network, { saved: true })),
    );
    app.switchDocument(app.activeDocument()!.id);
    expect(app.savedQueryNames()).toEqual(['Safety']);
    app.discardSavedQueries();
    expect(app.savedQueryNames()).toEqual([]);
    expect(app.activeDocument()!.past).toHaveLength(1);
    app.undo();
    expect(app.savedQueryNames()).toEqual(['Safety']);
    expect(app.dirty()).toBe(false);
  });
});

describe('timed document UI workflow', () => {
  let app: App;
  let svg: SVGSVGElement;
  beforeEach(() => {
    vi.useFakeTimers();
    app = new App();
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    Object.assign(app, { canvas: new ElementRef(svg) });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    svg.remove();
  });
  async function openTimed() {
    let doc = docs.createTimedDocument({ name: 'Aged', componentName: 'Main' });
    doc = docs.commitComponentNet(doc, {
      ...docs.activeNet(doc),
      nodes: [
        { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 100, y: 100 },
        { id: 't', name: 'T', kind: 'transition', tokens: 0, x: 200, y: 100 },
        { id: 'q', name: 'Q', kind: 'place', tokens: 0, x: 300, y: 100 },
      ],
      arcs: [
        { id: 'i', source: 'p', target: 't', weight: 1, kind: 'normal' },
        { id: 'o', source: 't', target: 'q', weight: 1, kind: 'normal' },
      ],
    });
    doc = docs.setPlaceTokenAges(doc, 'p', ['0.1', '2.5']);
    doc = docs.setPlaceInvariant(doc, 'p', { upper: '3', upperClosed: true });
    await app.openFile({
      target: {
        files: [{ size: 100, name: 'a.json', text: async () => serializeNetworkJson(doc.network) }],
        value: 'a.json',
      },
    } as unknown as Event);
    return app.activeDocument()!;
  }
  async function openTimedNetwork() {
    const original = await openTimed();
    const alpha = original.network.components[0];
    const beta = {
      ...structuredClone(alpha),
      id: 'beta',
      timing: {
        ...structuredClone(alpha.timing!),
        transports: [{ inputArc: 'i', outputArc: 'o' }],
      },
    };
    beta.net.template = 'Beta';
    beta.net.nodes.find((n) => n.id === 'p')!.name = 'OtherP';
    beta.net.nodes.find((n) => n.id === 'q')!.name = 'OtherQ';
    beta.net.arcs.forEach((a) => (a.weight = 2));
    const inactive = {
      ...structuredClone(alpha),
      id: 'inactive',
      active: false,
      timing: { ...structuredClone(alpha.timing!), urgent: ['t'] },
    };
    inactive.net.template = 'Frozen';
    const network = { ...original.network, components: [alpha, beta, inactive] };
    await app.openFile({
      target: {
        files: [
          { size: 100, name: 'network.json', text: async () => serializeNetworkJson(network) },
        ],
        value: 'network.json',
      },
    } as unknown as Event);
    return app.activeDocument()!;
  }
  it('shares exact time across duplicate local IDs and freezes inactive ages while preserving global history on view changes', async () => {
    const doc = await openTimedNetwork();
    app.setMode('Simulate');
    expect(app.enabledTransitions()).toEqual([
      { componentId: doc.session.componentId, elementId: 't' },
      { componentId: 'beta', elementId: 't' },
    ]);
    expect(app.legalDelay()).toBe('[0,0.5]');
    app.delayAmount.set('0.1');
    app.delay();
    app.switchComponent('beta');
    app.delayAmount.set('0.2');
    app.delay();
    expect(app.globalTime()).toBe('0.3');
    expect(app.currentAges()['p']).toEqual(['0.4', '2.8']);
    const trace = app.trace();
    app.switchComponent('inactive');
    expect(app.mode()).toBe('Simulate');
    expect(app.inactiveView()).toBe(true);
    expect(app.currentAges()['p']).toEqual(['0.1', '2.5']);
    expect(app.enabledIds()).toEqual([]);
    expect(app.trace()).toEqual(trace);
    expect(app.cursor()).toBe(2);
    app.back();
    expect(app.globalTime()).toBe('0.1');
    app.switchComponent(doc.session.componentId);
    app.step();
    expect(app.globalTime()).toBe('0.3');
    expect(app.historyMarkingText(2, app.trace()[2])).toContain('Beta.OtherP: 2.8');
    app.back();
    app.delayAmount.set('0.1');
    app.delay();
    expect(app.globalTime()).toBe('0.2');
    expect(app.canForward()).toBe(false);
    app.resetSimulation();
    expect(app.globalTime()).toBe('0');
    expect(app.currentAges()['p']).toEqual(['0.1', '2.5']);
    expect(app.trace()).toHaveLength(1);
  });
  it('resolves manual weighted transport choices against the origin component from an inactive view and replays snapshots', async () => {
    const doc = await openTimedNetwork();
    app.setMode('Simulate');
    app.switchComponent('inactive');
    app.setTokenPolicy('manual');
    const ref = { componentId: 'beta', elementId: 't' };
    app.fireEnabled(ref);
    const draft = app.tokenDraft()!;
    expect(draft.componentId).toBe('beta');
    expect(draft.inputs[0]).toMatchObject({
      arcId: 'i',
      place: 'p',
      placeName: 'OtherP',
      destinationName: 'OtherQ',
      weight: 2,
    });
    const ids = draft.inputs[0].tokens.map((t) => t.id);
    app.confirmTokenSelection({ i: ids });
    expect(app.error()).toBe('');
    expect(app.cursor()).toBe(1);
    expect(app.trace()[1].transition).toEqual(ref);
    expect(app.historyLabel(1, app.trace()[1])).toBe('Fire Beta.T · time 0');
    expect(app.trace()[1].marking[doc.session.componentId]['p']).toBe(2);
    app.switchComponent('beta');
    expect(app.currentAges()['q']).toEqual(['0.1', '2.5']);
    app.back();
    app.step();
    expect(app.tokenDraft()).toBeNull();
    expect(app.currentAges()['q']).toEqual(['0.1', '2.5']);
    app.back();
    app.fireEnabled(ref);
    const stale = app.tokenDraft()!;
    app.switchComponent(doc.session.componentId);
    expect(app.tokenDraft()).toBeNull();
    app.confirmTokenSelection({ i: ids }, stale);
    expect(app.cursor()).toBe(0);
    expect(app.canForward()).toBe(true);
  });
  it('uses qualified enabled-row selection and global Step from an inactive view', async () => {
    const doc = await openTimedNetwork();
    app.setMode('Simulate');
    app.selectEnabled({ componentId: 'beta', elementId: 't' });
    expect(app.activeDocument()!.session.componentId).toBe('beta');
    app.setTokenPolicy('youngest');
    app.fireSelected();
    expect(app.trace()[1].transition).toEqual({ componentId: 'beta', elementId: 't' });
    app.switchComponent('inactive');
    app.step();
    expect(app.trace()[2].transition).toEqual({
      componentId: doc.session.componentId,
      elementId: 't',
    });
    app.fireEnabled({ componentId: 'inactive', elementId: 't' });
    expect(app.error()).toMatch(/not enabled/);
    expect(app.cursor()).toBe(2);
  });
  it('intersects other active occupied invariants and enabled urgency even from an inactive view', async () => {
    const doc = await openTimedNetwork();
    let network = {
      ...doc.network,
      components: doc.network.components.map((c, i) => ({
        ...c,
        timing: {
          ...c.timing!,
          invariants:
            i === 0
              ? {}
              : i === 1
                ? { p: { upper: '3', upperClosed: false } }
                : c.timing!.invariants,
        },
      })),
    };
    app.workspace.set(
      docs.openDocument(app.workspace(), docs.openNetworkDocument(network, { timed: true }), {
        timed: true,
      }),
    );
    app.setMode('Simulate');
    app.switchComponent('inactive');
    expect(app.legalDelay()).toBe('[0,0.5)');
    app.delayAmount.set('0.5');
    app.delay();
    expect(app.error()).toMatch(/blocked/);
    expect(app.cursor()).toBe(0);
    app.setMode('Edit');
    network = {
      ...network,
      components: network.components.map((c, i) =>
        i === 1 ? { ...c, timing: { ...c.timing, transports: [], urgent: ['t'] } } : c,
      ),
    };
    app.workspace.set(
      docs.openDocument(app.workspace(), docs.openNetworkDocument(network, { timed: true }), {
        timed: true,
      }),
    );
    app.setMode('Simulate');
    app.switchComponent('inactive');
    expect(app.legalDelay()).toBe('[0,0]');
    app.delayAmount.set('0.1');
    app.delay();
    expect(app.error()).toMatch(/blocked/);
    expect(app.globalTime()).toBe('0');
  });
  it('saves every initial component and age mid-run and ends the run on a source revision', async () => {
    const doc = await openTimedNetwork();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const oldCreate = URL.createObjectURL,
      oldRevoke = URL.revokeObjectURL;
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    try {
      app.setMode('Simulate');
      app.delayAmount.set('0.2');
      app.delay();
      app.fireEnabled({ componentId: 'beta', elementId: 't' });
      app.switchComponent('inactive');
      const trace = app.trace();
      app.save('json');
      expect(saved).toBeDefined();
      vi.useRealTimers();
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(saved!);
      });
      vi.useFakeTimers();
      expect(JSON.parse(text).network).toEqual(doc.network);
      expect(app.trace()).toEqual(trace);
      expect(app.cursor()).toBe(2);
      app.workspace.update((w) =>
        docs.updateDocument(w, doc.id, (d) => docs.renameDocument(d, 'Changed')),
      );
      app.delay();
      expect(app.mode()).toBe('Edit');
      expect(app.trace()).toEqual([]);
      app.setMode('Simulate');
      expect(app.cursor()).toBe(0);
      expect(app.globalTime()).toBe('0');
    } finally {
      click.mockRestore();
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
    }
  });
  it.each(['colored', 'stochastic'] as const)(
    'refuses unsupported %s without an untimed fallback',
    async (flag) => {
      const doc = await openTimedNetwork();
      const before = app.workspace();
      const network = { ...doc.network, type: { ...doc.network.type, [flag]: true } };
      await app.openFile({
        target: {
          files: [
            {
              size: 100,
              name: 'unsupported.json',
              text: async () => serializeNetworkJson(network),
            },
          ],
          value: 'unsupported.json',
        },
      } as unknown as Event);
      expect(app.mode()).toBe('Edit');
      expect(app.error()).toMatch(/Unsupported/);
      expect(app.workspace()).toEqual(before);
      expect(app.trace()).toEqual([]);
    },
  );
  it('opens manual drafts from all firing entrypoints, cancels without mutation and protects global actions', async () => {
    const doc = await openTimed();
    app.setMode('Simulate');
    expect(app.tokenPolicy()).toBe('random');
    app.setTokenPolicy('manual');
    const ref = { componentId: doc.session.componentId, elementId: 't' };
    for (const fire of [
      () => app.fireEnabled(ref),
      () => app.fire(app.net().nodes.find((n) => n.id === 't')!),
      () => app.step(),
      () => app.fireSelected(),
    ]) {
      fire();
      expect(app.tokenDraft()).not.toBeNull();
      const snapshot = app.trace();
      app.key(new KeyboardEvent('keydown', { key: 'Delete' }));
      const clipboard = {
        type: 'paste',
        target: svg,
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const clipboardAction = vi.spyOn(app, 'clipboardAction');
      app.clipboardEvent(clipboard);
      expect(clipboardAction).not.toHaveBeenCalled();
      expect(clipboard.preventDefault).not.toHaveBeenCalled();
      clipboardAction.mockRestore();
      expect(app.trace()).toEqual(snapshot);
      app.cancelTokenSelection();
      expect(app.cursor()).toBe(0);
      expect(app.trace()).toEqual(snapshot);
    }
    app.step();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    app.key(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(app.tokenDraft()).toBeNull();
    expect(app.activeDocument()!.network).toEqual(doc.network);
  });
  it('commits manual selection atomically, retains future on failure and replays without another dialog', async () => {
    const doc = await openTimed();
    app.setMode('Simulate');
    app.setTokenPolicy('manual');
    app.step();
    const draft = app.tokenDraft()!;
    expect(draft.inputs[0].tokens.map((t) => t.age)).toEqual(['0.1', '2.5']);
    app.confirmTokenSelection({ i: [draft.inputs[0].tokens[1].id] });
    expect(app.cursor()).toBe(1);
    expect(app.currentAges()['p']).toEqual(['0.1']);
    app.back();
    app.fireSelected();
    const trace = app.trace();
    app.confirmTokenSelection({ i: ['missing'] });
    expect(app.error()).toMatch(/ineligible/);
    expect(app.tokenSelectionError()).toMatch(/ineligible/);
    expect(app.trace()).toEqual(trace);
    expect(app.canForward()).toBe(true);
    app.cancelTokenSelection();
    app.step();
    expect(app.tokenDraft()).toBeNull();
    expect(app.currentAges()['p']).toEqual(['0.1']);
    expect(app.activeDocument()!.network).toEqual(doc.network);
  });
  it('invalidates drafts on delay, reset, navigation, policy, mode, tab and document revision changes', async () => {
    await openTimed();
    app.setMode('Simulate');
    app.setTokenPolicy('manual');
    const open = () => {
      app.fireSelected();
      return app.tokenDraft()!;
    };
    let draft = open();
    app.delayAmount.set('0.1');
    app.delay();
    expect(app.tokenDraft()).toBeNull();
    app.confirmTokenSelection({ i: [draft.inputs[0].tokens[0].id] }, draft);
    expect(app.cursor()).toBe(1);
    draft = open();
    app.resetSimulation();
    expect(app.tokenDraft()).toBeNull();
    app.confirmTokenSelection({ i: [draft.inputs[0].tokens[0].id] }, draft);
    expect(app.cursor()).toBe(0);
    open();
    app.setTokenPolicy('oldest');
    expect(app.tokenDraft()).toBeNull();
    app.setTokenPolicy('manual');
    open();
    app.back();
    expect(app.tokenDraft()).toBeNull();
    open();
    app.jumpToMarking(0);
    expect(app.tokenDraft()).toBeNull();
    open();
    app.setMode('Edit');
    expect(app.tokenDraft()).toBeNull();
    app.setMode('Simulate');
    open();
    const other = app.documents().find((d) => d.id !== app.activeDocument()!.id)!;
    app.switchDocument(other.id);
    expect(app.tokenDraft()).toBeNull();
    await openTimed();
    app.setMode('Simulate');
    app.setTokenPolicy('manual');
    draft = open();
    // A network revision (rather than a view update) invalidates the captured run.
    app.workspace.update((ws) =>
      docs.updateDocument(ws, app.activeDocument()!.id, (d) =>
        docs.setPlaceTokenAges(d, 'p', ['1', '2']),
      ),
    );
    app.confirmTokenSelection({ i: [draft.inputs[0].tokens[0].id] });
    expect(app.mode()).toBe('Edit');
    expect(app.tokenDraft()).toBeNull();
    expect(app.cursor()).toBe(0);
  });
  it('uses Random by default and Forward replays without sampling again', async () => {
    await openTimed();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      app.setMode('Simulate');
      app.step();
      expect(app.currentAges()['p']).toEqual(['2.5']);
      expect(random).toHaveBeenCalledOnce();
      app.back();
      app.setTokenPolicy('manual');
      app.step();
      expect(app.currentAges()['p']).toEqual(['2.5']);
      expect(app.tokenDraft()).toBeNull();
      expect(random).toHaveBeenCalledOnce();
    } finally {
      random.mockRestore();
    }
  });
  it('manual urgent inputs remain unrestricted and source/inhibitor-only transitions fire without a picker', async () => {
    const original = await openTimed();
    const urgent = docs.setTransitionUrgent(original, 't', true);
    app.workspace.update((ws) => docs.updateDocument(ws, original.id, () => urgent));
    app.setMode('Simulate');
    app.setTokenPolicy('manual');
    app.step();
    expect(app.legalDelay()).toBe('[0,0]');
    expect(app.tokenDraft()!.inputs[0].tokens.map((t) => t.age)).toEqual(['0.1', '2.5']);
    app.cancelTokenSelection();
    app.setMode('Edit');
    let source = docs.commitComponentNet(urgent, {
      ...docs.activeNet(urgent),
      arcs: docs.activeNet(urgent).arcs.filter((a) => a.id !== 'i'),
    });
    app.workspace.update((ws) => docs.updateDocument(ws, original.id, () => source));
    app.setMode('Simulate');
    app.step();
    expect(app.tokenDraft()).toBeNull();
    expect(app.cursor()).toBe(1);
    app.setMode('Edit');
    source = docs.commitComponentNet(source, {
      ...docs.activeNet(source),
      arcs: [
        ...docs.activeNet(source).arcs,
        { id: 'h', source: 'p', target: 't', kind: 'inhibitor', weight: 3 },
      ],
    });
    app.workspace.update((ws) => docs.updateDocument(ws, original.id, () => source));
    app.setMode('Simulate');
    app.step();
    expect(app.tokenDraft()).toBeNull();
    expect(app.cursor()).toBe(1);
    expect(app.currentAges()['p']).toEqual(['0.1', '2.5']);
  });
  it('rejects a stale generation even when the simulator cursor returns to the captured position', async () => {
    await openTimed();
    app.setMode('Simulate');
    app.setTokenPolicy('manual');
    app.step();
    const draft = app.tokenDraft()!;
    draft.simulator.delay('0');
    draft.simulator.back();
    expect(draft.simulator.cursor).toBe(0);
    const trace = draft.simulator.trace;
    app.confirmTokenSelection({ i: [draft.inputs[0].tokens[0].id] });
    expect(app.error()).toMatch(/expired/);
    expect(app.tokenDraft()).toBeNull();
    expect(draft.simulator.trace).toEqual(trace);
    expect(draft.simulator.canForward).toBe(true);
  });
  it('creates timed and untimed tabs and keeps independent edit histories', () => {
    app.newModel();
    app.submitDocumentDialog({ name: 'Timed', componentName: 'Main', timed: true });
    expect(app.timed()).toBe(true);
    app.context.set({ x: 100, y: 100, point: { x: 100, y: 100 }, id: null });
    app.contextAction('place');
    const timed = app.activeDocument()!;
    app.newModel();
    app.submitDocumentDialog({ name: 'Plain', componentName: 'Main', timed: false });
    expect(app.timed()).toBe(false);
    expect(app.canUndo()).toBe(false);
    app.switchDocument(timed.id);
    expect(app.canUndo()).toBe(true);
    app.undo();
    expect(app.net().nodes).toEqual([]);
  });
  it('opens timed opt-in, projects exact ages, delays/fires/replays and saves only initial data', async () => {
    const doc = await openTimed();
    expect(app.timed()).toBe(true);
    expect(app.agesText('p')).toBe('0.1, 2.5');
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    expect(app.legalDelay()).toBe('[0,0.5]');
    app.delayAmount.set('0.1');
    app.delay();
    app.delayAmount.set('0.2');
    app.delay();
    expect(app.currentAges()['p']).toEqual(['0.4', '2.8']);
    expect(app.historyLabel(2, app.trace()[2])).toBe('Delay 0.2 · time 0.3');
    app.back();
    const trace = app.trace();
    app.delayAmount.set('1');
    app.delay();
    expect(app.error()).toMatch(/blocked/);
    expect(app.trace()).toEqual(trace);
    expect(app.canForward()).toBe(true);
    app.step();
    expect(app.currentAges()['p']).toEqual(['0.4', '2.8']);
    app.tokenPolicy.set('youngest');
    app.fireSelected();
    expect(app.currentAges()['p']).toEqual(['2.8']);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let saved: Blob | undefined;
    const oldCreate = URL.createObjectURL,
      oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    try {
      app.save('json');
      expect(saved).toBeDefined();
      expect(app.activeDocument()!.network).toEqual(doc.network);
      expect(app.hasInitialAges()).toBe(true);
      expect(app.notice()).not.toContain('resets');
      app.save('tapn');
      expect(app.notice()).toContain('TAPAAL 4.0.4 resets nonzero initial ages to zero');
      expect(app.activeDocument()!.network).toEqual(doc.network);
    } finally {
      click.mockRestore();
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
    }
    app.resetSimulation();
    expect(app.currentAges()['p']).toEqual(['0.1', '2.5']);
    app.setMode('Edit');
    expect(app.marking()['p']).toBe(2);
  });
  it('duplicates timed initial ages in one undo step and keeps token-removal refusal visible', async () => {
    await openTimed();
    app.selectElement('p');
    const doc = app.activeDocument();
    app.duplicate();
    expect(app.error()).toBe('');
    const id = app.selectedIds()[0];
    expect(app.timing()?.ages[id]).toEqual(['0.1', '2.5']);
    expect(app.timing()?.invariants[id]).toEqual({ upper: '3', upperClosed: true });
    app.undo();
    expect(app.activeDocument()!.network).toEqual(doc!.network);
    app.redo();
    expect(app.timing()?.ages[id]).toEqual(['0.1', '2.5']);
    app.undo();
    app.changeTokens('p', -1);
    expect(app.error()).toMatch(/ages/);
    expect(app.activeDocument()!.network).toEqual(doc!.network);
    app.changeTokens('p', 1);
    expect(app.net().nodes[0].tokens).toBe(3);
    expect(app.timing()?.ages['p']).toEqual(['0.1', '2.5']);
  });
  it('commits timing dialogs atomically, refuses invalid ages and deletes a transport pair in one undo step', async () => {
    await openTimed();
    app.openEditor('i');
    app.applyTimedElement({
      element: app.editingElement()!,
      timing: { ...app.editorTiming()!, outputArc: 'o', interval: '[1,3]' },
    });
    expect(app.editingElement()).toBeNull();
    expect(app.timing()?.transports).toEqual([{ inputArc: 'i', outputArc: 'o' }]);
    app.openEditor('p');
    const before = app.activeDocument();
    app.applyTimedElement({
      element: app.editingElement()!,
      timing: { ...app.editorTiming()!, ages: '4' },
    });
    expect(app.dialogError()).toMatch(/invariant/i);
    expect(app.activeDocument()).toBe(before);
    app.closeEditor();
    app.selectElement('o');
    app.remove();
    expect(app.net().arcs).toEqual([]);
    expect(app.timing()?.transports).toEqual([]);
    app.undo();
    expect(app.net().arcs).toHaveLength(2);
    expect(app.timing()?.transports).toHaveLength(1);
  });
  it('allows timed network execution with inactive projections and switches safely', async () => {
    const timed = await openTimed();
    app.componentDialog('copy');
    app.submitDocumentDialog({ name: 'Aged', componentName: 'Copy' });
    expect(app.components()[1].timing).toEqual(app.components()[0].timing);
    app.toggleComponent(app.components()[1].id, { target: { checked: false } } as unknown as Event);
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    expect(app.inactiveView()).toBe(true);
    app.switchComponent(app.components()[0].id);
    expect(app.mode()).toBe('Simulate');
    app.delayAmount.set('0.1');
    app.delay();
    const initialId = app.documents().find((d) => d.id !== timed.id)!.id;
    app.switchDocument(initialId);
    expect(app.mode()).toBe('Edit');
    expect(app.timed()).toBe(false);
    app.setMode('Simulate');
    expect(app.mode()).toBe('Simulate');
    app.switchDocument(timed.id);
    expect(app.mode()).toBe('Edit');
    expect(app.timing()?.ages['p']).toEqual(['0.1', '2.5']);
  });
});
