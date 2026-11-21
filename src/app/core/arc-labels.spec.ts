import { validateSharedSource, type SharedSource } from './authored-shared';
import {
  parseSharedJson,
  serializeSharedJson,
  parseSharedTapn,
  serializeSharedTapn,
} from './shared-files';
// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { moveArcLabel, arcGeometry, arcLabelPosition } from './arc-geometry';
import { layoutBounds } from './element-layout';
import { parseJson, serializeJson, parseTapn, serializeTapn } from './files';
import { parseNetworkJson, serializeNetworkTapn } from './network-files';
import {
  copySelection,
  parseWebClipboard,
  pasteClipboard,
  serializeNativeClipboard,
} from './clipboard';
import { moveSelection, duplicateSelection } from './selection';
import { validateNet, type Net } from './net';
const net = (): Net => ({
  name: 'Labels',
  template: 'Main',
  nodes: [
    { id: 'p', name: 'P', kind: 'place', x: 100, y: 100, tokens: 1 },
    { id: 't', name: 'T', kind: 'transition', x: 250, y: 140, tokens: 0, angle: 45 },
    { id: 'q', name: 'Q', kind: 'place', x: 400, y: 100, tokens: 0 },
  ],
  arcs: [
    {
      id: 'a',
      source: 'p',
      target: 't',
      kind: 'normal',
      weight: 2,
      bends: [{ x: 170, y: 210, curved: true }],
    },
    { id: 'b', source: 't', target: 'q', kind: 'normal', weight: 3 },
    { id: 'i', source: 'q', target: 't', kind: 'inhibitor', weight: 4 },
  ],
});
it('retains signed offsets for input/output/inhibitor with rotation and curves; old defaults omit keys', () => {
  const original = net();
  expect(parseTapn(serializeTapn(original)).net).toEqual(original);
  const moved = moveArcLabel(
    moveArcLabel(moveArcLabel(original, 'a', { x: 23, y: -17 }), 'b', { x: -7, y: 40 }),
    'i',
    { x: 12, y: -30 },
  );
  expect(parseJson(serializeJson(moved)).net).toEqual(moved);
  expect(parseTapn(serializeTapn(moved)).net).toEqual(moved);
  expect(moveArcLabel(moved, 'a', { x: -23, y: 17 }).arcs[0]).toEqual(original.arcs[0]);
  expect(original.arcs[0]).not.toHaveProperty('nameOffsetX');
  expect(moved.nodes).toEqual(original.nodes);
});
it.each([NaN, Infinity, -Infinity, 1000001, -1000001, '12', null])(
  'refuses malformed offset %s',
  (value) => {
    const n = net();
    Object.assign(n.arcs[0], { nameOffsetX: value });
    expect(() => validateNet(n)).toThrow();
  },
);
it('keeps fractional JSON exact and refuses native export with JSON alternative', () => {
  const n = net();
  n.arcs[0].nameOffsetX = 1.25;
  expect(parseJson(serializeJson(n)).net).toEqual(n);
  expect(() =>
    serializeNetworkTapn({
      name: n.name,
      type: { timed: false, game: false, colored: false, stochastic: false },
      components: [{ id: 'c', active: true, net: n }],
    }),
  ).toThrow(/JSON/);
  expect(() => serializeTapn(n)).toThrow(/JSON/);
  const raw = JSON.parse(serializeJson(n));
  raw.net.arcs[0].surprise = true;
  expect(() => parseNetworkJson(JSON.stringify(raw))).toThrow();
});
it('web clipboard and group translations retain relative offsets exactly; native clipboard refuses loss', () => {
  const n = moveArcLabel(net(), 'a', { x: -43, y: 27 });
  n.arcs[0].nameOffsetY = 27.5;
  const ids = [...n.nodes, ...n.arcs].map((a) => a.id);
  const payload = copySelection(n, ids);
  expect(() => serializeNativeClipboard(payload.content)).toThrow(/web clipboard/);
  const pasted = pasteClipboard(n, parseWebClipboard(payload.webText), {
    offset: { x: 30, y: 30 },
  });
  expect(pasted.net.arcs.at(-3)).toMatchObject({ nameOffsetX: -43, nameOffsetY: 27.5 });
  expect(moveSelection(n, ids, { x: 30, y: 30 }).arcs[0]).toMatchObject({
    nameOffsetX: -43,
    nameOffsetY: 27.5,
  });
  expect(duplicateSelection(n, ids).net.arcs.at(-3)).toMatchObject({
    nameOffsetX: -43,
    nameOffsetY: 27.5,
  });
});
it('fits moved label extents in both directions from the native path midpoint', () => {
  for (const delta of [
    { x: 900, y: 800 },
    { x: -900, y: -800 },
  ]) {
    const n = moveArcLabel(net(), 'a', delta),
      p = arcLabelPosition(n.arcs[0], arcGeometry(n, 'a').midpoint),
      b = layoutBounds(n)!;
    expect(b.minX).toBeLessThan(p.x);
    expect(b.maxX).toBeGreaterThan(p.x);
    expect(b.minY).toBeLessThan(p.y);
    expect(b.maxY).toBeGreaterThanOrEqual(p.y);
  }
});

it('uses native paired-offset defaults for old files and validates before truncating', () => {
  const xml = serializeTapn(moveArcLabel(net(), 'a', { x: 23, y: -17 }));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  doc.querySelector('arc')!.removeAttribute('nameOffsetY');
  expect(parseTapn(new XMLSerializer().serializeToString(doc)).net.arcs[0]).not.toHaveProperty(
    'nameOffsetX',
  );
});

it('strict v3 authored readers preserve symbolic bindings and reject unknown/inherited offset records', () => {
  const n = moveArcLabel(net(), 'a', { x: -23, y: 17 });
  const source: SharedSource = {
    name: n.name,
    type: { timed: false, game: false, colored: false, stochastic: false },
    constants: [{ id: '__proto__', name: 'W', value: 2 }],
    shared: { places: [], transitions: [] },
    components: [
      {
        id: 'c',
        active: true,
        net: {
          ...n,
          arcs: n.arcs.map((a) =>
            a.id === 'a' ? { ...a, weight: { constantId: '__proto__' } } : a,
          ),
        },
      },
    ],
  };
  expect(parseSharedJson(serializeSharedJson(source)).network).toEqual(source);
  const reopened = parseSharedTapn(serializeSharedTapn(source)).network;
  expect(reopened.components[0].net.arcs[0]).toMatchObject({ nameOffsetX: -23, nameOffsetY: 17 });
  expect(typeof reopened.components[0].net.arcs[0].weight).toBe('object');
  const bad = JSON.parse(serializeSharedJson(source));
  bad.network.components[0].net.arcs[0].unexpected = true;
  expect(() => parseSharedJson(JSON.stringify(bad))).toThrow();
  const inherited = structuredClone(source);
  Object.setPrototypeOf(inherited.components[0].net.arcs[0], { nameOffsetY: 10 });
  expect(validateSharedSource(inherited).ok).toBe(false);
});
