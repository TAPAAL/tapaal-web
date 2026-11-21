// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJson, parseModel, parseTapn, serializeJson, serializeTapn } from './files';
import { Net } from './net';

const example: Net = {
  name: 'Untimed example',
  template: 'Main',
  nodes: [
    { id: 'p', name: 'Input', kind: 'place', x: 100, y: 150, tokens: 3 },
    { id: 'q', name: 'Output', kind: 'place', x: 400, y: 150, tokens: 0 },
    { id: 't', name: 'Transfer', kind: 'transition', x: 250, y: 150, tokens: 0 },
  ],
  arcs: [
    { id: 'a', source: 'p', target: 't', kind: 'normal', weight: 2 },
    { id: 'b', source: 't', target: 'q', kind: 'normal', weight: 3 },
    { id: 'c', source: 'q', target: 't', kind: 'inhibitor', weight: 4 },
  ],
};
const xml = () => serializeTapn(example);
const mutateXml = (change: (document: Document) => void) => {
  const document = new DOMParser().parseFromString(xml(), 'application/xml');
  change(document);
  return new XMLSerializer().serializeToString(document);
};
const changeAttribute = (selector: string, key: string, value: string) =>
  mutateXml((document) => document.querySelector(selector)!.setAttribute(key, value));
const append = (document: Document, selector: string, source: string) => {
  const element = new DOMParser().parseFromString(source, 'application/xml').documentElement;
  document.querySelector(selector)!.appendChild(document.importNode(element, true));
};

describe('model file round trips', () => {
  it('preserves all untimed JSON model data and detects the format', () => {
    expect(parseJson(serializeJson(example))).toEqual({ net: example, warnings: [] });
    expect(parseModel(` \n${serializeJson(example)}`, 'model.json').net).toEqual(example);
  });
  it('preserves TAPN semantics, arc weights and centre coordinates', () => {
    expect(parseTapn(xml(), 'Untimed example.tapn')).toEqual({ net: example, warnings: [] });
    expect(parseModel(xml(), 'Untimed example.xml').net).toEqual(example);
  });
  it('retains native name offsets through TAPN and JSON round trips', () => {
    const model = structuredClone(example);
    model.nodes[0].nameOffsetX = -24;
    model.nodes[0].nameOffsetY = 9;
    expect(parseTapn(serializeTapn(model), 'offsets.tapn').net).toEqual(model);
    expect(parseJson(serializeJson(model)).net).toEqual(model);
    const imported = parseTapn(changeAttribute('place', 'nameOffsetY', '-18'), 'offsets.tapn');
    expect(imported.net.nodes[0].nameOffsetY).toBe(-18);
  });
  it('round-trips hidden names, rotation and annotations in native attribute form', () => {
    const model: Net = {
      ...structuredClone(example),
      annotations: [
        {
          id: 'annotation-1',
          text: 'A & B <c>\n  "quoted" ]]>',
          x: 40,
          y: 8,
          width: 120,
          height: 34,
        },
        { id: 'annotation-2', text: ' ', x: 0, y: 0, width: 0, height: 0, border: false },
      ],
    };
    model.nodes[0].nameVisible = false;
    model.nodes[2].angle = 315;
    const source = serializeTapn(model);
    expect(source).toContain('A &amp; B &lt;c&gt;\n  "quoted" ]]&gt;');
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const net = document.querySelector('net')!;
    expect(Array.from(net.children).map((e) => e.localName)).toEqual([
      'labels',
      'labels',
      'place',
      'place',
      'transition',
      'arc',
      'arc',
      'arc',
    ]);
    const label = net.querySelector('labels')!;
    expect(Object.fromEntries(Array.from(label.attributes).map((a) => [a.name, a.value]))).toEqual({
      positionX: '40',
      positionY: '8',
      width: '120',
      height: '34',
      border: 'true',
    });
    expect(net.querySelectorAll('labels')[1].getAttribute('border')).toBe('false');
    expect(net.querySelector('place')!.getAttribute('displayName')).toBe('false');
    expect(net.querySelector('transition')!.getAttribute('angle')).toBe('315');
    expect(parseTapn(source, 'Untimed example.tapn').net).toEqual(model);
    expect(parseJson(serializeJson(model)).net).toEqual(model);
  });
  it('reads native angles with Java remainder semantics and display names exactly', () => {
    const angle = (value: string) =>
      parseTapn(changeAttribute('transition', 'angle', value)).net.nodes[2].angle;
    expect(angle('405')).toBe(45);
    expect(angle('-45')).toBe(-45);
    expect(angle('-360')).toBeUndefined();
    expect(angle('')).toBeUndefined();
    expect(() => angle('45.0')).toThrow(/whole number/);
    const hidden = (value: string) =>
      parseTapn(changeAttribute('place', 'displayName', value)).net.nodes[0].nameVisible;
    expect(hidden('false')).toBe(false);
    expect(hidden('FALSE')).toBeUndefined();
  });
  it('rejects invalid name offsets before replacing a model', () => {
    expect(() => parseTapn(changeAttribute('place', 'nameOffsetX', 'NaN'), 'bad.tapn')).toThrow();
    const model = structuredClone(example);
    model.nodes[0].nameOffsetX = Infinity;
    expect(() => serializeTapn(model)).toThrow(/Label offsets/);
  });
  it('writes the legacy Java loader dialect and untimed feature declaration', () => {
    const document = new DOMParser().parseFromString(xml(), 'application/xml');
    expect(document.querySelector('feature')!.getAttribute('isTimed')).toBe('false');
    expect(document.querySelector('arc[id="a"]')!.getAttribute('type')).toBe('timed');
    expect(document.querySelector('arc[id="a"]')!.getAttribute('inscription')).toBe('[0,inf)');
    expect(document.querySelector('arc[id="b"]')!.getAttribute('type')).toBe('normal');
    expect(document.querySelector('arc[id="c"]')!.getAttribute('type')).toBe('tapnInhibitor');
    expect(document.querySelector('place')!.getAttribute('positionX')).toBe('85');
  });
  it('escapes XML attributes while preserving XML syntax in IDs', () => {
    const net = structuredClone(example);
    net.nodes[0].id = 'p<&"\'';
    net.arcs[0].source = net.nodes[0].id;
    const source = serializeTapn(net);
    for (const entity of ['&lt;', '&amp;', '&quot;']) expect(source).toContain(entity);
    expect(parseTapn(source, 'Untimed example.tapn').net).toEqual(net);
  });
  it('preserves the model title even when the imported filename changes', () => {
    const net = structuredClone(example);
    net.name = 'A & B <experiment> "one"';
    expect(parseTapn(serializeTapn(net), 'renamed.tapn').net).toEqual(net);
  });
  it('accepts legacy inputArc/outputArc/inhibitorArc tags', () => {
    const source = xml()
      .replace('<arc id="a"', '<inputArc id="a"')
      .replace('<arc id="b"', '<outputArc id="b"')
      .replace('<arc id="c"', '<inhibitorArc id="c"')
      .replace('</arc>', '</inputArc>')
      .replace('</arc>', '</outputArc>')
      .replace('</arc>', '</inhibitorArc>');
    expect(parseTapn(source).net).toEqual(example);
  });
  it('accepts namespace-prefixed PNML elements', () => {
    const source = xml()
      .replace(
        /<(\/?)(pnml|net|place|transition|arc|arcpath|k-bound|feature)(?=[\s/>])/g,
        '<$1p:$2',
      )
      .replace('xmlns=', 'xmlns:p=');
    expect(parseTapn(source, 'Untimed example.tapn').net).toEqual(example);
  });
  it.each([
    ['home-construction', 'HouseConstruction1', 27, 18, 52, 3],
    ['two-phase-locking', 'comp1', 8, 6, 18, 4],
    ['ERK', 'comp1', 11, 11, 34, 1],
  ] as const)(
    'imports the real %s desktop example and reports omitted queries',
    (name, template, places, transitions, arcs, queries) => {
      const source = readFileSync(`../src/main/resources/Example nets/${name}.tapn`, 'utf8');
      const imported = parseTapn(source, `${name}.tapn`);
      expect(imported.net.template).toBe(template);
      expect(imported.net.nodes.filter((n) => n.kind === 'place')).toHaveLength(places);
      expect(imported.net.nodes.filter((n) => n.kind === 'transition')).toHaveLength(transitions);
      expect(imported.net.arcs).toHaveLength(arcs);
      expect(imported.warnings.some((w) => w.includes(`${queries} saved queries`))).toBe(true);
      expect(parseTapn(serializeTapn(imported.net), `${name}.tapn`).net).toEqual(imported.net);
      expect(parseJson(serializeJson(imported.net)).net).toEqual(imported.net);
    },
  );
});

const bent: Net = structuredClone(example);
bent.arcs[0] = {
  ...bent.arcs[0],
  bends: [
    { x: 130, y: 90, curved: false },
    { x: 170, y: 60, curved: true },
    { x: 210, y: 90, curved: true },
  ],
};
bent.arcs[1] = { ...bent.arcs[1], bends: [{ x: 320, y: 210, curved: false }], curvedEnd: true };
bent.arcs[2] = { ...bent.arcs[2], curvedEnd: true };
const arcPoints = (source: string, id: string) =>
  Array.from(
    new DOMParser()
      .parseFromString(source, 'application/xml')
      .querySelectorAll(`arc[id="${id}"] > arcpath`),
  ).map((point) =>
    ['id', 'xCoord', 'yCoord', 'arcPointType'].map((key) => point.getAttribute(key)),
  );

describe('native arc paths', () => {
  it('round trips straight and curved interior bends and a curved target end', () => {
    expect(parseTapn(serializeTapn(bent)).net).toEqual(bent);
    expect(parseJson(serializeJson(bent)).net).toEqual(bent);
    expect(parseTapn(serializeTapn(bent)).warnings).toEqual([]);
  });
  it('writes endpoints around the interior points with sequential native IDs', () => {
    expect(arcPoints(serializeTapn(bent), 'a')).toEqual([
      ['0', '100', '150', 'false'],
      ['1', '130', '90', 'false'],
      ['2', '170', '60', 'true'],
      ['3', '210', '90', 'true'],
      ['4', '250', '150', 'false'],
    ]);
    expect(arcPoints(serializeTapn(bent), 'c').at(-1)).toEqual(['1', '250', '150', 'true']);
  });
  it('treats the first and last points as automatic endpoints, not bends', () => {
    const source = mutateXml((document) => {
      const points = document.querySelectorAll('arc[id="a"] > arcpath');
      points[0].setAttribute('xCoord', '-999');
      points[0].setAttribute('arcPointType', 'true');
      points[1].setAttribute('yCoord', '12345');
    });
    expect(parseTapn(source).net).toEqual(example);
  });
  it('follows the Java loader: truncated coordinates and case-insensitive true', () => {
    const source = mutateXml((document) => {
      const arc = document.querySelector('arc[id="a"]')!;
      const point = document.createElementNS(arc.namespaceURI, 'arcpath');
      for (const [key, value] of Object.entries({
        id: '1',
        xCoord: '180.9',
        yCoord: '-0.4',
        arcPointType: 'TRUE',
      }))
        point.setAttribute(key, value);
      arc.insertBefore(point, arc.lastElementChild);
    });
    expect(parseTapn(source).net.arcs[0].bends).toEqual([{ x: 180, y: 0, curved: true }]);
  });
  it('keeps default straight arcs free of geometry fields', () => {
    expect(
      parseTapn(xml()).net.arcs.every((arc) => !('bends' in arc) && !('curvedEnd' in arc)),
    ).toBe(true);
  });
  it('replaces a single-point path with a straight connection and says so', () => {
    const source = mutateXml((document) =>
      document.querySelector('arc[id="a"] > arcpath')!.remove(),
    );
    const imported = parseTapn(source);
    expect(imported.net).toEqual(example);
    expect(imported.warnings).toEqual([
      'Arc paths with a single point were replaced with straight connections.',
    ]);
  });
  it.each([
    ['NaN', 'xCoord', 'NaN'],
    ['infinite', 'yCoord', 'Infinity'],
    ['empty', 'xCoord', ''],
    ['text', 'yCoord', 'left'],
    ['out-of-range', 'xCoord', '1000001'],
  ])('rejects %s arc path coordinates', (_label, key, value) => {
    const source = mutateXml((document) => {
      const arc = document.querySelector('arc[id="b"]')!;
      const point = document.createElementNS(arc.namespaceURI, 'arcpath');
      point.setAttribute('xCoord', '10');
      point.setAttribute('yCoord', '10');
      point.setAttribute(key, value);
      arc.insertBefore(point, arc.lastElementChild);
    });
    expect(() => parseTapn(source)).toThrow();
  });
  it('rejects malformed JSON geometry before replacing a model', () => {
    for (const bends of [[{ x: 1, y: Infinity, curved: false }], [{ x: 1, y: 2 }], 'none']) {
      const document = JSON.parse(serializeJson(example));
      document.net.arcs[0].bends = bends;
      expect(() => parseJson(JSON.stringify(document))).toThrow(/bend/);
    }
    const document = JSON.parse(serializeJson(example));
    document.net.arcs[0].curvedEnd = 'yes';
    expect(() => parseJson(JSON.stringify(document))).toThrow(/curvature/);
  });
  it.each(['ERK', 'home-construction'])(
    'preserves every interior point and end type of the desktop %s example',
    (name) => {
      const source = readFileSync(`../src/main/resources/Example nets/${name}.tapn`, 'utf8');
      const original = new DOMParser().parseFromString(source, 'application/xml');
      const expected = Array.from(original.querySelectorAll('arc')).map((arc) => {
        const points = Array.from(arc.querySelectorAll('arcpath')).map((point) => ({
          x: Number(point.getAttribute('xCoord')),
          y: Number(point.getAttribute('yCoord')),
          curved: point.getAttribute('arcPointType') === 'true',
        }));
        return { bends: points.slice(1, -1), curvedEnd: points.at(-1)!.curved };
      });
      const imported = parseTapn(source, `${name}.tapn`);
      expect(
        imported.net.arcs.map((arc) => ({ bends: arc.bends ?? [], curvedEnd: !!arc.curvedEnd })),
      ).toEqual(expected);
      expect(expected.some((arc) => arc.bends.length || arc.curvedEnd)).toBe(true);
      expect(imported.warnings.some((warning) => /bend|arc path/i.test(warning))).toBe(false);
      const saved = serializeTapn(imported.net);
      expect(parseTapn(saved, `${name}.tapn`).net).toEqual(imported.net);
    },
  );
});

describe('lossy import warnings', () => {
  it('reports queries and expanded constants, and imports annotations', () => {
    const source = mutateXml((document) => {
      append(document, 'pnml', '<query name="Reachability"/>');
      append(document, 'pnml', '<constant name="CAPACITY" value="2"/>');
      // Native ignores a text attribute: the note is the element's text content.
      append(document, 'net', '<labels text="An annotation"/>');
      document.querySelector('arc')!.setAttribute('weight', 'CAPACITY');
    });
    const imported = parseTapn(source, 'Untimed example.tapn');
    expect(imported.net).toEqual({
      ...example,
      annotations: [{ id: 'annotation-1', text: '', x: 0, y: 0, width: 0, height: 0 }],
    });
    expect(imported.warnings).toHaveLength(2);
    for (const word of ['queries', 'Constants'])
      expect(imported.warnings.some((w) => w.includes(word))).toBe(true);
    const saved = new DOMParser().parseFromString(serializeTapn(imported.net), 'application/xml');
    for (const tag of ['query', 'constant']) expect(saved.querySelector(tag)).toBeNull();
    expect(saved.querySelectorAll('labels')).toHaveLength(1);
  });
  it('warns about unused constant definitions too', () => {
    const source = mutateXml((document) =>
      append(document, 'pnml', '<constant name="UNUSED" value="7"/>'),
    );
    expect(parseTapn(source).warnings.some((w) => w.includes('Constants'))).toBe(true);
  });
});

describe('rejecting unsupported and malformed files', () => {
  it.each([
    '<pnml>',
    '<other/>',
    '<pnml/>',
    '<!DOCTYPE pnml><pnml/>',
    '<!DOCTYPE pnml [<!ENTITY secret "value">]><pnml/>',
  ])('rejects XML %s', (source) => expect(() => parseTapn(source)).toThrow());
  it.each(['isTimed', 'isColored', 'isGame', 'isStochastic'])('rejects %s features', (feature) =>
    expect(() => parseTapn(changeAttribute('feature', feature, 'true'))).toThrow(),
  );
  it('requires an explicit untimed feature declaration', () =>
    expect(() =>
      parseTapn(mutateXml((document) => document.querySelector('feature')!.remove())),
    ).toThrow());
  it('rejects multiple templates including inactive templates', () =>
    expect(() =>
      parseTapn(
        mutateXml((document) => append(document, 'pnml', '<net id="Other" active="false"/>')),
      ),
    ).toThrow());
  it('rejects an inactive sole template', () =>
    expect(() => parseTapn(changeAttribute('net', 'active', 'false'))).toThrow());
  it.each(['shared-place', 'shared-transition'])('rejects %s declarations', (tag) =>
    expect(() =>
      parseTapn(mutateXml((document) => append(document, 'pnml', `<${tag} name="Shared"/>`))),
    ).toThrow(),
  );
  it.each([
    ['place', 'invariant', '< 5'],
    ['arc', 'inscription', '[1,inf)'],
    ['transition', 'urgent', 'true'],
    ['transition', 'player', '1'],
    ['transition', 'priority', '1'],
    ['arc', 'type', 'transport'],
    ['arc', 'type', 'reset'],
  ])('rejects unsupported %s %s=%s', (selector, key, value) =>
    expect(() => parseTapn(changeAttribute(selector, key, value))).toThrow(),
  );
  it.each([
    ['place', '<initialMarkingAge><token age="1"/></initialMarkingAge>'],
    ['place', '<hlinitialMarking/>'],
    ['place', '<colorinvariant/>'],
    ['place', '<type/>'],
    ['transition', '<condition/>'],
    ['arc', '<hlinscription/>'],
    ['arc', '<colorinterval/>'],
    ['net', '<transportArc source="p" target="t"/>'],
  ])('rejects unsupported content inside %s: %s', (selector, content) =>
    expect(() => parseTapn(mutateXml((document) => append(document, selector, content)))).toThrow(),
  );
  it.each([
    '{',
    '{}',
    '{"format":"other","version":1}',
    '{"format":"tapaal-web-untimed","version":2}',
    '{"format":"tapaal-web-untimed","version":1,"net":null}',
  ])('rejects invalid JSON %s', (source) => expect(() => parseJson(source)).toThrow());
  it.each(['-1', '0.5', 'NaN', 'Infinity', '9007199254740992'])(
    'rejects invalid token count %s',
    (value) => expect(() => parseTapn(changeAttribute('place', 'initialMarking', value))).toThrow(),
  );
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', 'UNKNOWN_CONSTANT'])(
    'rejects invalid weight %s',
    (value) => expect(() => parseTapn(changeAttribute('arc', 'weight', value))).toThrow(),
  );
  it.each([
    ['source', 'missing'],
    ['target', 'missing'],
    ['source', 't'],
    ['target', 'q'],
  ])('rejects invalid arc %s=%s', (key, value) =>
    expect(() => parseTapn(changeAttribute('arc', key, value))).toThrow(),
  );
  it('rejects inhibitor arcs from transitions', () =>
    expect(() => parseTapn(changeAttribute('arc[id="b"]', 'type', 'tapnInhibitor'))).toThrow());
  it('rejects duplicate node IDs and duplicate arcs', () => {
    expect(() => parseTapn(changeAttribute('place[id="q"]', 'id', 'p'))).toThrow();
    expect(() =>
      parseTapn(
        mutateXml((document) =>
          append(document, 'net', '<arc id="duplicate" source="p" target="t" weight="1"/>'),
        ),
      ),
    ).toThrow();
  });
  it('validates both export formats instead of saving corrupt documents', () => {
    const net = structuredClone(example);
    net.arcs[0].weight = 0;
    expect(() => serializeTapn(net)).toThrow();
    expect(() => serializeJson(net)).toThrow();
    expect(() =>
      parseJson(JSON.stringify({ format: 'tapaal-web-untimed', version: 1, net })),
    ).toThrow();
  });
});

describe('desktop compatibility boundaries', () => {
  it('repairs real ERK arc ID collisions without changing endpoints or weights', () => {
    const source = readFileSync('../src/main/resources/Example nets/ERK.tapn', 'utf8');
    const original = new DOMParser().parseFromString(source, 'application/xml');
    const expected = Array.from(original.querySelectorAll('arc')).map((arc) => ({
      source: arc.getAttribute('source'),
      target: arc.getAttribute('target'),
      weight: Number(arc.getAttribute('weight')),
      kind: arc.getAttribute('type') === 'tapnInhibitor' ? 'inhibitor' : 'normal',
    }));
    const imported = parseTapn(source, 'ERK.tapn');
    expect(
      imported.net.arcs.map(({ source, target, weight, kind }) => ({
        source,
        target,
        weight,
        kind,
      })),
    ).toEqual(expected);
    const ids = [...imported.net.nodes, ...imported.net.arcs].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(imported.warnings.some((warning) => warning.includes('Duplicate arc IDs'))).toBe(true);
  });
  it('repairs arc IDs that collide with a node or another repaired arc ID', () => {
    const source = mutateXml((document) => {
      document.querySelector('arc[id="a"]')!.setAttribute('id', 'p');
      document.querySelector('arc[id="b"]')!.setAttribute('id', 'p');
      document.querySelector('arc[id="c"]')!.setAttribute('id', 'p_1');
    });
    const imported = parseTapn(source);
    expect(imported.net.arcs.map(({ id: _id, ...arc }) => arc)).toEqual(
      example.arcs.map(({ id: _id, ...arc }) => arc),
    );
    const ids = [...imported.net.nodes, ...imported.net.arcs].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(imported.warnings.some((warning) => warning.includes('Duplicate arc IDs'))).toBe(true);
  });
  it.each(['tokens', 'weight'] as const)('round trips the maximum Java int %s', (field) => {
    const net = structuredClone(example);
    if (field === 'tokens') net.nodes[0].tokens = 2147483647;
    else net.arcs[0].weight = 2147483647;
    expect(parseTapn(serializeTapn(net)).net).toEqual(net);
  });
  it.each(['tokens', 'weight'] as const)(
    'requires JSON for %s above the Java int boundary',
    (field) => {
      const net = structuredClone(example);
      if (field === 'tokens') net.nodes[0].tokens = 2147483648;
      else net.arcs[0].weight = 2147483648;
      expect(() => serializeTapn(net)).toThrow(/JSON/);
      expect(parseJson(serializeJson(net)).net).toEqual(net);
    },
  );
});
