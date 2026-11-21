// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  parseAuthoredModel,
  parseAuthoredJson,
  parseAuthoredTapn,
  serializeAuthoredJson,
  serializeAuthoredTapn,
} from './authored-files';
import { resolveAuthored, AuthoredNetwork } from './authored-model';
import { openAuthoredDocument, transactDocument, undoAuthored } from './authored-documents';
import {
  parseNetworkJson,
  parseNetworkTapn,
  serializeNetworkJson,
  serializeNetworkTapn,
} from './network-files';
import { TimedNetworkSimulation } from './timed-network-simulation';
import { Network } from './resolved-network';
const fixture = readFileSync(
  'src/app/core/test-fixtures/native-4.0.4/scalar-constants.tapn',
  'utf8',
);
function value<T>(r: { ok: true; value: T } | { ok: false; issues: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const parsed = () => parseAuthoredTapn(fixture).network;
const numeric = (n: AuthoredNetwork) =>
  structuredClone(value(resolveAuthored(n)).numeric) as Network;
describe('opt-in authored file codecs', () => {
  it('writes v2, migrates numeric v1/legacy, and retains numeric public gates', () => {
    const n = parsed();
    expect(parseAuthoredModel(serializeAuthoredJson(n)).network).toEqual(n);
    expect(JSON.parse(serializeAuthoredJson(n)).version).toBe(2);
    expect(() => parseNetworkJson(serializeAuthoredJson(n))).toThrow(/version/);
    expect(() => parseNetworkTapn(fixture)).toThrow(/Constants/);
    expect(() => serializeNetworkJson(n as unknown as Network)).toThrow();
    expect(() => serializeNetworkTapn(n as unknown as Network)).toThrow();
    expect(parseAuthoredJson(serializeNetworkJson(numeric(n))).network.constants).toEqual([]);
    expect(
      parseAuthoredJson(
        JSON.stringify({
          format: 'tapaal-web-untimed',
          version: 1,
          net: numeric(n).components[0].net,
        }),
      ).network.constants,
    ).toEqual([]);
  });
  it('round-trips rename/value edit/undo, fresh dot AST and changed execution', () => {
    const n = parsed(),
      doc = value(openAuthoredDocument(n));
    const changed = value(
      transactDocument(doc, doc.network, {
        kind: 'updateConstant',
        id: n.constants[0].id,
        name: 'Batch',
        value: 4,
      }),
    );
    const output = serializeAuthoredTapn(changed.network);
    expect(output).toContain('weight="Batch"');
    expect(output).toContain('inscription="[Batch,D]"');
    expect(output).toContain("4'dot");
    expect(output).not.toContain('NaN');
    expect((output.match(/<\?xml/g) ?? []).length).toBe(1);
    const reloaded = parseAuthoredTapn(output).network;
    expect(reloaded.constants[0].name).toBe('Batch');
    expect(numeric(reloaded).components[0].net.arcs.map((a) => a.weight)).toEqual([4, 4, 4, 4, 4]);
    expect(undoAuthored(changed).network).toBe(doc.network);
    expect(new TimedNetworkSimulation(numeric(n)).enabledFor(n.components[0].id)).toContain('t');
    expect(
      new TimedNetworkSimulation(numeric(changed.network)).enabledFor(n.components[0].id),
    ).not.toContain('t');
  });
  it('retains symbolic defaults and refuses symbolic urgent/inhibitor guards', () => {
    const source = fixture.replaceAll('[Zero,D]:1', '[Zero,inf):1');
    const n = parseAuthoredTapn(source).network;
    expect(n.components[0].timing?.intervals['ti'].lower).toEqual({
      constantId: n.constants[2].id,
    });
    expect(numeric(n).components[0].timing?.intervals['ti']).toBeUndefined();
    expect(serializeAuthoredTapn(n)).toContain('[Zero,inf):1');
    expect(() =>
      parseAuthoredTapn(source.replace('angle="90" urgent="false"', 'angle="90" urgent="true"')),
    ).toThrow(/Symbolic urgent/);
    expect(() =>
      parseAuthoredTapn(fixture.replace('inscription="[0,inf)"', 'inscription="[Zero,inf)"')),
    ).toThrow(/ordinary or transport/);
  });
  it.each([
    ['value="2"', 'value="2,3"', /scalar/],
    ['value="2"', 'value="2.5"', /scalar/],
    ['value="2"', 'value="-1"', /scalar/],
    ['value="2"', 'value="2147483648"', /scalar/],
    ['name="K" value="2"', 'name="K" value="2" type="real"', /Scalar/],
    ['weight="K"', 'weight="Missing"', /Undefined/],
    ['[K,D]', '(K,K)', /interval/],
    ['&lt;= D', '&lt; Zero', /invariant/],
    ['weight="K"', 'weight="Zero"', /weight/i],
    ['name="K" value="2"', 'name="inf" value="2"', /reserved/],
    ['id="ti"', 'id="p"', /unambiguous/],
  ])('refuses source %s → %s', (a, b, error) =>
    expect(() => parseAuthoredTapn(fixture.replace(a, b))).toThrow(error),
  );
  it('refuses equal-value distinct-name transport halves', () => {
    const source = fixture
      .replace('<constant name="D"', '<constant name="Other" value="2"/><constant name="D"')
      .replace(
        'id="to" source="t" target="q" type="transport" weight="K"',
        'id="to" source="t" target="q" type="transport" weight="Other"',
      );
    expect(() => parseAuthoredTapn(source)).toThrow(/identical authored/);
  });
  it('supports exact case/underscore, MAX and [K,K]', () => {
    for (const name of ['_K', 'Inf'])
      expect(parseAuthoredTapn(fixture.replaceAll('K', name)).network.constants[0].name).toBe(name);
    expect(
      parseAuthoredTapn(
        fixture.replace('</pnml>', '<constant name="Max" value="2147483647"/></pnml>'),
      ).network.constants.at(-1)?.value,
    ).toBe(2147483647);
    expect(
      parseAuthoredTapn(fixture.replace('[K,D]', '[K,K]')).network.components[0].timing?.intervals[
        'in'
      ].upper,
    ).toEqual({ constantId: 'tapn:constant:0' });
  });
  it('retains geometry/ages/inactive status and protects queries exactly once', () => {
    const source = fixture
      .replace('<net active="true"', '<net active="false"')
      .replace('<feature ', '<net active="true" id="Active" type="P/T net"/><feature ')
      .replace(
        'invariant="&lt;= D" displayName="false"/>',
        'invariant="&lt;= D" displayName="false"><initialMarkingAge><token age="1.25"/></initialMarkingAge></place>',
      )
      .replace(
        '</pnml>',
        '<query active="true" name="Safe" type="Default" query="EF Scalar.q &gt;= 2"/></pnml>',
      );
    const n = parseAuthoredTapn(source).network;
    const reloaded = parseAuthoredTapn(serializeAuthoredTapn(n)).network;
    expect(reloaded).toEqual(n);
    expect(n.savedQueries?.protectedConstants).toHaveLength(3);
    const doc = value(openAuthoredDocument(n));
    expect(
      transactDocument(doc, doc.network, {
        kind: 'updateConstant',
        id: n.constants[0].id,
        name: 'Other',
        value: 2,
      }).ok,
    ).toBe(false);
  });
  it('refuses malformed/unknown v2 references and nested keys', () => {
    for (const patch of [
      { weight: { constantId: 'missing' } },
      { weight: { constantId: 'tapn:constant:0', value: 2 } },
      { extra: 1 },
    ]) {
      const n = structuredClone(parsed());
      Object.assign(n.components[0].net.arcs[0], patch);
      expect(() =>
        parseAuthoredJson(JSON.stringify({ format: 'tapaal-web-network', version: 2, network: n })),
      ).toThrow();
    }
    expect(() => parseAuthoredJson('{"format":"tapaal-web-network","version":3}')).toThrow(
      /version/,
    );
  });
  it('rejects getters/inherited/hidden data before clone', () => {
    const n = parsed();
    let reads = 0;
    expect(() =>
      serializeAuthoredJson({
        ...n,
        get constants() {
          reads++;
          return n.constants;
        },
      }),
    ).toThrow();
    expect(reads).toBe(0);
    expect(() => serializeAuthoredJson(Object.create(n))).toThrow();
    const hidden = structuredClone(n);
    Object.defineProperty(hidden.constants, 0, { enumerable: false });
    expect(() => serializeAuthoredJson(hidden)).toThrow();
  });
  it('keeps fractional bounds/geometry JSON-only and rejects dot conflicts', () => {
    const n = parsed();
    const draft = {
      ...n,
      components: n.components.map((c) => ({
        ...c,
        timing: {
          ...c.timing!,
          intervals: {
            ...c.timing!.intervals,
            in: { lower: '0.5', upper: '5', lowerClosed: true, upperClosed: true },
          },
        },
      })),
    };
    expect(parseAuthoredJson(serializeAuthoredJson(draft)).network).toEqual(draft);
    expect(() => serializeAuthoredTapn(draft)).toThrow(/Save JSON/);
    const output = serializeAuthoredTapn(n);
    expect(() =>
      parseAuthoredTapn(
        output
          .replaceAll("2'dot", "3'dot")
          .replaceAll('numberconstant value="2"', 'numberconstant value="3"'),
      ),
    ).toThrow(/dot-only/);
    expect(() => parseAuthoredTapn(output.replace("2'dot", "3'dot"))).toThrow(/dot-only/);
  });
  it('keeps the weighted native transport regression fixture', () => {
    const n = parseAuthoredTapn(
      readFileSync('src/app/core/test-fixtures/native-4.0.4/timed-weighted.native.tapn', 'utf8'),
    ).network;
    expect(numeric(parseAuthoredTapn(serializeAuthoredTapn(n)).network)).toEqual(numeric(n));
  });
  it('uses emitted 4.0.4 fixtures before and after value change without losing reference classes', () => {
    for (const [file, expected] of [
      ['scalar-constants.native.tapn', 2],
      ['scalar-constants-changed.native.tapn', 4],
    ] as const) {
      const n = parseAuthoredTapn(
        readFileSync(`src/app/core/test-fixtures/native-4.0.4/${file}`, 'utf8'),
      ).network;
      expect(n.constants.find((c) => c.name === 'K')?.value).toBe(expected);
      expect(n.components[0].net.arcs.every((a) => typeof a.weight === 'object')).toBe(true);
      expect(serializeAuthoredTapn(n)).toContain('weight="K"');
    }
  });
  it('does not treat query/watch content as a declaration or widen the existing query gate', () => {
    const query =
      '<query name="Watch"><watch><integer-constant>2</integer-constant></watch></query>';
    const n = parseAuthoredTapn(fixture.replace('</pnml>', query + '</pnml>')).network;
    expect(n.constants).toHaveLength(3);
    expect(n.savedQueries?.xml[0]).toContain('integer-constant');
    expect(() =>
      parseAuthoredTapn(
        fixture.replace(
          '</pnml>',
          '<query><watch><constant name="Hidden" value="2"/></watch></query></pnml>',
        ),
      ),
    ).toThrow(/saved-query content/);
  });
  it('validates persisted protections and refuses native export that would recapture a different protection set', () => {
    const n = parseAuthoredTapn(
      fixture.replace('</pnml>', '<query name="Safe" query="EF Scalar.q &gt;= 2"/></pnml>'),
    ).network;
    const q = n.savedQueries!;
    const partial = { ...n, savedQueries: { ...q, protectedConstants: [] } };
    expect(parseAuthoredJson(serializeAuthoredJson(partial)).network).toEqual(partial);
    expect(() => serializeAuthoredTapn(partial)).toThrow(/verification failed/);
    for (const protection of [
      { id: 'missing', name: 'K' },
      { id: n.constants[0].id, name: 'Renamed' },
    ]) {
      const bad = { ...n, savedQueries: { ...q, protectedConstants: [protection] } };
      expect(() =>
        parseAuthoredJson(
          JSON.stringify({ format: 'tapaal-web-network', version: 2, network: bad }),
        ),
      ).toThrow();
    }
  });
  it('retains literal <=0 and symbolic <=Zero invariants and emits v2 without declarations', () => {
    const n = parseAuthoredTapn(
      fixture.replace(
        'id="q" name="q" positionX="230" positionY="30" initialMarking="0" invariant="&lt; inf"',
        'id="q" name="q" positionX="230" positionY="30" initialMarking="0" invariant="&lt;= Zero"',
      ),
    ).network;
    expect(serializeAuthoredTapn(n)).toContain('invariant="&lt;= Zero"');
    const migrated = parseAuthoredJson(serializeNetworkJson(numeric(parsed()))).network;
    const output = JSON.parse(serializeAuthoredJson(migrated));
    expect(output.version).toBe(2);
    expect(output.network.constants).toEqual([]);
  });
});
