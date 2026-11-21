// @vitest-environment jsdom
// Independent review proofs for the opt-in authored file codecs. See design/CONSTANTS-FILES-REVIEW.md.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseAuthoredJson,
  parseAuthoredTapn,
  serializeAuthoredJson,
  serializeAuthoredTapn,
} from './authored-files';
import {
  AuthoredDocument,
  AuthoredEdit,
  openAuthoredDocument,
  transactDocument,
  undoAuthored,
} from './authored-documents';
import { parseNetworkTapn, serializeNetworkTapn } from './network-files';
import { resolveAuthored } from './authored-model';
import { Network } from './resolved-network';

const fixture = readFileSync(
  'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn',
  'utf8',
);
/** Rename a node consistently: id, name and arc endpoints. */
const renameNode = (source: string, from: string, to: string) =>
  source
    .replaceAll(`id="${from}" name="${from}"`, `id="${to}" name="${to}"`)
    .replaceAll(`source="${from}"`, `source="${to}"`)
    .replaceAll(`target="${from}"`, `target="${to}"`);
const PROTOTYPE_NAMES = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];

describe('review F1: prototype-named IDs in authored TAPN records', () => {
  it.each(PROTOTYPE_NAMES)('numeric codec exports place %s (control)', (name) => {
    const n = parseAuthoredTapn(renameNode(fixture, 'q', name)).network;
    const resolved = resolveAuthored(n);
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
    const numeric = structuredClone(resolved.value.numeric) as Network;
    expect(
      parseNetworkTapn(serializeNetworkTapn(numeric)).network.components[0].net.nodes.map(
        (x) => x.id,
      ),
    ).toContain(name);
  });
  it.each(PROTOTYPE_NAMES)('exports place %s with a literal default invariant', (name) => {
    const n = parseAuthoredTapn(renameNode(fixture, 'q', name)).network;
    expect(parseAuthoredTapn(serializeAuthoredTapn(n)).network).toEqual(n);
  });
  it.each(PROTOTYPE_NAMES)('exports output arc %s', (name) => {
    const n = parseAuthoredTapn(fixture.replace('id="out"', `id="${name}"`)).network;
    expect(parseAuthoredTapn(serializeAuthoredTapn(n)).network).toEqual(n);
  });
  it('imports a symbolic invariant on place __proto__ as an own record key', () => {
    const n = parseAuthoredTapn(renameNode(fixture, 'p', '__proto__')).network;
    const invariants = n.components[0].timing!.invariants;
    expect(Object.hasOwn(invariants, '__proto__')).toBe(true);
    expect(parseAuthoredTapn(serializeAuthoredTapn(n)).network).toEqual(n);
  });
});

describe('review: contracts that hold (bounded proofs)', () => {
  const withInputAst = (text: string, coefficient: string) =>
    fixture.replace(
      '<arc id="in" source="p" target="o" type="timed" weight="K" inscription="[K,D]"/>',
      `<arc id="in" source="p" target="o" type="timed" weight="K" inscription="[K,D]"><hlinscription><text>${text}</text><structure><numberof><subterm><numberconstant value="${coefficient}"><positive/></numberconstant></subterm><subterm><useroperator declaration="dot"/></subterm></numberof></structure></hlinscription></arc>`,
    );
  it.each([
    ["1'dot", '1'],
    ["2'dot", '2'],
  ])('accepts redundant dot AST %s with coefficient 1 or the resolved weight', (text, c) =>
    expect(() => parseAuthoredTapn(withInputAst(text, c))).not.toThrow(),
  );
  it.each([
    ["3'dot", '3'],
    ["K'dot", 'K'],
    ["2'dot", 'K'],
    ["1'dot", '2'],
    ["2'dot", '1'],
  ])('refuses stale, symbolic or conflicting dot AST %s / %s', (text, c) =>
    expect(() => parseAuthoredTapn(withInputAst(text, c))).toThrow(/dot-only/),
  );

  it.each([
    [
      'nested in <net>',
      '<place id="b"',
      '<constant name="Z" value="1"/><place id="b"',
      /Constants/,
    ],
    [
      'foreign namespace',
      '<constant name="K" value="2"/>',
      '<constant xmlns="urn:x" name="K" value="2"/>',
      /Scalar <constant>/,
    ],
    [
      'namespaced attribute',
      '<constant name="K" value="2"/>',
      '<constant xmlns:x="urn:x" x:a="1" name="K" value="2"/>',
      /Scalar <constant>/,
    ],
    [
      'comment content',
      '<constant name="K" value="2"/>',
      '<constant name="K" value="2"><!--x--></constant>',
      /Scalar <constant>/,
    ],
    ['lower inf', '[K,D]', '[inf,inf)', /Undefined/],
    [
      'literal vs reference transport weight',
      'id="to" source="t" target="q" type="transport" weight="K"',
      'id="to" source="t" target="q" type="transport" weight="2"',
      /identical authored/,
    ],
    [
      'equal-valued transport guard spelling',
      'id="to" source="t" target="q" type="transport" weight="K" inscription="[Zero,D]:1"',
      'id="to" source="t" target="q" type="transport" weight="K" inscription="[0,D]:1"',
      /identical authored/,
    ],
    ['arc without ID', '<arc id="out" ', '<arc ', /unambiguous/],
  ])('refuses %s', (_label, from, to, error) =>
    expect(() => parseAuthoredTapn(fixture.replace(from, to))).toThrow(error),
  );

  it('binds upper Inf as a declaration (native reserves exact lowercase inf only)', () => {
    const n = parseAuthoredTapn(
      fixture
        .replace('<constant name="Zero"', '<constant name="Inf" value="9"/><constant name="Zero"')
        .replace('[K,D]', '[K,Inf)'),
    ).network;
    const inf = n.constants.find((c) => c.name === 'Inf')!;
    expect(n.components[0].timing!.intervals['in'].upper).toEqual({ constantId: inf.id });
    expect(serializeAuthoredTapn(n)).toContain('inscription="[K,Inf)"');
  });

  it('round-trips untimed symbolic weights and refuses untimed symbolic guards', () => {
    const untimed = `<?xml version="1.0"?><pnml xmlns="http://www.informatik.hu-berlin.de/top/pnml/ptNetb"><constant name="K" value="2"/><constant name="Unused" value="0"/><net active="true" id="N" type="P/T net"><place id="p" name="p" positionX="30" positionY="30" initialMarking="3"/><transition id="t" name="t" positionX="130" positionY="30"/><arc id="a" source="p" target="t" type="timed" weight="K" inscription="[0,inf)"/><arc id="b" source="t" target="p" type="normal" weight="K" inscription="1"/></net><feature isTimed="false" isColored="false" isGame="false" isStochastic="false"/></pnml>`;
    const n = parseAuthoredTapn(untimed).network;
    const output = serializeAuthoredTapn(n);
    expect(output.match(/weight="K"/g)).toHaveLength(2);
    expect(parseAuthoredTapn(output).network).toEqual(n);
    expect(() => parseAuthoredTapn(untimed.replace('[0,inf)', '[0,K)'))).toThrow(/Timed arc/);
  });

  it('exports a symbolic edit chain across an inactive copy with names, not values', () => {
    const n = parseAuthoredTapn(
      fixture.replace('</pnml>', '<query name="Safe" query="EF Scalar.q &gt;= 2"/></pnml>'),
    ).network;
    const opened = openAuthoredDocument(n);
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
    let doc: AuthoredDocument = opened.value;
    const step = (edit: AuthoredEdit) => {
      const r = transactDocument(doc, doc.network, edit);
      if (!r.ok) return r.issues[0].code;
      doc = r.value;
      return 'ok';
    };
    const [, d, zero] = n.constants;
    const component = n.components[0].id;
    expect(
      step({ kind: 'copyComponent', componentId: component, id: 'copy', template: 'Copy' }),
    ).toBe('ok');
    expect(
      step({ kind: 'patchComponent', componentId: 'copy', active: false, template: 'Copy' }),
    ).toBe('ok');
    expect(step({ kind: 'updateConstant', id: d.id, name: 'Limit', value: 6 })).toBe(
      'query-protected',
    );
    expect(step({ kind: 'removeSavedQueries' })).toBe('ok');
    expect(step({ kind: 'updateConstant', id: d.id, name: 'Limit', value: 6 })).toBe('ok');
    expect(step({ kind: 'setWeightTerm', componentId: component, arcId: 'out', term: 3 })).toBe(
      'ok',
    );
    expect(
      step({
        kind: 'setInvariant',
        componentId: 'copy',
        placeId: 'q',
        invariant: { upper: { constantId: zero.id }, upperClosed: true },
      }),
    ).toBe('ok');
    expect(step({ kind: 'addConstant', constant: { id: 'u', name: 'Unused', value: 7 } })).toBe(
      'ok',
    );
    const output = serializeAuthoredTapn(doc.network);
    expect(output).not.toMatch(/"D"|NaN|undefined/);
    expect(output.match(/inscription="\[K,Limit\]"/g)).toHaveLength(2);
    expect(output).toContain('invariant="&lt;= Zero"');
    expect(output).toContain('<constant name="Unused" value="7"/>');
    expect(output).toContain('weight="3" inscription="1"');
    const reloaded = parseAuthoredTapn(output).network;
    expect(reloaded.constants.map((c) => `${c.name}=${c.value}`)).toEqual([
      'K=2',
      'Limit=6',
      'Zero=0',
      'Unused=7',
    ]);
    expect(reloaded.components.map((c) => c.active)).toEqual([true, false]);
    expect(reloaded.components[1].net.arcs.find((a) => a.id === 'out')!.weight).toEqual({
      constantId: reloaded.constants[0].id,
    });
    expect(parseAuthoredJson(serializeAuthoredJson(doc.network)).network).toEqual(doc.network);
    // Undo walks back through every authored snapshot to the protected import.
    let back = doc;
    for (let i = 0; i < 7; i++) back = undoAuthored(back);
    expect(back.network).toBe(opened.value.network);
  });

  it('keeps a __proto__ constant ID/name as own data through JSON and TAPN', () => {
    const n = parseAuthoredTapn(fixture).network;
    const json = serializeAuthoredJson(n).replace(
      '"constants": [',
      '"constants": [{"id":"__proto__","name":"__proto__","value":3},',
    );
    const m = parseAuthoredJson(json).network;
    expect(m.constants[0]).toEqual({ id: '__proto__', name: '__proto__', value: 3 });
    expect(serializeAuthoredTapn(m)).toContain('<constant name="__proto__" value="3"/>');
  });
});
