// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as d from './documents';
import { Simulation } from './net';
import {
  parseNetworkJson,
  parseNetworkModel,
  parseNetworkTapn,
  serializeNetworkJson,
  serializeNetworkTapn,
} from './network-files';
import { TimedSimulation, delayTimed, initialTimedMarking, isTimedEnabled } from './timed';

// TimedArcPetriNetNetworkWriter shape: transport halves share "interval:group" and a transportID;
// nonzero initial ages follow initialMarkingAge; inhibitors always write [0,inf).
const TIMED = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <net active="true" id="Clock" type="P/T net">
    <labels border="false" height="40" positionX="10" positionY="300" width="120">Deadline</labels>
    <place displayName="false" id="P0" initialMarking="3" invariant="&lt;= 5" name="Start" nameOffsetX="-5" nameOffsetY="35" positionX="90" positionY="60">
      <initialMarkingAge>
        <token age="0.1"/>
        <token age="2.50"/>
      </initialMarkingAge>
    </place>
    <place displayName="true" id="P1" initialMarking="0" invariant="&lt; inf" name="Moved" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="60"/>
    <place displayName="true" id="P2" initialMarking="0" invariant="&lt; 7" name="Block" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="200"/>
    <transition angle="90" displayName="true" distribution="constant" firingMode="Random" id="T0" infiniteServer="false" name="Go" nameOffsetX="12" nameOffsetY="-4" player="0" positionX="195" positionY="60" priority="0" urgent="false" value="1.0" weight="1.0"/>
    <transition angle="0" displayName="true" id="T1" infiniteServer="false" name="Now" nameOffsetX="0" nameOffsetY="0" player="0" positionX="195" positionY="200" priority="0" urgent="true"/>
    <arc id="A0" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" transportID="1" type="transport" weight="2">
      <arcpath arcPointType="false" id="0" xCoord="105" yCoord="75"/>
      <arcpath arcPointType="true" id="1" xCoord="150" yCoord="20"/>
      <arcpath arcPointType="false" id="2" xCoord="210" yCoord="75"/>
    </arc>
    <arc id="A1" inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" transportID="1" type="transport" weight="2">
      <arcpath arcPointType="false" id="0" xCoord="210" yCoord="75"/>
      <arcpath arcPointType="false" id="1" xCoord="260" yCoord="130"/>
      <arcpath arcPointType="true" id="2" xCoord="315" yCoord="75"/>
    </arc>
    <arc id="A2" inscription="[2,inf)" nameOffsetX="0" nameOffsetY="0" source="P1" target="T0" type="timed" weight="3">
      <arcpath arcPointType="false" id="0" xCoord="315" yCoord="75"/>
      <arcpath arcPointType="false" id="1" xCoord="210" yCoord="75"/>
    </arc>
    <arc id="A3" inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P2" target="T1" type="tapnInhibitor" weight="1">
      <arcpath arcPointType="false" id="0" xCoord="315" yCoord="215"/>
      <arcpath arcPointType="false" id="1" xCoord="210" yCoord="215"/>
    </arc>
    <arc id="A4" inscription="1" nameOffsetX="0" nameOffsetY="0" source="T1" target="P2" type="normal" weight="1">
      <arcpath arcPointType="false" id="0" xCoord="210" yCoord="215"/>
      <arcpath arcPointType="false" id="1" xCoord="315" yCoord="215"/>
    </arc>
  </net>
  <query active="true" name="Moved" type="Default" query="EF Clock.Moved &gt;= 2"/>
  <k-bound bound="3"/>
  <feature isGame="false" isTimed="true" isColored="false" isStochastic="false"/>
</pnml>
`;
const example = (name: string) => readFileSync(`public/examples/${name}.tapn`, 'utf8');
const replace = (from: string, to: string) => {
  expect(TIMED).toContain(from);
  return TIMED.replace(from, to);
};

describe('native timed TAPN files', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'preserves timing for prototype-named place and input arc IDs: %s',
    (id) => {
      const baseline = parseNetworkTapn(TIMED).network.components[0].timing!;
      const nodeNetwork = parseNetworkTapn(TIMED.replaceAll('"P0"', `"${id}"`)).network;
      const nodeTiming = nodeNetwork.components[0].timing!;
      expect(Object.hasOwn(nodeTiming.invariants, id)).toBe(true);
      expect(Object.hasOwn(nodeTiming.ages, id)).toBe(true);
      expect(nodeTiming.invariants[id]).toEqual(baseline.invariants.P0);
      expect(nodeTiming.ages[id]).toEqual(baseline.ages.P0);
      expect(parseNetworkTapn(serializeNetworkTapn(nodeNetwork)).network).toEqual(nodeNetwork);
      const arcNetwork = parseNetworkTapn(TIMED.replaceAll('"A2"', `"${id}"`)).network;
      expect(Object.hasOwn(arcNetwork.components[0].timing!.intervals, id)).toBe(true);
      expect(arcNetwork.components[0].timing!.intervals[id]).toEqual(baseline.intervals.A2);
      expect(parseNetworkTapn(serializeNetworkTapn(arcNetwork)).network).toEqual(arcNetwork);
    },
  );
  it('preserves independent signed labels on both transport halves and all timed arc forms', () => {
    const source = TIMED.replaceAll(
      'nameOffsetX="0" nameOffsetY="0"',
      'nameOffsetX="-23" nameOffsetY="17"',
    );
    const network = parseNetworkTapn(source).network;
    expect(
      network.components[0].net.arcs.every((a) => a.nameOffsetX === -23 && a.nameOffsetY === 17),
    ).toBe(true);
    expect(parseNetworkTapn(serializeNetworkTapn(network)).network).toEqual(network);
  });
  it('imports intervals, strict bounds, invariants, exact ages, urgency and transports', () => {
    const { network, warnings } = parseNetworkTapn(TIMED, 'clock.tapn');
    expect(warnings).toEqual([]);
    expect(network.type).toEqual({ timed: true, colored: false, game: false, stochastic: false });
    const [{ net, timing }] = network.components;
    expect(timing).toEqual({
      intervals: {
        A0: { lower: '1', upper: '5', lowerClosed: false, upperClosed: false },
        A2: { lower: '2', upper: null, lowerClosed: true, upperClosed: false },
      },
      invariants: {
        P0: { upper: '5', upperClosed: true },
        P2: { upper: '7', upperClosed: false },
      },
      urgent: ['T1'],
      transports: [{ inputArc: 'A0', outputArc: 'A1' }],
      ages: { P0: ['0.1', '2.50'] },
    });
    // Both transport halves keep their own graph arcs and routes; weights stay on each half.
    expect(net.arcs.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: 'A0',
        kind: 'normal',
        weight: 2,
        bends: [{ x: 150, y: 20, curved: true }],
      }),
      expect.objectContaining({ id: 'A1', kind: 'normal', weight: 2, curvedEnd: true }),
    ]);
    expect(net.arcs[3]).toMatchObject({ id: 'A3', kind: 'inhibitor' });
    expect(net.nodes[0]).toMatchObject({ tokens: 3, nameVisible: false });
    expect(net.nodes[3]).toMatchObject({ angle: 90 });
    expect(net.annotations).toEqual([expect.objectContaining({ text: 'Deadline', border: false })]);
    expect(network.savedQueries?.xml).toHaveLength(1);
  });
  it('exports native timed syntax that reopens identically, keeping queries and layout', () => {
    const network = parseNetworkTapn(TIMED, 'clock.tapn').network;
    const xml = serializeNetworkTapn(network);
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const arc = (id: string) => document.querySelector(`arc[id="${id}"]`)!;
    for (const id of ['A0', 'A1']) {
      expect(arc(id).getAttribute('type')).toBe('transport');
      expect(arc(id).getAttribute('inscription')).toBe('(1,5):1');
      expect(arc(id).getAttribute('transportID')).toBe('1');
      expect(arc(id).getAttribute('weight')).toBe('2');
      expect(arc(id).querySelector('hlinscription numberconstant')?.getAttribute('value')).toBe(
        '2',
      );
    }
    expect(arc('A0').querySelectorAll('arcpath')).toHaveLength(3);
    expect(arc('A1').querySelectorAll('arcpath')).toHaveLength(3);
    expect(arc('A2').getAttribute('inscription')).toBe('[2,inf)');
    expect(arc('A3').getAttribute('inscription')).toBe('[0,inf)');
    const place = document.querySelector('place[id="P0"]')!;
    expect(place.getAttribute('invariant')).toBe('<= 5');
    expect(
      [...place.querySelectorAll('initialMarkingAge > token')].map((t) => t.getAttribute('age')),
    ).toEqual(['0.1', '2.50']);
    expect(document.querySelector('place[id="P1"]')!.getAttribute('invariant')).toBe('< inf');
    expect(document.querySelector('transition[id="T1"]')!.getAttribute('urgent')).toBe('true');
    expect(document.querySelector('feature')!.getAttribute('isTimed')).toBe('true');
    expect(document.querySelectorAll('pnml > query')).toHaveLength(1);
    expect(parseNetworkTapn(xml, 'clock.tapn').network).toEqual(network);
  });
  it('writes matching expressions on weighted normal input/output and inhibitor arcs too', () => {
    const xml = TIMED.replace(
      'type="tapnInhibitor" weight="1"',
      'type="tapnInhibitor" weight="4"',
    ).replace('type="normal" weight="1"', 'type="normal" weight="5"');
    const network = parseNetworkTapn(xml).network;
    const output = serializeNetworkTapn(network);
    const doc = new DOMParser().parseFromString(output, 'application/xml');
    for (const [id, value] of [
      ['A2', '3'],
      ['A3', '4'],
      ['A4', '5'],
    ]) {
      expect(
        doc.querySelector(`arc[id="${id}"] hlinscription numberconstant`)?.getAttribute('value'),
      ).toBe(value);
    }
    expect(parseNetworkTapn(output).network).toEqual(network);
  });
  it('round-trips real single-component desktop timed examples and refuses unsupported ones', () => {
    for (const name of [
      'intro-example',
      'workflow-simple',
      'producer-consumer',
      'alternating-bit-protocol',
      'fischer-protocol',
    ]) {
      const network = parseNetworkTapn(example(name), `${name}.tapn`).network;
      expect(parseNetworkTapn(serializeNetworkTapn(network), `${name}.tapn`).network).toEqual(
        network,
      );
      expect(() => d.timedModelForNetwork(network)).not.toThrow();
    }
    const intro = parseNetworkTapn(example('intro-example')).network.components[0].timing!;
    expect(intro.urgent).toEqual(['T4']);
    expect(intro.invariants).toEqual({ P2: { upper: '5', upperClosed: true } });
    expect(intro.transports).toEqual([{ inputArc: 'P1 to T3', outputArc: 'T3 to P6' }]);
    // Transport self-loops through one transition pair in document order.
    const simple = parseNetworkTapn(example('workflow-simple')).network.components[0].timing!;
    expect(simple.transports).toContainEqual({
      inputArc: 'Deadlines to A2_Done',
      outputArc: 'A2_Done to Deadlines',
    });
    expect(() => parseNetworkTapn(example('webserver'))).toThrow(/Constants are not supported/);
    expect(() => parseNetworkTapn(example('workflow-payment'))).toThrow(/Shared places/);
    expect(() => parseNetworkTapn(example('euler-number'))).toThrow(/Stochastic nets/);
    expect(() => parseNetworkTapn(example('cpn-packet'))).toThrow(/Coloured nets/);
    expect(() => parseNetworkTapn(example('game-harddisk'))).toThrow(/Game nets/);
  });
  it('rejects timing it cannot represent exactly, with precise messages', () => {
    const cases: [string, RegExp][] = [
      [
        replace(
          '(1,5):1" nameOffsetX="0" nameOffsetY="0" source="P0"',
          '(1,k):1" nameOffsetX="0" nameOffsetY="0" source="P0"',
        ),
        /Constant or non-integer bound "k"/,
      ],
      [replace('inscription="[2,inf)"', 'inscription="[2.5,inf)"'), /Malformed time interval/],
      [
        replace('inscription="[2,inf)"', 'inscription="[2,inf]"'),
        /Invalid time interval.*Infinity must be open/,
      ],
      [replace('inscription="[2,inf)"', 'inscription="(3,3]"'), /Empty or reversed/],
      [replace('inscription="[2,inf)"', 'inscription="[0,2147483648]"'), /exceeds 2,147,483,647/],
      [replace('invariant="&lt; 7"', 'invariant="&lt; 0"'), /invariant < 0 is invalid/],
      [replace('invariant="&lt; 7"', 'invariant="&lt;= inf"'), /Infinity must be open/],
      [replace('invariant="&lt; 7"', 'invariant="&lt; N"'), /Constant or non-integer bound "N"/],
      [replace('age="0.1"', 'age="1e-1"'), /plain nonnegative decimal/],
      [replace('age="0.1"', 'age="-1"'), /plain nonnegative decimal/],
      [replace('age="0.1"', 'age="0.1" color="dot"'), /Unsupported attribute color/],
      [replace('initialMarking="3"', 'initialMarking="1"'), /exceeds the initial marking/],
      [replace('age="2.50"', 'age="6"'), /violates the invariant/],
      [
        replace('<initialMarkingAge>', '<initialMarkingAge/><initialMarkingAge>'),
        /Duplicate initialMarkingAge/,
      ],
      [replace('urgent="true"', 'urgent="TRUE"'), /urgent must be/],
      [
        replace('type="tapnInhibitor"', 'type="tapnInhibitor" tagged="true"'),
        /Unsupported attribute tagged/,
      ],
      [
        replace(
          'inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P2"',
          'inscription="[1,inf)" nameOffsetX="0" nameOffsetY="0" source="P2"',
        ),
        /Inhibitor arcs only support/,
      ],
      [
        replace(
          'inscription="(1,5):1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" transportID="1" type="transport"',
          'inscription="1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" type="normal"',
        ),
        /Unpaired transport arc A0/,
      ],
      [
        replace(
          '(1,5):1" nameOffsetX="0" nameOffsetY="0" source="T0"',
          '(1,6):1" nameOffsetX="0" nameOffsetY="0" source="T0"',
        ),
        /different intervals or weights/,
      ],
      [
        replace(
          'source="T0" target="P1" transportID="1" type="transport" weight="2"',
          'source="T0" target="P1" transportID="1" type="transport" weight="1"',
        ),
        /different intervals or weights/,
      ],
      [
        replace(
          'id="A2" inscription="[2,inf)" nameOffsetX="0" nameOffsetY="0" source="P1" target="T0" type="timed"',
          'id="A2" inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P1" target="T0" type="transport"',
        ),
        /Unpaired transport arc A2/,
      ],
      [replace('<arc id="A2"', '<arc id="A1"'), /unique arc IDs/],
      [
        replace(
          'urgent="true"/>',
          'urgent="true"/><shared-place name="S" invariant="&lt; inf" initialMarking="0"/>',
        ),
        /Shared places/,
      ],
    ];
    for (const [source, message] of cases) expect(() => parseNetworkTapn(source)).toThrow(message);
    // A second pending input half for T0 before its output half: the loader would drop one.
    const second = TIMED.match(/<arc id="A2"[\s\S]*?<\/arc>\n/)![0]
      .replace('type="timed"', 'type="transport"')
      .replace('[2,inf)', '[0,inf)');
    const ambiguous = TIMED.replace(
      second.replace('type="transport"', 'type="timed"').replace('[0,inf)', '[2,inf)'),
      '',
    ).replace('    <arc id="A1"', `${second}    <arc id="A1"`);
    expect(() => parseNetworkTapn(ambiguous)).toThrow(/Ambiguous transport arcs A0 and A2/);
    // Untimed files keep the original untimed dialect and its refusals.
    const untimed = replace('isTimed="true"', 'isTimed="false"');
    expect(() => parseNetworkTapn(untimed)).toThrow(/Timed place invariants are not supported/);
  });
  it('re-pairs transport halves only when native document order would mis-pair them', () => {
    let doc = d.createTimedDocument({ name: 'Pairs', componentName: 'Net' });
    const net = d.activeNet(doc);
    const node = (id: string, kind: 'place' | 'transition', x: number) => ({
      id,
      name: id,
      kind,
      x,
      y: 0,
      tokens: 0,
    });
    net.nodes = [
      node('a', 'place', 0),
      node('b', 'place', 60),
      node('c', 'place', 120),
      node('e', 'place', 180),
      node('t', 'transition', 300),
    ];
    const arc = (id: string, source: string, target: string) => ({
      id,
      source,
      target,
      kind: 'normal' as const,
      weight: 1,
    });
    // in1, in2, out1, out2: the native loader would keep a pending input half and drop the other.
    net.arcs = [
      arc('in1', 'a', 't'),
      arc('in2', 'b', 't'),
      arc('out1', 't', 'c'),
      arc('out2', 't', 'e'),
    ];
    doc = d.commitComponentNet(doc, net);
    doc = d.setTransport(doc, 'in1', 'out1');
    doc = d.setTransport(doc, 'in2', 'out2');
    doc = d.setArcInterval(doc, 'in2', {
      lower: '1',
      upper: '4',
      lowerClosed: true,
      upperClosed: true,
    });
    const xml = serializeNetworkTapn(doc.network);
    const order = [
      ...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('arc'),
    ].map((a) => a.getAttribute('id'));
    expect(order).toEqual(['in1', 'out1', 'in2', 'out2']);
    expect(xml).toContain('inscription="[1,4]:2"');
    const reopened = parseNetworkTapn(xml).network;
    expect(reopened.components[0].timing).toEqual(doc.network.components[0].timing);
    // Already loader-safe order is kept as drawn.
    const kept = serializeNetworkTapn(parseNetworkTapn(xml).network);
    expect(kept).toBe(serializeNetworkTapn(reopened));
  });
  it('keeps exact decimals in JSON, refuses fractional bounds in TAPN, and leaves untimed output unchanged', () => {
    let doc = d.openNetworkDocument(parseNetworkTapn(TIMED).network, { timed: true });
    doc = d.setArcInterval(doc, 'A2', {
      lower: '0.1',
      upper: '0.3',
      lowerClosed: true,
      upperClosed: false,
    });
    const json = serializeNetworkJson(doc.network);
    expect(parseNetworkJson(json).network).toEqual(doc.network);
    expect(parseNetworkModel(json).network.components[0].timing!.intervals['A2'].lower).toBe('0.1');
    expect(() => serializeNetworkTapn(doc.network)).toThrow(
      /arc A2 has bound 0.1.*whole-number bounds.*Save JSON/,
    );
    const unknown = JSON.parse(json);
    unknown.network.components[0].timing.intervals.A2.open = true;
    expect(() => parseNetworkJson(JSON.stringify(unknown))).toThrow(
      /Unsupported field open in component Clock interval/,
    );
    // Untimed files gain no timing keys and keep their exact previous serialization.
    const untimed = d.createDocument({ name: 'Plain' }).network;
    expect(serializeNetworkJson(untimed)).not.toContain('timing');
    expect(serializeNetworkTapn(untimed)).toContain('isTimed="false"');
  });
  it('dispatches typed timed output through the auto parser but keeps untimed gates closed', () => {
    const { network } = parseNetworkModel(TIMED, 'clock.tapn');
    expect(network.type.timed).toBe(true);
    expect(() => d.openNetworkDocument(network, { saved: true })).toThrow(
      /Unsupported timed semantics/,
    );
    expect(() => d.legacyNetFromNetwork(network)).toThrow(/Unsupported timed semantics/);
    expect(d.networkCapabilities(network)).toMatchObject({ editable: false, executable: false });
    expect(d.networkCapabilities(network, { timed: true })).toMatchObject({
      editable: true,
      executable: false,
    });
    const doc = d.openNetworkDocument(network, { saved: true, timed: true });
    expect(() => d.openDocument(d.createWorkspace(), doc)).toThrow(/Unsupported timed/);
    expect(d.getDocument(d.openDocument(d.createWorkspace(), doc, { timed: true })).id).toBe(
      doc.id,
    );
    // The untimed simulator never receives the timed net through the supported adapters.
    expect(() => new Simulation(d.legacyNetFromNetwork(doc.network))).toThrow(/Unsupported timed/);
  });
  it('maps file timing to the timed engine with exact age arithmetic and strict bounds', () => {
    const network = parseNetworkTapn(TIMED).network;
    const model = d.timedModelForNetwork(network);
    expect(model.componentCount).toBe(1);
    expect(model.sharedElementIds).toEqual([]);
    expect(model.initial.map((t) => [t.place, t.age])).toEqual([
      ['P0', '0.1'],
      ['P0', '2.50'],
      ['P0', '0'],
    ]);
    // Urgent T1 (inhibited only once Block is marked) blocks every positive delay.
    const simulation = new TimedSimulation(model);
    expect(() => simulation.delay('0.1')).toThrow(/urgent/);
    simulation.fire('T1');
    simulation.delay('0.1');
    simulation.delay('0.2');
    expect(simulation.marking.tokens.filter((t) => t.place === 'P0').map((t) => t.age)).toEqual([
      '0.4',
      '2.8',
      '0.3',
    ]);
    // Without A2, T0 needs two P0 tokens strictly inside (1,5).
    const open = d.removeComponentElements(d.openNetworkDocument(network, { timed: true }), ['A2']);
    const timed = d.timedModelForNetwork(open.network);
    const fired = new TimedSimulation(timed);
    fired.fire('T1');
    const at = (amount: string) => delayTimed(timed, fired.marking, amount);
    expect(at('0.9').tokens.map((t) => t.age)).toEqual(['1', '3.4', '0.9', '0.9']);
    expect(isTimedEnabled(timed, at('0.9'), 'T0')).toBe(false);
    expect(isTimedEnabled(timed, at('0.9000000001'), 'T0')).toBe(true);
    expect(initialTimedMarking(timed).tokens).toHaveLength(3);
  });
  it('keeps saved-query protections on timed edits and preserves layout through timing edits', () => {
    let doc = d.openNetworkDocument(parseNetworkTapn(TIMED).network, { saved: true, timed: true });
    expect(() => d.removeComponentElements(doc, ['P2'])).toThrow(/saved quer/i);
    expect(d.isDirty(doc)).toBe(false);
    doc = d.setPlaceTokenAges(doc, 'P0', ['0.1', '2.50', '0']);
    doc = d.setTransitionUrgent(doc, 'T1', false);
    const net = d.activeNet(doc);
    expect(net.annotations).toEqual(parseNetworkTapn(TIMED).network.components[0].net.annotations);
    expect(net.nodes[0].nameVisible).toBe(false);
    expect(net.nodes[3].angle).toBe(90);
    expect(parseNetworkTapn(serializeNetworkTapn(doc.network)).network).toEqual(doc.network);
  });
});
