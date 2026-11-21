// @vitest-environment jsdom
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
import { DocumentSimulation } from '../timed-ui';
import { resolveAuthored } from './authored-model';
import {
  displayNumeric,
  numeric,
  createGameDocument,
  copySelection,
  copyComponent,
} from '../editor-workspace';
import { undoAuthored, redoAuthored } from './authored-documents';
function source(timed = false): SharedSource {
  return {
    name: 'Game',
    type: { timed, game: true, colored: false, stochastic: false },
    constants: [],
    shared: { places: [], transitions: [] },
    components: [
      {
        id: 'c',
        active: true,
        net: {
          name: 'Game',
          template: 'C',
          nodes: [
            { id: 'p', name: 'P', kind: 'place', tokens: 1, x: 0, y: 0 },
            {
              id: 't',
              name: 'T',
              kind: 'transition',
              tokens: 0,
              x: 50,
              y: 0,
              actor: 'environment',
            },
            { id: 'u', name: 'U', kind: 'transition', tokens: 0, x: 100, y: 0 },
          ],
          arcs: [{ id: 'a', source: 'p', target: 't', kind: 'normal', weight: 1 }],
        },
        ...(timed
          ? { timing: { intervals: {}, invariants: {}, ages: {}, urgent: [], transports: [] } }
          : {}),
      },
    ],
  };
}
const unwrap = <T>(
  r: { ok: true; value: T } | { ok: false; issues: readonly { message: string }[] },
): T => {
  if (!r.ok) throw Error(JSON.stringify(r.issues));
  return r.value;
};
it.each([false, true])(
  'manual game retains actors/type, fires either side and replays (%s)',
  (timed) => {
    const s = source(timed),
      run = new DocumentSimulation(s, () => 0);
    expect(run.revision.type.game).toBe(true);
    expect(run.enabled.length).toBe(2);
    if (timed) run.delay('1');
    run.fire('c', 't', { mode: 'oldest' });
    expect(run.enabledFor('c')).toEqual(['u']);
    run.fire('c', 'u', { mode: 'youngest' });
    expect(run.label(run.cursor)).toContain('controller');
    run.back();
    run.forward();
    expect(parseSharedJson(serializeSharedJson(s)).network).toEqual(s);
    expect(parseSharedTapn(serializeSharedTapn(s)).network.type.game).toBe(true);
    expect(() => numeric(s)).toThrow(/manual game/);
    expect(displayNumeric(s).type.game).toBe(true);
    expect(resolveAuthored(s).ok).toBe(false);
  },
);
it('native package-delivery keeps original queries and role bindings through both codecs', () => {
  const input = readFileSync('public/examples/package-delivery.tapn', 'utf8');
  const s = parseSharedTapn(input).network;
  expect(s.type.game).toBe(true);
  expect(
    s.components.flatMap((c) => c.net.nodes).some((n) => 'actor' in n && n.actor === 'environment'),
  ).toBe(true);
  const reopened = parseSharedTapn(serializeSharedTapn(s)).network;
  expect(reopened.savedQueries?.xml).toEqual(s.savedQueries?.xml);
  expect(parseSharedJson(serializeSharedJson(s)).network).toEqual(s);
  expect(new DocumentSimulation(s).revision.type.game).toBe(true);
});
it.each(['untimedGame', 'game-harddisk'])(
  'opens and preserves original arc labels and game roles for %s',
  (name) => {
    const source = parseSharedTapn(readFileSync(`public/examples/${name}.tapn`, 'utf8')).network;
    const offset = name === 'untimedGame' ? 23 : -7;
    expect(source.type.game).toBe(true);
    expect(source.components.flatMap((c) => c.net.arcs).some((a) => a.nameOffsetX === offset)).toBe(
      true,
    );
    const reopened = parseSharedTapn(serializeSharedTapn(source)).network;
    expect(
      reopened.components.flatMap((c) => c.net.arcs).map((a) => [a.nameOffsetX, a.nameOffsetY]),
    ).toEqual(
      source.components.flatMap((c) => c.net.arcs).map((a) => [a.nameOffsetX, a.nameOffsetY]),
    );
    expect(parseSharedJson(serializeSharedJson(source)).network).toEqual(source);
  },
);
it('actors are closed, transition-only, game-only, including unused pools and inactive locals', () => {
  for (const bad of [
    { ...source(), type: { ...source().type, game: false } },
    {
      ...source(),
      shared: { places: [], transitions: [{ id: 'x', name: 'X', urgent: false, actor: 'bogus' }] },
    },
  ])
    expect(validateSharedSource(bad as SharedSource).ok).toBe(false);
  const s = structuredClone(source());
  s.components[0].net.nodes[0] = { ...s.components[0].net.nodes[0], actor: 'environment' };
  expect(validateSharedSource(s).ok).toBe(false);
});
it('role adoption/detach/history are atomic and source owns one shared role', () => {
  let d = unwrap(openSharedDocument(source()));
  d = unwrap(
    transactShared(d, d.network, {
      kind: 'makeShared',
      componentId: 'c',
      elementId: 't',
      poolId: 'sync',
      name: 'Sync',
    }),
  );
  expect(d.network.shared.transitions[0].actor).toBe('environment');
  expect('actor' in d.network.components[0].net.nodes[1]).toBe(false);
  const before = d;
  d = unwrap(
    transactShared(d, d.network, {
      kind: 'setActor',
      componentId: 'c',
      elementId: 't',
      actor: 'controller',
    }),
  );
  expect(d.past.length).toBe(before.past.length + 1);
  expect(transitionActor(d.network, 'c', 't')).toBe('controller');
  expect(
    transactShared(d, before.network, {
      kind: 'setActor',
      componentId: 'c',
      elementId: 't',
      actor: 'environment',
    }).ok,
  ).toBe(false);
  expect(undoAuthored(d).network).toEqual(before.network);
  expect(redoAuthored(undoAuthored(d)).network).toEqual(d.network);
  d = unwrap(
    transactShared(d, d.network, {
      kind: 'detach',
      componentId: 'c',
      elementId: 't',
      name: 'Detached',
    }),
  );
  expect(transitionActor(d.network, 'c', 't')).toBe('controller');
});
it('component copy preserves local roles; subnet copy refuses before output', () => {
  const d = unwrap(openSharedDocument(source()));
  expect(() => copySelection(d, ['t'])).toThrow(/Game subnet clipboard/);
  const c = copyComponent(d, 'c', 'Copy');
  expect(c.network.components[1].net.nodes[1]).toMatchObject({ actor: 'environment' });
  expect(createGameDocument({ name: 'Empty', componentName: 'C' }).network.type.game).toBe(true);
});
it('all-controller game retains its lens and rejects hostile player metadata', () => {
  const s = source();
  const text = serializeSharedTapn(s);
  expect(() => parseSharedTapn(text.replace('player="1"', 'player="2"'))).toThrow(/player/);
  const all = parseSharedTapn(text.replace('player="1"', 'player="0"')).network;
  expect(parseSharedTapn(serializeSharedTapn(all)).network.type.game).toBe(true);
});
it.each(['oldest', 'youngest', 'random', 'manual'] as const)(
  'no-pool game uses role-aware adapter for %s',
  (mode) => {
    const s = source(true),
      run = new DocumentSimulation(s, () => 0);
    const ref = { componentId: 'c', elementId: 't' };
    const bindings = Object.fromEntries(
      run.eligibleInputs(ref).map((i) => [i.arcId, [i.tokens[0].id]]),
    );
    run.fire('c', 't', mode === 'manual' ? { mode, bindings } : mode);
    expect(run.cursor).toBe(1);
    expect(run.label(1)).toContain('environment');
    expect(run.revision.type.game).toBe(true);
  },
);
it('default Controller command is a no-op, malformed roles fail and shared adoption is explicit', () => {
  let d = unwrap(openSharedDocument(source()));
  expect(
    unwrap(
      transactShared(d, d.network, {
        kind: 'setActor',
        componentId: 'c',
        elementId: 'u',
        actor: 'controller',
      }),
    ),
  ).toBe(d);
  expect(
    transactShared(d, d.network, {
      kind: 'setActor',
      componentId: 'c',
      elementId: 't',
      actor: undefined,
    } as never).ok,
  ).toBe(false);
  d = unwrap(
    transactShared(d, d.network, {
      kind: 'createTransitionPool',
      pool: { id: 'pool', name: 'Pool', urgent: false, actor: 'controller' },
    }),
  );
  const command = {
    kind: 'usePool' as const,
    componentId: 'c',
    elementId: 't',
    poolId: 'pool',
    acceptPoolValues: false,
  };
  expect(transactShared(d, d.network, command).ok).toBe(false);
  d = unwrap(transactShared(d, d.network, { ...command, acceptPoolValues: true }));
  const native = serializeSharedTapn(d.network);
  expect(parseSharedTapn(native).network.shared.transitions[0].actor).toBe('controller');
  expect(() =>
    parseSharedTapn(
      native.replace(
        '<shared-transition name="Pool" urgent="false" player="0"',
        '<shared-transition name="Pool" urgent="false" player="1"',
      ),
    ),
  ).toThrow(/disagrees/);
});
