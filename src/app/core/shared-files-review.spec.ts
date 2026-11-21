// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as authoredFiles from './authored-files';
import { parseNetworkTapn } from './network-files';
import { captureSharedQueries, SharedSource, validateSharedSource } from './authored-shared';
import {
  parseSharedJson,
  parseSharedModel,
  parseSharedTapn,
  serializeSharedJson,
  serializeSharedTapn,
} from './shared-files';

// Independent miniature: unused authority, inactive member, local symbolic timing.
const native = (poolContent = '', memberContent = '') => `<?xml version="1.0"?>
<pnml name="Review">
  <shared-place name="Global" initialMarking="2" invariant="&lt;= Limit">${poolContent}</shared-place>
  <shared-place name="Dormant" initialMarking="1" invariant="&lt;= Zero"/>
  <net id="A" active="true">
    <place id="m" name="Global" positionX="0" positionY="0" initialMarking="2" invariant="&lt;= Limit">${memberContent}</place>
    <place id="local" name="Local" positionX="100" positionY="0" initialMarking="0" invariant="&lt;= Limit"/>
    <transition id="t" name="Fire" positionX="50" positionY="50"/>
    <arc id="in" source="m" target="t" type="timed" weight="Batch" inscription="[Zero,Limit]"/>
    <arc id="out" source="t" target="local" type="normal" weight="Batch"/>
  </net>
  <net id="B" active="false">
    <place id="__proto__" name="Global" positionX="60" positionY="60" initialMarking="2" invariant="&lt;= Limit">${memberContent}</place>
  </net>
  <constant name="Batch" value="2"/><constant name="Limit" value="5"/><constant name="Zero" value="0"/>
  <feature isTimed="true" isColored="false" isGame="false" isStochastic="false"/>
</pnml>`;
const read = () => parseSharedTapn(native()).network;
const ageXml = (values: string[]) =>
  `<initialMarkingAge>${values.map((age) => `<token age="${age}"/>`).join('')}</initialMarkingAge>`;
const envelope = (network: unknown, version: unknown = 3, extra = {}) =>
  JSON.stringify({ format: 'tapaal-web-network', version, network, ...extra });
afterEach(() => vi.restoreAllMocks());

describe('independent shared codec contract review', () => {
  it('retains global authority, native defaults, local endpoints and source-only members', () => {
    const n = read();
    expect(n.shared.places.map((p) => [p.name, p.tokens])).toEqual([
      ['Global', 2],
      ['Dormant', 1],
    ]);
    expect(n.components[1].active).toBe(false);
    expect(n.components[1].net.nodes[0]).toEqual({
      id: '__proto__',
      kind: 'place',
      sharedId: n.shared.places[0].id,
      x: 75,
      y: 75,
      nameOffsetY: 0,
    });
    expect(n.components[0].net.arcs[0]).toMatchObject({ source: 'm', target: 't' });
    expect(n.components[0].timing!.invariants).not.toHaveProperty('m');
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('preserves age multisets and treats omitted ages as zero', () => {
    const n = parseSharedTapn(native(ageXml(['1.00', '2']), ageXml(['2.0', '1']))).network;
    expect(n.shared.places[0].timing!.ages).toEqual(['1', '2']);
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    expect(() => parseSharedTapn(native(ageXml(['0']), ''))).not.toThrow();
    expect(() => parseSharedTapn(native(ageXml(['1']), ''))).toThrow(/disagrees/);
    expect(() => parseSharedTapn(native(ageXml(['1', '1']), ageXml(['2', '0'])))).toThrow(
      /disagrees/,
    );
  });
  it.each([
    [
      'root count',
      (s: string) =>
        s.replace('name="Global" initialMarking="2"', 'name="Global" initialMarking="3"'),
    ],
    [
      'literal versus reference',
      (s: string) =>
        s.replace(
          'name="Global" initialMarking="2" invariant="&lt;= Limit"',
          'name="Global" initialMarking="2" invariant="&lt;= 5"',
        ),
    ],
    ['unused impossible invariant', (s: string) => s.replace('&lt;= Zero', '&lt; Zero')],
    ['duplicate wire ID', (s: string) => s.replace('id="local"', 'id="m"')],
    ['wrong kind', (s: string) => s.replace('name="Fire"', 'name="Global"')],
    [
      'foreign declaration',
      (s: string) => s.replace('<shared-place ', '<shared-place xmlns="urn:wrong" '),
    ],
    ['root metadata', (s: string) => s.replace('<shared-place ', '<shared-place id="forbidden" ')],
    ['root content', (s: string) => s.replace('</shared-place>', '<bogus/></shared-place>')],
    ['root text', (s: string) => s.replace('</shared-place>', 'lost text</shared-place>')],
    ['root comment', (s: string) => s.replace('</shared-place>', '<!--lost--></shared-place>')],
    ['member attribute', (s: string) => s.replace('id="m"', 'id="m" semantic="hidden"')],
    [
      'member namespace',
      (s: string) => s.replace('<place id="m"', '<place xmlns="urn:wrong" id="m"'),
    ],
  ])('refuses original XML conflict: %s', (_label, mutate) => {
    expect(() => parseSharedTapn(mutate(native()))).toThrow();
  });
  it('preserves all-inactive activity and does not fuse equal undeclared local names', () => {
    const n = parseSharedTapn(native().replace('active="true"', 'active="false"')).network;
    expect(n.components.every((c) => !c.active)).toBe(true);
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    const local = parseSharedTapn(
      native().replace(/<shared-place[^>]*>.*?<\/shared-place>|<shared-place[^>]*\/>/g, ''),
    ).network;
    expect(local.shared.places).toEqual([]);
    expect(local.components[1].net.nodes[0]).toMatchObject({ name: 'Global', tokens: 2 });
  });
  it('captures unused globals and every membership before opaque-query roundtrip', () => {
    const n = parseSharedTapn(
      native().replace('</pnml>', '<query name="Q" query="EF Dormant &gt;= 1"/></pnml>'),
    ).network;
    expect(n.savedQueries!.protectedSharedPlaces.map((p) => p.name)).toEqual(['Global', 'Dormant']);
    expect(n.savedQueries!.protectedMembership).toHaveLength(4);
    expect(
      n.savedQueries!.protectedMembership.find((m) => m.elementId === 'local')!.sharedId,
    ).toBeNull();
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('refuses native recapture that would strengthen valid subset query protections', () => {
    const n = read();
    const q = captureSharedQueries(n, ['<query name="Q"/>']);
    if (!q.ok) throw new Error('review fixture query capture failed');
    const source = { ...n, savedQueries: { ...q.value, protectedSharedPlaces: [] } };
    expect(validateSharedSource(source).ok).toBe(true);
    expect(parseSharedJson(serializeSharedJson(source)).network).toEqual(source);
    expect(() => serializeSharedTapn(source)).toThrow(/verification.*JSON/);
  });
  it.each(['constructor', '__proto__', 'constantId', 'componentId', 'sharedId'])(
    'retains timing under opaque local ID %s',
    (id) => {
      const n = parseSharedTapn(native().replaceAll('"local"', `"${id}"`)).network;
      expect(Object.hasOwn(n.components[0].timing!.invariants, id)).toBe(true);
      expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    },
  );
  it.each([null, false, 0, '', { ...read(), unknown: 1 }])(
    'rejects malformed V3 source %s',
    (network) => {
      expect(() => parseSharedJson(envelope(network))).toThrow();
    },
  );
  it.each([0, 4, '3', null])('keeps unknown version %s closed', (version) => {
    expect(() => parseSharedJson(envelope(read(), version))).toThrow();
  });
  it('keeps V2 exact schema, clipboard, envelope and existing XML gates closed', () => {
    expect(() => parseSharedJson(envelope(read(), 2))).toThrow();
    expect(() => parseSharedJson(envelope(read(), 3, { future: true }))).toThrow();
    expect(() =>
      parseSharedJson(
        JSON.stringify({ format: 'tapaal-web-clipboard', version: 3, network: read() }),
      ),
    ).toThrow();
    expect(() => authoredFiles.parseAuthoredTapn(native())).toThrow(/Shared/);
    expect(() => parseNetworkTapn(native())).toThrow(/Shared/);
  });
  it('preserves exact V3 geometry and emits one browser-parsed XML declaration', () => {
    const n = read();
    const fractional: SharedSource = {
      ...n,
      components: n.components.map((c) => ({
        ...c,
        net: { ...c.net, nodes: c.net.nodes.map((node) => ({ ...node, x: 15.125 })) },
      })),
    };
    expect(parseSharedModel(serializeSharedJson(fractional)).network).toEqual(fractional);
    expect(() => serializeSharedTapn(fractional)).toThrow(/JSON/);
    const xml = serializeSharedTapn(n);
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    expect(
      new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror'),
    ).toBeNull();
  });
  it('preserves explicit optional geometry defaults without requiring optional-key identity', () => {
    const n = read();
    const source: SharedSource = {
      ...n,
      components: n.components.map((c) => ({
        ...c,
        net: {
          ...c.net,
          nodes: c.net.nodes.map((node) => ({
            ...node,
            nameOffsetX: 0,
            nameOffsetY: 35,
            nameVisible: true,
            ...(node.kind === 'transition' ? { angle: 0 } : {}),
          })),
          arcs: c.net.arcs.map((arc) => ({ ...arc, bends: [], curvedEnd: false })),
        },
      })),
    };
    const reopened = parseSharedTapn(serializeSharedTapn(source)).network;
    expect(reopened.components[0].net.nodes[0].nameOffsetY ?? 35).toBe(35);
    expect(reopened.components[0].net.arcs[0].bends ?? []).toEqual([]);
    expect(parseSharedJson(serializeSharedJson(source)).network).toEqual(source);
  });
  it('migrates old-valid V2, numeric V1 and single-net legacy through their old gates', () => {
    const localXml = native().replace(
      /<shared-place[^>]*>.*?<\/shared-place>|<shared-place[^>]*\/>/g,
      '',
    );
    const old = authoredFiles.parseAuthoredTapn(localXml).network;
    expect(parseSharedJson(authoredFiles.serializeAuthoredJson(old)).network.shared.places).toEqual(
      [],
    );
    const net = { name: 'Old', template: 'A', nodes: [], arcs: [] };
    const numeric = {
      name: 'Old',
      type: { timed: false, colored: false, game: false, stochastic: false },
      components: [{ id: 'a', active: true, net }],
    };
    expect(parseSharedJson(envelope(numeric, 1)).network.shared.places).toEqual([]);
    expect(
      parseSharedJson(JSON.stringify({ format: 'tapaal-web-untimed', version: 1, net })).network
        .shared.places,
    ).toEqual([]);
  });
  it('retains weighted transport halves, inhibitor, annotation, rotation and route geometry', () => {
    const text = native()
      .replace(
        'type="timed" weight="Batch" inscription="[Zero,Limit]"',
        'type="transport" weight="Batch" inscription="[Zero,Limit]:1"',
      )
      .replace(
        'type="normal" weight="Batch"',
        'type="transport" weight="Batch" inscription="[Zero,Limit]:1"',
      )
      .replace(
        '<transition id="t"',
        '<labels positionX="5" positionY="6" width="90" height="40" border="false">review note</labels><transition angle="90" id="t"',
      )
      .replace(
        '<arc id="out"',
        '<transition id="u" name="Other" positionX="50" positionY="100"/><arc id="inhibitor" source="m" target="u" type="tapnInhibitor" weight="Batch" inscription="[0,inf)"/><arc id="out"',
      )
      .replace(
        'inscription="[Zero,Limit]:1"/>',
        'inscription="[Zero,Limit]:1"><arcpath xCoord="0" yCoord="0"/><arcpath xCoord="30" yCoord="20" arcPointType="true"/><arcpath xCoord="50" yCoord="50" arcPointType="true"/></arc>',
      );
    const n = parseSharedTapn(text).network;
    expect(n.components[0].timing!.transports).toEqual([{ inputArc: 'in', outputArc: 'out' }]);
    expect(n.components[0].net.arcs[0]).toMatchObject({
      bends: [{ x: 30, y: 20, curved: true }],
      curvedEnd: true,
    });
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    expect(() =>
      parseSharedTapn(
        text.replace(
          'id="out" source="t" target="local" type="transport" weight="Batch"',
          'id="out" source="t" target="local" type="transport" weight="2"',
        ),
      ),
    ).toThrow(/identical authored/);
  });
  it('checks redundant dot AST on original root and member before stripping it', () => {
    const doc = new DOMParser().parseFromString(serializeSharedTapn(read()), 'application/xml');
    const rootPool = doc.querySelector('shared-place')!;
    expect(rootPool.querySelector('hlinitialMarking')).not.toBeNull();
    rootPool.querySelector('hlinitialMarking numberconstant')!.setAttribute('value', '1');
    rootPool.querySelector('hlinitialMarking text')!.textContent = "1'dot";
    expect(() => parseSharedTapn(new XMLSerializer().serializeToString(doc))).toThrow(/dot/);
    const memberDoc = new DOMParser().parseFromString(
      serializeSharedTapn(read()),
      'application/xml',
    );
    const marking = memberDoc.querySelector('net place hlinitialMarking')!;
    marking.querySelector('numberconstant')!.setAttribute('value', '1');
    marking.querySelector('text')!.textContent = "1'dot";
    expect(() => parseSharedTapn(new XMLSerializer().serializeToString(memberDoc))).toThrow(/dot/);
  });

  // Perturb only the private writer output to test the promised independent
  // shared verifier. This does not assert today's scalar writer flattens terms.
  it.each(
    ['constantId', 'componentId', 'sharedId'].flatMap((id) =>
      ['interval', 'ages'].map((kind) => ({ id, kind })),
    ),
  )('compares opaque $kind map entry $id', ({ id, kind }) => {
    const text =
      kind === 'interval'
        ? native().replaceAll('"in"', `"${id}"`)
        : native()
            .replaceAll('"local"', `"${id}"`)
            .replace(
              'initialMarking="0" invariant="&lt;= Limit"/>',
              `initialMarking="1" invariant="&lt;= Limit">${ageXml(['2'])}</place>`,
            );
    const n = parseSharedTapn(text).network;
    const realWriter = authoredFiles.serializeAuthoredTapn;
    vi.spyOn(authoredFiles, 'serializeAuthoredTapn').mockImplementation((projection) => {
      const doc = new DOMParser().parseFromString(realWriter(projection), 'application/xml');
      if (kind === 'interval') {
        const arc = Array.from(doc.querySelectorAll('arc')).find(
          (a) => a.getAttribute('id') === id,
        )!;
        arc.setAttribute('inscription', '[0,Limit]');
      } else {
        const place = Array.from(doc.querySelectorAll('place')).find(
          (p) => p.getAttribute('id') === id,
        )!;
        place.querySelector('initialMarkingAge token')!.setAttribute('age', '3');
      }
      return new XMLSerializer().serializeToString(doc);
    });
    expect(() => serializeSharedTapn(n)).toThrow(/verification.*JSON/);
  });

  it.each(['local', 'constantId', 'componentId', 'sharedId'])(
    'export verifier rejects equal-numeric reference loss for local ID %s',
    (id) => {
      const n = parseSharedTapn(native().replaceAll('"local"', `"${id}"`)).network;
      const realWriter = authoredFiles.serializeAuthoredTapn;
      let perturbed = '';
      vi.spyOn(authoredFiles, 'serializeAuthoredTapn').mockImplementation((projection) => {
        const doc = new DOMParser().parseFromString(realWriter(projection), 'application/xml');
        const place = Array.from(doc.querySelectorAll('place')).find(
          (p) => p.getAttribute('id') === id,
        )!;
        place.setAttribute('invariant', '<= 5');
        perturbed = new XMLSerializer().serializeToString(doc);
        return perturbed;
      });
      expect(validateSharedSource(n).ok).toBe(true);
      let output: string | undefined;
      let failure: unknown;
      try {
        output = serializeSharedTapn(n);
      } catch (error) {
        failure = error;
      }
      expect(perturbed).toContain('invariant="&lt;= 5"');
      expect(n.components[0].timing!.invariants[id].upper).toEqual({
        constantId: n.constants.find((c) => c.name === 'Limit')!.id,
      });
      if (output !== undefined)
        expect(parseSharedTapn(output).network.components[0].timing!.invariants[id].upper).toBe(
          '5',
        );
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/verification.*JSON/);
    },
  );
});
