// @vitest-environment jsdom
/** Independent review probes (Opus/high) for game nets + arc-label offsets. Read-only to production. */
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateSharedSource,
  openSharedDocument,
  transactShared,
  transitionActor,
  type SharedSource,
} from './authored-shared';
import {
  parseSharedTapn,
  parseSharedJson,
  serializeSharedJson,
  serializeSharedTapn,
} from './shared-files';
import { moveArcLabel } from './arc-geometry';
import { editElement, timingDraft } from '../constants-editor';
import { DocumentSimulation } from '../timed-ui';
import {
  activeNet,
  commitComponentNet,
  displayNumeric,
  numeric,
  setTransitionUrgent,
  removeComponentElements,
  unwrap as wsUnwrap,
} from '../editor-workspace';

const unwrap = <T>(
  r: { ok: true; value: T } | { ok: false; issues: readonly { message: string }[] },
): T => {
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
};
/** Timed game: local Environment transition E, shared Environment pool S (urgent) with member m,
 *  local Controller U, constant-weighted arc with moved label. */
function game(): SharedSource {
  return {
    name: 'Review',
    type: { timed: true, game: true, colored: false, stochastic: false },
    constants: [{ id: 'k', name: 'K', value: 2 }],
    shared: {
      places: [],
      transitions: [{ id: 'S', name: 'Sync', urgent: true, actor: 'environment' }],
    },
    components: [
      {
        id: 'c',
        active: true,
        net: {
          name: 'Review',
          template: 'C',
          nodes: [
            { id: 'p', name: 'P', kind: 'place', tokens: 2, x: 0, y: 0 },
            {
              id: 'e',
              name: 'E',
              kind: 'transition',
              tokens: 0,
              x: 100,
              y: 0,
              actor: 'environment',
            },
            { id: 'u', name: 'U', kind: 'transition', tokens: 0, x: 100, y: 100 },
            { id: 'm', kind: 'transition', x: 100, y: 200, sharedId: 'S' },
          ],
          arcs: [
            {
              id: 'a',
              source: 'p',
              target: 'e',
              kind: 'normal',
              weight: { constantId: 'k' },
              nameOffsetX: 13,
              nameOffsetY: -9,
            },
            { id: 'b', source: 'p', target: 'm', kind: 'normal', weight: 1 },
            { id: 'c2', source: 'p', target: 'u', kind: 'normal', weight: 1 },
          ],
        },
        timing: {
          intervals: {},
          invariants: {},
          ages: {},
          urgent: [],
          transports: [],
        },
      },
    ],
  } as SharedSource;
}

it('R1 game source is valid and keeps one global actor authority', () => {
  const s = game();
  expect(validateSharedSource(s).ok).toBe(true);
  expect(transitionActor(s, 'c', 'm')).toBe('environment');
  expect(transitionActor(s, 'c', 'u')).toBe('controller');
});

it('R2 arc-label drag commit in a game preserves actors, urgency, membership, constant weight', () => {
  let d = unwrap(openSharedDocument(game()));
  const before = d.network;
  const dragged = moveArcLabel(activeNet(d), 'b', { x: -31.9, y: 7.2 });
  d = commitComponentNet(d, dragged);
  const c = d.network.components[0];
  expect(c.net.arcs.find((a) => a.id === 'b')).toMatchObject({ nameOffsetX: -31, nameOffsetY: 7 });
  expect(c.net.arcs.find((a) => a.id === 'a')).toMatchObject({
    weight: { constantId: 'k' },
    nameOffsetX: 13,
    nameOffsetY: -9,
  });
  expect(c.net.nodes.find((n) => n.id === 'e')).toMatchObject({ actor: 'environment' });
  expect(c.net.nodes.find((n) => n.id === 'm')).toEqual(
    before.components[0].net.nodes.find((n) => n.id === 'm'),
  );
  expect(d.network.shared).toEqual(before.shared);
  expect(d.network.type).toEqual(before.type);
  expect(d.past.length).toBe(1);
});

it('R3 UI-shaped property edits (display element) and deletion keep local actors', () => {
  let d = unwrap(openSharedDocument(game()));
  const display = activeNet(d).nodes.find((n) => n.id === 'e')!;
  expect('actor' in display).toBe(false);
  d = editElement(d, {
    element: { ...display, name: 'E2' },
    weightText: '',
    timing: { ...timingDraft(d, display), urgent: true },
  });
  expect(transitionActor(d.network, 'c', 'e')).toBe('environment');
  expect(d.network.components[0].timing!.urgent).toContain('e');
  d = removeComponentElements(d, ['u']);
  expect(transitionActor(d.network, 'c', 'e')).toBe('environment');
  expect(d.network.type.game).toBe(true);
});

it('F1 regression: urgency edits preserve game actors before and after native reopen', () => {
  const d = unwrap(openSharedDocument(game()));
  const changed = setTransitionUrgent(d, 'e', true);
  expect(changed.network.components[0].timing!.urgent).toContain('e');
  expect(transitionActor(changed.network, 'c', 'e')).toBe('environment');
  expect(changed.network.type.game).toBe(true);
  expect(changed.past).toHaveLength(1);
  // Native reopen makes every local game transition carry an explicit actor, Controllers included.
  const reopened = unwrap(openSharedDocument(parseSharedTapn(serializeSharedTapn(game())).network));
  const u = reopened.network.components[0].net.nodes.find((n) => n.name === 'U')!;
  expect(u).toMatchObject({ actor: 'controller' });
  const updated = setTransitionUrgent(reopened, u.id, true);
  expect(updated.network.components[0].timing!.urgent).toContain(u.id);
  expect(transitionActor(updated.network, reopened.session.componentId, u.id)).toBe('controller');
});

it('R4 fractional offsets in a GAME refuse native export (no silent truncation) and stay exact in JSON', () => {
  const s = structuredClone(game());
  (s.components[0].net.arcs[0] as { nameOffsetX: number }).nameOffsetX = 2.5;
  expect(validateSharedSource(s).ok).toBe(true);
  expect(parseSharedJson(serializeSharedJson(s)).network).toEqual(s);
  expect(() => serializeSharedTapn(s)).toThrow();
});

it('R5 native game roundtrip keeps roles, pool actor, urgency, constants and offsets', () => {
  const s = game();
  const reopened = parseSharedTapn(serializeSharedTapn(s)).network;
  expect(reopened.type).toEqual(s.type);
  expect(reopened.shared.transitions[0]).toMatchObject({
    name: 'Sync',
    urgent: true,
    actor: 'environment',
  });
  const nodes = reopened.components[0].net.nodes;
  expect(
    nodes.find((n) => n.name === 'E' || ('actor' in n && n.actor === 'environment')),
  ).toBeTruthy();
  expect(nodes.filter((n) => 'sharedId' in n).every((n) => !('actor' in n))).toBe(true);
  const arcs = reopened.components[0].net.arcs;
  expect(arcs.some((a) => a.nameOffsetX === 13 && a.nameOffsetY === -9)).toBe(true);
  expect(arcs.some((a) => typeof a.weight === 'object')).toBe(true);
});

it('R6 hostile actor fields: member, casing, nongame, place, accessor, prototype', () => {
  const variants: ((s: SharedSource) => void)[] = [
    (s) => Object.assign(s.components[0].net.nodes[3], { actor: 'environment' }),
    (s) => Object.assign(s.components[0].net.nodes[1], { actor: 'Environment' }),
    (s) => Object.assign(s, { type: { ...s.type, game: false } }),
    (s) => Object.assign(s.components[0].net.nodes[0], { actor: 'controller' }),
    (s) =>
      Object.defineProperty(s.components[0].net.nodes[2], 'actor', {
        get: () => 'environment',
        enumerable: true,
      }),
    (s) => Object.setPrototypeOf(s.components[0].net.nodes[2], { actor: 'environment' }),
    (s) => Object.assign(s.shared.transitions[0], { actor: '__proto__' }),
  ];
  for (const mutate of variants) {
    const s = structuredClone(game());
    mutate(s);
    expect(validateSharedSource(s).ok).toBe(false);
  }
  // Inactive local and unused pool in a nongame still refuse actors.
  const inactive = structuredClone(game());
  Object.assign(inactive, { type: { ...inactive.type, game: false } });
  inactive.shared = { places: [], transitions: [] };
  (inactive.components as unknown as { active: boolean }[])[0].active = false;
  inactive.components[0].net = {
    ...inactive.components[0].net,
    nodes: inactive.components[0].net.nodes.filter((n) => !('sharedId' in n)),
    arcs: inactive.components[0].net.arcs.filter((a) => a.id !== 'b'),
  };
  expect(validateSharedSource(inactive).ok).toBe(false);
});

it('R7 localActorEdit refuses a member target and a spoofed transition kind for a place', () => {
  const d = unwrap(openSharedDocument(game()));
  const member = d.network.components[0].net.nodes[3];
  expect(
    transactShared(d, d.network, {
      kind: 'localActorEdit',
      actor: 'controller',
      edit: {
        kind: 'editElement',
        componentId: 'c',
        element: { ...member, name: 'Sync', tokens: 0 } as never,
        timing: null,
      },
    }).ok,
  ).toBe(false);
  expect(
    transactShared(d, d.network, {
      kind: 'localActorEdit',
      actor: 'environment',
      edit: {
        kind: 'editElement',
        componentId: 'c',
        element: { id: 'p', name: 'P', kind: 'transition', tokens: 0, x: 0, y: 0 },
        timing: null,
      },
    }).ok,
  ).toBe(false);
  expect(d.network).toEqual(game());
});

it('R8 public projections keep the game flag; scalar paths refuse', () => {
  const s = game();
  expect(() => numeric(s)).toThrow(/game/i);
  const display = displayNumeric(s);
  expect(display.type.game).toBe(true);
  expect(() => new DocumentSimulation(display)).toThrow();
  expect(new DocumentSimulation(s).revision.type.game).toBe(true);
});

it('R9 native import: player without isGame=true is conservatively refused (native would infer a game)', () => {
  const xml = serializeSharedTapn(game()).replace(/isGame="true"/, 'isGame="false"');
  expect(() => parseSharedTapn(xml)).toThrow(/isGame/);
  const missing = serializeSharedTapn(game()).replace(/\s*isGame="true"/, '');
  expect(() => parseSharedTapn(missing)).toThrow();
});

it('R10 native single-attribute and fractional arc offsets in a game file', () => {
  const text = serializeSharedTapn(game());
  const single = text.replace(/nameOffsetY="-9"/, '');
  const a = parseSharedTapn(single).network.components[0].net.arcs.find(
    (x) => typeof x.weight === 'object',
  )!;
  expect([a.nameOffsetX ?? 0, a.nameOffsetY ?? 0]).toEqual([0, 0]);
  expect(() => parseSharedTapn(text.replace(/nameOffsetX="13"/, 'nameOffsetX="13.5"'))).toThrow();
});

it.each([
  ['package-delivery', 'timed'],
  ['untimedGame', 'untimed'],
  ['game-harddisk', 'timed'],
])('R11 original %s opens as a %s game; native save/reopen keeps the role multiset', (name) => {
  const s = parseSharedTapn(readFileSync(`public/examples/${name}.tapn`, 'utf8')).network;
  expect(s.type.game).toBe(true);
  const roles = (x: SharedSource) =>
    x.components
      .flatMap((c) =>
        c.net.nodes
          .filter((n) => n.kind === 'transition')
          .map((n) => `${c.net.template}/${transitionActor(x, c.id, n.id)}`),
      )
      .sort();
  const reopened = parseSharedTapn(serializeSharedTapn(s)).network;
  expect(roles(reopened)).toEqual(roles(s));
  expect(roles(s).some((r) => r.endsWith('environment'))).toBe(true);
  expect(reopened.savedQueries?.xml).toEqual(s.savedQueries?.xml);
  const run = new DocumentSimulation(s, () => 0);
  expect(run.revision.type.game).toBe(true);
  expect(wsUnwrap(openSharedDocument(s)).network.type.game).toBe(true);
});
