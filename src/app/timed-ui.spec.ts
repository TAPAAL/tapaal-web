// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as d from './core/documents';
import { captureSavedQueries } from './core/saved-queries';
import {
  serializeNetworkJson,
  serializeNetworkTapn,
  parseNetworkModel,
} from './core/network-files';
import {
  DocumentSimulation,
  editTimedElement,
  timingDraft,
  parseInterval,
  parseInvariant,
} from './timed-ui';

function fixture() {
  let doc = d.createTimedDocument({ name: 'Timed' });
  doc = d.commitComponentNet(doc, {
    ...d.activeNet(doc),
    nodes: [
      { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 100, y: 100 },
      { id: 't', name: 'T', kind: 'transition', tokens: 0, x: 200, y: 100 },
      { id: 'q', name: 'Q', kind: 'place', tokens: 0, x: 300, y: 100 },
    ],
    arcs: [
      {
        id: 'i',
        source: 'p',
        target: 't',
        kind: 'normal',
        weight: 1,
        bends: [{ x: 130, y: 120, curved: false }],
      },
      {
        id: 'o',
        source: 't',
        target: 'q',
        kind: 'normal',
        weight: 1,
        bends: [{ x: 250, y: 140, curved: true }],
      },
    ],
  });
  return d.setPlaceTokenAges(doc, 'p', ['0.1', '2.50']);
}
function edit(doc: d.NetworkDocument, id: string, fields: Partial<ReturnType<typeof timingDraft>>) {
  const net = d.activeNet(doc);
  const element = [...net.nodes, ...net.arcs].find((n) => n.id === id)!;
  return editTimedElement(doc, { element, timing: { ...timingDraft(doc, element), ...fields } });
}
describe('native timed UI transactions and dispatch', () => {
  it('keeps saved-query node guards on atomic timed edits and cascade deletion', () => {
    const original = fixture();
    const network = {
      ...original.network,
      savedQueries: captureSavedQueries(original.network, ['<query name="Safety"/>']),
    };
    const doc = d.openNetworkDocument(network, { saved: true, timed: true });
    const element = { ...d.activeNet(doc).nodes[0], name: 'Renamed' };
    expect(() => editTimedElement(doc, { element, timing: timingDraft(doc, element) })).toThrow(
      /saved quer/i,
    );
    expect(() => d.removeComponentElements(doc, ['p'])).toThrow(/saved quer/i);
    expect(d.isDirty(doc)).toBe(false);
    expect(doc.past).toHaveLength(0);
  });

  it('pairs, edits both weights, unpairs and deletes transport halves atomically without losing routes', () => {
    const doc = fixture();
    const paired = edit(doc, 'i', { outputArc: 'o', interval: '(1,5]' });
    expect(paired.past.length).toBe(doc.past.length + 1);
    expect(d.activeNet(paired).arcs).toEqual(d.activeNet(doc).arcs);
    expect(paired.network.components[0].timing?.transports).toEqual([
      { inputArc: 'i', outputArc: 'o' },
    ]);
    const element = { ...d.activeNet(paired).arcs[1], weight: 2 };
    const weighted = editTimedElement(paired, { element, timing: timingDraft(paired, element) });
    expect(d.activeNet(weighted).arcs.map((a) => a.weight)).toEqual([2, 2]);
    expect(d.activeNet(weighted).arcs.map((a) => a.bends)).toEqual(
      d.activeNet(doc).arcs.map((a) => a.bends),
    );
    const removed = d.removeComponentElements(weighted, ['o']);
    expect(d.activeNet(removed).arcs).toEqual([]);
    expect(d.undoDocument(removed).network).toEqual(weighted.network);
    expect(edit(paired, 'i', { outputArc: '' }).network.components[0].timing?.transports).toEqual(
      [],
    );
  });
  it('filters transport eligibility by destination invariant and keeps selected ages after firing', () => {
    let doc = edit(fixture(), 'i', { outputArc: 'o' });
    doc = edit(doc, 'q', { invariant: '<= 1' });
    const sim = new DocumentSimulation(doc.network);
    sim.fire(doc.session.componentId, 't', 'oldest');
    expect(sim.ages('q')).toEqual(['0.1']); // oldest 2.50 is ineligible at destination
    expect(sim.ages('p')).toEqual(['2.50']);
    expect(sim.label(1)).toBe(`Fire ${doc.network.components[0].net.template}.T · time 0`);
    expect(doc.network.components[0].timing?.ages['p']).toEqual(['0.1', '2.50']);
  });
  it('implements exact delays, legal feedback, immutable failure, history replay, reset and branching', () => {
    const doc = edit(fixture(), 'p', { invariant: '<= 3' });
    const sim = new DocumentSimulation(doc.network);
    expect(sim.legalDelay).toBe('[0,0.5]');
    sim.delay('0.1');
    sim.delay('0.2');
    expect(sim.ages('p')).toEqual(['0.4', '2.8']);
    expect(sim.label(2)).toBe('Delay 0.2 · time 0.3');
    sim.back();
    const trace = sim.trace;
    expect(() => sim.delay('1')).toThrow(/blocked/);
    expect(sim.trace).toEqual(trace);
    expect(sim.canForward).toBe(true);
    sim.forward();
    expect(sim.ages('p')).toEqual(['0.4', '2.8']);
    sim.back();
    sim.delay('0.1');
    expect(sim.canForward).toBe(false);
    expect(sim.ages('p')).toEqual(['0.3', '2.7']);
    sim.reset();
    expect(sim.ages('p')).toEqual(['0.1', '2.50']);
    expect(sim.cursor).toBe(0);
    expect(() => sim.delay('1e-1')).toThrow(/decimal/);
  });
  it('uses deliberate oldest/youngest choice and ordinary output age zero', () => {
    const doc = fixture();
    const oldest = new DocumentSimulation(doc.network),
      youngest = new DocumentSimulation(doc.network);
    oldest.fire(doc.session.componentId, 't', 'oldest');
    youngest.fire(doc.session.componentId, 't', 'youngest');
    expect(oldest.ages('p')).toEqual(['0.1']);
    expect(youngest.ages('p')).toEqual(['2.50']);
    expect(oldest.ages('q')).toEqual(['0']);
  });
  it('enforces urgent input and destination constraints atomically and blocks delay only when enabled', () => {
    const doc = edit(fixture(), 't', { urgent: true });
    const sim = new DocumentSimulation(doc.network);
    expect(sim.legalDelay).toBe('[0,0]');
    expect(() => sim.delay('0.1')).toThrow(/blocked/);
    expect(sim.cursor).toBe(0);
    sim.delay('0');
    expect(() => edit(doc, 'i', { interval: '[1,5]' })).toThrow(/urgent/i);
    const transport = edit(doc, 'i', { outputArc: 'o' });
    expect(() => edit(transport, 'q', { invariant: '<= 5' })).toThrow(/urgent/i);
    expect(doc.network.components[0].timing?.intervals).toEqual({});
    const empty = editTimedElement(doc, {
      element: { ...d.activeNet(doc).nodes[0], tokens: 0 },
      timing: { ...timingDraft(doc, d.activeNet(doc).nodes[0]), ages: '' },
    });
    expect(new DocumentSimulation(empty.network).legalDelay).toBe('[0,inf)');
  });
  it('uses integer native bounds, keeps existing JSON decimal bounds, and refuses lossy native save', () => {
    expect(parseInterval('(1,5]')).toEqual({
      lower: '1',
      upper: '5',
      lowerClosed: false,
      upperClosed: true,
    });
    expect(parseInvariant('<= 0')).toEqual({ upper: '0', upperClosed: true });
    for (const text of ['[0.5,5]', '[0,2147483648]', '[0,inf]', '(2,2)'])
      expect(() => parseInterval(text)).toThrow();
    expect(() => parseInvariant('< 0')).toThrow();
    let doc = d.setArcInterval(fixture(), 'i', {
      lower: '0.5',
      upper: null,
      lowerClosed: true,
      upperClosed: false,
    });
    doc = edit(doc, 'i', {});
    expect(doc.network.components[0].timing?.intervals['i'].lower).toBe('0.5');
    expect(() => serializeNetworkTapn(doc.network)).toThrow(/JSON/);
    expect(parseNetworkModel(serializeNetworkJson(doc.network), 'a.json').network).toEqual(
      doc.network,
    );
  });
  it('preserves initial marking, ages and independent document undo; supports active and inactive timed components', () => {
    const doc = fixture(),
      sim = new DocumentSimulation(doc.network);
    const before = serializeNetworkTapn(doc.network);
    sim.delay('0.2');
    sim.fire(doc.session.componentId, 't', 'oldest');
    expect(serializeNetworkTapn(doc.network)).toBe(before);
    const multi = d.addComponent(doc, 'Other');
    expect(new DocumentSimulation(multi.network).trace).toHaveLength(1);
    const inactive = d.setComponentActive(multi, multi.network.components[1].id, false);
    expect(
      new DocumentSimulation(inactive.network).enabled.every(
        (ref) => ref.componentId !== inactive.network.components[1].id,
      ),
    ).toBe(true);
    const copied = d.copyComponent(doc, doc.session.componentId, 'Copy');
    expect(copied.network.components[1].timing).toEqual(doc.network.components[0].timing);
    const plain = d.createDocument({ name: 'Untimed' });
    expect(new DocumentSimulation(d.addComponent(plain, 'Other').network).trace).toHaveLength(1);
  });
});

describe('random and manual document token selection', () => {
  it('defaults to injected random, samples without replacement and replays without repicking', () => {
    const doc = fixture(),
      random = vi.fn(() => 0);
    const sim = new DocumentSimulation(doc.network, random);
    sim.fire(doc.session.componentId, 't');
    expect(sim.ages('p')).toEqual(['2.50']);
    expect(random).toHaveBeenCalledOnce();
    sim.back();
    sim.forward();
    expect(sim.ages('p')).toEqual(['2.50']);
    expect(random).toHaveBeenCalledOnce();
    expect(doc.network.components[0].timing!.ages['p']).toEqual(['0.1', '2.50']);
  });
  it.each([1, -0.1, NaN, Infinity])(
    'rejects bad random %s without losing a future snapshot',
    (value) => {
      const doc = fixture(),
        sim = new DocumentSimulation(doc.network, () => value);
      sim.fire(doc.session.componentId, 't', 'oldest');
      sim.back();
      const trace = sim.trace,
        version = sim.version;
      expect(() => sim.fire(doc.session.componentId, 't', 'random')).toThrow(/Random source/);
      expect(sim.trace).toEqual(trace);
      expect(sim.cursor).toBe(0);
      expect(sim.version).toBe(version);
      expect(sim.canForward).toBe(true);
    },
  );
  it('requires exact weighted and multiple input bindings, retaining transported identities and ages', () => {
    let doc = fixture();
    doc = d.commitComponentNet(doc, {
      ...d.activeNet(doc),
      nodes: [
        ...d.activeNet(doc).nodes,
        { id: 'r', name: 'R', kind: 'place', tokens: 1, x: 100, y: 200 },
      ],
      arcs: [
        ...d.activeNet(doc).arcs,
        { id: 'j', source: 'r', target: 't', kind: 'normal', weight: 1 },
      ],
    });
    doc = d.setPlaceTokenAges(doc, 'p', ['2', '2']);
    doc = edit(doc, 'i', { outputArc: 'o' });
    const element = { ...d.activeNet(doc).arcs[0], weight: 2 };
    doc = editTimedElement(doc, { element, timing: timingDraft(doc, element) });
    const sim = new DocumentSimulation(
      doc.network,
      vi.fn(() => 0.99),
    );
    const [i, j] = sim.eligibleInputs({ componentId: doc.session.componentId, elementId: 't' });
    expect(i.tokens[0].id).not.toBe(i.tokens[1].id);
    const bindings = { [i.arcId]: i.tokens.map((t) => t.id), [j.arcId]: j.tokens.map((t) => t.id) };
    expect(() =>
      sim.fire(doc.session.componentId, 't', { mode: 'manual', bindings: { i: [i.tokens[0].id] } }),
    ).toThrow(/exactly/);
    expect(sim.cursor).toBe(0);
    sim.fire(doc.session.componentId, 't', { mode: 'manual', bindings });
    expect(sim.ages('q')).toEqual(['2', '2']);
    expect(
      sim.eligibleInputs({ componentId: doc.session.componentId, elementId: 't' })[0].tokens,
    ).toEqual([]);
    sim.back();
    const future = sim.trace;
    expect(() =>
      sim.fire(doc.session.componentId, 't', {
        mode: 'manual',
        bindings: { ...bindings, i: ['missing', i.tokens[1].id] },
      }),
    ).toThrow(/ineligible/);
    expect(sim.trace).toEqual(future);
    expect(sim.canForward).toBe(true);
    sim.forward();
    expect(sim.ages('q')).toEqual(['2', '2']);
    sim.back();
    sim.fire(doc.session.componentId, 't', 'random');
    expect(sim.ages('q')).toEqual(['2', '2']);
  });
});

it('random weighted transport samples from the shrinking eligible pool, and second-sample failure is atomic', () => {
  let doc = edit(fixture(), 'i', { outputArc: 'o' });
  const element = { ...d.activeNet(doc).arcs[0], weight: 2 };
  doc = editTimedElement(doc, { element, timing: timingDraft(doc, element) });
  const random = vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0);
  const sim = new DocumentSimulation(doc.network, random);
  sim.fire(doc.session.componentId, 't', 'random');
  expect(sim.ages('q')).toEqual(['2.50', '0.1']);
  expect(random).toHaveBeenCalledTimes(2);
  sim.back();
  const trace = sim.trace;
  random.mockReturnValueOnce(0).mockReturnValueOnce(1);
  expect(() => sim.fire(doc.session.componentId, 't', 'random')).toThrow(/Random source/);
  expect(sim.trace).toEqual(trace);
  expect(sim.cursor).toBe(0);
  expect(sim.canForward).toBe(true);
});

it('manual input choices share strict source endpoints and transport destination eligibility with firing', () => {
  let doc = edit(fixture(), 'i', { outputArc: 'o', interval: '(0,3)' });
  doc = edit(doc, 'q', { invariant: '<= 1' });
  const sim = new DocumentSimulation(doc.network);
  const input = sim.eligibleInputs({ componentId: doc.session.componentId, elementId: 't' })[0];
  expect(input.tokens.map((t) => t.age)).toEqual(['0.1']);
  const original = fixture();
  const all = new DocumentSimulation(original.network).eligibleInputs({
    componentId: original.session.componentId,
    elementId: 't',
  })[0].tokens;
  const ineligible = all.find((t) => t.age === '2.50')!;
  expect(() =>
    sim.fire(doc.session.componentId, 't', { mode: 'manual', bindings: { i: [ineligible.id] } }),
  ).toThrow(/ineligible/);
  expect(sim.cursor).toBe(0);
  sim.fire(doc.session.componentId, 't', { mode: 'manual', bindings: { i: [input.tokens[0].id] } });
  expect(sim.ages('q')).toEqual(['0.1']);
  doc = edit(fixture(), 'i', { interval: '(0,2)' });
  expect(
    new DocumentSimulation(doc.network)
      .eligibleInputs({ componentId: doc.session.componentId, elementId: 't' })[0]
      .tokens.map((t) => t.age),
  ).toEqual(['0.1']);
});
