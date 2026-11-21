import { describe, expect, it } from 'vitest';
import {
  clipboardPayload,
  copySelection,
  parseNativeClipboard,
  parseWebClipboard,
  pasteClipboard,
  readClipboard,
  serializeNativeClipboard,
} from './clipboard';
import {
  activeNet,
  commitTimedComponent,
  createTimedDocument,
  redoDocument,
  undoDocument,
  type ComponentTiming,
} from './documents';
import type { Net } from './net';
import { pasteTiming } from './timed-clipboard';

function fixture(): { net: Net; timing: ComponentTiming } {
  return {
    net: {
      name: 'Timed',
      template: 'Main',
      nodes: [
        {
          id: 'p',
          kind: 'place',
          name: 'P0',
          x: 40.5,
          y: 50,
          tokens: 3,
          nameOffsetX: 8,
          nameVisible: false,
        },
        { id: 't', kind: 'transition', name: 'T0', x: 140, y: 50, tokens: 0, angle: 90 },
        { id: 'q', kind: 'place', name: 'P1', x: 240, y: 50, tokens: 0 },
        { id: 'u', kind: 'transition', name: 'T1', x: 140, y: 150, tokens: 0 },
      ],
      arcs: [
        {
          id: 'i',
          nameOffsetX: -7.5,
          nameOffsetY: 23,
          source: 'p',
          target: 't',
          kind: 'normal',
          weight: 2,
          bends: [{ x: 80, y: 25, curved: true }],
          curvedEnd: true,
        },
        {
          id: 'o',
          source: 't',
          target: 'q',
          kind: 'normal',
          weight: 2,
          bends: [{ x: 200, y: 25, curved: false }],
        },
      ],
      annotations: [{ id: 'note', text: 'Aged pair', x: 10, y: 200, width: 120, height: 40 }],
    },
    timing: {
      intervals: { i: { lower: '1', upper: '5', lowerClosed: false, upperClosed: false } },
      invariants: { p: { upper: '4', upperClosed: false } },
      ages: { p: ['0.1', '2.50'] },
      urgent: ['u'],
      transports: [{ inputArc: 'i', outputArc: 'o' }],
    },
  };
}
function copied() {
  const { net, timing } = fixture();
  return copySelection(
    net,
    [...net.nodes, ...net.arcs, ...net.annotations!].map((n) => n.id),
    { timing, selectedArcsOnly: true },
  );
}

describe('timed clipboard transactions', () => {
  it('keeps the complete model timing and layout frozen, detached and explicitly typed in plain text', () => {
    const { net, timing } = fixture();
    const before = structuredClone({ net, timing });
    const payload = copySelection(
      net,
      [...net.nodes, ...net.arcs, ...net.annotations!].map((n) => n.id),
      { timing },
    );
    expect({ net, timing }).toEqual(before);
    expect(payload.content.timing).toEqual(timing);
    expect(Object.isFrozen(payload.content.timing!.ages['p'])).toBe(true);
    expect(JSON.parse(payload.nativeText)).toMatchObject({
      format: 'tapaal-web-clipboard',
      version: 2,
      modelType: 'timed',
    });
    expect(parseWebClipboard(payload.webText)).toEqual(payload.content);
    expect(parseWebClipboard(payload.webText).arcs[0]).toMatchObject({
      nameOffsetX: -7.5,
      nameOffsetY: 23,
    });
    expect(readClipboard({ text: payload.nativeText }).content).toEqual(payload.content);
    expect(readClipboard({ text: payload.nativeText, webText: payload.webText }).source).toBe(
      'web',
    );
    net.nodes[0].tokens = 10;
    expect(payload.content.nodes[0].tokens).toBe(3); // one implicit zero + two recorded nonzero ages
    expect(() => serializeNativeClipboard(payload.content)).toThrow(/desktop/);
  });
  it('maps weighted transport halves, strict bounds, ages, urgency, labels, angles, notes and both routes with one undo/redo', () => {
    const payload = copied();
    let doc = createTimedDocument({ name: 'Target', componentName: 'Other' });
    const base = fixture();
    doc = commitTimedComponent(
      doc,
      { ...base.net, name: 'Target', template: 'Other' },
      base.timing,
    );
    const before = doc.network;
    const pasted = pasteClipboard(activeNet(doc), payload.content, { timedTarget: true });
    const timing = pasteTiming(
      doc.network.components[0].timing!,
      payload.content.timing,
      pasted.idMap,
    );
    const next = commitTimedComponent(doc, pasted.net, timing);
    expect(next.past.length).toBe(doc.past.length + 1);
    expect(pasted.net.nodes.slice(4).map((n) => n.name)).toEqual(['P2', 'P3', 'T2', 'T3']);
    expect(pasted.net.nodes[4]).toMatchObject({
      tokens: 3,
      nameOffsetX: 8,
      nameVisible: false,
      x: 70.5,
    });
    expect(pasted.net.nodes[6].angle).toBe(90);
    expect(pasted.net.annotations![1]).toMatchObject({ text: 'Aged pair', x: 40, y: 230 });
    expect(pasted.net.arcs[2]).toMatchObject({
      weight: 2,
      bends: [{ x: 110, y: 55, curved: true }],
      curvedEnd: true,
    });
    expect(pasted.net.arcs[3].bends![0]).toMatchObject({ x: 230, y: 55 });
    expect(timing.transports[1]).toEqual({
      inputArc: pasted.idMap['i'],
      outputArc: pasted.idMap['o'],
    });
    expect(timing.ages[pasted.idMap['p']]).toEqual(['0.1', '2.50']);
    expect(timing.intervals[pasted.idMap['i']]).toEqual(payload.content.timing!.intervals['i']);
    expect(timing.urgent).toContain(pasted.idMap['u']);
    expect(undoDocument(next).network).toEqual(before);
    expect(redoDocument(undoDocument(next)).network).toEqual(next.network);
    expect(doc.network).toBe(before);
  });
  it.each([['i'], ['p'], ['p', 't', 'i'], ['p', 't', 'q', 'i']])(
    'refuses touched incomplete transport selection %j without changing inputs',
    (...selected) => {
      const { net, timing } = fixture();
      const before = structuredClone({ net, timing });
      expect(() => copySelection(net, selected, { timing, selectedArcsOnly: true })).toThrow(
        /both transport halves/,
      );
      expect({ net, timing }).toEqual(before);
    },
  );
  it('refuses even all-default timed → untimed and permits untimed → timed defaults', () => {
    const { net } = fixture();
    const plain = copySelection(net, ['p']);
    const timed = clipboardPayload({
      ...plain.content,
      timing: { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] },
    });
    expect(() => pasteClipboard(net, timed.content)).toThrow(/untimed/);
    expect(pasteClipboard(net, plain.content, { timedTarget: true }).net.nodes).toHaveLength(5);
  });
  it.each(['half', 'weight', 'unknown', 'null', 'age', 'urgent', 'interval', 'prototype'])(
    'rejects malformed %s timing atomically',
    (kind) => {
      const envelope = JSON.parse(copied().webText);
      if (kind === 'half') envelope.timing.transports[0].outputArc = 'missing';
      if (kind === 'weight') envelope.arcs[1].weight = 1;
      if (kind === 'unknown') envelope.timing.intervals.i.extra = true;
      if (kind === 'null') envelope.timing = null;
      if (kind === 'age') envelope.timing.ages.p = ['9'];
      if (kind === 'urgent') envelope.timing.urgent = ['t'];
      if (kind === 'interval') envelope.timing.intervals.i.lower = '8';
      if (kind === 'prototype') envelope.timing.ages = JSON.parse('{"__proto__":["1"]}');
      expect(() => parseWebClipboard(JSON.stringify(envelope))).toThrow();
    },
  );
  it('refuses native timed semantics instead of pretending native file AST is the clipboard contract', () => {
    const { net } = fixture();
    const native = JSON.parse(serializeNativeClipboard(copySelection(net, ['q']).content));
    native.places[0].invariant = '< 5';
    expect(() => parseNativeClipboard(JSON.stringify(native))).toThrow(/invariant/);
    native.places[0].invariant = '< inf';
    native.places[0].tokenAges = ['1']; // absent from PlaceModel in actual native clipboard contract
    expect(() => parseNativeClipboard(JSON.stringify(native))).toThrow(/unsupported field/);
  });
});
