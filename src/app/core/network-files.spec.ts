// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as d from './documents';
import { writeDotDependencies } from './dot-expressions';
import { serializeJson, serializeTapn } from './files';
import { Net } from './net';
import {
  NETWORK_JSON_FORMAT,
  parseNetworkJson,
  parseNetworkModel,
  parseNetworkTapn,
  serializeNetworkJson,
  serializeNetworkTapn,
  tapnComponentId,
} from './network-files';

// Shaped like TimedArcPetriNetNetworkWriter output: dot declaration, stochastic defaults, k-bound.
const NATIVE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">
  <declaration>
    <structure>
      <declarations>
        <namedsort id="dot" name="dot">
          <dot/>
        </namedsort>
      </declarations>
    </structure>
  </declaration>
  <net active="true" id="Producer" type="P/T net">
    <place displayName="true" id="P0" initialMarking="2" invariant="&lt; inf" name="Buffer" nameOffsetX="-5" nameOffsetY="35" positionX="90" positionY="60"/>
    <place displayName="true" id="P1" initialMarking="0" invariant="&lt; inf" name="Done" nameOffsetX="0" nameOffsetY="0" positionX="300" positionY="60"/>
    <transition angle="0" displayName="true" distribution="constant" firingMode="Random" id="T0" infiniteServer="false" name="Make" nameOffsetX="12" nameOffsetY="-4" player="0" positionX="195" positionY="60" priority="0" urgent="false" value="1.0" weight="1.0"/>
    <arc id="A0" inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" type="timed" weight="3">
      <arcpath arcPointType="false" id="0" xCoord="119" yCoord="74"/>
      <arcpath arcPointType="true" id="1" xCoord="150" yCoord="20"/>
      <arcpath arcPointType="true" id="2" xCoord="200" yCoord="74"/>
    </arc>
    <arc id="A1" inscription="1" nameOffsetX="0" nameOffsetY="0" source="T0" target="P1" type="normal" weight="1">
      <arcpath arcPointType="false" id="0" xCoord="215" yCoord="74"/>
      <arcpath arcPointType="false" id="1" xCoord="250" yCoord="130"/>
      <arcpath arcPointType="false" id="2" xCoord="300" yCoord="74"/>
    </arc>
    <arc id="A2" inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P1" target="T0" type="tapnInhibitor" weight="2">
      <arcpath arcPointType="false" id="0" xCoord="300" yCoord="74"/>
      <arcpath arcPointType="false" id="1" xCoord="215" yCoord="74"/>
    </arc>
  </net>
  <net active="false" id="Consumer" type="P/T net">
    <place displayName="true" id="P0" initialMarking="1" invariant="&lt; inf" name="Buffer" nameOffsetX="-5" nameOffsetY="35" positionX="45" positionY="45"/>
    <transition angle="0" displayName="true" id="T0" infiniteServer="false" name="Take" nameOffsetX="-5" nameOffsetY="35" player="0" positionX="150" positionY="45" priority="0" urgent="false"/>
    <arc id="A0" inscription="[0,inf)" nameOffsetX="0" nameOffsetY="0" source="P0" target="T0" type="timed" weight="1">
      <arcpath arcPointType="false" id="0" xCoord="74" yCoord="59"/>
      <arcpath arcPointType="false" id="1" xCoord="155" yCoord="59"/>
    </arc>
  </net>
  <k-bound bound="3"/>
  <feature isGame="false" isTimed="false" isColored="false" isStochastic="false"/>
</pnml>
`;
const producer = (): Net => ({
  name: 'Producer consumer',
  template: 'Producer',
  nodes: [
    { id: 'P0', kind: 'place', name: 'Buffer', x: 105, y: 75, tokens: 2, nameOffsetX: -5 },
    { id: 'P1', kind: 'place', name: 'Done', x: 315, y: 75, tokens: 0, nameOffsetY: 0 },
    {
      id: 'T0',
      kind: 'transition',
      name: 'Make',
      x: 210,
      y: 75,
      tokens: 0,
      nameOffsetX: 12,
      nameOffsetY: -4,
    },
  ],
  arcs: [
    {
      id: 'A0',
      source: 'P0',
      target: 'T0',
      kind: 'normal',
      weight: 3,
      bends: [{ x: 150, y: 20, curved: true }],
      curvedEnd: true,
    },
    {
      id: 'A1',
      source: 'T0',
      target: 'P1',
      kind: 'normal',
      weight: 1,
      bends: [{ x: 250, y: 130, curved: false }],
    },
    { id: 'A2', source: 'P1', target: 'T0', kind: 'inhibitor', weight: 2 },
  ],
});
const consumer = (): Net => ({
  name: 'Producer consumer',
  template: 'Consumer',
  nodes: [
    { id: 'P0', kind: 'place', name: 'Buffer', x: 60, y: 60, tokens: 1, nameOffsetX: -5 },
    { id: 'T0', kind: 'transition', name: 'Take', x: 165, y: 60, tokens: 0, nameOffsetX: -5 },
  ],
  arcs: [{ id: 'A0', source: 'P0', target: 'T0', kind: 'normal', weight: 1 }],
});
const native = () => parseNetworkTapn(NATIVE, 'Producer consumer.tapn');
const edit = (change: (document: Document) => void, source = NATIVE) => {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  change(document);
  return new XMLSerializer().serializeToString(document);
};
const attr = (selector: string, key: string, value: string | null) =>
  edit((document) => {
    const element = document.querySelector(selector)!;
    if (value === null) element.removeAttribute(key);
    else element.setAttribute(key, value);
  });
const insert = (selector: string, source: string, before = false) =>
  edit((document) => {
    const wrapper = `<w xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb">${source}</w>`;
    const element = new DOMParser().parseFromString(wrapper, 'application/xml').documentElement
      .firstElementChild!;
    const target = document.querySelector(selector)!;
    const imported = document.importNode(element, true);
    if (before) target.parentNode!.insertBefore(imported, target);
    else target.appendChild(imported);
  });
const withoutIds = (network: d.Network) => ({
  ...network,
  components: network.components.map(({ active, net }) => ({ active, net })),
});

describe('native multi-component TAPN import', () => {
  it('writes exactly one XML declaration when saving a network', () => {
    const xml = serializeNetworkTapn(native().network);
    expect(xml.match(/<\?xml\b/g)).toHaveLength(1);
    expect(
      new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
  });
  it('keeps every component, its activation, local IDs and label/bend geometry', () => {
    const { network, warnings } = native();
    expect(warnings).toEqual([]);
    expect(network).toEqual({
      name: 'Producer consumer',
      type: { timed: false, colored: false, game: false, stochastic: false },
      components: [
        { id: 'tapn:Producer', active: true, net: producer() },
        { id: 'tapn:Consumer', active: false, net: consumer() },
      ],
    });
    expect(tapnComponentId('Consumer')).toBe('tapn:Consumer');
    expect(parseNetworkModel(NATIVE, 'x.tapn')).toEqual(parseNetworkTapn(NATIVE, 'x.tapn'));
  });
  it('opens as an editable document and supports multi-component editing', () => {
    const doc = d.openNetworkDocument(native().network, { saved: true });
    expect(d.isDirty(doc)).toBe(false);
    expect(d.networkCapabilities(doc.network)).toMatchObject({ editable: true, executable: true });
  });
  it('defaults absent native attributes like TapnXmlLoader', () => {
    const source = edit((document) => {
      const net = document.querySelectorAll('net')[1];
      net.removeAttribute('active');
      net.removeAttribute('type');
      for (const key of ['nameOffsetX', 'nameOffsetY', 'displayName', 'invariant'])
        net.querySelector('place')!.removeAttribute(key);
      for (const key of ['angle', 'priority', 'urgent', 'player', 'infiniteServer'])
        net.querySelector('transition')!.removeAttribute(key);
      for (const key of ['inscription', 'weight', 'nameOffsetX', 'nameOffsetY'])
        net.querySelector('arc')!.removeAttribute(key);
      document.querySelector('k-bound')!.remove();
      document.querySelector('declaration')!.remove();
    });
    const imported = parseNetworkTapn(source).network.components[1];
    expect(imported.active).toBe(true);
    const { nameOffsetX, ...place } = consumer().nodes[0];
    expect(nameOffsetX).toBe(-5);
    expect(imported.net.nodes[0]).toEqual({ ...place, nameOffsetY: 0 });
    expect(imported.net.arcs).toEqual(consumer().arcs);
  });
  it('uses the root title, else the filename, and keeps template identifiers distinct', () => {
    expect(native().network.name).toBe('Producer consumer');
    const titled = attr('pnml', 'name', 'My title');
    const network = parseNetworkTapn(titled, 'ignored.tapn').network;
    expect(network.name).toBe('My title');
    expect(network.components.map((c) => [c.net.name, c.net.template])).toEqual([
      ['My title', 'Producer'],
      ['My title', 'Consumer'],
    ]);
    expect(parseNetworkTapn(NATIVE, 'dir/.tapn').network.name).toBe('Imported model');
    const named = edit((document) => {
      const net = document.querySelectorAll('net')[1];
      net.removeAttribute('id');
      net.setAttribute('name', 'Renamed');
    });
    expect(parseNetworkTapn(named).network.components[1].id).toBe('tapn:Renamed');
  });
  it('reports repaired duplicate arc IDs per component without changing connections', () => {
    const source = edit((document) => {
      document.querySelectorAll('net')[0].querySelectorAll('arc')[1].setAttribute('id', 'A0');
    });
    const { network, warnings } = parseNetworkTapn(source);
    expect(network.components[0].net.arcs.map((a) => a.id)).toEqual(['A0', 'A0_1', 'A2']);
    expect(warnings).toEqual([expect.stringMatching(/^Component Producer: Duplicate arc IDs/)]);
  });
  it('rejects malformed feature, active, identity and structure', () => {
    const cases: [string, RegExp][] = [
      [attr('feature', 'isTimed', null), /Missing isTimed/],
      [attr('feature', 'isColored', 'true'), /Coloured nets/],
      [attr('feature', 'isGame', 'true'), /Game nets/],
      [attr('feature', 'isStochastic', 'true'), /Stochastic nets/],
      [edit((doc) => doc.querySelector('feature')!.remove()), /exactly one <feature>/],
      [insert('pnml', '<feature isTimed="false"/>'), /exactly one <feature>/],
      [attr('net', 'active', 'TRUE'), /active must be/],
      [
        edit((doc) =>
          doc.querySelectorAll('net').forEach((n) => n.setAttribute('active', 'false')),
        ),
        /At least one component must be active/,
      ],
      [attr('net', 'id', 'Consumer'), /Component identifiers must be unique/],
      [attr('net', 'id', '_Hidden'), /start with a letter/],
      [attr('net', 'id', 'bad name'), /Component identifier must start/],
      [attr('net', 'name', 'Other'), /conflicting id/],
      [edit((doc) => doc.querySelectorAll('net').forEach((n) => n.remove())), /no components/],
      [
        insert(
          'net',
          '<place id="P0" name="Extra" initialMarking="0" positionX="0" positionY="0"/>',
        ),
        /Element IDs must be nonempty and unique/,
      ],
      [
        insert(
          'net',
          '<place id="P9" name="Make" initialMarking="0" positionX="0" positionY="0"/>',
        ),
        /already used/,
      ],
      [attr('arc', 'source', 'missing'), /endpoints do not exist/],
      [attr('arc', 'type', 'normal'), /does not match its endpoints/],
      [attr('net:nth-of-type(1) arc:nth-of-type(2)', 'type', 'timed'), /does not match/],
      ['<pnml><net', /malformed/],
      ['<!DOCTYPE pnml><pnml/>', /document types/],
      ['<other/>', /Expected a TAPAAL PNML/],
    ];
    for (const [source, message] of cases) expect(() => parseNetworkTapn(source)).toThrow(message);
  });
  it('enforces numeric syntax and native bounds instead of coercing', () => {
    const cases: [string, RegExp][] = [
      [attr('place', 'initialMarking', '2147483648'), /Initial markings/],
      [attr('place', 'initialMarking', '1.5'), /Initial markings/],
      [attr('place', 'initialMarking', '1e3'), /Initial markings/],
      [attr('place', 'initialMarking', null), /Missing initialMarking/],
      [attr('arc', 'weight', '0'), /Arc weights/],
      [attr('arc', 'weight', 'N'), /constants are not supported/],
      [attr('arc', 'weight', '2147483648'), /Arc weights/],
      [attr('place', 'positionX', '10.5'), /whole-number positions/],
      [attr('place', 'positionX', 'NaN'), /whole-number positions/],
      [attr('place', 'positionX', null), /Missing positionX/],
      [attr('place', 'positionX', '1000000'), /within ±1,000,000/],
      [attr('place', 'nameOffsetY', '0.25'), /label offsets/],
      [attr('arcpath', 'xCoord', '119.5'), /Arc path points/],
      [attr('arcpath', 'arcPointType', 'yes'), /Arc point types/],
      [attr('k-bound', 'bound', '-1'), /k-bound/],
    ];
    for (const [source, message] of cases) expect(() => parseNetworkTapn(source)).toThrow(message);
    const max = attr('place', 'initialMarking', '2147483647');
    expect(parseNetworkTapn(max).network.components[0].net.nodes[0].tokens).toBe(2147483647);
    expect(
      parseNetworkTapn(attr('place', 'positionX', '90.0'), 'Producer consumer.tapn').network,
    ).toEqual(native().network);
    const upper = attr('net:nth-of-type(1) arcpath[id="1"]', 'arcPointType', 'TRUE');
    expect(parseNetworkTapn(upper, 'Producer consumer.tapn').network).toEqual(native().network);
  });
  it('rejects unsupported native content rather than dropping it', () => {
    const cases: [string, RegExp][] = [
      [insert('pnml', '<constant name="N" value="2"/>'), /Constants/],
      [
        insert('pnml', '<shared-place name="S" initialMarking="0" invariant="&lt; inf"/>'),
        /Shared places/,
      ],
      [insert('pnml', '<shared-transition name="S" urgent="false"/>'), /Shared transitions/],
      [insert('pnml', '<custom_distribution name="D"/>'), /distributions/],
      [insert('pnml', '<extension/>'), /Unsupported element <extension>/],
      [insert('namedsort', '<cyclicenumeration/>'), /Colour declarations/],
      [insert('declarations', '<variabledecl id="x" name="x"/>'), /Colour declarations/],
      [insert('net', '<labels positionX="1" positionY="1">Note<b/></labels>'), /<b>/],
      [
        insert('net', '<labels positionX="1.0" positionY="1">Note</labels>'),
        /Annotation positions/,
      ],
      [insert('net', '<labels positionX="-4" positionY="1">Note</labels>'), /Annotation positions/],
      [insert('net', '<labels width="1e2">Note</labels>'), /Annotation positions/],
      [insert('net', '<labels border="yes">Note</labels>'), /Annotation border/],
      [insert('net', '<labels id="N1">Note</labels>'), /Unsupported attribute id/],
      [insert('net', '<labels><!-- c -->Note</labels>'), /comments/],
      [insert('pnml', '<labels>Note</labels>'), /Unsupported element <labels>/],
      [insert('net', '<transportArc/>'), /Transport arcs/],
      [insert('net', '<inputArc source="P0" target="T0"/>'), /Legacy inputArc/],
      [insert('place', '<initialMarkingAge/>'), /Token ages/],
      [insert('place', '<type/>'), /Coloured place types/],
      [insert('transition', '<condition/>'), /Coloured guards/],
      [insert('arc', '<hlinscription/>'), /Coloured expressions/],
      [insert('arcpath', '<extra/>'), /Unsupported element <extra>/],
      [attr('arc', 'type', 'transport'), /no transport arcs/],
      [attr('arc', 'inscription', '[2,5]'), /Timed arc intervals/],
      [attr('net arc:nth-of-type(2)', 'inscription', '2'), /output arc inscription/],
      [attr('arc', 'nameOffsetX', 'NaN'), /label offsets/],
      [attr('arc', 'tagged', 'true'), /Unsupported attribute tagged/],
      [attr('place', 'invariant', '&lt;= 5'), /invariants/],
      [attr('place', 'inscription', '[0,inf)'), /Unsupported attribute inscription/],
      [attr('place', 'displayName', 'FALSE'), /displayName must be/],
      [attr('transition', 'angle', '90.0'), /Transition angles/],
      [attr('transition', 'angle', '2147483648'), /Transition angles/],
      [attr('transition', 'urgent', 'true'), /Urgent transitions/],
      [attr('transition', 'player', '1'), /Game/],
      [attr('transition', 'priority', '2'), /priorities/],
      [attr('transition', 'infiniteServer', 'true'), /Infinite-server/],
      [attr('transition', 'distribution', 'uniform'), /distributions/],
      [attr('transition', 'value', '0.0'), /distributions/],
      [attr('transition', 'weight', '2.0'), /transition weights/],
      [attr('transition', 'firingMode', 'Youngest'), /firing modes/],
      [attr('net', 'type', 'Colored net'), /Only P\/T net/],
      [attr('pnml', 'version', '2'), /Unsupported attribute version/],
      [NATIVE.replace('<k-bound', '<!-- note --><k-bound'), /comments/],
      [NATIVE.replace('<k-bound', '<?app hint?><k-bound'), /processing instructions/],
      [NATIVE.replace('<k-bound', 'stray text <k-bound'), /Unsupported text content/],
      [NATIVE.replace('<net active="false"', '<net xmlns="urn:other" active="false"'), /namespace/],
    ];
    for (const [source, message] of cases) expect(() => parseNetworkTapn(source)).toThrow(message);
  });
  it('rejects real desktop examples whose content would be lost', () => {
    const example = (name: string) => readFileSync(`public/examples/${name}.tapn`, 'utf8');
    expect(parseNetworkTapn(example('two-phase-locking')).network.savedQueries?.xml).toHaveLength(
      4,
    );
    expect(() => parseNetworkTapn(example('untimedGame'))).toThrow(/Game nets/);
    expect(() => parseNetworkTapn(example('philosophers'))).toThrow(/Coloured nets/);
    expect(() => parseNetworkTapn(example('alternating-bit-protocol-components'))).toThrow(
      /Shared places/,
    );
    const { network } = parseNetworkTapn(example('two-phase-locking'), 'two-phase-locking.tapn');
    expect(network.components).toHaveLength(1);
    expect(network.components[0].net.nodes).toHaveLength(14);
  });
});

// TimedArcPetriNetNetworkWriter shape: labels first, hidden names, moved labels, rotation.
const GEOMETRY = NATIVE.replace(
  '<net active="true" id="Producer" type="P/T net">',
  `<net active="true" id="Producer" type="P/T net">
    <labels border="true" height="34" positionX="40" positionY="150" width="185">Items &amp; &lt;tokens&gt;
  move "right" ]]&gt;</labels>
    <labels border="false" height="16" positionX="0" positionY="0" width="40"> </labels>`,
)
  .replace('name="Done" nameOffsetX="0"', 'name="Done" nameOffsetX="-30"')
  .replace('displayName="true" id="P1"', 'displayName="false" id="P1"')
  .replace(
    /angle="0" displayName="true" distribution/,
    'angle="45" displayName="true" distribution',
  )
  .replace(/angle="0" displayName="true" id="T0"/, 'angle="-90" displayName="false" id="T0"');
const geometry = () => parseNetworkTapn(GEOMETRY, 'Producer consumer.tapn');

describe('native element layout in TAPN', () => {
  it('imports hidden and moved labels, rotation and annotations as optional fields', () => {
    const { network, warnings } = geometry();
    expect(warnings).toEqual([]);
    const [first, second] = network.components.map((c) => c.net);
    expect(first.annotations).toEqual([
      {
        id: 'annotation-1',
        text: 'Items & <tokens>\n  move "right" ]]>',
        x: 40,
        y: 150,
        width: 185,
        height: 34,
      },
      { id: 'annotation-2', text: ' ', x: 0, y: 0, width: 40, height: 16, border: false },
    ]);
    expect(first.nodes[1]).toEqual({
      ...producer().nodes[1],
      nameOffsetX: -30,
      nameVisible: false,
    });
    expect(first.nodes[2]).toEqual({ ...producer().nodes[2], angle: 45 });
    expect(second.nodes[1]).toEqual({ ...consumer().nodes[1], angle: -90, nameVisible: false });
    expect(second.annotations).toBeUndefined();
    // Defaults keep the original shape: no new keys on untouched nodes.
    expect(first.nodes[0]).toEqual(producer().nodes[0]);
  });
  it('writes native attributes and reopens identically, saved queries included', () => {
    const query =
      '<query active="true" name="Q" type="Default"><formula><exists-path><finally>' +
      '<integer-ge><tokens-count><place>Producer.P0</place></tokens-count>' +
      '<integer-constant>1</integer-constant></integer-ge></finally></exists-path></formula></query>';
    const source = GEOMETRY.replace('<k-bound', `${query}<k-bound`);
    const { network } = parseNetworkTapn(source, 'Producer consumer.tapn');
    expect(network.savedQueries?.xml).toHaveLength(1);
    const xml = serializeNetworkTapn(network);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const net = document.querySelector('net')!;
    expect(
      Array.from(net.children)
        .map((e) => e.localName)
        .slice(0, 3),
    ).toEqual(['labels', 'labels', 'place']);
    const attributes = (e: Element) =>
      Object.fromEntries(Array.from(e.attributes).map((a) => [a.name, a.value]));
    expect(attributes(net.querySelector('labels')!)).toEqual({
      positionX: '40',
      positionY: '150',
      width: '185',
      height: '34',
      border: 'true',
    });
    expect(net.querySelector('labels')!.textContent).toBe('Items & <tokens>\n  move "right" ]]>');
    expect(xml).toContain('Items &amp; &lt;tokens&gt;');
    expect(net.querySelector('transition')!.getAttribute('angle')).toBe('45');
    expect(net.querySelector('place[id="P1"]')!.getAttribute('displayName')).toBe('false');
    const reopened = parseNetworkTapn(xml, 'Producer consumer.tapn').network;
    expect(reopened).toEqual(network);
    expect(parseNetworkJson(serializeNetworkJson(network)).network).toEqual(network);
  });
  it('renumbers annotation IDs on TAPN reopen but keeps them in JSON', () => {
    const network = structuredClone(geometry().network) as d.Network;
    const net = network.components[0].net;
    net.annotations = [{ ...net.annotations![1], id: 'my-note' }];
    const reopened = parseNetworkTapn(serializeNetworkTapn(network)).network;
    expect(reopened.components[0].net.annotations![0].id).toBe('annotation-1');
    expect(parseNetworkJson(serializeNetworkJson(network)).network).toEqual(network);
  });
  it('refuses annotation content desktop cannot save, and unknown annotation fields', () => {
    const network = () => structuredClone(geometry().network) as d.Network;
    const transparent = network();
    transparent.components[0].net.annotations![0].filled = false;
    expect(() => serializeNetworkTapn(transparent)).toThrow(/transparent annotation/);
    expect(parseNetworkJson(serializeNetworkJson(transparent)).network).toEqual(transparent);
    const negative = network();
    negative.components[0].net.annotations![0].x = -1;
    expect(() => serializeNetworkTapn(negative)).toThrow(/canvas origin/);
    const fractional = network();
    fractional.components[0].net.annotations![0].width = 10.5;
    expect(() => serializeNetworkTapn(fractional)).toThrow(/annotation sizes/);
    const unknown = network();
    (unknown.components[0].net.annotations![0] as unknown as Record<string, unknown>)['font'] = 'x';
    expect(() => serializeNetworkJson(unknown)).toThrow(/Unsupported field font in .* annotation/);
    const carriage = network();
    carriage.components[0].net.annotations![0].text = 'a\rb';
    expect(() => serializeNetworkJson(carriage)).toThrow(/carriage returns/);
  });
  it('opens real untimed desktop examples with rotation and annotations', () => {
    const example = (name: string) => readFileSync(`public/examples/${name}.tapn`, 'utf8');
    const erk = parseNetworkTapn(example('ERK'), 'ERK.tapn').network;
    expect(erk.components[0].net.nodes.filter((n) => n.angle)).toHaveLength(8);
    expect(erk.savedQueries?.xml).toHaveLength(1);
    expect(parseNetworkTapn(serializeNetworkTapn(erk), 'ERK.tapn').network).toEqual(erk);
    // package-delivery is a game net; its real <labels> element opens in an untimed P/T net.
    const label = example('package-delivery').match(/<labels[\s\S]*?<\/labels>/)![0];
    const source = NATIVE.replace(
      '<place displayName="true" id="P0"',
      `${label}<place displayName="true" id="P0"`,
    );
    const network = parseNetworkTapn(source, 'Producer consumer.tapn').network;
    const [note] = network.components[0].net.annotations!;
    expect(note.text.length).toBeGreaterThan(20);
    const reopened = parseNetworkTapn(serializeNetworkTapn(network), 'Producer consumer.tapn');
    expect(reopened.network).toEqual(network);
  });
});

describe('native multi-component TAPN export', () => {
  const reopen = (network: d.Network) => parseNetworkTapn(serializeNetworkTapn(network)).network;
  it('writes all components in order with active flags and a single feature', () => {
    const xml = serializeNetworkTapn(native().network);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const root = document.documentElement;
    expect(Array.from(root.children).map((e) => e.localName)).toEqual([
      'net',
      'net',
      'k-bound',
      'feature',
    ]);
    expect(
      Array.from(document.querySelectorAll('net')).map((n) => n.getAttribute('active')),
    ).toEqual(['true', 'false']);
    expect(root.getAttribute('name')).toBe('Producer consumer');
    expect(document.querySelectorAll('feature')).toHaveLength(1);
    expect(reopen(native().network)).toEqual(native().network);
  });
  it('reopens after rename, copy, reorder, activation, edit and undo', () => {
    let doc = d.openNetworkDocument(native().network, { saved: true });
    const [first, second] = doc.network.components.map((c) => c.id);
    doc = d.renameDocument(doc, 'Renamed model');
    doc = d.renameComponent(doc, second, 'Worker');
    doc = d.copyComponent(doc, first, 'ProducerCopy');
    doc = d.setComponentActive(doc, second, true);
    doc = d.setComponentActive(doc, first, false);
    const copy = doc.session.componentId;
    doc = d.reorderComponents(doc, [copy, second, first]);
    const moved = d.activeNet(d.switchComponent(doc, second));
    moved.nodes[0].x += 30;
    doc = d.commitComponentNet(doc, moved, second);
    expect(withoutIds(reopen(doc.network))).toEqual(withoutIds(doc.network));
    expect(reopen(doc.network).components.map((c) => [c.id, c.active])).toEqual([
      ['tapn:ProducerCopy', true],
      ['tapn:Worker', true],
      ['tapn:Producer', false],
    ]);
    doc = d.undoDocument(doc);
    expect(withoutIds(reopen(doc.network))).toEqual(withoutIds(doc.network));
    const json = parseNetworkJson(serializeNetworkJson(doc.network)).network;
    expect(json).toEqual(doc.network);
  });
  it('round trips straight and curved bends with label offsets', () => {
    const network = native().network;
    const xml = serializeNetworkTapn(network);
    expect(xml).toContain('arcPointType="true"');
    expect(reopen(network).components[0].net.arcs).toEqual(producer().arcs);
    expect(reopen(network).components[0].net.nodes).toEqual(producer().nodes);
  });
  it('treats explicit native defaults and key order as immaterial', () => {
    const network = structuredClone(native().network) as d.Network;
    const net = network.components[1].net;
    const { id, ...rest } = net.nodes[1];
    net.nodes[1] = { ...rest, id };
    net.nodes[0] = { ...net.nodes[0], nameOffsetY: 35 };
    net.arcs[0] = { ...net.arcs[0], bends: [], curvedEnd: false };
    expect(() => serializeNetworkTapn(network)).not.toThrow();
  });
  it('refuses unsupported or lossy exports with precise messages', () => {
    const network = () => structuredClone(native().network) as d.Network;
    const fractional = network();
    fractional.components[0].net.nodes[0].x = 105.5;
    expect(() => serializeNetworkTapn(fractional)).toThrow(/fractional coordinates/);
    expect(serializeNetworkJson(fractional)).toContain('105.5');
    const bend = network();
    bend.components[0].net.arcs[0].bends![0].y = 20.25;
    expect(() => serializeNetworkTapn(bend)).toThrow(/fractional/);
    const large = network();
    large.components[1].net.nodes[0].tokens = 2147483648;
    expect(() => serializeNetworkTapn(large)).toThrow(/2,147,483,647/);
    expect(parseNetworkJson(serializeNetworkJson(large)).network).toEqual(large);
    const underscore = {
      ...network(),
      components: network().components.map((c, i) =>
        i ? { ...c, net: { ...c.net, template: '_Worker' } } : c,
      ),
    };
    expect(() => serializeNetworkTapn(underscore)).toThrow(/start with a letter/);
    const unknown = network();
    (unknown.components[0].net.arcs[0] as unknown as Record<string, unknown>)['labelOffset'] = 4;
    expect(() => serializeNetworkTapn(unknown)).toThrow(/Unsupported field labelOffset/);
    expect(() => serializeNetworkJson(unknown)).toThrow(/Unsupported field labelOffset/);
    const timed = { ...network(), type: { ...network().type, timed: true } };
    expect(() => serializeNetworkTapn(timed)).toThrow(/require timing metadata/);
    const inactive = {
      ...network(),
      components: network().components.map((c) => ({ ...c, active: false })),
    };
    expect(() => serializeNetworkTapn(inactive)).toThrow(/At least one component/);
  });
});

describe('network JSON and legacy migration', () => {
  it('round trips IDs, activation and order exactly', () => {
    const network = native().network;
    const json = serializeNetworkJson(network);
    expect(JSON.parse(json)).toMatchObject({ format: NETWORK_JSON_FORMAT, version: 1 });
    expect(parseNetworkJson(json)).toEqual({ network, warnings: [] });
    expect(parseNetworkModel(`\n ${json}`, 'x.json').network).toEqual(network);
  });
  it('migrates legacy single-Net JSON and TAPN to one active component', () => {
    const net = consumer();
    const expected = {
      name: net.name,
      type: { timed: false, colored: false, game: false, stochastic: false },
      components: [{ id: 'tapn:Consumer', active: true, net }],
    };
    expect(parseNetworkModel(serializeJson(net), 'old.json')).toEqual({
      network: expected,
      warnings: [],
    });
    expect(parseNetworkModel(serializeTapn(net), 'old.tapn')).toEqual({
      network: expected,
      warnings: [],
    });
  });
  it('rejects malformed, unknown, unsupported or invalid JSON', () => {
    const valid = () => JSON.parse(serializeNetworkJson(native().network));
    const variants: [unknown, RegExp][] = [
      [{ ...valid(), version: 2 }, /version: 2/],
      [{ ...valid(), format: 'other' }, /Unsupported JSON format/],
      [{ ...valid(), extra: true }, /Unsupported field extra in network file/],
      [{ ...valid(), network: { ...valid().network, queries: [] } }, /Unsupported field queries/],
      [
        {
          ...valid(),
          network: { ...valid().network, type: { ...valid().network.type, game: true } },
        },
        /Unsupported game/,
      ],
      [{ ...valid(), network: { ...valid().network, components: [] } }, /at least one component/],
      [
        {
          ...valid(),
          network: {
            ...valid().network,
            components: valid().network.components.map((c: object) => ({ ...c, id: 'same' })),
          },
        },
        /Component IDs must be nonempty and unique/,
      ],
      [
        {
          ...valid(),
          network: {
            ...valid().network,
            components: valid().network.components.map((c: object) => ({ ...c, active: 'yes' })),
          },
        },
        /active state must be boolean/,
      ],
    ];
    for (const [document, message] of variants)
      expect(() => parseNetworkJson(JSON.stringify(document))).toThrow(message);
    expect(() => parseNetworkJson('{"format":')).toThrow(/malformed/);
    expect(() => parseNetworkJson('{"__proto__":{"format":"tapaal-web-network"}}')).toThrow(
      /Unsupported JSON format/,
    );
    const legacy = JSON.parse(serializeJson(consumer()));
    legacy.net.nodes[0].colour = 'red';
    expect(() => parseNetworkJson(JSON.stringify(legacy))).toThrow(/Unsupported field colour/);
  });
});

// Captured from released 4.0.4 TimedArcPetriNetNetworkWriter, not hand-written XML.
describe('released native writer interoperability (TV-2)', () => {
  for (const file of [
    'Producer_cycle.native.tapn',
    'control-hlinscription.native.tapn',
    'timed-weighted.native.tapn',
  ]) {
    it(`opens and round-trips ${file}`, () => {
      const xml = readFileSync(`src/app/core/test-fixtures/native-4.0.4/${file}`, 'utf8');
      const { network, warnings } = parseNetworkTapn(xml, file);
      expect(warnings).toEqual([]);
      expect(parseNetworkTapn(serializeNetworkTapn(network), file).network).toEqual(network);
      if (file === 'control-hlinscription.native.tapn') {
        expect(network.components[0].net.arcs.find((a) => a.id === 'ri')?.weight).toBe(2);
        expect(network.components[0].timing?.transports).toHaveLength(2);
      }
      if (file === 'timed-weighted.native.tapn') {
        const { net, timing } = network.components[0];
        expect(network.savedQueries?.xml).toHaveLength(1);
        expect(network.savedQueries?.xml[0]).toContain('<integer-ge>');
        expect(network.savedQueries?.xml[0]).toContain('Clock.Moved');
        expect(net.arcs.map((a) => a.weight).sort()).toEqual([2, 2, 3, 4, 5]);
        expect(timing?.transports).toEqual([{ inputArc: 'A0', outputArc: 'A1' }]);
        expect(timing?.intervals['A0']).toEqual({
          lower: '1',
          upper: '5',
          lowerClosed: false,
          upperClosed: false,
        });
        expect(timing?.ages).toEqual({}); // Released 4.0.4 drops ages, unlike HEAD.
        expect(net.nodes.find((n) => n.name === 'Start')).toMatchObject({
          tokens: 3,
          nameVisible: false,
        });
        expect(net.arcs.find((a) => a.id === 'A0')?.bends).toHaveLength(1);
        expect(net.arcs.find((a) => a.id === 'A1')?.curvedEnd).toBe(true);
      }
    });
  }
});

describe('strict redundant dot scaffolding', () => {
  const scaffold = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    writeDotDependencies(doc.documentElement);
    return new XMLSerializer().serializeToString(doc);
  };
  const nativeXml = () => scaffold(serializeNetworkTapn(native().network));
  const changed = (edit: (doc: Document) => void) => {
    const doc = new DOMParser().parseFromString(nativeXml(), 'application/xml');
    edit(doc);
    return new XMLSerializer().serializeToString(doc);
  };
  it('accepts the native default coefficient 1 on weighted input, output and inhibitor arcs', () => {
    const original = native().network;
    original.components[0].net.arcs[1].weight = 4;
    const xml = scaffold(serializeNetworkTapn(original));
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const inscription of doc.querySelectorAll('hlinscription')) {
      inscription.querySelector('text')!.textContent = "1'dot";
      inscription.querySelector('numberconstant')!.setAttribute('value', '1');
    }
    expect(parseNetworkTapn(new XMLSerializer().serializeToString(doc)).network).toEqual(original);
  });
  it('checks every scaffolding node and refuses conflicting or ambiguous structures', () => {
    const edits: ((doc: Document) => void)[] = [
      (doc) => (doc.querySelector('type text')!.textContent = 'red'),
      (doc) => doc.querySelector('usersort')!.setAttribute('declaration', 'red'),
      (doc) => doc.querySelector('useroperator')!.setAttribute('declaration', 'red'),
      (doc) => (doc.querySelector('hlinscription text')!.textContent = "2'dot"),
      (doc) => doc.querySelector('hlinitialMarking numberconstant')!.setAttribute('value', '1'),
      (doc) => {
        doc.querySelector('hlinscription text')!.textContent = "2'dot";
        doc.querySelector('hlinscription numberconstant')!.setAttribute('value', '2');
      },
      (doc) =>
        doc.querySelector('hlinscription numberconstant')!.setAttribute('value', '2147483648'),
      (doc) => doc.querySelector('dotconstant')!.setAttribute('color', 'red'),
      (doc) => doc.querySelector('positive')!.setAttribute('extra', 'true'),
      (doc) => doc.querySelector('namedsort')!.setAttribute('name', 'red'),
      (doc) =>
        doc
          .querySelector('declarations')!
          .appendChild(doc.createElementNS(doc.documentElement.namespaceURI, 'constant')),
      (doc) =>
        doc
          .querySelector('type')!
          .appendChild(doc.querySelector('type structure')!.cloneNode(true)),
      (doc) => doc.querySelector('place')!.appendChild(doc.querySelector('type')!.cloneNode(true)),
      (doc) =>
        doc
          .querySelector('place')!
          .appendChild(doc.querySelector('hlinitialMarking')!.cloneNode(true)),
      (doc) =>
        doc.querySelector('arc')!.appendChild(doc.querySelector('hlinscription')!.cloneNode(true)),
      (doc) =>
        doc
          .querySelector('hlinscription structure')!
          .appendChild(doc.querySelector('hlinscription numberof')!.cloneNode(true)),
      (doc) =>
        doc
          .querySelector('numberof')!
          .appendChild(doc.querySelector('numberof subterm')!.cloneNode(true)),
      (doc) =>
        doc
          .querySelector('hlinitialMarking add')!
          .appendChild(doc.querySelector('hlinitialMarking add subterm')!.cloneNode(true)),
      (doc) =>
        doc
          .querySelector('hlinscription subterm')!
          .appendChild(doc.querySelector('numberconstant')!.cloneNode(true)),
      (doc) => doc.querySelector('hlinscription')!.appendChild(doc.createComment('hidden')),
      (doc) => doc.querySelector('declaration dot')!.appendChild(doc.createTextNode('hidden')),
      (doc) => doc.querySelector('type text')!.appendChild(doc.createCDATASection('dot')),
      (doc) =>
        doc.querySelector('positive')!.appendChild(doc.createProcessingInstruction('hidden', 'x')),
      (doc) =>
        doc
          .querySelector('dotconstant')!
          .replaceWith(doc.createElementNS('urn:foreign', 'dotconstant')),
      (doc) =>
        doc
          .querySelector('hlinscription numberof')!
          .replaceWith(doc.createElementNS(doc.documentElement.namespaceURI, 'subtract')),
    ];
    for (const edit of edits) {
      const xml = changed(edit);
      expect(() => parseNetworkTapn(xml)).toThrow();
    }
  });
});
