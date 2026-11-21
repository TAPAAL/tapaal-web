// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseSharedModel,
  parseSharedJson,
  parseSharedTapn,
  serializeSharedJson,
  serializeSharedTapn,
} from './shared-files';
import { parseAuthoredJson, parseAuthoredTapn, serializeAuthoredJson } from './authored-files';
import { parseNetworkTapn, parseNetworkJson } from './network-files';
import { SharedSource, validateSharedSource } from './authored-shared';
const fixture = readFileSync('src/app/core/test-fixtures/shared-files/timed.tapn', 'utf8');
const old = readFileSync('src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn', 'utf8');
const parsed = () => parseSharedTapn(fixture).network;
const envelope = (network: unknown, version = 3) =>
  JSON.stringify({ format: 'tapaal-web-network', version, network });
// Root declarations have a distinct closing tag.
const withAges = () =>
  fixture
    .replace(
      'name="Pool" initialMarking="3" invariant="&lt;= D"/>',
      'name="Pool" initialMarking="3" invariant="&lt;= D"><initialMarkingAge><token age="2.00"/><token age="1.250"/></initialMarkingAge></shared-place>',
    )
    .replaceAll(
      'initialMarking="3" invariant="&lt;= D"/>',
      'initialMarking="3" invariant="&lt;= D"><initialMarkingAge><token age="1.25"/><token age="2"/></initialMarkingAge></place>',
    );

describe('opt-in shared file codecs', () => {
  it('roundtrips timed pools, local wire IDs, inactive members, unused pools and rich layout', () => {
    const n = parsed(),
      out = serializeSharedTapn(n),
      reopened = parseSharedModel(out).network;
    expect(reopened).toEqual(n);
    expect(n.shared.places).toHaveLength(2);
    expect(n.shared.places[1].timing?.invariant?.upper).toEqual({ constantId: 'tapn:constant:2' });
    expect(n.components[0].net.nodes[0]).toMatchObject({
      id: 'constructor',
      sharedId: n.shared.places[0].id,
      nameVisible: false,
    });
    expect(n.components[0].net.nodes[0]).not.toHaveProperty('tokens');
    expect(n.components[0].timing?.invariants).toEqual({});
    expect(n.components[0].net.arcs[0].source).toBe('constructor');
    expect(n.components[0].net.arcs[0].bends).toHaveLength(1);
    expect(out).toContain("2'dot");
    expect(out.match(/<\?xml/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('SharedFile');
  });
  it('preserves age multisets, missing zeros and strict authored invariants', () => {
    const n = parseSharedTapn(withAges()).network;
    expect(n.shared.places[0].timing?.ages).toEqual(['1.25', '2']);
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    expect(() => parseSharedTapn(withAges().replace('<token age="1.25"/>', ''))).toThrow(
      /disagrees/,
    );
    const strict = fixture.replaceAll('&lt;= D', '&lt; D');
    expect(
      parseSharedTapn(serializeSharedTapn(parseSharedTapn(strict).network)).network.shared.places[0]
        .timing?.invariant?.upperClosed,
    ).toBe(false);
  });
  it('allows all-inactive source without activating it', () => {
    const n = parseSharedTapn(fixture.replace('active="true"', 'active="false"')).network;
    expect(n.components.every((c) => !c.active)).toBe(true);
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('does not fuse repeated local names without a root pool', () => {
    const source = fixture.replace(/<shared-place[^>]*\/>/g, '');
    const n = parseSharedTapn(source).network;
    expect(n.shared.places).toEqual([]);
    expect(n.components.map((c) => c.net.nodes[0])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Pool', tokens: 3 })]),
    );
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('supports untimed shared files', () => {
    const text =
      '<pnml><shared-place name="Pool" initialMarking="2"/><net id="A" active="false"><place id="__proto__" name="Pool" positionX="0" positionY="0" initialMarking="2"/></net><feature isTimed="false"/></pnml>';
    const n = parseSharedTapn(text).network;
    expect(n.components[0].net.nodes[0]).toMatchObject({
      id: '__proto__',
      sharedId: 'tapn:shared-place:0',
    });
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('captures global unused pools, constants, members and local query symbols', () => {
    const n = parseSharedTapn(
      fixture.replace(
        '</pnml>',
        '<query active="true" name="Q" type="Default" query="EF Unused &gt;= 1"/></pnml>',
      ),
    ).network;
    expect(n.savedQueries?.protectedSharedPlaces).toEqual(
      n.shared.places.map(({ id, name }) => ({ id, name })),
    );
    expect(n.savedQueries?.protectedMembership).toHaveLength(5);
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
    expect(parseSharedJson(serializeSharedJson(n)).network).toEqual(n);
  });
  it('JSON v3 preserves exact IDs, fractional layout and sparse nonzero ages', () => {
    const n = parsed();
    const source: SharedSource = {
      ...n,
      shared: {
        ...n.shared,
        places: n.shared.places.map((p, i) => ({ ...p, id: i ? 'constructor' : '__proto__' })),
      },
      components: n.components.map((c) => ({
        ...c,
        id: c.id + 'custom',
        net: {
          ...c.net,
          nodes: c.net.nodes.map((node) =>
            'sharedId' in node ? { ...node, x: 45.25, sharedId: '__proto__' } : node,
          ),
        },
      })),
    };
    const out = serializeSharedJson(source);
    expect(JSON.parse(out).version).toBe(3);
    expect(parseSharedModel(out).network).toEqual(source);
    expect(() => serializeSharedTapn(source)).toThrow(/fractional|JSON/i);
    expect(() => parseAuthoredJson(out)).toThrow();
    expect(() => parseNetworkJson(out)).toThrow();
  });
  it('migrates only old-valid exact v2/v1/legacy', () => {
    const v2 = serializeAuthoredJson(parseAuthoredTapn(old).network);
    expect(parseSharedJson(v2).network.shared.places).toEqual([]);
    const n = JSON.parse(v2).network;
    expect(() =>
      parseSharedJson(envelope({ ...n, shared: { places: [], transitions: [] } }, 2)),
    ).toThrow();
    const net = { name: 'Old', template: 'A', nodes: [], arcs: [] };
    const numeric = {
      name: 'Old',
      type: { timed: false, colored: false, game: false, stochastic: false },
      components: [{ id: 'a', active: true, net }],
    };
    expect(parseSharedJson(envelope(numeric, 1)).network.constants).toEqual([]);
    expect(
      parseSharedJson(JSON.stringify({ format: 'tapaal-web-untimed', version: 1, net })).network
        .shared.places,
    ).toEqual([]);
  });
  it.each([null, false, 0, ''])('rejects malformed v3 query field %s', (savedQueries) => {
    expect(() => parseSharedJson(envelope({ ...parsed(), savedQueries }))).toThrow();
  });
  it.each([
    (n: SharedSource) => ({ ...n, extra: 1 }),
    (n: SharedSource) => ({ ...n, shared: { ...n.shared, transitions: [{ id: 'x' }] } }),
    (n: SharedSource) => ({
      ...n,
      shared: { ...n.shared, places: n.shared.places.map((p) => ({ ...p, extra: 1 })) },
    }),
    (n: SharedSource) => ({
      ...n,
      components: n.components.map((c) => ({
        ...c,
        net: {
          ...c.net,
          nodes: c.net.nodes.map((node) => ({
            ...node,
            ...('sharedId' in node ? { tokens: 3 } : {}),
          })),
        },
      })),
    }),
  ])('rejects closed-schema violations', (patch) =>
    expect(() => parseSharedJson(envelope(patch(parsed())))).toThrow(),
  );
  it.each([0, 4, '3', null])('rejects unsupported version %s', (version) =>
    expect(() =>
      parseSharedJson(JSON.stringify({ format: 'tapaal-web-network', version, network: parsed() })),
    ).toThrow(),
  );
  it('rejects envelope extras, clipboard, malformed JSON and invalid source exports', () => {
    expect(() =>
      parseSharedJson(JSON.stringify({ ...JSON.parse(serializeSharedJson(parsed())), net: {} })),
    ).toThrow();
    expect(() => parseSharedJson('{')).toThrow(/malformed/);
    expect(() => parseSharedJson('{"format":"tapaal-web-clipboard","version":3}')).toThrow();
    expect(() =>
      serializeSharedTapn({ ...parsed(), shared: { places: [], transitions: [] } }),
    ).toThrow();
  });
  it.each([
    ['initialMarking="3" invariant="&lt;= D"/>', 'initialMarking="4" invariant="&lt;= D"/>'],
    [
      'name="Pool" initialMarking="3" invariant="&lt;= D"',
      'name="Pool" initialMarking="3" invariant="&lt;= 5"',
    ],
    [
      'name="Pool" initialMarking="3" invariant="&lt;= D"',
      'name="Pool" initialMarking="3" invariant="&lt;= Missing"',
    ],
    [
      'name="Unused" initialMarking="1" invariant="&lt;= Zero"',
      'name="Unused" initialMarking="1" invariant="&lt; Zero"',
    ],
    ['<shared-place name="Pool"', '<shared-place id="rootID" name="Pool"'],
    ['name="Unused"', 'name="Pool"'],
    ['id="t" name="t"', 'id="t" name="Pool"'],
    ['id="q" name="q"', 'id="constructor" name="q"'],
    ['name="q"', 'name="Pool"'],
    ['weight="K"', 'weight="Unknown"'],
    ["<text>1'dot</text>", "<text>3'dot</text>"],
    ['<shared-place name="Pool"', '<shared-transition name="Pool"'],
    ['isColored="false"', 'isColored="true"'],
    ['<shared-place name="Pool"', '<shared-place strange="1" name="Pool"'],
  ])('refuses contradictory or unsupported original XML %s', (a, b) =>
    expect(() => parseSharedTapn(fixture.replace(a, b))).toThrow(),
  );
  it('rejects nested/foreign/prefixed declarations and unsupported pool children', () => {
    for (const pool of [
      '<shared-place xmlns="urn:foreign" name="X" initialMarking="0"/>',
      '<x:shared-place xmlns:x="http://www.informatik.hu-berlin.de/top/pnml/ptNetb" name="X" initialMarking="0"/>',
      '<shared-place name="X" initialMarking="0"><bogus/></shared-place>',
      '<shared-place name="X" initialMarking="0"><initialMarkingAge><token age="-1"/></initialMarkingAge></shared-place>',
    ])
      expect(() => parseSharedTapn(fixture.replace('</pnml>', pool + '</pnml>'))).toThrow();
    expect(() =>
      parseSharedTapn(
        fixture.replace('</net>', '<shared-place name="X" initialMarking="0"/></net>'),
      ),
    ).toThrow();
  });
  it('refuses document-level content before adapting XML', () => {
    for (const prefix of ['<!-- keep -->', '<?extension data?>', '<!DOCTYPE pnml>'])
      expect(() => parseSharedTapn(prefix + fixture.replace(/<\?xml[^>]*>/, ''))).toThrow();
  });
  it('matches missing-ID members by name while retaining local arc endpoints', () => {
    const text = fixture
      .replaceAll('id="constructor" name="Pool"', 'name="Pool"')
      .replaceAll('source="constructor"', 'source="Pool"');
    const n = parseSharedTapn(text).network;
    expect(n.components[0].net.nodes[0].id).toBe('Pool');
    expect(parseSharedTapn(serializeSharedTapn(n)).network).toEqual(n);
  });
  it('checks pool dot AST against original marking, not a member or a regenerated AST', () => {
    const output = serializeSharedTapn(parsed());
    const doc = new DOMParser().parseFromString(output, 'application/xml');
    const pool = Array.from(doc.documentElement.children).find(
      (e) => e.localName === 'shared-place' && e.getAttribute('name') === 'Pool',
    )!;
    pool.querySelector('hlinitialMarking numberconstant')!.setAttribute('value', '4');
    pool.querySelector('hlinitialMarking text')!.textContent = "4'dot";
    expect(() => parseSharedTapn(new XMLSerializer().serializeToString(doc))).toThrow(/dot/);
    expect(() =>
      parseSharedTapn(output.replace('<hlinitialMarking>', '<hlinitialMarking invalid="true">')),
    ).toThrow();
  });
  it('checks authored Zero versus literal zero on pool members', () => {
    const text = fixture
      .replaceAll('&lt;= D', '&lt;= Zero')
      .replace(
        'initialMarking="3" invariant="&lt;= Zero"',
        'initialMarking="3" invariant="&lt;= 0"',
      );
    expect(() => parseSharedTapn(text)).toThrow(/disagrees/);
  });
  it('uses explicit native correspondence for opaque pool, constant and component IDs', () => {
    const n = parsed();
    const text = serializeSharedJson(n)
      .replaceAll('tapn:shared-place:0', '__proto__')
      .replaceAll('tapn:shared-place:1', 'constructor')
      .replaceAll('tapn:constant:0', 'weight-id')
      .replaceAll('tapn:Alpha', 'component-id');
    const source = parseSharedJson(text).network;
    expect(parseSharedTapn(serializeSharedTapn(source)).network).toEqual(n);
  });
  it('refuses silently changed annotation IDs or unrepresentable pool counts', () => {
    const n = parsed();
    const notes: SharedSource = {
      ...n,
      components: n.components.map((c, i) =>
        i
          ? c
          : {
              ...c,
              net: {
                ...c.net,
                annotations: c.net.annotations!.map((a) => ({ ...a, id: 'custom-note' })),
              },
            },
      ),
    };
    expect(parseSharedJson(serializeSharedJson(notes)).network).toEqual(notes);
    expect(() => serializeSharedTapn(notes)).toThrow(/verification.*JSON/);
    const large: SharedSource = {
      ...n,
      shared: { ...n.shared, places: n.shared.places.map((p) => ({ ...p, tokens: 2147483648 })) },
    };
    expect(validateSharedSource(large).ok).toBe(true);
    expect(() => serializeSharedTapn(large)).toThrow(/JSON/);
  });
  it('keeps legacy production refusal gates and validates before touching output', () => {
    expect(() => parseAuthoredTapn(fixture)).toThrow(/Shared/);
    expect(() => parseNetworkTapn(fixture)).toThrow(/Shared/);
    expect(validateSharedSource(parsed()).ok).toBe(true);
  });
});
